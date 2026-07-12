/**
 * ProtectedJourneyRegistry · Wave D1 · j015-runtime-update (2026-07-12)
 *
 * Cross-cutting registry that lets any surface (upload, clip-run,
 * export, submit, payout, identity claim) mark itself as "active"
 * for the current tick. The runtime-update journey reads this via
 * `hasActiveProtected()` when the mandatory Restart Gate wants to
 * mount — if any protected journey is active, the gate defers and
 * emits `update_gate_shown { deferred_by_protected_journey: <id> }`.
 *
 * Contract
 * ─────────
 * - Module-scope Map<journeyId, active>.
 * - `useProtectedJourney(id, active)` React hook — auto-registers
 *   on mount, auto-unregisters on unmount, flips on `active` change.
 * - `hasActiveProtected()` — reads the registry synchronously.
 * - `activeProtectedIds()` — returns the list of active ids (used
 *   by the update-journey to name the *specific* journey that
 *   deferred the gate).
 * - `subscribe(cb)` — module-level subscription so the update
 *   journey can re-attempt gate mount when the last protected
 *   journey completes without waiting for a poll.
 *
 * Locked protected journey ids (from j015 §"Protected journeys"):
 *   j005-upload
 *   j006-clip-generation
 *   j007-my-clips              (only while export/copy is active)
 *   j004-connect-whop
 *   j011-payout
 *   j001-fresh-user-otp-identity
 *
 * Zero deps · zero side effects at import time · SSR-safe.
 */

import { useEffect } from "react";

export type ProtectedJourneyId =
  | "j005-upload"
  | "j006-clip-generation"
  | "j007-my-clips"
  | "j004-connect-whop"
  | "j011-payout"
  | "j001-fresh-user-otp-identity";

/** All ids the update-journey knows about. Kept as a runtime array so
 *  test files can iterate without hard-coding the constant list. */
export const PROTECTED_JOURNEY_IDS: readonly ProtectedJourneyId[] = [
  "j005-upload",
  "j006-clip-generation",
  "j007-my-clips",
  "j004-connect-whop",
  "j011-payout",
  "j001-fresh-user-otp-identity",
];

const registry: Map<ProtectedJourneyId, number> = new Map();
const subscribers: Set<() => void> = new Set();

function notify(): void {
  for (const cb of subscribers) {
    try {
      cb();
    } catch {
      /* subscriber failure must not break the registry */
    }
  }
}

/** Register/unregister an active protected journey.
 *  Ref-counted per id so two mount sites for the same journey don't
 *  clobber each other on unmount ordering. */
export function registerProtectedJourney(id: ProtectedJourneyId): () => void {
  const prev = registry.get(id) ?? 0;
  registry.set(id, prev + 1);
  if (prev === 0) notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const cur = registry.get(id) ?? 0;
    if (cur <= 1) {
      registry.delete(id);
      notify();
    } else {
      registry.set(id, cur - 1);
    }
  };
}

/** Are any protected journeys currently active? */
export function hasActiveProtected(): boolean {
  return registry.size > 0;
}

/** The list of ids currently active. Empty when none. */
export function activeProtectedIds(): ProtectedJourneyId[] {
  return Array.from(registry.keys());
}

/** Subscribe to registry changes. Fires on every register/unregister
 *  transition (including intermediate counts) so the update-journey
 *  can retry gate mount at the exact moment the last protected
 *  journey drops. Returns an unsubscribe function. */
export function subscribeProtectedJourney(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/** Test-only reset · clears the registry between test cases so state
 *  from an earlier `it` block doesn't leak. Not exported to product
 *  code — only imported from the test file. */
export function __resetProtectedJourneyForTests(): void {
  registry.clear();
  // Subscribers are kept so listeners installed by the update-journey
  // module survive between tests. Callers that need a full reset
  // should also clear their own listeners.
}

/** React hook · registers `id` while `active` is true, unregisters
 *  when it flips or the component unmounts.
 *
 *  Passing `active=false` at mount is a no-op — the surface stays
 *  unregistered until the flag flips to true, at which point the
 *  effect wires the ref-counted registration. */
export function useProtectedJourney(id: ProtectedJourneyId, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const release = registerProtectedJourney(id);
    return release;
  }, [id, active]);
}
