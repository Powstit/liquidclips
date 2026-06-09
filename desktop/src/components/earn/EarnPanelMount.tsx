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

import { useEffect, useRef, useState } from "react";
import {
  closeEarnPanel,
  onEarnPanelMessage,
  openEarnPanel,
  postToEarnPanel,
  resizeEarnPanel,
  type EarnPanelMessage,
} from "../../lib/earn_panel";
import { sidecar, type WhopBounty } from "../../lib/sidecar";
import { openAuthPanel } from "../auth/useAuthPanel";

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

  // Open + close the native webview alongside the React mount. Re-open
  // hits the same Rust singleton — calling openEarnPanel twice is a no-op
  // beyond surfacing the existing webview.
  useEffect(() => {
    let cancelled = false;
    let resizeRetryId = 0;

    async function boot() {
      try {
        await openEarnPanel();
        if (cancelled) return;
        setPanelReady(true);
      } catch (e) {
        console.error("[earn-panel] open failed:", e);
        // Retry open on a short delay — the main window may still be
        // initialising when the Earn tab mounts on cold boot.
        resizeRetryId = window.setTimeout(boot, 500);
      }
    }
    void boot();

    return () => {
      cancelled = true;
      if (resizeRetryId !== 0) window.clearTimeout(resizeRetryId);
      void closeEarnPanel().catch((e) => {
        console.error("[earn-panel] close failed:", e);
      });
    };
  }, []);

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
          try {
            const { bounty } = await sidecar.whopBounty(id);
            if (bounty) cbRef.current.onStartBounty(bounty);
          } catch (e) {
            console.error("[earn-panel] whopBounty failed:", e);
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
          const submissionIds = readSubmissionIdsFromKeychain();
          try {
            const { value } = await sidecar.licenseJwtRead();
            await postToEarnPanel({
              type: "lc:auth-jwt",
              value: value ?? null,
              tier: cbRef.current.userTier ?? null,
              submissionIds,
            });
          } catch (e) {
            console.error("[earn-panel] license read failed:", e);
            await postToEarnPanel({
              type: "lc:auth-jwt",
              value: null,
              tier: cbRef.current.userTier ?? null,
              submissionIds,
              error: String(e),
            }).catch(() => {
              /* the webview may have closed in between */
            });
          }
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

  // The div is purely a layout reservation — the native webview floats
  // on top of it in window coordinates. A loading state renders underneath
  // so the tab never looks blank while Rust is still attaching the webview
  // or the hosted page is fetching its first paint.
  return (
    <div ref={containerRef} className="relative h-full w-full" aria-hidden>
      {!panelReady && (
        <div className="absolute inset-0 grid place-items-center bg-paper">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            Loading Earn…
          </p>
        </div>
      )}
    </div>
  );
}
