/**
 * KadeUpdateGate · 2026-07-14 · Full-screen mandatory-update surface.
 *
 * Rendered as the SOLE reachable surface at app root when the active
 * runtime version is below the manifest-declared
 * `minimum_supported_version`. Blocks Login, Cockpit, Workstation,
 * Earn, Agency, Settings and every deep-linked route by taking over
 * the entire viewport until the new signed runtime activates.
 *
 * Runtime-only · no shell rebuild · no Rust · no new npm deps.
 *
 * Copy is locked by Daniel's 2026-07-14 spec — do not paraphrase.
 *
 * Design rules:
 *   - Kade branded (uses existing brand asset)
 *   - Never imitates a macOS system dialogue
 *   - Progress: real byte-percentage when available, indeterminate
 *     otherwise · NEVER fabricated percentages
 *   - Failure surface remains blocking until user retries or manually
 *     rolls back — never dismissable, never a blank screen
 *   - Accessible: aria-live for state transitions, keyboard focus
 *     retained inside the gate (natural focus containment because
 *     application routes are not mounted while the gate is up)
 */

import { useMemo, useState } from "react";
import { useUpdateJourney, isCritical } from "../../lib/updateJourney";
import type { UpdateState } from "../../lib/updateJourney";
import type { MandatoryStatus } from "../../lib/mandatoryUpdate";
import "./KadeUpdateGate.css";

const HEADLINE = "Liquid Clips Update";
const INITIAL_MSG = "A fresh version of Liquid Clips is ready.";
const SUPPORTING = "Kade is installing the latest improvements. Your projects, clips and account will remain safe.";

const STATUS_COPY: Record<UpdateState | "preparing" | "verifying" | "installing" | "done", string> = {
  checking: "Checking for updates…",
  preparing: "Preparing update…",
  downloading: "Downloading update…",
  verifying: "Verifying update…",
  installing: "Installing update…",
  staged: "Installing update…",
  gate: "Installing update…",
  restarting: "Restarting Liquid Clips…",
  restored: "Liquid Clips is up to date.",
  done: "Liquid Clips is up to date.",
  failed: "Update could not be completed",
};

const FAILURE_BODY = "Your existing version has not been changed. Check your connection and try again.";

export interface KadeUpdateGateProps {
  /** Result of `resolveMandatoryStatus`. Gate mounts only when
   *  `kind === "mandatory" | "mandatory_cached"`. */
  status: MandatoryStatus;
  /** Bytes downloaded so far (from Tauri progress event) · null when
   *  the shell hasn't emitted a measurable progress signal yet. */
  bytesDownloaded?: number | null;
  /** Total bytes expected (from Content-Length or manifest hint) ·
   *  null when unknown; keeps the progress indicator indeterminate. */
  bytesTotal?: number | null;
  /** Called when user clicks "Retry update" on the failure surface. */
  onRetry?: () => void | Promise<void>;
  /** Called when user clicks "Copy diagnostics" — returns a JSON
   *  blob with the current policy + last error for support attachment. */
  onCopyDiagnostics?: () => void | Promise<void>;
  /** Called when user clicks "Contact support" — opens the standard
   *  support surface via bus/router. */
  onContactSupport?: () => void | Promise<void>;
}

export function KadeUpdateGate({
  status,
  bytesDownloaded = null,
  bytesTotal = null,
  onRetry,
  onCopyDiagnostics,
  onContactSupport,
}: KadeUpdateGateProps): React.ReactElement | null {
  const journey = useUpdateJourney();
  const [retryBusy, setRetryBusy] = useState(false);

  // Gate mounts only for mandatory kinds. Callers that pass "ok" or
  // "unknown" get null · they render their normal route tree.
  const isMandatoryKind =
    status.kind === "mandatory" || status.kind === "mandatory_cached";
  if (!isMandatoryKind) return null;

  const displayState: keyof typeof STATUS_COPY = useMemo(() => {
    if (journey.state === "failed") return "failed";
    if (journey.state === "restarting") return "restarting";
    if (journey.state === "restored") return "done";
    if (journey.state === "gate" || journey.state === "staged") {
      // Post-stage · pre-restart · the shell has already atomically
      // verified + activated the bundle. Copy: "Installing…"
      return "installing";
    }
    if (journey.state === "downloading") return "downloading";
    if (journey.state === "checking") return "checking";
    // Journey hasn't started yet · we're still evaluating manifest.
    return "checking";
  }, [journey.state]);

  const percent =
    bytesDownloaded != null
    && bytesTotal != null
    && bytesTotal > 0
    && displayState === "downloading"
      ? Math.min(100, Math.round((bytesDownloaded / bytesTotal) * 100))
      : null;

  const isFailed = displayState === "failed";
  const isDone = displayState === "done";

  const handleRetry = async (): Promise<void> => {
    if (!onRetry || retryBusy) return;
    setRetryBusy(true);
    try { await onRetry(); } finally { setRetryBusy(false); }
  };

  return (
    <div
      className="lc-kade-update-gate"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lc-kade-update-headline"
      aria-describedby="lc-kade-update-status"
      data-testid="kade-update-gate"
      data-mandatory-kind={status.kind}
      data-display-state={displayState}
      data-journey-state={journey.state}
      data-active-version={status.policy.active}
      data-min-supported={status.policy.minimum_supported_version ?? ""}
      data-latest-version={status.policy.latest_version ?? ""}
    >
      <div className="lc-kade-update-gate__panel">
        <img
          className="lc-kade-update-gate__kade"
          src="/brand/kade/kade-cutting-clips.webp"
          alt=""
          aria-hidden="true"
        />
        <h1 id="lc-kade-update-headline" className="lc-kade-update-gate__headline">
          {isFailed ? "Update could not be completed" : HEADLINE}
        </h1>

        {!isFailed && (
          <>
            <p className="lc-kade-update-gate__initial">{INITIAL_MSG}</p>
            <p className="lc-kade-update-gate__supporting">{SUPPORTING}</p>
          </>
        )}
        {isFailed && (
          <p className="lc-kade-update-gate__failure-body">{FAILURE_BODY}</p>
        )}

        <div
          id="lc-kade-update-status"
          className="lc-kade-update-gate__status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="kade-update-status-copy"
        >
          {STATUS_COPY[displayState]}
        </div>

        {!isFailed && !isDone && (
          <div className="lc-kade-update-gate__progress" data-testid="kade-update-progress">
            {percent != null ? (
              <div
                className="lc-kade-update-gate__bar"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Update download progress"
                data-percent={percent}
              >
                <div
                  className="lc-kade-update-gate__bar-fill"
                  style={{ width: `${percent}%` }}
                />
              </div>
            ) : (
              <div
                className="lc-kade-update-gate__indeterminate"
                role="progressbar"
                aria-label={`${STATUS_COPY[displayState]} · in progress`}
              />
            )}
          </div>
        )}

        {isFailed && (
          <div className="lc-kade-update-gate__actions" role="group" aria-label="Update recovery actions">
            <button
              type="button"
              className="lc-kade-update-gate__btn lc-kade-update-gate__btn--primary"
              onClick={handleRetry}
              disabled={retryBusy}
              data-testid="kade-update-retry"
            >
              {retryBusy ? "Retrying…" : "Retry update"}
            </button>
            <button
              type="button"
              className="lc-kade-update-gate__btn"
              onClick={() => { void onCopyDiagnostics?.(); }}
              data-testid="kade-update-copy-diag"
            >
              Copy diagnostics
            </button>
            <button
              type="button"
              className="lc-kade-update-gate__btn"
              onClick={() => { void onContactSupport?.(); }}
              data-testid="kade-update-contact-support"
            >
              Contact support
            </button>
          </div>
        )}

        <div className="lc-kade-update-gate__meta" aria-hidden="true">
          <span>Active {status.policy.active}</span>
          <span aria-hidden="true"> · </span>
          <span>Required {status.policy.minimum_supported_version ?? "—"}</span>
          {status.policy.latest_version ? (
            <>
              <span aria-hidden="true"> · </span>
              <span>Latest {status.policy.latest_version}</span>
            </>
          ) : null}
          {status.kind === "mandatory_cached" ? (
            <>
              <span aria-hidden="true"> · </span>
              <span data-testid="kade-update-cached-marker">Offline · cached policy</span>
            </>
          ) : null}
          {isCritical(journey.criticality) ? (
            <>
              <span aria-hidden="true"> · </span>
              <span>Critical: {journey.criticality}</span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
