/**
 * RestartGate · Wave D1 · j015-runtime-update (2026-07-12)
 *
 * Mandatory blocking modal · mounted when `updateJourney.state === "gate"`
 * (never when deferred behind a protected journey — the deferred case
 * renders `UpdateReadyIndicator` instead).
 *
 * Locked copy (from j015 §"State 4"):
 *   Heading:  "Update ready · Restart to continue."
 *   Body:     "A new version is ready. The app will quit and relaunch
 *              to activate it. Your sign-in, current view, and any
 *              unsaved draft will be restored."
 *   CTA:      "Restart now"
 *
 * NEVER emits the retired R-word · locked by Daniel proof requirement 10.
 * On click, calls `transitionToRestarting()` which:
 *   1. Persists `lc.restore.v1` (jwt + route + draft).
 *   2. Emits `update_restart_clicked`.
 *   3. Calls `@tauri-apps/plugin-process::relaunch()` (existing dep,
 *      no new npm packages).
 *
 * If the relaunch fails (browser preview · missing plugin) the journey
 * flips to `failed` state and this modal is replaced by a small
 * "Try again" indicator — see `UpdateReadyIndicator` deferred styling.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import {
  useUpdateJourney,
  useShouldMountGate,
  transitionToRestarting,
  isCritical,
} from "../../lib/updateJourney";
import "./RestartGate.css";

export function RestartGate(): React.ReactElement | null {
  const snap = useUpdateJourney();
  const shouldMount = useShouldMountGate();
  const [busy, setBusy] = useState(false);

  if (!shouldMount) return null;
  if (typeof document === "undefined") return null;

  const critical = isCritical(snap.criticality);

  async function onRestart(): Promise<void> {
    if (busy) return;
    setBusy(true);
    await transitionToRestarting();
    // If the relaunch actually happens we never reach here (the
    // process exits). The setBusy(false) is a defensive reset for
    // the browser preview + failure paths.
    setBusy(false);
  }

  return createPortal(
    <div
      className="lc-restart-gate-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lc-restart-gate-title"
      aria-describedby="lc-restart-gate-body"
      data-testid="restart-gate"
      data-current={snap.current ?? ""}
      data-next={snap.next ?? ""}
      data-criticality={snap.criticality ?? ""}
      data-critical={critical ? "true" : "false"}
    >
      <div className="lc-restart-gate-card">
        <span className="lc-restart-gate-eb">Update ready</span>
        <h2 className="lc-restart-gate-title" id="lc-restart-gate-title">
          Restart to continue.
        </h2>
        <p className="lc-restart-gate-body" id="lc-restart-gate-body">
          A new version is ready. The app will quit and relaunch to
          activate it. Your sign-in, current view, and any unsaved
          draft will be restored.
        </p>
        {snap.current && snap.next && (
          <p className="lc-restart-gate-versions" data-testid="restart-gate-versions">
            <span>Current · {snap.current}</span>
            <span aria-hidden="true"> → </span>
            <span>Next · {snap.next}</span>
          </p>
        )}
        <button
          type="button"
          className="lc-restart-gate-cta"
          onClick={() => { void onRestart(); }}
          disabled={busy}
          data-testid="restart-gate-cta"
        >
          {busy ? "Restarting…" : "Restart now"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
