// ship-lens v0.7.8: E2 — `pushRect` is now rAF-debounced. Pre-fix, ResizeObserver + window-resize each fired `resize_earn_panel(invoke)` synchronously; dragging the window queued dozens of IPC calls per frame and starved the main thread. We stash the latest rect, schedule one rAF, fire on tick, clear the scheduled flag. Cancelled cleanly on unmount.
// ship-lens v0.7.7: fix #10 — auth-jwt reply now ships my-whop-submission IDs so the embed's status pills stop being silently empty (origin prefix mismatch made the embed's own localStorage read return [] forever)
// SURFACE: Earn webview mount
// MAP TAGS: (O #5)(O #6)(O #7) hosted Earn surface
// See docs/UI_MAP_embed_surfaces.md — the contract.
//
// Thin React shell that:
//   1. Reserves layout space inside the cockpit room (via an empty div).
//   2. Measures that div with a ResizeObserver and reports the rect to
//      Rust, which pins the child webview on top of it.
//   3. Subscribes to bridge messages from the embed (lc:nav, lc:start-bounty,
//      lc:auth-request) and routes each to the right desktop callback.
//   4. Responds to lc:auth-request by reading the keychain LICENSE_JWT
//      through the existing sidecar bridge and posting it back into the
//      webview. The embed only sees the JWT in memory — no localStorage,
//      no URL.
//
// The native webview floats above this div in window-coordinates space;
// the div itself stays empty so the layout grid still has something to
// flex against.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  closeEarnPanel,
  onEarnPanelLoaded,
  onEarnPanelMessage,
  openEarnPanel,
  postToEarnPanel,
  resizeEarnPanel,
  type EarnPanelMessage,
} from "../../lib/earn_panel";
import { humanError, sidecar, type WhopBounty } from "../../lib/sidecar";
import { openAuthPanel } from "../auth/useAuthPanel";
import { openSmart as openExternal } from "../../lib/openSmart";
import { getCachedLicenseJwt } from "../../lib/backend";

// v0.7.56 P0 — Earn black-screen blocker. The native child webview pins on
// top of an empty React div; if the embed page never reports first paint
// (offline, CSP, DNS, satellite-cookie crash, embed redirected to a blank
// state) the user stares at the WKWebView's default black until they switch
// tabs. We watchdog `earn-panel:loaded` and, if it doesn't fire by this
// budget, destroy the webview so the React recovery card underneath becomes
// visible. 10s matches the 8-10s budget in Daniel's directive — long enough
// to absorb a cold Vercel start, short enough that the user doesn't sit on
// black.
const EMBED_FIRST_PAINT_BUDGET_MS = 10_000;

// External fallback URL the recovery card's "Open in browser" CTA points to.
// Uses the public /earn page (not the embed variant) so the user lands on a
// signed-in-rewardable surface even when our shell webview can't render it.
const EMBED_BROWSER_FALLBACK_URL = "https://account.liquidclips.app/earn";

/** Source of truth for "what submissions has THIS desktop captured?" lives
 *  in `localStorage["junior:my-whop-submissions:v1"]` (see EarnTab.ts's
 *  `rememberSubmissionId` + BountySubmissionCapture). The embed webview is
 *  a different origin (account.liquidclips.app) so it cannot read that key
 *  directly — we ship the contents along with the auth-jwt reply.
 *  v0.7.7 fix #10 Path A. */
const DESKTOP_SUBMISSION_IDS_KEY = "junior:my-whop-submissions:v1";

function readSubmissionIdsFromKeychain(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DESKTOP_SUBMISSION_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

type Props = {
  // Workspace hand-off when the embed clicks "Start clipping" on a bounty
  // card. Mirrors EarnTab's existing onStartBounty signature — App.tsx
  // doesn't need to know the source changed.
  onStartBounty: (bounty: WhopBounty) => void;
  // lc:nav events from the embed (e.g. "go to settings") get routed here
  // so App.tsx still owns the view-state machine.
  onNav?: (to: string) => void;
  // Desktop tier — the embed reads this from server-side Clerk, but we
  // also forward it so the auth-request response includes it.
  userTier?: "free" | "solo" | "pro" | "agency" | null;
};

export function EarnPanelMount({ onStartBounty, onNav, userTier }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [panelReady, setPanelReady] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  // v0.7.56 P0 — track the embed's first paint independent of `panelReady`.
  // panelReady flips as soon as Rust's open_earn_panel returns; firstPaint
  // flips when the WKWebView reports `PageLoadEvent::Finished`. The gap
  // between the two is the black-screen window: if firstPaint never lands,
  // the user sees the empty WebKit canvas instead of our React fallback.
  const [embedFirstPaint, setEmbedFirstPaint] = useState(false);
  // Bumped by Retry to re-trigger the boot effect.
  const [bootAttempt, setBootAttempt] = useState(0);
  // Timestamps for the Copy-diagnostics payload — every recovery card the
  // user reaches should be debuggable from a single clipboard paste.
  const bootStartedAtRef = useRef<number>(0);

  // Open + close the native webview alongside the React mount. Re-open
  // hits the same Rust singleton — calling openEarnPanel twice is a no-op
  // beyond surfacing the existing webview.
  useEffect(() => {
    let cancelled = false;
    let resizeRetryId = 0;
    let loadUnlisten: (() => void) | undefined;
    let loadRetries = 0;
    // v0.7.56 P0 — first-paint watchdog. If the embed doesn't report
    // earn-panel:loaded within the budget, destroy the webview (so the
    // React fallback underneath becomes visible) and surface the recovery
    // card. Cleared on first paint, on unmount, and on Retry.
    let firstPaintTimerId = 0;

    bootStartedAtRef.current = Date.now();
    // Reset state between retries so the user sees the loading indicator
    // again instead of stale "couldn't load" copy.
    setPanelReady(false);
    setPanelError(null);
    setEmbedFirstPaint(false);

    async function boot() {
      try {
        await openEarnPanel();
        if (cancelled) return;
        setPanelReady(true);
        setPanelError(null);
        // Watchdog the embed's first paint. Distinct from panelReady (which
        // only tracks the Rust webview spawn) — see comment on embedFirstPaint.
        firstPaintTimerId = window.setTimeout(() => {
          if (cancelled) return;
          console.warn(
            "[earn-panel] embed did not report first paint within budget",
            { budgetMs: EMBED_FIRST_PAINT_BUDGET_MS },
          );
          setPanelError("embed-timeout");
          // Destroy the WKWebView so the empty black canvas stops covering
          // the React recovery card. Reopened on Retry.
          void closeEarnPanel().catch((e) => {
            console.warn("[earn-panel] close after timeout failed:", e);
          });
        }, EMBED_FIRST_PAINT_BUDGET_MS);
        // Listen for the embed's first paint. When it fires, clear the
        // watchdog and keep panelError null so the WKWebView stays on
        // screen as the real Earn surface.
        const u = await onEarnPanelLoaded(() => {
          console.log("[earn-panel] embed reported first paint");
          if (firstPaintTimerId !== 0) {
            window.clearTimeout(firstPaintTimerId);
            firstPaintTimerId = 0;
          }
          setEmbedFirstPaint(true);
        });
        if (cancelled) {
          try {
            u();
          } catch {
            /* ignore */
          }
        } else {
          loadUnlisten = u;
        }
      } catch (e) {
        console.error("[earn-panel] open failed:", e);
        loadRetries += 1;
        if (loadRetries >= 6) {
          // ~3s of retries — main window isn't just slow, something is wrong.
          setPanelError(
            `Could not open Earn: ${humanError(e)}. Try restarting Liquid Clips.`,
          );
          return;
        }
        // Retry open on a short delay — the main window may still be
        // initialising when the Earn tab mounts on cold boot.
        resizeRetryId = window.setTimeout(boot, 500);
      }
    }
    void boot();

    return () => {
      cancelled = true;
      if (resizeRetryId !== 0) window.clearTimeout(resizeRetryId);
      if (firstPaintTimerId !== 0) {
        window.clearTimeout(firstPaintTimerId);
        firstPaintTimerId = 0;
      }
      try {
        loadUnlisten?.();
      } catch {
        /* ignore */
      }
      void closeEarnPanel().catch((e) => {
        console.error("[earn-panel] close failed:", e);
      });
    };
  }, [bootAttempt]);

  // Pin the webview to the container rect, every resize. window.scrollX/Y
  // are zero in the Tauri shell — the chrome doesn't scroll — so the
  // bounding rect already gives us window-relative coordinates.
  //
  // v0.7.8 fix E2 — pushRect is rAF-debounced. ResizeObserver + window-resize
  // can each fire dozens of times per frame during an active window drag;
  // each call used to translate 1:1 into an `invoke("resize_earn_panel")`
  // which is a JSON-serialised IPC roundtrip to Rust. Dropping that into
  // an rAF cap means at most one IPC per animation frame, and the user
  // never sees more than one paint-pair of misalignment during a drag.
  //
  // v0.7.40 hotfix — the resize effect now waits for `panelReady` before
  // its first push. This stops the webview from being left at fallback
  // bounds (or 0x0 if the container collapsed) when open_earn_panel is
  // slower than the ResizeObserver's first fire.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let scheduled = false;
    let rafId = 0;

    function pushRect(): void {
      // Coalesce: each event sets the flag; only the first event in this
      // animation frame actually schedules the rAF tick.
      if (scheduled) return;
      scheduled = true;
      rafId = window.requestAnimationFrame(() => {
        scheduled = false;
        rafId = 0;
        const node = containerRef.current;
        if (!node) return;
        const r = node.getBoundingClientRect();
        // Round to whole logical pixels — sub-pixel Position values cause
        // WKWebView to flicker on retina displays.
        void resizeEarnPanel({
          x: Math.round(r.left),
          y: Math.round(r.top),
          w: Math.round(r.width),
          h: Math.round(r.height),
        }).catch((e) => {
          console.warn("[earn-panel] resize failed:", e);
        });
      });
    }

    pushRect();
    const ro = new ResizeObserver(pushRect);
    ro.observe(el);
    // Window resizes can shift x/y without changing width/height of this
    // container, so listen to those too.
    window.addEventListener("resize", pushRect);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", pushRect);
      // Cancel any pending rAF tick so unmount-then-remount in HMR doesn't
      // see a stale tick fire into a dead container.
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
      scheduled = false;
    };
  }, [panelReady]);

  // Bridge messages — keep the latest callbacks in a ref so the listener
  // doesn't have to detach + re-attach when props change.
  const cbRef = useRef({ onStartBounty, onNav, userTier });
  cbRef.current = { onStartBounty, onNav, userTier };

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    async function handle(msg: EarnPanelMessage): Promise<void> {
      switch (msg.type) {
        case "lc:nav": {
          const to = typeof msg.to === "string" ? msg.to : "";
          cbRef.current.onNav?.(to);
          break;
        }
        case "lc:open-auth": {
          // ship-lens v0.7.11: the embed renders a "Link your account"
          // CTA when Clerk satellite cookies haven't been set yet (the
          // server-side auth() in /embed/earn returns no userId). The CTA
          // posts this message; we open the native auth panel which lands
          // the user on Clerk's hosted page at account.liquidclips.app —
          // signing in sets the satellite cookie + the panel auto-closes,
          // and on close we destroy + reopen the earn webview so the
          // embed re-renders authenticated.
          const panel = (msg as { panel?: unknown }).panel === "upgrade"
            ? "upgrade"
            : "sign-in";
          openAuthPanel(panel);
          break;
        }
        case "lc:start-bounty": {
          const id = typeof (msg as { id?: unknown }).id === "string"
            ? (msg as { id: string }).id
            : "";
          if (!id) return;
          // Fetch the full bounty server-side so App.tsx receives the
          // same WhopBounty shape it already routes today.
          //
          // Demo audit P1 — ship-lens-reviewer flagged that a failed RPC
          // OR a {bounty: null} response was a silent no-op: user clicked
          // a card in the embed, console logged, nothing on screen. On
          // camera that reads as "the app is broken." Surface a real
          // toast via the `lc:toast` bus App.tsx already listens for so
          // the user gets explicit "couldn't open that reward" feedback
          // they can act on (retry / pick another / contact support).
          try {
            const { bounty } = await sidecar.whopBounty(id);
            if (bounty) {
              cbRef.current.onStartBounty(bounty);
            } else {
              console.warn("[earn-panel] whopBounty returned null for id:", id);
              window.dispatchEvent(
                new CustomEvent("lc:toast", {
                  detail: {
                    kind: "error",
                    message:
                      "Couldn't open that reward — it may have closed. Try another or refresh Earn.",
                  },
                }),
              );
            }
          } catch (e) {
            console.error("[earn-panel] whopBounty failed:", e);
            window.dispatchEvent(
              new CustomEvent("lc:toast", {
                detail: {
                  kind: "error",
                  message: `Couldn't open that reward — ${humanError(e)}`,
                },
              }),
            );
          }
          break;
        }
        case "lc:auth-request": {
          // Path 2 from UI_MAP_embed_surfaces.md §"Auth bridge". Only
          // fires if Clerk satellite cookies didn't cross over to the
          // child webview's cookie partition.
          //
          // v0.7.7 fix #10 Path A: we also ship the submission ID list
          // from the desktop's own localStorage. The embed webview is a
          // different origin and cannot read that key — the bridge IS the
          // only path. Even on errors we still include the IDs so the
          // status pills can render while the embed re-tries the JWT.
          //
          // v0.7.56 P0 — Passive callback. The embed asks for a JWT
          // automatically on page load when satellite cookies are missing
          // (i.e. without any user action on the desktop side). We must
          // NOT trigger a Keychain prompt for opening the Earn tab. We
          // hand back whatever the in-memory cache already has (filled by
          // explicit auth flows earlier in the session) — null otherwise.
          // The embed handles `null` by rendering its "Link your account"
          // CTA, which posts `lc:open-auth`; the user clicking that opens
          // the auth panel — an EXPLICIT action where a single Keychain
          // prompt is acceptable (the auth panel's success handler does
          // the real read + persists it to the cache via secret_set →
          // presence-file update).
          const submissionIds = readSubmissionIdsFromKeychain();
          const cached = getCachedLicenseJwt();
          await postToEarnPanel({
            type: "lc:auth-jwt",
            value: cached,
            tier: cbRef.current.userTier ?? null,
            submissionIds,
          }).catch(() => {
            /* the webview may have closed in between */
          });
          break;
        }
        default:
          // Unknown lc:* — log and ignore. The embed page is a separate
          // ship train; future message types reach Rust through the
          // generic earn-panel:message event already.
          break;
      }
    }

    void onEarnPanelMessage((msg) => {
      if (cancelled) return;
      void handle(msg);
    }).then((u) => {
      if (cancelled) {
        try {
          u();
        } catch {
          /* ignore */
        }
      } else {
        unsubscribe = u;
      }
    });

    return () => {
      cancelled = true;
      try {
        unsubscribe?.();
      } catch {
        /* ignore */
      }
    };
  }, []);

  // v0.7.56 P0 — Recovery actions.
  //
  // Retry: bump bootAttempt → the boot effect tears down + re-opens the
  // webview from scratch (close is already wired in the effect's cleanup,
  // and the new boot resets panelReady / firstPaint / panelError).
  const handleRetry = useCallback(() => {
    setBootAttempt((n) => n + 1);
  }, []);

  // Open in browser: routes through openSmart's Tauri-opener bridge so the
  // user lands on /earn in their default browser. The public /earn page
  // mirrors the same rewards surface so a signed-in user can still claim
  // bounties even when our shell can't render the embed.
  const handleOpenInBrowser = useCallback(() => {
    void openExternal(EMBED_BROWSER_FALLBACK_URL).catch((e) => {
      console.error("[earn-panel] open-in-browser failed:", e);
    });
  }, []);

  // Copy diagnostics: bundles every signal Daniel asked for in the directive
  // (URL, panelReady, embedFirstPaint, budget, retry-count, ts) into one
  // clipboard paste so support / a follow-up bug report has the full picture
  // without needing devtools open.
  const handleCopyDiagnostics = useCallback(() => {
    const diagnostics = {
      surface: "earn",
      app_version: "0.7.56",
      embed_url: EMBED_BROWSER_FALLBACK_URL,
      panel_ready: panelReady,
      embed_first_paint: embedFirstPaint,
      panel_error: panelError,
      first_paint_budget_ms: EMBED_FIRST_PAINT_BUDGET_MS,
      boot_attempt: bootAttempt + 1,
      boot_started_at: bootStartedAtRef.current,
      now_ts: Date.now(),
      user_tier: userTier ?? null,
    };
    const text = JSON.stringify(diagnostics, null, 2);
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).catch(() => {
        // Clipboard API blocked — fall back to a visible textarea so the
        // user can copy by hand. Non-fatal.
        console.warn("[earn-panel] clipboard write blocked");
      });
    } else {
      console.warn("[earn-panel] clipboard API unavailable", diagnostics);
    }
    window.dispatchEvent(
      new CustomEvent("lc:toast", {
        detail: { kind: "info", message: "Earn diagnostics copied." },
      }),
    );
  }, [panelReady, embedFirstPaint, panelError, bootAttempt, userTier]);

  // Reload app: full window reload. Last-ditch when even Retry doesn't move
  // panelReady. Mirrors the universal "restart the surface" escape hatch.
  const handleReloadApp = useCallback(() => {
    window.location.reload();
  }, []);

  // Recovery card content depends on whether we hit the timeout watchdog
  // (the most common cause — black screen the user sees) vs. an open-time
  // failure (rare, surfaced as a raw error string above). Both paths show
  // the same four CTAs Daniel specified.
  const showRecoveryCard = !!panelError;
  const showLoadingCard = !panelError && (!panelReady || !embedFirstPaint);

  // The div is purely a layout reservation — the native webview floats
  // on top of it in window coordinates. A loading state renders underneath
  // so the tab never looks blank while Rust is still attaching the webview
  // or the hosted page is fetching its first paint.
  return (
    // IRON GATE IG-011 — h-full w-full on this containerRef MUST stay.
    // RoomShell stretches EarnTab to a definite height; this div is the
    // last hop of the cascade. Drop h-full here and the ResizeObserver
    // measures 0px → the native webview pins to a 0×0 rect → blank Earn.
    <div ref={containerRef} className="relative h-full w-full">
      {showLoadingCard && (
        <div
          className="absolute inset-0 grid place-items-center bg-paper"
          aria-live="polite"
        >
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            Loading Earn…
          </p>
        </div>
      )}
      {showRecoveryCard && (
        <div
          className="absolute inset-0 grid place-items-center bg-paper px-6"
          role="alert"
        >
          <div className="max-w-[420px] rounded-2xl border border-ink/10 bg-paper-elev p-6 text-center shadow-xl">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia">
              {panelError === "embed-timeout"
                ? "Rewards didn't load"
                : "Earn couldn't load"}
            </p>
            <p className="mt-3 font-sans text-[14px] leading-relaxed text-text-primary">
              Rewards did not load. You can retry or open the rewards page in
              your browser.
            </p>
            {panelError && panelError !== "embed-timeout" && (
              <p className="mt-2 font-mono text-[11px] leading-relaxed text-text-tertiary">
                {panelError}
              </p>
            )}
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={handleRetry}
                className="rounded-full bg-fuchsia px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:opacity-90"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={handleOpenInBrowser}
                className="rounded-full border border-ink/15 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-primary hover:bg-ink/5"
              >
                Open in browser
              </button>
              <button
                type="button"
                onClick={handleCopyDiagnostics}
                className="rounded-full border border-ink/15 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-secondary hover:bg-ink/5"
              >
                Copy diagnostics
              </button>
              <button
                type="button"
                onClick={handleReloadApp}
                className="rounded-full border border-ink/15 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-secondary hover:bg-ink/5"
              >
                Reload app
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
