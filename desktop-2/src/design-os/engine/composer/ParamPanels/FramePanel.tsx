/**
 * FramePanel · Composer Phase 1b · F9 flowFrame
 *
 * Safe-zone multi-select (TikTok/Reels/Shorts) + Zoom slider (1x-3x) +
 * Hook text input + Emphasis word input + Duration slider (1s-5s) +
 * 5 gradient template thumbs.
 *
 * Cockpit hook: `setStyle` from `useCockpit()` (writes accent preset).
 * All frame fields (safe zones, zoom, hook, emphasis, duration, gradient
 * template) are NOT part of CockpitSettings today — flagged for Agent 3.
 */

import { useEffect, useState, type ReactElement } from "react";
import { bus } from "../../../bridge";
import { useCockpit } from "../../cockpit/CockpitContext";
import "./ParamPanel.css";

export interface ParamPanelProps {
  visible: boolean;
  onPick: (fieldName: string, value: unknown) => void;
}

const SAFE_ZONES = ["tiktok", "reels", "shorts"] as const;
type SafeZone = (typeof SAFE_ZONES)[number];

const GRAD_INDEXES = [0, 1, 2, 3, 4] as const;

export function FramePanel(props: ParamPanelProps): ReactElement {
  const { visible, onPick } = props;
  // B7 · hook overlay reuses the sidecar's existing hook_burnin path in
  // stages.py (line 1951 hook_text · line 2225 _extract_hook_text · line
  // 2238 _write_hook_textfile). This panel writes hookText / emphasis /
  // hookDuration / template to CockpitSettings.baseWindow so the export
  // stage picks it up.
  const { settings, setBaseWindow } = useCockpit();
  const bw = settings.baseWindow ?? {};
  const [safe, setSafe] = useState<Record<SafeZone, boolean>>(() => {
    const seeded = bw.safeZones ?? ["tiktok", "reels"];
    return {
      tiktok: seeded.includes("tiktok"),
      reels: seeded.includes("reels"),
      shorts: seeded.includes("shorts"),
    };
  });
  const [zoom, setZoom] = useState<number>(bw.zoom ?? 1.4);
  const [hook, setHook] = useState<string>(bw.hookText ?? "");
  const [emphasis, setEmphasis] = useState<string>(bw.emphasisWord ?? "");
  const [duration, setDuration] = useState<number>(bw.hookDuration ?? 2.5);
  const [gradPick, setGradPick] = useState<number>(bw.template ?? 0);

  useEffect(() => {
    if (!visible) return;
    bus.emit("kade:speak", {
      title: "Frame",
      body: "Pick safe-zones · write the hook.",
      severity: "info",
    });
  }, [visible]);

  const toggleZone = (z: SafeZone): void => {
    const next = { ...safe, [z]: !safe[z] };
    setSafe(next);
    const active = SAFE_ZONES.filter((k) => next[k]);
    setBaseWindow({ safeZones: [...active] });
    onPick("safeZones", active);
  };

  return (
    <div className="param-panel" data-visible={visible ? "true" : "false"}>
      <div className="param-panel-header">
        <span className="param-panel-eb">F9</span>
        <span className="param-panel-title">Frame · Hook</span>
      </div>

      <div className="param-section">
        <div className="param-section-label">Safe zones</div>
        <div className="param-chip-row">
          {SAFE_ZONES.map((z) => (
            <button
              key={z}
              type="button"
              className="param-chip"
              data-picked={safe[z] ? "true" : "false"}
              onClick={() => toggleZone(z)}
            >
              {z}
            </button>
          ))}
        </div>
      </div>

      <div className="param-section">
        <div className="param-section-label">Zoom</div>
        <div className="param-slider-row">
          <input
            className="param-slider"
            type="range"
            min={1.0}
            max={3.0}
            step={0.05}
            value={zoom}
            onChange={(e) => {
              const v = Number(e.target.value);
              setZoom(v);
              setBaseWindow({ zoom: v });
              onPick("zoom", v);
            }}
            aria-label="Zoom"
          />
          <span className="param-slider-value">{zoom.toFixed(2)}x</span>
        </div>
      </div>

      <div className="param-section">
        <div className="param-section-label">Hook text</div>
        <input
          className="param-input"
          type="text"
          value={hook}
          onChange={(e) => setHook(e.target.value)}
          onBlur={() => {
            setBaseWindow({ hookText: hook });
            onPick("hookText", hook);
          }}
          placeholder="Watch this to the end"
          aria-label="Hook text"
        />
      </div>

      <div className="param-section">
        <div className="param-section-label">Emphasis word</div>
        <input
          className="param-input"
          type="text"
          value={emphasis}
          onChange={(e) => setEmphasis(e.target.value)}
          onBlur={() => {
            setBaseWindow({ emphasisWord: emphasis });
            onPick("emphasisWord", emphasis);
          }}
          placeholder="end"
          aria-label="Emphasis word"
        />
      </div>

      <div className="param-section">
        <div className="param-section-label">Duration</div>
        <div className="param-slider-row">
          <input
            className="param-slider"
            type="range"
            min={1.0}
            max={5.0}
            step={0.1}
            value={duration}
            onChange={(e) => {
              const v = Number(e.target.value);
              setDuration(v);
              setBaseWindow({ hookDuration: v });
              onPick("hookDuration", v);
            }}
            aria-label="Hook duration"
          />
          <span className="param-slider-value">{duration.toFixed(1)}s</span>
        </div>
      </div>

      <div className="param-section">
        <div className="param-section-label">Templates</div>
        <div className="param-grad-row">
          {GRAD_INDEXES.map((i) => {
            const gradients = [
              "linear-gradient(135deg, var(--fuchsia), var(--fuchsia-deep))",
              "linear-gradient(135deg, var(--fuchsia-soft), var(--fuchsia))",
              "linear-gradient(135deg, var(--fuchsia), var(--ink))",
              "linear-gradient(135deg, var(--fuchsia), var(--money-green))",
              "linear-gradient(135deg, var(--money-soft), var(--fuchsia))",
            ];
            return (
              <button
                key={i}
                type="button"
                className="param-grad-thumb"
                data-picked={gradPick === i ? "true" : "false"}
                style={{ background: gradients[i] }}
                onClick={() => {
                  setGradPick(i);
                  setBaseWindow({ template: i as 0 | 1 | 2 | 3 | 4 });
                  onPick("template", i);
                }}
                aria-label={`Template ${i + 1}`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default FramePanel;
