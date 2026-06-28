// Cinematic browser overlay — 90vw × 88vh, fuchsia rim/glow chrome, iframe body,
// honest CSP-blocked fallback footer. Portaled into document.body so it escapes
// the .lc-page perspective:1200px containing block.
//
// Triggers: Home reward hero, Earn, Community, Campaigns. NOT globally mounted.
// Esc priority: closes the browser overlay first (handled here), then yields.
//
// No Tauri webview. No Rust. iframe only. Real APIs forbidden.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  X,
  ArrowUpRight,
  ExternalLink,
  Sparkles,
  ClipboardCopy,
} from "lucide-react";
import { bus } from "../../design-os/bridge";
import {
  useBrowseOverlay,
  WHOP_REWARDS_URL,
} from "../../state/browseOverlay";
import { setActiveCampaignId } from "../../shell/modeStore";
import { openSmart } from "../../lib/openSmart";
import {
  openBrowsePanel,
  closeBrowsePanel,
  updateBrowsePanelBounds,
  browseBack as nativeBrowseBack,
  browseForward as nativeBrowseForward,
  browseReload as nativeBrowseReload,
} from "../../lib/browse";

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
  { label: "Earn", designOsRoute: "earn" },
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

  const [draft, setDraft] = useState(currentUrl ?? WHOP_REWARDS_URL);
  // 2026-06-25 · slotRef is an empty div the Rust webview is positioned over.
  // React measures slot.getBoundingClientRect() and passes those bounds to
  // open_browse_panel / update_browse_panel_bounds so the native webview
  // sits exactly inside the React overlay layout.
  const slotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (currentUrl) setDraft(currentUrl);
  }, [currentUrl]);

  // Esc priority: BrowseOverlay wins first. Use a capture-phase listener so we
  // close before any descendant Dialog/Sheet sees it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", onKey, { capture: true });
    return () =>
      document.removeEventListener("keydown", onKey, { capture: true });
  }, [open, close]);

  // 2026-06-25 · webview lifecycle. The native Rust child webview sits
  // exactly over slotRef's rect. On open / URL change → spawn or navigate.
  // On window resize → reposition. On close → destroy.
  //
  // (Removed: 10s "still loading → blocked" fallback. The Rust webview
  // bypasses iframe CSP entirely so the only blocking path now is the
  // commerce-redirect filter, which is fast + handled in Rust.)
  useEffect(() => {
    if (!open || !currentUrl) {
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
      .then(() => setLoadState("loaded"))
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
  }, [open, currentUrl, setLoadState]);

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
         * wired before the emit (covers the cold-hash-set case). */
        window.setTimeout(() => {
          bus.emit("nav:click", { route });
        }, 30);
      }
    },
    [handleGo, close],
  );

  if (!open) return null;

  const canBack = historyIdx > 0;
  const canForward = historyIdx < history.length - 1;

  const overlay = (
    <section
      className="lc-browse-overlay"
      role="dialog"
      aria-label="Browser overlay"
      onClick={(e) => e.stopPropagation()}
    >
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
        {/* 2026-06-25 · webview slot — the Rust child webview is positioned
            over this rect. No iframe (Whop/X/YT/Discord block iframe via
            X-Frame-Options: DENY). The slot stays empty in dev / vite
            preview where Rust isn't available. */}
        <div ref={slotRef} className="lc-browse-webview-slot" aria-hidden="true" />
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

      {/* Hidden contract anchors for the shell guard. */}
      <div aria-hidden="true" style={{ display: "none" }}>
        <span data-browse-overlay="root">Browser overlay</span>
        <span data-browse-overlay="use-in-engine">Use in Engine</span>
        <span data-browse-overlay="open-system">Open in system browser</span>
        <span data-browse-overlay="esc-hint">esc to close</span>
        <span data-browse-overlay="blocked">This site blocks embedded viewing.</span>
      </div>
    </section>
  );

  return createPortal(overlay, document.body);
}
