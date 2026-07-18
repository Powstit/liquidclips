/**
 * TrimPanel · Composer Phase 1b · F2 flowTrim
 *
 * Start/End time inputs (mm:ss.mmm) + Duration display + Playback speed +
 * Remove silence toggle + Auto-tighten toggle.
 *
 * Cockpit hook: `setTrim` from `useCockpit()`. Playback speed, remove-silence
 * and auto-tighten are NOT part of CockpitSettings.trim today — flagged for
 * Agent 3 to extend CockpitSettings.baseWindow.
 */

/* ═════════════════════════════════════════════════════════════════════
   IRON GATE IG-COMPOSER-H · Trim reuse contract · LOCKED 2026-07-18
   ─────────────────────────────────────────────────────────────────────
   TrimPanel writes `inS` / `outS` via `setTrim` from `useCockpit()` ·
   shares CockpitSettings.trim with Workstation's TrimModule · same
   ffmpeg trim in the export pipeline. Regression test
   `Composer.trimpanel.test.ts` + lint invariants #51–54 enforce.
   ═════════════════════════════════════════════════════════════════════ */

import { useEffect, useState, type ReactElement } from "react";
import { bus } from "../../../bridge";
import { useCockpit } from "../../cockpit/CockpitContext";
import "./ParamPanel.css";

export interface ParamPanelProps {
  visible: boolean;
  onPick: (fieldName: string, value: unknown) => void;
}

function formatMSSms(totalS: number): string {
  const t = Math.max(0, totalS);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t - Math.floor(t)) * 1000);
  const mm = m.toString().padStart(2, "0");
  const ss = s.toString().padStart(2, "0");
  const mmm = ms.toString().padStart(3, "0");
  return `${mm}:${ss}.${mmm}`;
}

function parseMSSms(txt: string): number | null {
  // Accepts "mm:ss.mmm" · returns seconds or null
  const m = /^(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(txt.trim());
  if (!m) return null;
  const mins = Number(m[1]);
  const secs = Number(m[2]);
  const ms = m[3] ? Number(m[3].padEnd(3, "0")) : 0;
  return mins * 60 + secs + ms / 1000;
}

export function TrimPanel(props: ParamPanelProps): ReactElement {
  const { visible, onPick } = props;
  const { settings, setTrim, setBaseWindow } = useCockpit();
  // B2 · Playback speed · seeded from baseWindow and written back via
  // setBaseWindow so the sidecar's export atempo filter picks it up.
  const [speed, setSpeed] = useState<number>(settings.baseWindow?.speed ?? 1.0);
  // B1 · removeSilence gate mirrors the sidecar's JUNIOR_SILENCE_REMOVE
  // env flag (IG-COMPOSER-DD) but persisted per-clip for UI recall.
  const [removeSilence, setRemoveSilence] = useState<boolean>(
    settings.baseWindow?.removeSilence ?? false,
  );
  const [autoTighten, setAutoTighten] = useState<boolean>(
    settings.baseWindow?.autoTighten ?? true,
  );

  const [inTxt, setInTxt] = useState<string>(formatMSSms(settings.trim.inS));
  const [outTxt, setOutTxt] = useState<string>(formatMSSms(settings.trim.outS));

  useEffect(() => {
    setInTxt(formatMSSms(settings.trim.inS));
    setOutTxt(formatMSSms(settings.trim.outS));
  }, [settings.trim.inS, settings.trim.outS]);

  useEffect(() => {
    if (!visible) return;
    bus.emit("kade:speak", {
      title: "Trim",
      body: "Set in / out · I'll tighten the rest.",
      severity: "info",
    });
  }, [visible]);

  const duration = Math.max(0, settings.trim.outS - settings.trim.inS);

  const commit = (which: "in" | "out", raw: string): void => {
    const seconds = parseMSSms(raw);
    if (seconds == null) return;
    if (which === "in") {
      setTrim({ inS: seconds });
      onPick("inS", seconds);
    } else {
      setTrim({ outS: seconds });
      onPick("outS", seconds);
    }
  };

  return (
    <div className="param-panel" data-visible={visible ? "true" : "false"}>
      <div className="param-panel-header">
        <span className="param-panel-eb">F2</span>
        <span className="param-panel-title">Trim · Timing</span>
      </div>

      <div className="param-section">
        <div className="param-section-label">Start</div>
        <input
          className="param-input"
          type="text"
          value={inTxt}
          onChange={(e) => setInTxt(e.target.value)}
          onBlur={() => commit("in", inTxt)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit("in", inTxt);
          }}
          aria-label="Trim start"
          spellCheck={false}
        />
      </div>

      <div className="param-section">
        <div className="param-section-label">End</div>
        <input
          className="param-input"
          type="text"
          value={outTxt}
          onChange={(e) => setOutTxt(e.target.value)}
          onBlur={() => commit("out", outTxt)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit("out", outTxt);
          }}
          aria-label="Trim end"
          spellCheck={false}
        />
      </div>

      <div className="param-section">
        <div className="param-section-label">Duration</div>
        <div className="param-input" aria-live="polite">
          {formatMSSms(duration)}
        </div>
      </div>

      <div className="param-section">
        <div className="param-section-label">Playback speed</div>
        <div className="param-slider-row">
          <input
            className="param-slider"
            type="range"
            min={0.5}
            max={2.0}
            step={0.05}
            value={speed}
            onChange={(e) => {
              const v = Number(e.target.value);
              setSpeed(v);
              setBaseWindow({ speed: v });
              onPick("speed", v);
            }}
            aria-label="Playback speed"
          />
          <span className="param-slider-value">{speed.toFixed(2)}x</span>
        </div>
      </div>

      <div className="param-section">
        <div className="param-toggle-row">
          <span className="param-toggle-label">Remove silence</span>
          <button
            type="button"
            className="param-toggle"
            data-on={removeSilence ? "true" : "false"}
            aria-pressed={removeSilence}
            onClick={() => {
              const next = !removeSilence;
              setRemoveSilence(next);
              setBaseWindow({ removeSilence: next });
              onPick("removeSilence", next);
            }}
          />
        </div>
        <div className="param-toggle-row">
          <span className="param-toggle-label">Auto-tighten</span>
          <button
            type="button"
            className="param-toggle"
            data-on={autoTighten ? "true" : "false"}
            aria-pressed={autoTighten}
            onClick={() => {
              const next = !autoTighten;
              setAutoTighten(next);
              setBaseWindow({ autoTighten: next });
              onPick("autoTighten", next);
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default TrimPanel;
