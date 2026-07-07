/**
 * EngineHealthPanel · runtime honesty diagnostic strip
 *
 * Phase 6C-Lockdown. Sits at the foot of the ClippingEngine route as a small
 * discreet panel — dev-honest but not user-confusing. Reads from
 * runtimeInfo + the engine session.
 *
 * Public-friendly labels (e.g. "Engine preview" instead of "mock pipeline")
 * + a dev-only details disclosure that shows the raw probe values.
 *
 * Pure read; no state, no IPC, no side effects beyond a refresh button.
 */

import { useState } from "react";
import { GlassCard } from "../components";
import {
  useRuntimeInfo,
  refreshRuntimeProbes,
  type ProbeStatus,
} from "./runtimeInfo";
import "./EngineHealthPanel.css";

export function EngineHealthPanel() {
  const info = useRuntimeInfo();
  const [busy, setBusy] = useState(false);

  const onRefresh = async () => {
    setBusy(true);
    try { await refreshRuntimeProbes(); } finally { setBusy(false); }
  };

  const userMode = info.mode === "real" ? "Live engine" : "Engine preview";
  const userModeNote = info.mode === "real"
    ? "Real sidecar runtime."
    : "Demonstration pipeline · real ingest lands when the runtime is installed.";

  return (
    <GlassCard density="quiet" className="lc-health">
      <header className="lc-health-head">
        <span className="lc-health-eb">Runtime</span>
        <span className={`lc-health-mode lc-health-mode-${info.mode}`}>{userMode}</span>
        <button
          type="button"
          className="lc-health-refresh"
          disabled={busy}
          onClick={onRefresh}
        >
          {busy ? "Probing…" : "Re-probe"}
        </button>
      </header>

      <p className="lc-health-note">{userModeNote}</p>

      <ul className="lc-health-list">
        <Row label="sidecar_call" v={info.sidecarCallAvailable} />
        <Row label="ffmpeg"       v={info.ffmpeg} />
        <Row label="yt-dlp"       v={info.ytDlp} />
        <Row label="faster-whisper" v={info.fasterWhisper} />
      </ul>

      <footer className="lc-health-foot">
        <span className="lc-health-eb">Last run</span>
        <span className={`lc-health-last lc-health-last-${info.lastRun.phase}`}>
          {info.lastRun.phase}
          {info.lastRun.stage && info.lastRun.phase === "running" && (
            <span className="lc-health-stage"> · {info.lastRun.stage}</span>
          )}
        </span>
        {info.lastRun.message && (
          <span className="lc-health-err" title={info.lastRun.message}>
            {info.lastRun.message}
          </span>
        )}
      </footer>
    </GlassCard>
  );
}

function Row({ label, v }: { label: string; v: ProbeStatus }) {
  return (
    <li className={`lc-health-row lc-health-row-${v}`}>
      <span className="lc-health-row-k">{label}</span>
      <span className="lc-health-row-v">{v}</span>
    </li>
  );
}
