/**
 * UpdateReadyIndicator · Wave D1 · j015-runtime-update (2026-07-12)
 *
 * Soft, non-blocking pill that surfaces a staged non-critical update
 * OR a critical update whose gate has been deferred behind a
 * protected journey. Clicking the pill calls `tryMountGate()` which
 * either promotes the gate (protected journey inactive) or emits
 * another `update_gate_shown { deferred_by_protected_journey }`
 * telemetry (so HQ measures deferral depth).
 *
 * Locked copy (from j015 §"State 3"):
 *   Non-critical:  "Update ready · Restart to continue →"
 *   Deferred:      "Update ready · Waiting for {journey} →"
 *
 * NEVER emits the old R-word — that language implied same-session
 * activation and was the surface for BUG-012. Grep guard in
 * the grep guard test enforces this.
 *
 * Perf discipline: portal-mounted, no backdrop-filter, no infinite
 * animation, single ≤100ms transition on hover.
 */

import { createPortal } from "react-dom";
import {
  useUpdateJourney,
  useShouldShowIndicator,
  tryMountGate,
  isCritical,
} from "../../lib/updateJourney";
import "./UpdateReadyIndicator.css";

export function UpdateReadyIndicator(): React.ReactElement | null {
  const snap = useUpdateJourney();
  const shouldShow = useShouldShowIndicator();

  if (!shouldShow) return null;
  if (typeof document === "undefined") return null;

  const critical = isCritical(snap.criticality);
  const deferredBy = snap.gate_deferred_by;
  const copy = deferredBy
    ? `Update ready · Waiting for ${humanJourney(deferredBy)} →`
    : "Update ready · Restart to continue →";

  return createPortal(
    <div
      className="lc-update-indicator"
      role="status"
      aria-live="polite"
      data-testid="update-ready-indicator"
      data-current={snap.current ?? ""}
      data-next={snap.next ?? ""}
      data-criticality={snap.criticality ?? ""}
      data-critical={critical ? "true" : "false"}
      data-deferred={snap.gate_deferred ? "true" : "false"}
      data-deferred-by={deferredBy ?? ""}
    >
      <button
        type="button"
        className="lc-update-indicator-btn"
        onClick={() => tryMountGate()}
        data-testid="update-ready-indicator-btn"
      >
        <span className="lc-update-indicator-dot" aria-hidden="true" />
        <span className="lc-update-indicator-copy">{copy}</span>
      </button>
    </div>,
    document.body,
  );
}

function humanJourney(id: string): string {
  switch (id) {
    case "j005-upload":
      return "upload";
    case "j006-clip-generation":
      return "clipping run";
    case "j007-my-clips":
      return "clip export";
    case "j004-connect-whop":
      return "Whop connect";
    case "j011-payout":
      return "payout";
    case "j001-fresh-user-otp-identity":
      return "identity claim";
    default:
      return "current task";
  }
}
