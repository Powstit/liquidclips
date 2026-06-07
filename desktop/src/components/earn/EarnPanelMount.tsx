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

import { useEffect, useRef } from "react";
import {
  closeEarnPanel,
  onEarnPanelMessage,
  openEarnPanel,
  postToEarnPanel,
  resizeEarnPanel,
  type EarnPanelMessage,
} from "../../lib/earn_panel";
import { sidecar, type WhopBounty } from "../../lib/sidecar";

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

  // Open + close the native webview alongside the React mount. Re-open
  // hits the same Rust singleton — calling openEarnPanel twice is a no-op
  // beyond surfacing the existing webview.
  useEffect(() => {
    let cancelled = false;
    void openEarnPanel().catch((e) => {
      console.error("[earn-panel] open failed:", e);
    });
    return () => {
      cancelled = true;
      void closeEarnPanel().catch((e) => {
        console.error("[earn-panel] close failed:", e);
      });
      // Touch `cancelled` so TS doesn't complain if the destructor ever
      // grows an async branch that needs to bail early.
      void cancelled;
    };
  }, []);

  // Pin the webview to the container rect, every resize. window.scrollX/Y
  // are zero in the Tauri shell — the chrome doesn't scroll — so the
  // bounding rect already gives us window-relative coordinates.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function pushRect(): void {
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
        // Resize before the webview attaches is expected on first mount;
        // Rust returns Ok with no-op in that case. Anything else means
        // we mis-wired the bridge.
        console.warn("[earn-panel] resize failed:", e);
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
    };
  }, []);

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
  // on top of it in window coordinates. We leave it transparent so the
  // cockpit room's background shows through during the brief window
  // before the webview's first paint lands.
  return <div ref={containerRef} className="h-full w-full" aria-hidden />;
}
