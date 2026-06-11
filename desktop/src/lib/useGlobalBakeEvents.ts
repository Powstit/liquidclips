// ───── IRON GATE IG-010 (v0.8.0-pre) — see docs/IRON_GATES.md ─────
// Singleton-listener pattern for the v0.8.0 non-blocking architecture.
// useEffect(() => { void ensureListeners(); }, []) MUST stay in place —
// lazy attachment inside waitForBake leaks fast events between the RPC
// return and listener registration, leaving callers stuck on the 5-min
// timeout. This is the gated behaviour. Any sibling hook (useIngestEvents,
// useLiftEvents, etc.) MUST mirror this on-mount-attach pattern.
//
// v0.8.0 — Global bake event listener.
//
// Replaces the per-component listener duplication (ReactionControls mounts
// one, ClipCard would need one, etc.). Any component that fires
// startOverlayBake can simply use this hook to receive completion/error
// callbacks without managing its own Tauri event subscription.
//
// Usage:
//   const { waitForBake } = useGlobalBakeEvents();
//   await sidecar.startOverlayBake(slug, idx, overlay);
//   const result = await waitForBake(slug, idx);

import { useCallback, useEffect } from "react";
import { onBakeComplete, onBakeError, type BakeComplete, type BakeError } from "./sidecar";

type BakeResult =
  | { status: "complete"; project: BakeComplete["project"] }
  | { status: "error"; message: string; canceled?: boolean };

type PendingBake = {
  resolve: (r: BakeResult) => void;
  reject: (e: Error) => void;
};

const pendingBakes = new Map<string, PendingBake>();

function makeKey(slug: string, idx: number) {
  return `${slug}:${idx}`;
}

let listenersActive = false;
let unlistenComplete: (() => void) | undefined;
let unlistenError: (() => void) | undefined;

async function ensureListeners() {
  if (listenersActive) return;
  listenersActive = true;

  unlistenComplete = await onBakeComplete((payload: BakeComplete) => {
    const key = makeKey(payload.slug, payload.idx);
    const pending = pendingBakes.get(key);
    if (!pending) return;
    pendingBakes.delete(key);
    pending.resolve({ status: "complete", project: payload.project });
  });

  unlistenError = await onBakeError((payload: BakeError) => {
    const key = makeKey(payload.slug, payload.idx);
    const pending = pendingBakes.get(key);
    if (!pending) return;
    pendingBakes.delete(key);
    pending.resolve({
      status: "error",
      message: payload.message,
      canceled: payload.canceled,
    });
  });
}

export function cleanupGlobalBakeListeners() {
  unlistenComplete?.();
  unlistenError?.();
  listenersActive = false;
  pendingBakes.clear();
}

// Non-hook variant for non-React orchestrators (masterActions saga,
// any background service). Attaches listeners on first call and never
// detaches — the same singleton useGlobalBakeEvents uses. Safe to call
// from anywhere; key collisions are handled the same way as the hook.
export function globalWaitForBake(slug: string, idx: number, timeoutMs = 300_000): Promise<{ status: "complete"; project: BakeComplete["project"] } | { status: "error"; message: string; canceled?: boolean }> {
  return new Promise((resolve, reject) => {
    const key = makeKey(slug, idx);
    if (pendingBakes.has(key)) {
      reject(new Error(`Bake already pending for ${key}`));
      return;
    }
    pendingBakes.set(key, { resolve, reject });
    window.setTimeout(() => {
      if (!pendingBakes.has(key)) return;
      pendingBakes.delete(key);
      reject(new Error(`Bake timeout for ${key} after ${timeoutMs}ms`));
    }, timeoutMs);
    void ensureListeners();
  });
}

export function useGlobalBakeEvents() {
  // Audit fix — attach Tauri listeners on hook mount, not on first waitForBake.
  // The old behaviour lazy-attached inside the Promise, which left a race
  // window between startOverlayBake() returning and ensureListeners()
  // resolving. A fast bake (identity overlay, cached frame) could emit
  // bake_complete before listeners attached, leaving waitForBake to wait
  // out the 5-minute timeout.
  useEffect(() => { void ensureListeners(); }, []); // IRON GATE IG-010 — on-mount listener attach (do not move into Promise body)

  const waitForBake = useCallback(
    (slug: string, idx: number, timeoutMs = 300_000): Promise<BakeResult> => {
      return new Promise((resolve, reject) => {
        const key = makeKey(slug, idx);
        if (pendingBakes.has(key)) {
          reject(new Error(`Bake already pending for ${key}`));
          return;
        }
        pendingBakes.set(key, { resolve, reject });

        // Safety timeout so promises can't leak if an event is dropped.
        window.setTimeout(() => {
          if (!pendingBakes.has(key)) return;
          pendingBakes.delete(key);
          reject(new Error(`Bake timeout for ${key} after ${timeoutMs}ms`));
        }, timeoutMs);

        void ensureListeners();
      });
    },
    [],
  );

  return { waitForBake };
}
