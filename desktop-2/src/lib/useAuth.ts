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
import { lcDiag } from "./diagnosticLogger";

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

/* ─── BUG-016 · BC-001 · runtime writer-drift detection ──────────────
 *
 * `setJwt()` is the canonical writer for `state.authenticated` (INV-006).
 * Enforcement of that invariant has been convention-only — any code path
 * that writes `localStorage.setItem("lc.license.jwt.v1", ...)` bypasses
 * the bus emit and leaves `cachedHasJwt` stale until an unrelated
 * consumer re-reads. This poll surfaces the drift both:
 *   1. Observability — emit `auth_state_drift` telemetry with `{cached,
 *      actual, ts}` payload so HQ can pinpoint the rogue writer.
 *   2. Self-heal    — force-sync `cachedHasJwt` from truth (localStorage)
 *      AND fire the correct bus event (`auth:signed-in` /
 *      `auth:signed-out`) so every subscriber lands on the same tick.
 *
 * We do NOT change the write path. `setJwt()` remains the writer. This
 * is a shim, not a new writer. See ``lcos/09_BUG_LEDGER.md`` BUG-016
 * close conditions.
 *
 * Positioned ABOVE the module init block so `startDriftDetectionInterval`
 * is fully hoisted before `initOnce()` calls it (TDZ-safe).
 */

/** Poll interval, milliseconds. 2s is the BUG-016 close-only contract
 *  value ("raw-localStorage-write-detected-within-2s"). Exposed as
 *  constant so tests can advance a fake timer past it deterministically. */
export const AUTH_DRIFT_POLL_MS = 2000;

let driftIntervalHandle: ReturnType<typeof setInterval> | null = null;

/** Read the JWT key directly from localStorage (bypasses the module-
 *  cache in ``authStorage.getJwt()`` which mirrors the same rogue
 *  write we're trying to detect). Returns `null` outside browser. */
function readJwtFromRawStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LICENSE_JWT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function checkAuthDrift(): void {
  const actualHasJwt = readJwtFromRawStorage() !== null;
  if (actualHasJwt === cachedHasJwt) return;

  // Divergence · rogue write detected. Emit telemetry with both sides
  // of the drift so HQ can grep by timestamp + correlate with the
  // rogue writer's call site.
  try {
    lcDiag("auth_state_drift", {
      cached: cachedHasJwt,
      actual: actualHasJwt,
      ts: Date.now(),
    });
  } catch {
    /* telemetry failure never blocks self-heal */
  }

  // Dev-only warn · noisy in prod, quiet in dev.
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const isDev = Boolean((import.meta as any).env?.DEV);
    if (isDev) {
      // eslint-disable-next-line no-console
      console.warn(
        `[useAuth] auth_state_drift · cached=${cachedHasJwt} actual=${actualHasJwt} · self-healing`,
      );
    }
  } catch {
    /* dev-only warn is best-effort */
  }

  // Self-heal · adopt truth into the cache + fan out + fire the correct
  // bus event so every subscriber (TopHud, MembershipGate, etc.)
  // re-syncs on the next tick.
  cachedHasJwt = actualHasJwt;
  notifyListeners();
  try {
    if (actualHasJwt) {
      bus.emit("auth:signed-in", {});
    } else {
      bus.emit("auth:signed-out", { reason: "auth_fail" });
    }
  } catch {
    /* a bad handler can't defeat the self-heal · the notifyListeners
       fan-out above is the primary sync mechanism */
  }
}

function startDriftDetectionInterval(): void {
  if (driftIntervalHandle !== null) return;
  if (typeof window === "undefined") return;
  driftIntervalHandle = setInterval(checkAuthDrift, AUTH_DRIFT_POLL_MS);
}

function stopDriftDetectionInterval(): void {
  if (driftIntervalHandle === null) return;
  clearInterval(driftIntervalHandle);
  driftIntervalHandle = null;
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

  // BUG-016 · BC-001 · runtime drift detection. Start a 2s poll that
  // compares raw localStorage against the cached boolean. Only starts
  // in a browser-like environment (typeof window guarded above).
  startDriftDetectionInterval();
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

/** BUG-016 · test-only start/stop for the drift-detection interval so
 *  vitest fake timers can be driven without leaking a real interval
 *  handle across suites. */
export function _startDriftDetectionForTests(): void {
  startDriftDetectionInterval();
}

export function _stopDriftDetectionForTests(): void {
  stopDriftDetectionInterval();
}

/** BUG-016 · test-only synchronous drift check. Skips the setInterval
 *  scheduling entirely — useful when a test doesn't want to depend on
 *  vitest fake-timer plumbing and just needs to prove the drift
 *  detection logic itself. */
export function _checkAuthDriftForTests(): void {
  checkAuthDrift();
}
