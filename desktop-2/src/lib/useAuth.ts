/**
 * useAuth · P0-3 · single source of truth for JWT presence
 *
 * State-drift trifecta fix (RC1 · 2026-07-11).
 *
 * Before this file, every consumer that needed "is the user signed in?"
 * ran its own `useState(!!getJwt())` + local bus / storage listener.
 * Each mount installed its own listeners; each unmount tore them down.
 * When the OTP verify path emitted `auth:signed-in` some listeners had
 * fired (TopHud) and others hadn't (App, MembershipGate, etc.) and the
 * chrome told two different stories about the same second-old JWT.
 *
 * Contract (Daniel-locked):
 *   - ONE module-scope `cachedHasJwt` derived from `getJwt()`.
 *   - ONE `storage` window listener installed at module init.
 *   - ONE set of bus subscribers for `auth:signed-in` /
 *     `activation:complete` / `auth:signed-out`, installed at module init.
 *   - React `useAuth()` hook subscribes via `useSyncExternalStore`, so
 *     every consumer re-renders on the SAME tick when JWT presence
 *     flips. No more per-consumer drift.
 *
 * Callers replace `useState(!!getJwt())` + their own subscribers with:
 *   const { hasJwt } = useAuth();
 *
 * The bus import is dynamic to avoid a circular dep with the
 * `design-os/bridge` module tree (mirrors the pattern already used in
 * `design-os/state/useMe.ts`).
 */

import { useSyncExternalStore } from "react";
import { getJwt, LICENSE_JWT_STORAGE_KEY } from "./authStorage";
// Direct import from `bridge/events` (not `bridge/index`) — events.ts
// has zero downstream `import from "../../lib/*"` so there's no
// circular-dep risk. Keeps the bus subscribers synchronous at module
// init instead of the previous `void (async import)()` shape, which
// let a signin bus emit race the useAuth listener attachment.
import { bus } from "../design-os/bridge/events";

export interface AuthSnapshot {
  hasJwt: boolean;
}

/* ─── Module-scope singleton state ──────────────────────────────────── */

let cachedHasJwt: boolean = false;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) {
    try { listener(); } catch { /* a bad listener must not kill the fan-out */ }
  }
}

/** Re-read the JWT presence + fan out to every subscriber when it flips.
 *  Cheap — `getJwt()` returns a module cache in authStorage. */
function refreshHasJwt(): void {
  const next = getJwt() !== null;
  if (next === cachedHasJwt) return;
  cachedHasJwt = next;
  notifyListeners();
}

/* ─── Module init · install storage + bus listeners ONCE ────────────── */

/** True after the module init side effects have run. Guards against
 *  double-init in test environments that reset modules between suites. */
let initialized = false;

function initOnce(): void {
  if (initialized) return;
  initialized = true;

  // Prime the cache from the current JWT presence.
  cachedHasJwt = getJwt() !== null;

  if (typeof window === "undefined") return;

  // Cross-tab / external mutation. `storage` events only fire in OTHER
  // tabs — same-tab writes go through the bus events below.
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key === null || e.key === LICENSE_JWT_STORAGE_KEY) {
      refreshHasJwt();
    }
  });

  // Bus subscribers — synchronous, installed at module init. The three
  // events that flip JWT presence are:
  //   - `auth:signed-in`       · SimpleLoginPanel OTP verify path
  //   - `activation:complete`  · Whop deep-link activation state machine
  //   - `auth:signed-out`      · TopHud sign-out button + 401 self-heal
  // Each subscriber re-reads `getJwt()` and fans out to every listener
  // when the presence flips.
  bus.on("auth:signed-in", refreshHasJwt);
  bus.on("activation:complete", refreshHasJwt);
  bus.on("auth:signed-out", refreshHasJwt);
}

// Run init at module load so the first `useAuth()` render already has
// the correct cache + a live subscription network.
initOnce();

/* ─── React hook ────────────────────────────────────────────────────── */

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot(): boolean {
  return cachedHasJwt;
}

/** Reactive JWT-presence hook. Every mounted consumer receives the SAME
 *  boolean on the SAME React tick when the JWT flips. */
export function useAuth(): AuthSnapshot {
  const hasJwt = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { hasJwt };
}

/* ─── Test seam ─────────────────────────────────────────────────────── */

/** Reset the module cache + subscriber list. Test-only.
 *
 *  Tests that call `bus.clear()` in `beforeEach` also wipe the module-
 *  init bus subscribers · this helper re-attaches them so the next
 *  test starts with the same subscriber topology real users see. */
export function _resetUseAuthForTests(): void {
  listeners.clear();
  cachedHasJwt = getJwt() !== null;
  // Re-attach bus subscribers — safe to call unconditionally, `bus.on`
  // is a Set add so a duplicate attach after a real `bus.clear()`
  // remains a single subscription.
  bus.on("auth:signed-in", refreshHasJwt);
  bus.on("activation:complete", refreshHasJwt);
  bus.on("auth:signed-out", refreshHasJwt);
}

/** Test-only re-read. Forces the cache to catch a mutation that happened
 *  outside the bus (e.g. direct `setJwt` in a test that skips the bus
 *  emit). Fires listeners if the presence flipped. */
export function _refreshHasJwtForTests(): void {
  refreshHasJwt();
}
