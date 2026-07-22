/**
 * RemoteControlPill · app-wide persistent pill next to the AGENCY chip.
 * Reads from the useRemoteStatus Zustand slot so it renders on EVERY
 * route (Home · Composer · Wallet · everywhere) — not just Composer.
 *
 * Founder-only. Non-founder returns null.
 *
 * 2026-07-22 · Sprint remote-1a
 */
import { type ReactElement } from "react";
import { useRemoteStatus } from "../lib/remoteControlStatus";
import "./RemoteControlPill.css";

export function RemoteControlPill(): ReactElement | null {
  const active = useRemoteStatus((s) => s.active);
  const hasConsent = useRemoteStatus((s) => s.hasConsent);
  const isFounder = useRemoteStatus((s) => s.isFounder);
  const lastError = useRemoteStatus((s) => s.lastError);
  const optIn = useRemoteStatus((s) => s.optIn);
  const killSwitch = useRemoteStatus((s) => s.killSwitch);

  if (!isFounder) return null;

  if (!hasConsent) {
    return (
      <button
        className="lc-rc-pill"
        data-state="idle"
        data-testid="remote-control-pill"
        onClick={optIn ?? undefined}
        title="Enable founder remote support · session-scoped · ⌘⇧K to STOP anytime"
      >
        <span className="lc-rc-pill-badge">REMOTE</span>
        <span className="lc-rc-pill-body">Enable</span>
      </button>
    );
  }

  if (!active) {
    return (
      <button
        className="lc-rc-pill"
        data-state="warn"
        data-testid="remote-control-pill"
        onClick={killSwitch ?? undefined}
        title={lastError ?? "connecting…"}
      >
        <span className="lc-rc-pill-badge">REMOTE</span>
        <span className="lc-rc-pill-body">{lastError ? "error" : "connecting…"}</span>
        <span className="lc-rc-pill-stop">STOP</span>
      </button>
    );
  }

  return (
    <button
      className="lc-rc-pill"
      data-state="active"
      data-testid="remote-control-pill"
      onClick={killSwitch ?? undefined}
      title="Remote control active · ⌘⇧K or click STOP"
    >
      <span className="lc-rc-pill-badge lc-rc-pill-badge-pulse">● REMOTE ACTIVE</span>
      <span className="lc-rc-pill-stop">STOP (⌘⇧K)</span>
    </button>
  );
}

export default RemoteControlPill;
