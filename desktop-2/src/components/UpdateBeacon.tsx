/**
 * UpdateBeacon · normal (non-mandatory) runtime bundle update pill
 *
 * AU-C-1 · Liquid Clips Phase 2 finalization.
 *
 * The story:
 *   The `HardUpdateGate` (components/update/HardUpdateGate.tsx) handles
 *   MANDATORY / security updates — full-viewport blocker, no bypass, only
 *   forward path is "Install Update & Relaunch". That gate stays as-is.
 *
 *   This component handles NORMAL runtime-bundle updates. The Rust runtime
 *   (src-tauri/src/runtime.rs) polls the manifest, stages a new bundle to
 *   ~/Library/AppSupport, and fires `lc:runtime-staged` events. When a new
 *   staged version is present and DIFFERENT from the version the shell
 *   booted with, the beacon reveals a persistent bottom-right pill:
 *   "Update ready · Reload →". Clicking reloads the webview so the runtime
 *   bundle hot-swaps — NO restart / install language, because that's what
 *   mandatory updates say. This is a pure JS-bundle swap.
 *
 * Discovery mechanism:
 *   1. On mount: invoke("runtime_info") → capture `bootedVersion`.
 *   2. Every 5 min: invoke("runtime_check_now") then invoke("runtime_info").
 *   3. 30s post-boot delayed check (catches manifest updates during boot).
 *   4. Window `focus` listener (user returns to app after a while).
 *   5. Skip all checks if `useEngineSession().phase === "running"` so an
 *      active clipping run isn't nagged with a pill mid-work.
 *
 * Mandatory vs normal:
 *   HardUpdateGate boots FIRST as the outermost wrapper (App.tsx:269). If
 *   the mandatory-update pathway is active, the gate mounts a full-viewport
 *   blocker on top of everything — UpdateBeacon is drawn under that
 *   blocker and is not reachable by the user until the mandatory update
 *   clears. No explicit "mandatory" flag needs plumbing here — the gate's
 *   z-index (100000) covers the beacon (z-index 40) whenever it fires.
 *
 * Perf discipline:
 *   `contain: layout paint style` on the pill; no backdrop-filter; no
 *   infinite animation (only a 220ms fade-in); ≤100ms transitions.
 *
 * Watchdog:
 *   Wrapped by the caller in App.tsx (see mount site) so a Tauri invoke
 *   throwing (browser preview / missing runtime command) surfaces
 *   KadeRepairScreen instead of crashing the shell.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { lcDiag } from "../lib/diagnosticLogger";
import { useEngineSession } from "../design-os/state/useEngineSession";
import "./UpdateBeacon.css";

// BUG-009 · Wave B1 · runtime-truth (2026-07-12) — the beacon polls the
// manifest every 5 min. Before this fix a repeatable failure (missing
// runtime_manifests table on a fresh Railway DB, sidecar cold-start
// timeout, transient 5xx) fired `update_beacon_check_failed` on every
// tick, drowning the diag ring in noise. Now the FIRST failure lands
// as usual; subsequent identical failures within the same session are
// suppressed (deduped by the `stripped` reason). Reset on any successful
// read so a recovered backend restores logging.
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
}

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const DELAYED_BOOT_CHECK_MS = 30 * 1000; // 30 s

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
  );
}

export function UpdateBeacon(): React.ReactElement | null {
  const [bootedVersion, setBootedVersion] = useState<string | null>(null);
  const [stagedVersion, setStagedVersion] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const shownFiredRef = useRef(false);
  const engine = useEngineSession();
  const engineRunningRef = useRef(engine.phase === "running");
  // BUG-009 dedup ring — remembers the last emitted failure so an
  // identical follow-up stays silent. Cleared on any successful info
  // read (a healed backend restores logging).
  const lastFailureRef = useRef<FailureFingerprint | null>(null);
  useEffect(() => {
    engineRunningRef.current = engine.phase === "running";
  }, [engine.phase]);

  /** BUG-009 helper — deduped failure logger. First failure of a given
   *  (step, reason) shape lands; identical repeats are suppressed. */
  const logCheckFailure = useCallback((step: CheckFailureStep, err: unknown): void => {
    const reason = err instanceof Error ? err.message : String(err);
    const prev = lastFailureRef.current;
    if (prev && prev.step === step && prev.reason === reason) return;
    lastFailureRef.current = { step, reason };
    lcDiag("update_beacon_check_failed", { reason, step });
  }, []);

  /** BUG-009 helper — reset the failure dedup ring on a healthy read. */
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

  const forceCheck = useCallback(async (): Promise<void> => {
    if (!isTauriRuntime()) return;
    // Skip the manifest poll if the user is actively clipping — no
    // reason to make network noise mid-run.
    if (engineRunningRef.current) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("runtime_check_now");
      // 2026-07-12 · a successful `runtime_check_now` means the
      // backend answered (either 204 no-manifest or a valid
      // manifest). The Rust command treats 204 as `Ok(())` so any
      // healed backend clears the noise ring below.
      clearFailureFingerprint();
    } catch (err) {
      logCheckFailure("runtime_check_now", err);
      return;
    }
    const info = await readRuntimeInfo();
    if (info) {
      setStagedVersion(info.active_version);
    }
  }, [readRuntimeInfo, clearFailureFingerprint, logCheckFailure]);

  // Boot: capture bootedVersion + schedule the delayed 30s check + the
  // 5-min poll. Also listen for `lc:runtime-staged` so a bundle staged
  // by the Rust side reveals the pill instantly (no wait for the tick).
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let interval: number | undefined;
    let delayed: number | undefined;
    let unlistenStaged: (() => void) | undefined;

    void (async () => {
      const initial = await readRuntimeInfo();
      if (cancelled) return;
      if (initial) {
        setBootedVersion(initial.active_version);
        setStagedVersion(initial.active_version);
      }

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
      // bundle finishes staging — no need to wait 5 min.
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const off = await listen("lc:runtime-staged", () => {
          void (async () => {
            const info = await readRuntimeInfo();
            if (info) setStagedVersion(info.active_version);
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
  }, [readRuntimeInfo, forceCheck]);

  // Window focus → refresh on tab return.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const onFocus = () => { void forceCheck(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [forceCheck]);

  // Visibility rules.
  //  · bootedVersion + stagedVersion both known
  //  · stagedVersion !== bootedVersion
  //  · engine not running (hide during active clipping run)
  useEffect(() => {
    if (!bootedVersion || !stagedVersion) {
      setVisible(false);
      return;
    }
    if (stagedVersion === bootedVersion) {
      setVisible(false);
      return;
    }
    if (engine.phase === "running") {
      setVisible(false);
      return;
    }
    setVisible(true);
  }, [bootedVersion, stagedVersion, engine.phase]);

  // Fire update_beacon_shown once per staged version.
  useEffect(() => {
    if (!visible || shownFiredRef.current) return;
    shownFiredRef.current = true;
    lcDiag("update_beacon_shown", {
      booted: bootedVersion,
      staged: stagedVersion,
    });
  }, [visible, bootedVersion, stagedVersion]);
  // Reset the "shown once" flag if the staged version changes again.
  useEffect(() => {
    shownFiredRef.current = false;
  }, [stagedVersion]);

  const onReload = useCallback(() => {
    lcDiag("update_beacon_reload_clicked", {
      booted: bootedVersion,
      staged: stagedVersion,
    });
    // Runtime bundle hot-swap · webview reload picks up the new bundle
    // from ~/Library/AppSupport. NO relaunch / installer — that's the
    // language of the mandatory HardUpdateGate.
    window.location.reload();
  }, [bootedVersion, stagedVersion]);

  if (!visible) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="lc-update-beacon"
      role="status"
      aria-live="polite"
      data-testid="update-beacon"
      data-booted={bootedVersion ?? ""}
      data-staged={stagedVersion ?? ""}
    >
      <button
        type="button"
        className="lc-update-beacon-btn"
        onClick={onReload}
        data-testid="update-beacon-reload"
      >
        <span className="lc-update-beacon-dot" aria-hidden="true" />
        <span className="lc-update-beacon-copy">Update ready · Reload →</span>
      </button>
    </div>,
    document.body,
  );
}
