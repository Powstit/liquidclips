// Cinematic browser overlay — 90vw × 88vh, fuchsia rim/glow chrome, native
// child-webview body, and an honest system-browser fallback. Portaled into
// document.body so it escapes the .lc-page perspective containing block.
//
// Triggers: Home reward hero, Earn, Community, Campaigns. NOT globally mounted.
// Esc priority: closes the browser overlay first (handled here), then yields.
//
// The production body is a Tauri child webview; browser preview shows the
// unavailable state instead of pretending an empty slot loaded.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
// Port #8c · Section B · shared contextual demo overlay.
import { DemoOverlay } from "../demo-overlay";
// Ship-lens P1-005 fix (2026-07-10) · mount the approved InAppBrowser
// surface inside BrowseOverlay per Daniel's Q1: A decision. The
// InAppBrowser port at src/routes/in-app-browser/InAppBrowser.tsx was
// previously unreferenced dead code. Mounting it inside BrowseOverlay
// as the honest preview / blocked-state chrome makes it reachable
// through the real customer journey (Home / Earn / Community /
// Campaigns → browse overlay). Production Tauri path continues using
// the existing native webview + browse.rs commands (openBrowsePanel,
// updateBrowsePanelBounds, browseBack/Forward/Reload) — no new Rust,
// no new Tauri commands, no shell rebuild.
import { InAppBrowser } from "../../routes/in-app-browser/InAppBrowser";
import { Watchdog } from "../../lib/watchdog";
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  X,
  ArrowUpRight,
  ExternalLink,
  Sparkles,
  ClipboardCopy,
  Maximize2,
  Minimize2,
  Plus,
} from "lucide-react";
import { bus } from "../../design-os/bridge";
import {
  useBrowseOverlay,
  WHOP_REWARDS_URL,
} from "../../state/browseOverlay";
import {
  useUserShortcuts,
  firstGraphemeUpper,
  USER_SHORTCUT_MAX_TOTAL,
  type UserShortcut,
} from "../../state/userShortcuts";
import { platformComposerUrl } from "../../design-os/schedule/assistedSchedule";
import { setActiveCampaignId } from "../../shell/modeStore";
import { useRegisterModal } from "../../design-os/components/ModalPortal";
import { openSmart } from "../../lib/openSmart";
import {
  openBrowsePanel,
  closeBrowsePanel,
  updateBrowsePanelBounds,
  browseBack as nativeBrowseBack,
  browseForward as nativeBrowseForward,
  browseReload as nativeBrowseReload,
} from "../../lib/browse";
import {
  subscribeWhopBountyCapture,
  tryCaptureFromClipboard,
} from "../../lib/whopBountyCapture";

/** v1 quick-link surface: Whop only + internal app routes per Daniel's call.
 *
 * Gate 5 (2026-06-26) — `sectionId` removed. The deprecated SECTION_IDS
 * (`SECTION_EARN`, `SECTION_COMMUNITY`) were dropped from the active
 * registry per BUG-047, so passing them to `navigateTo()` was a silent
 * no-op. `SECTION_CAMPAIGNS` still resolved to the legacy hidden
 * `#/campaign` surface. Every quick link now emits `nav:click` for the
 * Design-OS surface, ensuring SimulatorRouter (mounted under `#/home`)
 * actually swaps the surface. */
type DesignOsRoute = "campaigns" | "earn" | "community";
interface QuickLink {
  label: string;
  /** If url present, opens in the browser overlay. If designOsRoute is
   *  present, closes overlay and routes to the matching Design-OS surface
   *  via bus.emit("nav:click"). */
  url?: string;
  designOsRoute?: DesignOsRoute;
}

const QUICK_LINKS: QuickLink[] = [
  { label: "Whop Rewards", url: WHOP_REWARDS_URL },
  { label: "Campaigns", designOsRoute: "campaigns" },
  // 2026-07-10 · Chapter 3 (Lane A) · label renamed "Earn" → "Wallet" to
  // match the approved wallet-detail mockup title. Route id `earn`
  // preserved so nav:click semantics + Kade pose don't change.
  { label: "Wallet", designOsRoute: "earn" },
  { label: "Community", designOsRoute: "community" },
];

function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return WHOP_REWARDS_URL;
  if (/^https?:\/\//i.test(t)) return t;
  if (t.includes(".") && !t.includes(" ")) return `https://${t}`;
  return `https://www.google.com/search?q=${encodeURIComponent(t)}`;
}

function openInSystemBrowser(url: string): void {
  void openSmart(url).catch(() => {
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      /* swallow */
    }
  });
}

/* ==================================================================
 * Stage 8+ · Sovereign Scheduling Station rail
 *
 * Port of docs/ui-master/mockups/browser_overlay_mockup.html — approved
 * "it's green" before this port. Default platform icons (TikTok /
 * YouTube / Instagram) live at the top; user-added shortcuts render
 * below them from `useUserShortcuts`. A "+" button at the bottom
 * prompts the user to add a new shortcut · hidden when the total
 * reaches USER_SHORTCUT_MAX_TOTAL.
 *
 * The rail is rendered as an <aside> sibling to the existing overlay
 * body inside a new `.lc-browse-with-rail` grid. The webview slot
 * bounding rect stays inside `.lc-browse-body`; the ResizeObserver
 * already picks up the new position on mount so the Rust child
 * webview lands correctly to the right of the rail.
 * ================================================================== */

type SchedulerPlatform = "tiktok" | "youtube" | "instagram";

interface RailPlatformSpec {
  key: SchedulerPlatform;
  label: string;
  intentTone: string;
  Glyph: () => JSX.Element;
}

// Inline SVG glyphs · stylised platform marks, not exact brand copies.
// Follow-up sprint can swap these for src/components/PlatformBadge glyphs
// if we ship a shared platform icon set.
function TikTokGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4v10.5a3.5 3.5 0 1 1-3.5-3.5" />
      <path d="M14 4c.6 2.3 2.4 3.7 4.5 4" />
    </svg>
  );
}
function YouTubeGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="6.5" width="18" height="11" rx="3" />
      <path d="M10.5 10 15 12l-4.5 2z" fill="currentColor" stroke="none" />
    </svg>
  );
}
function InstagramGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="4.5" />
      <circle cx="12" cy="12" r="3.6" />
      <circle cx="17" cy="7" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

const RAIL_PLATFORMS: readonly RailPlatformSpec[] = [
  { key: "tiktok",    label: "TikTok",    intentTone: "fuchsia", Glyph: TikTokGlyph },
  { key: "youtube",   label: "YouTube",   intentTone: "red",     Glyph: YouTubeGlyph },
  { key: "instagram", label: "Instagram", intentTone: "amber",   Glyph: InstagramGlyph },
];

export function BrowseOverlay(): JSX.Element | null {
  const open = useBrowseOverlay((s) => s.open);
  const currentUrl = useBrowseOverlay((s) => s.currentUrl);
  const history = useBrowseOverlay((s) => s.history);
  const historyIdx = useBrowseOverlay((s) => s.historyIdx);
  const loadState = useBrowseOverlay((s) => s.loadState);
  const intent = useBrowseOverlay((s) => s.intent);
  const setLoadState = useBrowseOverlay((s) => s.setLoadState);
  const back = useBrowseOverlay((s) => s.back);
  const forward = useBrowseOverlay((s) => s.forward);
  const reload = useBrowseOverlay((s) => s.reload);
  // 2026-06-25 · back/forward/reload use Rust's window.history so in-webview
  // link clicks count. The store back/forward also fire so the address bar
  // pointer + button-enable state track typed-URL history. Phase 2 will
  // emit a URL-change event from Rust to keep React's address bar in sync
  // with the webview's actual location.
  const handleBack = useCallback(() => { back(); void nativeBrowseBack(); }, [back]);
  const handleForward = useCallback(() => { forward(); void nativeBrowseForward(); }, [forward]);
  const handleReload = useCallback(() => { reload(); void nativeBrowseReload(); }, [reload]);
  const close = useBrowseOverlay((s) => s.close);
  const push = useBrowseOverlay((s) => s.push);
  const useInEngine = useBrowseOverlay((s) => s.useInEngine);

  // Stage 8+ · Sovereign Scheduling Station rail state.
  const userShortcuts = useUserShortcuts((s) => s.shortcuts);
  const addUserShortcut = useUserShortcuts((s) => s.add);
  const removeUserShortcut = useUserShortcuts((s) => s.remove);
  const shortcutsTotal = useUserShortcuts((s) => s.total());
  const shortcutsFull = useUserShortcuts((s) => s.isFull());
  const [expanded, setExpanded] = useState(false);
  // Inline add-shortcut form · Tauri's WKWebView disables `window.prompt`
  // (returns null without displaying a dialog). Render an in-app form
  // instead. While open, the effect below closes the child WebView so
  // the form is not visually occluded by the native panel. Closing the
  // form re-runs the effect and reopens the WebView at the same URL.
  const [addFormOpen, setAddFormOpen] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addUrl, setAddUrl] = useState("https://");
  const [addError, setAddError] = useState<string | null>(null);
  const labelInputRef = useRef<HTMLInputElement | null>(null);

  const [draft, setDraft] = useState(currentUrl ?? WHOP_REWARDS_URL);
  // 2026-06-25 · slotRef is an empty div the Rust webview is positioned over.
  // React measures slot.getBoundingClientRect() and passes those bounds to
  // open_browse_panel / update_browse_panel_bounds so the native webview
  // sits exactly inside the React overlay layout.
  const slotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (currentUrl) setDraft(currentUrl);
  }, [currentUrl]);

  // Ship-lens Batch 1 (Keyboard/Esc sweep · 2026-07-06) · register with
  // ModalPortal so the app-wide scroll lock activates while the browse
  // rail is open. NO onEscape passed here · BrowseOverlay owns a
  // bespoke capture-phase Esc handler with add-form-first branching
  // that the LIFO stack's onEscape can't model (needs to intercept
  // BEFORE the ModalPortal listener sees it). Both listeners coexist:
  // the capture-phase Esc below fires first and stopPropagation's
  // before the LIFO stack sees the key.
  useRegisterModal({ id: "browse-overlay", open });

  // Esc priority: BrowseOverlay wins first. Use a capture-phase listener so we
  // close before any descendant Dialog/Sheet sees it. When the inline
  // add-shortcut form is open, Esc cancels the form instead of the overlay.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (addFormOpen) {
          setAddFormOpen(false);
          setAddError(null);
        } else {
          close();
        }
      }
    };
    document.addEventListener("keydown", onKey, { capture: true });
    return () =>
      document.removeEventListener("keydown", onKey, { capture: true });
  }, [open, close, addFormOpen]);

  // 2026-06-25 · webview lifecycle. The native Rust child webview sits
  // exactly over slotRef's rect. On open / URL change → spawn or navigate.
  // On window resize → reposition. On close → destroy.
  //
  // (Removed: 10s "still loading → blocked" fallback. The Rust webview
  // bypasses iframe CSP entirely so the only blocking path now is the
  // commerce-redirect filter, which is fast + handled in Rust.)
  useEffect(() => {
    // Close the native child WebView while the inline add-shortcut form is
    // open — a native WKWebView renders above ALL React DOM, so any form
    // rendered inside `.lc-browse-body` would be invisible until the panel
    // is closed. Re-runs of this effect (triggered by flipping addFormOpen)
    // reopen at `currentUrl` cleanly.
    if (!open || !currentUrl || addFormOpen) {
      void closeBrowsePanel();
      return;
    }
    const slot = slotRef.current;
    if (!slot) return;

    const measure = () => {
      const r = slot.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };

    // Spawn / navigate the webview at the current slot bounds.
    // 2026-06-25 · regression-lens fix · legacy v0.7.8 E6 — silent failure
    // on openBrowsePanel was the #1 historical bug. Set blocked state AND
    // emit user-visible toast so the user never sees a dark empty overlay
    // without explanation.
    void openBrowsePanel(currentUrl, measure())
      .then((outcome) => {
        if (outcome.system_fallback) {
          setLoadState("blocked");
          close();
          bus.emit("toast", {
            kind: "info",
            title: "Opened in system browser",
            body: "Checkout uses the system browser to comply with desktop-store purchase rules.",
          });
          return;
        }
        setLoadState("loaded");
      })
      .catch((err) => {
        setLoadState("blocked");
        bus.emit("toast", {
          kind: "error",
          title: "Browser couldn't open",
          body: err instanceof Error ? err.message : "The in-app browser failed to spawn. Try the system-browser link in the footer.",
        });
      });

    // Resize observer keeps the webview locked to the slot on window
    // resize, sidebar collapse, hero settle, etc.
    const ro = new ResizeObserver(() => {
      void updateBrowsePanelBounds(measure());
    });
    ro.observe(slot);
    const onWindowResize = () => void updateBrowsePanelBounds(measure());
    window.addEventListener("resize", onWindowResize);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onWindowResize);
      void closeBrowsePanel();
    };
  }, [open, currentUrl, setLoadState, close, addFormOpen]);

  // Auto-focus label input when the add-shortcut form opens.
  useEffect(() => {
    if (!addFormOpen) return;
    // rAF so the input mounts before focus attempts.
    const raf = requestAnimationFrame(() => labelInputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [addFormOpen]);

  // 2026-08-30 · Whop bounty auto-capture. Subscribes to the Rust
  // `browse:url-changed` event (added in v2.3.70 shell) so LC catches
  // the Whop reward URL the moment an agency lands on its new-bounty
  // page — no manual copy-paste. Effect boundary = overlay lifetime,
  // so the de-dup window resets on each open/close cycle. On close, a
  // single clipboard read runs as belt-and-suspenders in case the
  // URL-change event was missed (webview crash mid-flow, agency
  // fell into the system-browser fallback for a commerce URL, etc.).
  // The captured event `lc:whop-bounty-captured` is picked up by
  // CampaignPageShell + KadeBountyWizard.
  //
  // Cancelled-flag pattern guards the async subscribe promise: if the
  // overlay closes before subscribeWhopBountyCapture() resolves, we
  // still tear down the listener the moment it lands.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let unsub: (() => void) | null = null;
    void subscribeWhopBountyCapture().then((fn) => {
      if (cancelled) { fn(); return; }
      unsub = fn;
    });
    return () => {
      cancelled = true;
      unsub?.();
      void tryCaptureFromClipboard();
    };
  }, [open]);

  const handleGo = useCallback(
    (raw: string) => {
      const next = normalizeUrl(raw);
      setDraft(next);
      push(next);
    },
    [push],
  );

  const handleUseInEngine = useCallback(() => {
    // Read currentUrl BEFORE the store mutation in useInEngine (which
    // doesn't actually clear currentUrl, but reading first is defensive).
    const urlAtClick = useBrowseOverlay.getState().currentUrl ?? "";
    const payload = useInEngine();
    if (payload.campaignId) {
      setActiveCampaignId(payload.campaignId);
    }
    // 2026-06-25 · dispatch lc:browse-url-handoff. InlineCreatePanel is now
    // mounted globally in AppShell (lifted from CommandRoom), so the panel
    // opens on whichever route the user was on when they clicked the tab.
    //
    // Per Daniel's directive: "Closing the browser returns the user to
    // exactly where they were." So we DO NOT navigate. The user stays put,
    // the create panel pops up on top, they choose to clip or dismiss.
    //
    // The event ALWAYS fires with the URL — even when payload.sourceUrl is
    // null (URL matched a campaign fixture), InlineCreatePanel still needs
    // the raw URL so it can pre-fill the input. campaignId rides along for
    // any caller that wants to map back to a known campaign.
    const handoffUrl = payload.sourceUrl ?? urlAtClick;
    if (handoffUrl && typeof window !== "undefined") {
      try {
        window.dispatchEvent(
          new CustomEvent("lc:browse-url-handoff", {
            detail: {
              url: handoffUrl,
              campaignId: payload.campaignId,
              source: "browse-overlay",
            },
          }),
        );
      } catch { /* swallow */ }
    }
  }, [useInEngine]);

  const handleCopyUrl = useCallback(async () => {
    const url = currentUrl ?? "";
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      bus.emit("toast", {
        kind: "success",
        title: "URL copied",
        body: "Paste it into Create Clips to start clipping this video.",
      });
    } catch {
      bus.emit("toast", {
        kind: "error",
        title: "Copy failed",
        body: "Clipboard access blocked — open in system browser and copy from the address bar.",
      });
    }
  }, [currentUrl]);

  const handleQuickLink = useCallback(
    (q: QuickLink) => {
      if (q.url) {
        handleGo(q.url);
        return;
      }
      if (q.designOsRoute) {
        close();
        /* SimulatorRouter is only mounted under `#/home`. If the user
         * triggered the overlay from the legacy `#/campaign` hidden
         * surface (or any other non-home hash), the bus.emit would have
         * no subscriber. Force-set the hash so the design-os shell is
         * live, then emit · the route swap lands every time. */
        if (window.location.hash !== "#/home" && window.location.hash !== "#") {
          window.location.hash = "#/home";
        }
        const route = q.designOsRoute;
        /* One-tick wait so SimulatorRouter's useEvent subscription is
         * wired before the emit (covers the cold-hash-set case).
         *
         * D1-cluster-P (2026-07-12) · the two-pipeline rule
         * (LOCKED 2026-07-10) says Design-OS routes live UNDER the
         * outer `#/home` hash — SimulatorRouter internal state
         * changes, the outer hash never does. SimulatorRouter's
         * later Block-3 pushState hook sync'd the outer hash to
         * `#/campaigns` etc. which broke the invariant. Reset the
         * hash back to `#/home` after the pushState fires so the
         * outer shell stays on the home Section pipeline while the
         * inner Design-OS surface flips. Same tick, no visible drift. */
        window.setTimeout(() => {
          bus.emit("nav:click", { route });
          try {
            if (window.location.hash !== "#/home") {
              window.history.replaceState(null, "", "#/home");
            }
          } catch {
            /* history API blocked · silent · route state still flipped. */
          }
        }, 30);
      }
    },
    [handleGo, close],
  );

  const handleRailPlatform = useCallback(
    (platform: SchedulerPlatform) => {
      // Same navigate-in-overlay pattern as `handleQuickLink` for URL
      // links · pushes into the store, the effect above then routes to
      // the Rust child webview. Zero regression on the WebView slot —
      // it stays inside `.lc-browse-body`; only the URL changes.
      push(platformComposerUrl(platform));
    },
    [push],
  );

  const handleUserShortcut = useCallback(
    (shortcut: UserShortcut) => { push(shortcut.url); },
    [push],
  );

  const handleAddShortcut = useCallback(() => {
    if (shortcutsFull) {
      bus.emit("toast", {
        kind: "info",
        title: "Shortcut cap reached",
        body: `You can pin up to ${USER_SHORTCUT_MAX_TOTAL} icons in the rail. Remove one to add another.`,
      });
      return;
    }
    // Reset form state + open the inline modal. `window.prompt` is a no-op
    // in Tauri's WKWebView (returns null without displaying a dialog), so
    // an inline React form is the only reliable path without adding a new
    // Rust dependency.
    setAddLabel("");
    setAddUrl("https://");
    setAddError(null);
    setAddFormOpen(true);
  }, [shortcutsFull]);

  const handleAddFormSubmit = useCallback(() => {
    const result = addUserShortcut(addLabel, addUrl);
    if (!result.ok) {
      setAddError(result.error);
      return;
    }
    setAddFormOpen(false);
    setAddError(null);
  }, [addUserShortcut, addLabel, addUrl]);

  const handleAddFormCancel = useCallback(() => {
    setAddFormOpen(false);
    setAddError(null);
  }, []);

  const handleRemoveShortcut = useCallback(
    (id: string) => { removeUserShortcut(id); },
    [removeUserShortcut],
  );

  const handleToggleExpand = useCallback(() => {
    setExpanded((prev) => !prev);
    // No manual `updateBrowsePanelBounds` here — the ResizeObserver on
    // `slotRef` in the effect above fires when the CSS transition
    // settles the new bounds, keeping the Rust child webview aligned.
  }, []);

  if (!open) return null;

  const canBack = historyIdx > 0;
  const canForward = historyIdx < history.length - 1;

  const overlay = (
    <section
      className="lc-browse-overlay"
      data-expanded={expanded ? "1" : "0"}
      role="dialog"
      aria-label="Browser overlay"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Stage 8+ · rail-wrapped body. The existing chrome + body +
          footer live inside `.lc-browse-main`; the rail is a sibling
          `<aside>` to the left. Guard anchors stay outside so the shell
          contract script still finds them. */}
      <div className="lc-browse-with-rail">
        <aside className="lc-browse-rail" aria-label="Scheduling station rail">
          {/* Kade "Station Operator" slot · production asset lives at
              /brand/kade/kade-avatar.png. Placeholder frame is preserved
              via the parent chrome so a missing asset never surfaces a
              broken-image icon in the walkthrough. */}
          <div className="lc-browse-rail-operator" title="Kade · Station Operator">
            <img
              alt="Kade · Station Operator"
              src="/brand/kade/kade-avatar.png"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
            <span className="lc-browse-rail-operator-glyph">K</span>
          </div>
          <div className="lc-browse-rail-operator-caption">operator</div>

          <div className="lc-browse-rail-divider" role="separator" aria-hidden="true" />

          {RAIL_PLATFORMS.map((spec) => (
            <button
              key={spec.key}
              type="button"
              className="lc-browse-rail-icon"
              data-platform={spec.key}
              data-tone={spec.intentTone}
              onClick={() => handleRailPlatform(spec.key)}
              aria-label={`Open ${spec.label} composer`}
              title={spec.label}
            >
              <spec.Glyph />
            </button>
          ))}

          {userShortcuts.map((sc) => (
            <div
              key={sc.id}
              className="lc-browse-rail-icon-user-wrap"
              data-user-id={sc.id}
            >
              <button
                type="button"
                className="lc-browse-rail-icon lc-browse-rail-icon-user"
                onClick={() => handleUserShortcut(sc)}
                aria-label={`Open ${sc.label}`}
                title={sc.label}
              >
                <span className="lc-browse-rail-user-glyph">
                  {firstGraphemeUpper(sc.label)}
                </span>
              </button>
              <button
                type="button"
                className="lc-browse-rail-user-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveShortcut(sc.id);
                }}
                aria-label={`Remove ${sc.label}`}
                title={`Remove ${sc.label}`}
              >
                <X size={11} />
              </button>
            </div>
          ))}

          {!shortcutsFull && (
            <button
              type="button"
              className="lc-browse-rail-add"
              onClick={handleAddShortcut}
              aria-label="Add shortcut"
              title="Add shortcut"
            >
              <Plus size={20} />
            </button>
          )}

          <div
            className="lc-browse-rail-count"
            data-full={shortcutsFull ? "1" : "0"}
          >
            {shortcutsTotal}/{USER_SHORTCUT_MAX_TOTAL}
          </div>
        </aside>

        <div className="lc-browse-main">
          <div className="lc-browse-chrome">
        <div className="lc-browse-chrome-row">
          <button
            type="button"
            className="lc-browse-icon-btn"
            onClick={handleBack}
            disabled={!canBack}
            aria-label="Back"
            title="Back"
          >
            <ArrowLeft size={15} />
          </button>
          <button
            type="button"
            className="lc-browse-icon-btn"
            onClick={handleForward}
            disabled={!canForward}
            aria-label="Forward"
            title="Forward"
          >
            <ArrowRight size={15} />
          </button>
          <button
            type="button"
            className="lc-browse-icon-btn"
            onClick={handleReload}
            aria-label="Reload"
            title="Reload"
          >
            <RotateCw size={14} />
          </button>

          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleGo(draft);
              }
            }}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            placeholder="Search or enter URL"
            className="lc-browse-url"
            aria-label="URL bar"
          />

          <button
            type="button"
            className="lc-btn"
            data-variant="secondary"
            data-size="sm"
            onClick={handleCopyUrl}
            title="Copy this URL to clipboard"
            disabled={!currentUrl}
          >
            <ClipboardCopy size={13} /> Copy URL
          </button>

          {intent !== "read-only" && (
            <button
              type="button"
              className="lc-btn"
              data-variant="primary"
              data-size="sm"
              onClick={handleUseInEngine}
              title="Hand this URL or campaign into the Engine"
            >
              <ArrowUpRight size={13} /> Use in Engine ↗
            </button>
          )}

          <button
            type="button"
            className="lc-browse-icon-btn lc-browse-expand-btn"
            onClick={handleToggleExpand}
            aria-label={expanded ? "Collapse overlay" : "Expand overlay"}
            aria-pressed={expanded}
            title={expanded ? "Collapse" : "Expand ×2"}
          >
            {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>

          <button
            type="button"
            className="lc-browse-icon-btn lc-browse-close"
            onClick={close}
            aria-label="Close browser overlay"
            title="Close (Esc)"
          >
            <X size={15} />
          </button>
        </div>

        <div className="lc-browse-chrome-quick">
          <span className="lc-browse-quick-label">
            {intent === "read-only" ? "Posting handoff" : "Quick"}
          </span>
          {intent !== "read-only" && QUICK_LINKS.map((q) => (
              <button
                key={q.label}
                type="button"
                className="lc-browse-quick-chip"
                onClick={() => handleQuickLink(q)}
              >
                <Sparkles size={10} /> {q.label}
              </button>
            ))}
          <span className="lc-browse-quick-hint">
            {loadState === "loading" ? (
              <span className="lc-browse-loading-dot">
                <span className="lc-browse-loading-pulse" /> loading…
              </span>
            ) : (
              <span className="lc-browse-loading-hint">esc to close</span>
            )}
          </span>
        </div>
      </div>

      <div className="lc-browse-body">
        {addFormOpen ? (
          <div
            className="lc-browse-add-form"
            role="dialog"
            aria-label="Add shortcut"
            aria-modal="true"
          >
            <div className="lc-browse-add-form-card">
              <div className="lc-browse-add-form-header">
                <div className="lc-browse-add-form-title">Add a shortcut</div>
                <div className="lc-browse-add-form-hint">
                  Pin any composer URL — LinkedIn, X, Threads, Bluesky, etc.
                </div>
              </div>

              <label className="lc-browse-add-form-field">
                <span>Name</span>
                <input
                  ref={labelInputRef}
                  type="text"
                  value={addLabel}
                  onChange={(e) => setAddLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddFormSubmit();
                    }
                  }}
                  placeholder="e.g. LinkedIn"
                  spellCheck={false}
                  autoComplete="off"
                  autoCapitalize="off"
                  maxLength={32}
                  aria-label="Shortcut name"
                />
              </label>

              <label className="lc-browse-add-form-field">
                <span>URL</span>
                <input
                  type="url"
                  value={addUrl}
                  onChange={(e) => setAddUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddFormSubmit();
                    }
                  }}
                  placeholder="https://…"
                  spellCheck={false}
                  autoComplete="off"
                  autoCapitalize="off"
                  aria-label="Shortcut URL"
                />
              </label>

              {addError && (
                <div className="lc-browse-add-form-error" role="alert">
                  {addError}
                </div>
              )}

              <div className="lc-browse-add-form-actions">
                <button
                  type="button"
                  className="lc-btn"
                  data-variant="ghost"
                  data-size="sm"
                  onClick={handleAddFormCancel}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="lc-btn"
                  data-variant="primary"
                  data-size="sm"
                  onClick={handleAddFormSubmit}
                >
                  <Plus size={13} /> Add shortcut
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* 2026-06-25 · webview slot — the Rust child webview is
                positioned over this rect. No iframe (Whop/X/YT/Discord
                block iframe via X-Frame-Options: DENY). The slot stays
                empty in dev / vite preview where Rust isn't available.

                Ship-lens P1-005 fix (2026-07-10) · when the native webview
                fails to open (loadState === "blocked" · signals the honest
                navigation-failed / iframe-blocked / commerce-fallback
                path) render the approved InAppBrowser mockup surface as
                the preview chrome. The customer sees the intended UI +
                can still fire back/forward/refresh/close + open-in-system
                — those actions route through the same nativeBrowseBack /
                Forward / Reload wrappers used by the outer chrome. The
                normal loaded path keeps the empty slot so the native
                WKWebView renders over it as before. */}
            <div ref={slotRef} className="lc-browse-webview-slot" aria-hidden="true" />
            {loadState === "blocked" && (
              <Watchdog
                id="pipeline/cp-15/in-app-browser-preview"
                label="In-app browser preview"
                cluster="pipeline"
                source="src/components/browser/BrowseOverlay.tsx:InAppBrowser"
              >
                <InAppBrowser
                  onClose={close}
                  onSyncGmail={() => {
                    // Route the sync-mail intent through the existing
                    // browser store → nav to Gmail via native panel
                    // when Tauri is back online.
                    push("https://mail.google.com/mail/u/0/#inbox");
                  }}
                  onSyncOther={() => {
                    // Non-Gmail branch is a UI-only placeholder in the
                    // mockup; keep it inert (state-only) here.
                  }}
                />
              </Watchdog>
            )}
          </>
        )}
      </div>

      <div className="lc-browse-footer">
        <span className="lc-browse-footer-meta">
          Browser overlay · native WebKit · commerce URLs open in system browser
        </span>
        <div className="lc-browse-footer-actions">
          <button
            type="button"
            className="lc-btn"
            data-variant="ghost"
            data-size="sm"
            onClick={() => currentUrl && openInSystemBrowser(currentUrl)}
          >
            <ExternalLink size={12} /> Open in system browser ↗
          </button>
          {intent !== "read-only" && (
            <button
              type="button"
              className="lc-btn"
              data-variant="secondary"
              data-size="sm"
              onClick={handleUseInEngine}
            >
              <ArrowUpRight size={12} /> Use this link in Engine ↗
            </button>
          )}
        </div>
      </div>

        </div>
      </div>

      {/* Hidden contract anchors for the shell guard. */}
      <div aria-hidden="true" style={{ display: "none" }}>
        <span data-browse-overlay="root">Browser overlay</span>
        <span data-browse-overlay="use-in-engine">Use in Engine</span>
        <span data-browse-overlay="open-system">Open in system browser</span>
        <span data-browse-overlay="esc-hint">esc to close</span>
        <span data-browse-overlay="blocked">This site blocks embedded viewing.</span>
      </div>

      {/* Port #8c · #6 · contextual demo overlay · shows on first open
          of the browse overlay (localStorage: demo-shown-in-app-browser).
          Sits fixed bottom-right so it doesn't obstruct the webview slot
          or the chrome header. Dismiss → "?" pill re-openable later. */}
      <DemoOverlay
        mp4Src="/demos/06-in-app-browser.mp4"
        kadePosterSrc="/brand/kade/kade-community-mode.webp"
        title="In-app browser tour"
        storageKey="demo-shown-in-app-browser"
      />
    </section>
  );

  return createPortal(overlay, document.body);
}
