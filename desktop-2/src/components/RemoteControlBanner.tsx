/**
 * RemoteControlBanner · always visible when the SSE stream is active
 * OR when a founder can opt in. Kill-switch button + link to log.
 *
 * ⛔ IRON GATE IG-REMOTE-CONTROL-STAFF-ONLY · this banner MUST render
 *    when active===true. Never gate the banner on any dismiss flag.
 *
 * 2026-07-22 · Sprint remote-1
 */
import { type ReactElement } from "react";
import "./RemoteControlBanner.css";

interface RemoteControl {
  active: boolean;
  hasConsent: boolean;
  isFounder: boolean;
  lastError: string | null;
  optIn: () => void;
  killSwitch: () => void;
}

interface Props {
  remote: RemoteControl;
}

export function RemoteControlBanner({ remote }: Props): ReactElement | null {
  if (!remote.isFounder) return null;

  // Not opted in yet · show a quiet "opt in" prompt (founder only)
  if (!remote.hasConsent) {
    return (
      <div className="lc-rc-banner" data-state="idle" data-testid="remote-control-banner">
        <span className="lc-rc-badge">FOUNDER</span>
        <span className="lc-rc-msg">Remote support channel · not connected</span>
        <button className="lc-rc-btn" onClick={remote.optIn}>Enable for this session</button>
        <a className="lc-rc-link" href="#/remote-log?staff=1">Log</a>
      </div>
    );
  }

  // Opted in but stream not live yet · error state
  if (!remote.active) {
    return (
      <div className="lc-rc-banner" data-state="warn" data-testid="remote-control-banner">
        <span className="lc-rc-badge">FOUNDER</span>
        <span className="lc-rc-msg">
          Remote enabled · {remote.lastError ?? "connecting…"}
        </span>
        <button className="lc-rc-btn lc-rc-btn-stop" onClick={remote.killSwitch} title="⌘⇧K">
          STOP
        </button>
        <a className="lc-rc-link" href="#/remote-log?staff=1">Log</a>
      </div>
    );
  }

  // Active stream · pulsing pill + STOP + log link
  return (
    <div className="lc-rc-banner" data-state="active" data-testid="remote-control-banner">
      <span className="lc-rc-badge lc-rc-badge-pulse">● REMOTE CONTROL ACTIVE</span>
      <span className="lc-rc-msg">
        Commands stream open · you can stop any time
      </span>
      <button className="lc-rc-btn lc-rc-btn-stop" onClick={remote.killSwitch} title="⌘⇧K">
        STOP (⌘⇧K)
      </button>
      <a className="lc-rc-link" href="#/remote-log?staff=1">Live log →</a>
    </div>
  );
}

export default RemoteControlBanner;
