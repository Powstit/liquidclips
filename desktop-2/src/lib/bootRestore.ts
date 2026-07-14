/**
 * bootRestore · Wave D1 · j015-runtime-update (2026-07-12)
 *
 * Persists `{ jwt, identity, last_safe_route, draft_state, ts_ms,
 * staged_version, current_version }` under
 * `localStorage["lc.restore.v1"]` before the app quits for a runtime
 * update. On the next boot, `readRestore()` returns the snapshot so
 * `main.tsx` can compare booted version vs staged version and drive
 * the j015 State 6 (restored) or State 7 (failed) transition.
 *
 * Contract
 * ─────────
 * - `writeRestore(snapshot)` — write once before triggering the
 *   Tauri quit/relaunch. Must not throw on quota-exceeded (falls back
 *   to a best-effort no-op).
 * - `readRestore()` — parse and return the snapshot. Returns null
 *   when the key is absent or malformed. Does NOT clear the key —
 *   the caller decides when to clear based on version verification.
 * - `clearRestore()` — remove the key. Called after a successful
 *   State 6 restore.
 * - `restoreLastSafeRoute()` — best-effort route restoration via
 *   `window.location.hash`. No side effects if the hash is empty
 *   or the snapshot is null.
 *
 * The v1 suffix is deliberate — if we ever need to migrate the shape
 * (e.g. add a new field) we bump to `lc.restore.v2` and the old key
 * silently ages out. No schema migration ceremony.
 *
 * Zero deps. SSR-safe (all accesses guarded by `typeof window`).
 */

/** The key in localStorage. Public constant so tests can assert
 *  exact writes and the update-journey can namespace-lock it. */
export const RESTORE_STORAGE_KEY = "lc.restore.v1";

/** JWT storage key used by the app for the license. Matches
 *  `main.tsx::__LCOS_PROBE__` and every other reader. */
export const JWT_STORAGE_KEY = "lc.license.jwt.v1";

/** Identity storage key — the app persists the last-known
 *  `me` snapshot elsewhere; the restore snapshot mirrors just what
 *  the update flow needs. */
export const IDENTITY_STORAGE_KEY = "lc.identity.snapshot.v1";

export interface RestoreSnapshot {
  /** Present JWT at write time · null if the user was signed-out. */
  jwt: string | null;
  /** Identity snapshot · shape mirrors useMe().snapshot. Free-form
   *  so we don't couple the update journey to identity schema
   *  changes. Null when unauthenticated. */
  identity: Record<string, unknown> | null;
  /** Last safe route hash. Preferred over `location.pathname` in
   *  hash-router apps — Liquid Clips desktop uses `#/…` throughout. */
  last_safe_route: string | null;
  /** Recoverable draft/session state · free-form JSON. Callers
   *  put whatever they'd otherwise lose (unsubmitted caption,
   *  half-typed OTP, wallet withdraw amount). */
  draft_state: Record<string, unknown> | null;
  /** Millisecond timestamp at write. Used to expire stale restore
   *  attempts (>10 min old are treated as abandoned). */
  ts_ms: number;
  /** Version we WERE running when we wrote the snapshot. */
  current_version: string;
  /** Version we EXPECT to boot into after quit+relaunch. */
  staged_version: string;
}

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

function isStorageAvailable(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

/** Write the restore snapshot. Silent on failure (quota exceeded,
 *  private browsing, storage disabled). */
export function writeRestore(snapshot: RestoreSnapshot): boolean {
  if (!isStorageAvailable()) return false;
  try {
    const payload = JSON.stringify(snapshot);
    window.localStorage.setItem(RESTORE_STORAGE_KEY, payload);
    return true;
  } catch {
    return false;
  }
}

/** Read the restore snapshot. Returns null on any parse or storage
 *  failure so the caller doesn't need to try/catch. */
export function readRestore(): RestoreSnapshot | null {
  if (!isStorageAvailable()) return null;
  try {
    const raw = window.localStorage.getItem(RESTORE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RestoreSnapshot>;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.ts_ms !== "number" ||
      typeof parsed.staged_version !== "string" ||
      typeof parsed.current_version !== "string"
    ) {
      return null;
    }
    return {
      jwt: parsed.jwt ?? null,
      identity: parsed.identity ?? null,
      last_safe_route: parsed.last_safe_route ?? null,
      draft_state: parsed.draft_state ?? null,
      ts_ms: parsed.ts_ms,
      current_version: parsed.current_version,
      staged_version: parsed.staged_version,
    };
  } catch {
    return null;
  }
}

/** Clear the restore key. Called by the boot verifier after a
 *  successful State 6 (booted == staged). Silent on failure. */
export function clearRestore(): void {
  if (!isStorageAvailable()) return;
  try {
    window.localStorage.removeItem(RESTORE_STORAGE_KEY);
  } catch {
    /* noop */
  }
}

/** Is the snapshot older than the stale threshold? Stale snapshots
 *  are treated as abandoned restore attempts and cleared without a
 *  version verification (the user probably force-quit without
 *  triggering the update). */
export function isStale(snapshot: RestoreSnapshot, nowMs: number = Date.now()): boolean {
  return nowMs - snapshot.ts_ms > STALE_THRESHOLD_MS;
}

/** Compare booted version vs staged version. Returns:
 *   - "matched"   → State 6 success · restore + clear
 *   - "mismatched" → State 7 · activation failed · clear + surface retry
 *   - "no-snapshot" → normal boot · nothing to do
 *   - "stale" → snapshot expired · clear silently
 */
export type BootVerdict = "matched" | "mismatched" | "no-snapshot" | "stale";

export function verifyBoot(bootedVersion: string, snapshot: RestoreSnapshot | null, nowMs: number = Date.now()): BootVerdict {
  if (!snapshot) return "no-snapshot";
  if (isStale(snapshot, nowMs)) return "stale";
  if (bootedVersion === snapshot.staged_version) return "matched";
  return "mismatched";
}

/** Best-effort route restoration. Sets `window.location.hash` to
 *  the last safe route if present. Guarded so tests running under
 *  jsdom without hash routing don't blow up. */
export function restoreLastSafeRoute(snapshot: RestoreSnapshot): boolean {
  if (!snapshot.last_safe_route) return false;
  if (typeof window === "undefined") return false;
  try {
    // Only overwrite the hash if the app booted into an empty or
    // default hash — otherwise the user has already navigated and
    // we'd trample their explicit choice.
    const current = window.location.hash || "";
    if (current === "" || current === "#" || current === "#/") {
      window.location.hash = snapshot.last_safe_route;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Snapshot the currently visible route. Used when the update flow
 *  wants to persist "wherever the user was" without every caller
 *  needing to plumb the route in. */
export function currentSafeRoute(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.location.hash || null;
  } catch {
    return null;
  }
}

/** Snapshot the current JWT. Reads directly from localStorage so
 *  the update flow doesn't need to plumb the `useAuth` hook. */
export function currentJwt(): string | null {
  if (!isStorageAvailable()) return null;
  try {
    return window.localStorage.getItem(JWT_STORAGE_KEY);
  } catch {
    return null;
  }
}
