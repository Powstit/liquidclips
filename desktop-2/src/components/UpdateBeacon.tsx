/**
 * UpdateBeacon · Wave D1 · j015-runtime-update (2026-07-12)
 *
 * REFACTORED to consume the Codex-style state machine at
 * `src/lib/updateJourney.ts`. The old component owned its own
 * "booted vs staged" comparison AND rendered a retired R-word pill —
 * both concerns now live upstream:
 *
 *   - "Booted vs staged" comparison + telemetry live in
 *     `updateJourney.ts` (transitions fired by this component
 *     when the Tauri manifest reports a new bundle).
 *
 *   - The visible pill is `UpdateReadyIndicator` (design-os/update/).
 *     The mandatory modal is `RestartGate` (design-os/update/).
 *
 * This file is now the transport layer: it polls `runtime_info` +
 * `runtime_check_now`, listens for `lc:runtime-staged`, and calls
 * the correct `updateJourney.*` transition. No visible output.
 *
 * ⚠️  ZERO retired R-word wording remains. Grep-guard enforced by
 * the sibling grep-guard test file (see the ``.no-*-wording`` sentinel next to this one). If any test hard-coded
 * the old data-testid or copy, fix the test — don't reintroduce
 * the string.
 *
 * BUG-012 mitigation:
 *   Same-session cache-switch never happens. Every activation
 *   requires a quit+relaunch through the RestartGate. The soft
 *   indicator only surfaces post-stage.
 */

import { useCallback, useEffect, useRef } from "react";
import { lcDiag } from "../lib/diagnosticLogger";
import { useEngineSession } from "../design-os/state/useEngineSession";
import {
  transitionToChecking,
  transitionToDownloading,
  transitionToStaged,
  markFailed,
  getUpdateJourneySnapshot,
  type UpdateCriticality,
} from "../lib/updateJourney";
// Wave D1 · j015-runtime-update · j006-clip-generation is protected
// whenever `useEngineSession().phase === "running"`. Registered here
// because the beacon is the shell-level place that already reads the
// engine hook (before Wave D1 to gate polling; now the same signal
// also gates the mandatory update modal).
import { useProtectedJourney } from "../lib/protectedJourney";

type CheckFailureStep = "runtime_info" | "runtime_check_now";
interface FailureFingerprint {
  step: CheckFailureStep;
  reason: string;
}

interface RuntimeInfoShape {
  active_version: string;
  source: "bundled" | "staged" | string;
  staged_bundle_path: string | null;
  last_check: {
    at: string;
    result: string;
    manifest_version: string | null;
  } | null;
  manifest_url: string;
  channel: string;
  /** Optional criticality tag surfaced by the runtime side · maps to
   *  the j015 criticality vocabulary. If missing we default to null
   *  (non-critical). */
  criticality?: UpdateCriticality;
}

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const DELAYED_BOOT_CHECK_MS = 30 * 1000; // 30 s

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
  );
}

export function UpdateBeacon(): React.ReactElement | null {
  const bootedVersionRef = useRef<string | null>(null);
  const lastStagedRef = useRef<string | null>(null);
  const engine = useEngineSession();
  const engineRunningRef = useRef(engine.phase === "running");
  const lastFailureRef = useRef<FailureFingerprint | null>(null);

  useEffect(() => {
    engineRunningRef.current = engine.phase === "running";
  }, [engine.phase]);

  // Wave D1 · j015-runtime-update · j006-clip-generation is the
  // canonical clip-run journey. Register while phase == "running"
  // so the RestartGate defers under this active clip run. Under
  // deferral the UpdateReadyIndicator surfaces with the "Waiting for
  // clipping run" copy, so the user sees the update is queued
  // without being interrupted mid-run.
  useProtectedJourney("j006-clip-generation", engine.phase === "running");

  /** Deduped failure logger. First failure of a given (step, reason)
   *  shape lands; identical repeats are suppressed. Same BUG-009
   *  discipline as the pre-refactor version. */
  const logCheckFailure = useCallback((step: CheckFailureStep, err: unknown): void => {
    const reason = err instanceof Error ? err.message : String(err);
    const prev = lastFailureRef.current;
    if (prev && prev.step === step && prev.reason === reason) return;
    lastFailureRef.current = { step, reason };
    lcDiag("update_beacon_check_failed", { reason, step });
    // A repeated check_now failure that's networky counts as a
    // failed download from the journey's perspective. Boot failures
    // are surfaced separately by main.tsx.
    if (step === "runtime_check_now") {
      markFailed("download", reason);
    }
  }, []);

  const clearFailureFingerprint = useCallback(() => {
    lastFailureRef.current = null;
  }, []);

  const readRuntimeInfo = useCallback(async (): Promise<RuntimeInfoShape | null> => {
    if (!isTauriRuntime()) return null;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const info = await invoke<RuntimeInfoShape>("runtime_info");
      clearFailureFingerprint();
      return info;
    } catch (err) {
      logCheckFailure("runtime_info", err);
      return null;
    }
  }, [clearFailureFingerprint, logCheckFailure]);

  /** Apply a runtime_info read to the journey state machine.
   *  - No booted version yet → capture, set state to checking.
   *  - Active version == booted → nothing to do.
   *  - Active version != booted AND != last-observed → fire the
   *    detected → downloading → staged transitions. */
  const applyRuntimeInfo = useCallback((info: RuntimeInfoShape): void => {
    const booted = bootedVersionRef.current;
    if (booted == null) {
      bootedVersionRef.current = info.active_version;
      lastStagedRef.current = info.active_version;
      transitionToChecking(info.active_version);
      return;
    }
    if (info.active_version === booted) {
      // No staging drift. Silent.
      return;
    }
    if (info.active_version === lastStagedRef.current) {
      // Already handled this staged version. No repeat telemetry.
      return;
    }
    lastStagedRef.current = info.active_version;
    const criticality: UpdateCriticality = info.criticality ?? null;
    // Fire the full detected → downloading → staged trio in one tick.
    // The runtime side has already downloaded + written the bundle
    // by the time `active_version` changes, so the journey collapses
    // to a single visible transition — but the telemetry still logs
    // every step so HQ can measure the funnel.
    transitionToDownloading(booted, info.active_version, criticality, null);
    transitionToStaged(booted, info.active_version, criticality);
  }, []);

  const forceCheck = useCallback(async (): Promise<void> => {
    if (!isTauriRuntime()) return;
    // Skip the manifest poll if the user is actively clipping. Protected
    // journey deferral handles the *gate* deferral; this is the polite
    // "don't add network noise mid-run" filter.
    if (engineRunningRef.current) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("runtime_check_now");
      clearFailureFingerprint();
    } catch (err) {
      logCheckFailure("runtime_check_now", err);
      return;
    }
    const info = await readRuntimeInfo();
    if (info) applyRuntimeInfo(info);
  }, [readRuntimeInfo, applyRuntimeInfo, clearFailureFingerprint, logCheckFailure]);

  // Boot: capture bootedVersion + schedule the delayed 30s check + the
  // 5-min poll. Also listen for `lc:runtime-staged` so a bundle staged
  // by the Rust side promotes the journey without waiting for the tick.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let interval: number | undefined;
    let delayed: number | undefined;
    let unlistenStaged: (() => void) | undefined;

    void (async () => {
      const initial = await readRuntimeInfo();
      if (cancelled) return;
      if (initial) applyRuntimeInfo(initial);

      // 30s post-boot check — catches a manifest bump between install
      // and the first tick.
      delayed = window.setTimeout(() => {
        void forceCheck();
      }, DELAYED_BOOT_CHECK_MS);

      // 5-min recurring check.
      interval = window.setInterval(() => {
        void forceCheck();
      }, CHECK_INTERVAL_MS);

      // Tauri event fired by src-tauri/src/runtime.rs whenever a new
      // bundle finishes staging.
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const off = await listen("lc:runtime-staged", () => {
          void (async () => {
            const info = await readRuntimeInfo();
            if (info) applyRuntimeInfo(info);
          })();
        });
        if (cancelled) off();
        else unlistenStaged = off;
      } catch {
        // Non-fatal — beacon still ticks on the 5-min interval.
      }
    })();

    return () => {
      cancelled = true;
      if (delayed != null) window.clearTimeout(delayed);
      if (interval != null) window.clearInterval(interval);
      if (unlistenStaged) unlistenStaged();
    };
  }, [readRuntimeInfo, applyRuntimeInfo, forceCheck]);

  // Window focus → refresh on tab return.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const onFocus = () => { void forceCheck(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [forceCheck]);

  // Transport layer only. All visible UI is rendered by
  // UpdateReadyIndicator + RestartGate, which subscribe to the
  // journey snapshot via `useUpdateJourney`.
  return null;
}

/** Test seam · lets vitest inspect the snapshot without importing the
 *  full journey module. Kept minimal so no exports leak into normal
 *  callers. */
export function __updateBeaconSnapshotForTest() {
  return getUpdateJourneySnapshot();
}
