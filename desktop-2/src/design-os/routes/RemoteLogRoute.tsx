/**
 * RemoteLogRoute · staff-only audit trail of every remote-control
 * command executed this session. Reads localStorage `lc.remote.log`
 * (written by useRemoteControl).
 *
 * 2026-07-22 · Sprint remote-1
 */
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { DesignOSAppShell } from "../components/AppShell";
import "./RemoteLogRoute.css";

const STAFF_FLAG_KEY = "lc.staff.flag";
const LOG_KEY = "lc.remote.log";

interface LogEntry {
  ts: number;
  id: string;
  kind: string;
  result: string;
  ok: boolean;
}

function isStaff(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const hash = window.location.hash || "";
    if (hash.includes("staff=1")) {
      try {
        window.localStorage.setItem(STAFF_FLAG_KEY, "1");
        const clean = hash.split("?")[0];
        window.history.replaceState(null, "", clean);
      } catch { /* silent */ }
      return true;
    }
    return window.localStorage.getItem(STAFF_FLAG_KEY) === "1";
  } catch { return false; }
}

function readLog(): LogEntry[] {
  try {
    const raw = window.localStorage.getItem(LOG_KEY);
    return raw ? (JSON.parse(raw) as LogEntry[]) : [];
  } catch { return []; }
}

function shortWhen(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function RemoteLogRoute(): ReactElement {
  const [staff] = useState<boolean>(() => isStaff());
  const [entries, setEntries] = useState<LogEntry[]>(() => readLog());
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!staff) return;
    const id = window.setInterval(() => {
      setEntries(readLog());
      forceTick((t) => t + 1);
    }, 800);
    return () => window.clearInterval(id);
  }, [staff]);

  const clearAll = useCallback(() => {
    try { window.localStorage.removeItem(LOG_KEY); } catch { /* silent */ }
    setEntries([]);
  }, []);

  if (!staff) {
    return (
      <DesignOSAppShell world="cockpit-home" route="composer" defaultKade="idle" kadePlacement="bottom-right">
        <div className="lc-rl-block">
          <h1>Remote Command Log · staff only</h1>
          <p>Enable via console: <code>localStorage.setItem("lc.staff.flag", "1")</code></p>
        </div>
      </DesignOSAppShell>
    );
  }

  return (
    <DesignOSAppShell world="cockpit-home" route="composer" defaultKade="idle" kadePlacement="bottom-right">
      <div className="lc-rl" data-testid="remote-log-route">
        <header className="lc-rl-head">
          <div>
            <h1>Remote Command Log</h1>
            <span className="lc-rl-sub">Every remote-control command executed on this device</span>
          </div>
          <div className="lc-rl-actions">
            <span className="lc-rl-pill">{entries.length} entries</span>
            <button className="lc-rl-btn" onClick={clearAll}>Clear</button>
          </div>
        </header>
        <div className="lc-rl-list">
          {entries.length === 0 && (
            <div className="lc-rl-empty">
              No remote commands executed yet on this device.
            </div>
          )}
          {entries.map((e) => (
            <div key={e.id + "_" + e.ts} className="lc-rl-row" data-ok={e.ok ? "true" : "false"}>
              <span className="lc-rl-when">{shortWhen(e.ts)}</span>
              <span className="lc-rl-kind">{e.kind}</span>
              <span className="lc-rl-result">{e.result}</span>
            </div>
          ))}
        </div>
      </div>
    </DesignOSAppShell>
  );
}

export default RemoteLogRoute;
