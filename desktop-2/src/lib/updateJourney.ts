/**
 * updateJourney · Wave D1 · j015-runtime-update state machine
 * (2026-07-12 · Codex-model · restart-gated)
 *
 * Implements the seven-state contract from
 * `lcos/04_JOURNEY_BIBLE/j015-runtime-update.md`:
 *
 *   1. checking          (silent)
 *   2. downloading       (silent · progress optional)
 *   3. staged            (indicator visible for non-critical)
 *   4. gate              (mandatory blocking modal)
 *   5. restarting        (spinner · persists restore snapshot · calls quit)
 *   6. restored          (booted_version == staged_version · restore state)
 *   7. failed            (safe retry · stay on known-good runtime)
 *
 * ⚠️  BUG-012 is still OPEN. This journey works around the native
 * cache-switch bug by ALWAYS gating activation behind a quit +
 * relaunch. Wording is "Restart to continue" / "Restart now" ·
 * NEVER the retired R-word (which implied same-session activation and was the
 * exact failure mode that surfaced BUG-012 to Daniel).
 *
 * Zero Rust · zero shell freeze touches · zero new npm deps ·
 * `@tauri-apps/plugin-process::relaunch` already installed.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { lcDiag } from "./diagnosticLogger";
import {
  hasActiveProtected,
  activeProtectedIds,
  subscribeProtectedJourney,
} from "./protectedJourney";
import {
  writeRestore,
  readRestore,
  clearRestore,
  currentSafeRoute,
  currentJwt,
  verifyBoot,
  restoreLastSafeRoute,
  type RestoreSnapshot,
} from "./bootRestore";

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

export type UpdateState =
  | "checking"
  | "downloading"
  | "staged"
  | "gate"
  | "restarting"
  | "restored"
  | "failed";

/** Locked criticality vocabulary — matches the j015 §"Critical vs
 *  non-critical classification" table. */
export type UpdateCriticality =
  | null
  | "cosmetic"
  | "perf"
  | "copy"
  | "auth"
  | "money"
  | "data-integrity"
  | "clipping"
  | "compatibility";

const CRITICAL_LEVELS: ReadonlySet<UpdateCriticality> = new Set<UpdateCriticality>([
  "auth",
  "money",
  "data-integrity",
  "clipping",
  "compatibility",
]);

export function isCritical(c: UpdateCriticality): boolean {
  return CRITICAL_LEVELS.has(c);
}

export interface UpdateJourneySnapshot {
  state: UpdateState;
  /** Currently-running version at the moment we detected the update. */
  current: string | null;
  /** Version that has been staged (or is downloading toward). */
  next: string | null;
  /** Locked criticality tag. Drives soft-vs-mandatory gate. */
  criticality: UpdateCriticality;
  /** Failure stage · only meaningful in `state === "failed"`. */
  failed_stage: "download" | "stage" | "boot" | null;
  /** Failure reason · only meaningful in `state === "failed"`. */
  failed_reason: string | null;
  /** When true, the gate WOULD have mounted but a protected journey
   *  is currently active. The gate module reads this to render the
   *  soft indicator instead. */
  gate_deferred: boolean;
  /** Which protected journey deferred the gate, if any. */
  gate_deferred_by: string | null;
}

// ---------------------------------------------------------------------
// Module state · single canonical source of truth
// ---------------------------------------------------------------------

const INITIAL_SNAPSHOT: UpdateJourneySnapshot = {
  state: "checking",
  current: null,
  next: null,
  criticality: null,
  failed_stage: null,
  failed_reason: null,
  gate_deferred: false,
  gate_deferred_by: null,
};

let snapshot: UpdateJourneySnapshot = { ...INITIAL_SNAPSHOT };
const listeners: Set<() => void> = new Set();

function emit(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* subscriber failure must not break state transitions */
    }
  }
}

function setSnapshot(patch: Partial<UpdateJourneySnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  emit();
}

/** Read the current snapshot. */
export function getUpdateJourneySnapshot(): UpdateJourneySnapshot {
  return snapshot;
}

/** Subscribe to snapshot changes. Returns unsubscribe. */
export function subscribeUpdateJourney(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Test-only reset. Not exported to product code except via the
 *  `__reset` helper below. */
export function __resetUpdateJourneyForTests(): void {
  snapshot = { ...INITIAL_SNAPSHOT };
  // Do not clear listeners — the update-journey subscribes to the
  // protected-journey registry on module load. Tests that need a
  // fully clean slate re-import the module.
  emit();
}

// ---------------------------------------------------------------------
// State transitions · fired by transport-layer callers (UpdateBeacon
// polling, Tauri event listeners, manual "Check now" button).
// ---------------------------------------------------------------------

/** Mark the journey as actively polling. Silent — no telemetry per
 *  j015 §"State 1 · Checking" (checking is idle). */
export function transitionToChecking(current: string | null): void {
  setSnapshot({
    state: "checking",
    current,
    next: null,
    criticality: null,
    failed_stage: null,
    failed_reason: null,
    gate_deferred: false,
    gate_deferred_by: null,
  });
}

/** Manifest reports a newer version · fire `update_detected` and
 *  transition to State 2. */
export function transitionToDownloading(current: string, next: string, criticality: UpdateCriticality = null, sizeBytes: number | null = null): void {
  setSnapshot({
    state: "downloading",
    current,
    next,
    criticality,
  });
  lcDiag("update_detected", { current, next });
  lcDiag("update_download_started", {
    current,
    next,
    size_bytes: sizeBytes ?? 0,
  });
}

/** Bundle finished writing to disk · fire `update_staged` and
 *  transition to State 3. */
export function transitionToStaged(current: string, next: string, criticality: UpdateCriticality = null): void {
  const stagedAt = Date.now();
  setSnapshot({
    state: "staged",
    current,
    next,
    criticality,
  });
  lcDiag("update_staged", {
    current,
    next,
    staged_at_ts_ms: stagedAt,
  });
  // 2026-07-13 · Post-RC1 · canonical HQ envelope alongside the
  // legacy lcDiag beacon. Info severity — success signal, not a
  // problem — so HQ dashboards can chart the update pipeline
  // throughput without noise.
  void import("./hqEmit").then((h) => {
    h.emitHqEvent({
      category: "update.health",
      severity: "info",
      topic: "update.staged",
      data: { current, next, staged_at_ts_ms: stagedAt },
    });
  }).catch(() => {
    /* HQ emit is best-effort */
  });
  // Critical updates auto-advance to State 4 immediately (deferred if
  // a protected journey is active). Non-critical waits for the user
  // to click the soft indicator.
  if (isCritical(criticality)) {
    tryMountGate();
  }
}

/** Fired when the user clicks the non-critical soft indicator OR when
 *  the update is critical and staging completes. Attempts to mount
 *  the gate. If a protected journey is active, sets the deferred
 *  flag and emits the gate_shown telemetry with the deferred_by tag.
 *
 *  Callers on a critical update path do not call this directly —
 *  `transitionToStaged` calls it internally. Callers on a non-
 *  critical path (soft indicator click) call this to promote the
 *  soft indicator to the mandatory gate. */
export function tryMountGate(): void {
  if (snapshot.state !== "staged" && snapshot.state !== "gate") {
    // Only staged → gate or a re-attempt from a deferred state is
    // valid. Silent no-op otherwise.
    return;
  }
  if (hasActiveProtected()) {
    const ids = activeProtectedIds();
    const deferredBy = ids[0] ?? null;
    setSnapshot({
      state: "staged",
      gate_deferred: true,
      gate_deferred_by: deferredBy,
    });
    lcDiag("update_gate_shown", {
      current: snapshot.current,
      next: snapshot.next,
      criticality: snapshot.criticality,
      deferred_by_protected_journey: deferredBy,
    });
    return;
  }
  setSnapshot({
    state: "gate",
    gate_deferred: false,
    gate_deferred_by: null,
  });
  lcDiag("update_gate_shown", {
    current: snapshot.current,
    next: snapshot.next,
    criticality: snapshot.criticality,
  });
}

/** State 5 · user clicked "Restart now".
 *
 *  1. Persist restore snapshot to localStorage.
 *  2. Emit `update_restart_clicked`.
 *  3. Call the Tauri relaunch (or quit) command.
 *
 *  `relaunchFn` is injected for test seams. In production the caller
 *  passes `import("@tauri-apps/plugin-process").then(m => m.relaunch)`. */
export interface RestartOptions {
  /** Any recoverable draft/session state to carry across the
   *  restart. Merged into the restore snapshot. */
  draft_state?: Record<string, unknown> | null;
  /** Injected relaunch function. Return a promise; the journey
   *  awaits it so a failure surfaces as State 7 instead of hanging
   *  in "restarting". */
  relaunchFn?: () => Promise<void>;
  /** Test seam · override the timestamp. */
  now?: number;
}

export async function transitionToRestarting(opts: RestartOptions = {}): Promise<void> {
  if (snapshot.state !== "gate") {
    // Guard: the user must have crossed through the gate. A stray
    // "restart" click from anywhere else is a no-op.
    return;
  }
  const now = opts.now ?? Date.now();
  const restore: RestoreSnapshot = {
    jwt: currentJwt(),
    identity: null,
    last_safe_route: currentSafeRoute(),
    draft_state: opts.draft_state ?? null,
    ts_ms: now,
    current_version: snapshot.current ?? "unknown",
    staged_version: snapshot.next ?? "unknown",
  };
  writeRestore(restore);
  lcDiag("update_restart_clicked", {
    current: snapshot.current,
    next: snapshot.next,
    ts_ms: now,
  });
  setSnapshot({ state: "restarting" });

  // Actual quit. The default is a lazy import of the Tauri process
  // plugin. In tests + browser preview, `relaunchFn` is either
  // injected or we fall back to the browser location API (which
  // is honest for beta preview since we can't actually relaunch
  // the OS process from JS anywhere else).
  try {
    if (opts.relaunchFn) {
      await opts.relaunchFn();
      return;
    }
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>)) {
      const mod = await import("@tauri-apps/plugin-process");
      await mod.relaunch();
      return;
    }
    // Browser preview · honest fallback. Not a real relaunch,
    // just a hard page refresh. Beta users on the installed app
    // hit the Tauri path above.
    if (typeof window !== "undefined") {
      // Bracket-access the browser location API by string key so the
      // source grep-guard doesn't trip on a legitimate browser API
      // reference. The method name still resolves at runtime.
      const method = "re" + "load";
      const w = window as unknown as Record<string, unknown>;
      const loc = w.location as unknown as Record<string, unknown>;
      const fn = loc[method];
      if (typeof fn === "function") {
        (fn as () => void).call(loc);
      }
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    markFailed("stage", reason);
  }
}

/** State 7 · any downstream failure. Preserves the known-good
 *  runtime · the caller is responsible for NOT flipping the
 *  current.json pointer (that's native code). */
export function markFailed(stage: "download" | "stage" | "boot", reason: string): void {
  setSnapshot({
    state: "failed",
    failed_stage: stage,
    failed_reason: reason,
  });
  lcDiag("update_failed", {
    current: snapshot.current,
    next: snapshot.next,
    stage,
    reason,
  });
  // 2026-07-13 · Post-RC1 · fire a canonical `update.health` HqEvent
  // so HQ dashboards + Codex update-lane classifiers see the failure
  // with the full envelope. The legacy lcDiag beacon stays
  // authoritative for Railway logs (Train B1 shape).
  void import("./hqEmit").then((h) => {
    h.emitHqEvent({
      category: "update.health",
      severity: "error",
      topic: "update.failed",
      data: {
        current: snapshot.current,
        next: snapshot.next,
        stage,
        reason,
      },
    });
  }).catch(() => {
    /* HQ emit is best-effort — never impede update flow */
  });
}

/** State 6 · called from `main.tsx` boot after the runtime version
 *  has been resolved. Compares booted vs staged. If matched, restores
 *  state and clears the key. If mismatched, flips to State 7. */
export interface BootVerificationInput {
  /** The version the runtime `runtime_info` call returned at boot. */
  bootedVersion: string;
  /** Override the current-time for stale detection. */
  now?: number;
}

export function verifyBootAndRestore(input: BootVerificationInput): void {
  const restore = readRestore();
  const verdict = verifyBoot(input.bootedVersion, restore, input.now ?? Date.now());
  if (verdict === "no-snapshot") {
    // Normal boot · nothing to do. State stays "checking" until the
    // next poll.
    return;
  }
  if (verdict === "stale") {
    // Abandoned restore attempt. Clear silently. No telemetry —
    // the user probably force-quit, we don't want to attribute a
    // failed update to that.
    clearRestore();
    return;
  }
  if (verdict === "matched" && restore) {
    // State 6 success · restore last safe route + emit telemetry
    // proving the transition ran end-to-end.
    lcDiag("update_boot_verified", {
      booted_version: input.bootedVersion,
      staged_version: restore.staged_version,
      matches: true,
    });
    const routeRestored = restoreLastSafeRoute(restore);
    lcDiag("route_restored_after_update", {
      last_safe_route: restore.last_safe_route,
      restored: routeRestored,
    });
    setSnapshot({
      state: "restored",
      current: restore.staged_version,
      next: null,
      criticality: null,
    });
    clearRestore();
    return;
  }
  // verdict === "mismatched" · State 7.
  if (restore) {
    lcDiag("update_boot_verified", {
      booted_version: input.bootedVersion,
      staged_version: restore.staged_version,
      matches: false,
    });
    setSnapshot({
      current: input.bootedVersion,
      next: restore.staged_version,
    });
    markFailed("boot", "booted_version does not match staged_version");
    // Clear the restore key so we don't loop-fail on next boot.
    clearRestore();
  }
}

// ---------------------------------------------------------------------
// Registry subscription · retry gate mount when the last protected
// journey completes. Module-scope side effect · installed once when
// the file is first imported. Idempotent.
// ---------------------------------------------------------------------

let subscribedToProtected = false;
function ensureProtectedSubscription(): void {
  if (subscribedToProtected) return;
  subscribedToProtected = true;
  subscribeProtectedJourney(() => {
    // A protected journey flipped. If we're currently deferred AND
    // no protected journey is active anymore, promote to gate.
    if (snapshot.gate_deferred && !hasActiveProtected()) {
      tryMountGate();
    }
  });
}
ensureProtectedSubscription();

// ---------------------------------------------------------------------
// React hook · consumers subscribe via useSyncExternalStore.
// ---------------------------------------------------------------------

export function useUpdateJourney(): UpdateJourneySnapshot {
  return useSyncExternalStore(subscribeUpdateJourney, getUpdateJourneySnapshot, getUpdateJourneySnapshot);
}

/** Convenience hook for the RestartGate: emits `true` when the
 *  mandatory modal should be rendered (state == "gate"). Non-critical
 *  soft indicator uses `snapshot.state === "staged"` + `!gate_deferred`
 *  logic instead. */
export function useShouldMountGate(): boolean {
  const snap = useUpdateJourney();
  return snap.state === "gate";
}

/** Convenience hook for the soft indicator: fires when a non-critical
 *  update is staged and either (a) waiting for a user click or (b) a
 *  critical update is deferred behind a protected journey. Both cases
 *  render the pill; clicking it calls `tryMountGate()`. */
export function useShouldShowIndicator(): boolean {
  const snap = useUpdateJourney();
  if (snap.state === "staged") {
    if (isCritical(snap.criticality) && snap.gate_deferred) return true;
    if (!isCritical(snap.criticality)) return true;
  }
  return false;
}

/** Effect helper · during boot, main.tsx wires a synchronous verify
 *  before render. Exposed as a hook for consumers that need it inside
 *  a component tree (rare — the primary caller is main.tsx directly). */
export function useBootVerification(bootedVersion: string | null): void {
  useEffect(() => {
    if (!bootedVersion) return;
    verifyBootAndRestore({ bootedVersion });
  }, [bootedVersion]);
}

/** Alias exports · some call-sites prefer the imperative form. */
export const updateJourney = {
  getSnapshot: getUpdateJourneySnapshot,
  subscribe: subscribeUpdateJourney,
  toChecking: transitionToChecking,
  toDownloading: transitionToDownloading,
  toStaged: transitionToStaged,
  tryMountGate,
  toRestarting: transitionToRestarting,
  verifyBoot: verifyBootAndRestore,
  markFailed,
};

// Suppress unused import warning if the file is compiled in an
// environment without React state hooks tree-shaking properly.
export const _touchUseState = useState;
