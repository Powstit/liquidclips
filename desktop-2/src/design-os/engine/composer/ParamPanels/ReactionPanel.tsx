/**
 * ReactionPanel · Composer Phase 1b · F5 flowReaction
 *
 * Layout picker (7 real values from ReactionLayoutKey) +
 * Main volume · Reaction volume · Auto-switch speaker · Duck main audio.
 *
 * Cockpit hook: `setReaction` from `useCockpit()`. Volume + auto-switch +
 * duck fields are NOT part of CockpitSettings.reaction today — flagged
 * for Agent 3 to extend CockpitSettings.baseWindow.
 */

import { useEffect, useState, type ReactElement } from "react";
import { bus } from "../../../bridge";
import {
  useCockpit,
  type ReactionLayoutKey,
} from "../../cockpit/CockpitContext";
import "./ParamPanel.css";

export interface ParamPanelProps {
  visible: boolean;
  onPick: (fieldName: string, value: unknown) => void;
}

// Real cockpit enum · 7 values. `full-overlay` is Phase 1c-only, not written here.
const LAYOUTS: ReadonlyArray<{ value: ReactionLayoutKey; label: string }> = [
  { value: "pip-tr", label: "PIP · TR" },
  { value: "pip-tl", label: "PIP · TL" },
  { value: "pip-br", label: "PIP · BR" },
  { value: "pip-bl", label: "PIP · BL" },
  { value: "top-bottom", label: "Top / Bot" },
  { value: "side-by-side", label: "Side × Side" },
  { value: "solo", label: "Solo" },
];

export function ReactionPanel(props: ParamPanelProps): ReactElement {
  const { visible, onPick } = props;
  const { settings, setReaction } = useCockpit();
  // Local-only fields · flagged for Agent 3 extension
  const [mainVol, setMainVol] = useState(80);
  const [reactVol, setReactVol] = useState(90);
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [duck, setDuck] = useState(true);

  useEffect(() => {
    if (!visible) return;
    bus.emit("kade:speak", {
      title: "Reaction",
      body: "Pick the layout · I'll rebalance the audio.",
      severity: "info",
    });
  }, [visible]);

  const currentLayout = settings.reaction.layout;

  return (
    <div className="param-panel" data-visible={visible ? "true" : "false"}>
      <div className="param-panel-header">
        <span className="param-panel-eb">F5</span>
        <span className="param-panel-title">Reaction · Layout</span>
      </div>

      <div className="param-section">
        <div className="param-section-label">Layout</div>
        <div className="param-chip-row">
          {LAYOUTS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className="param-chip"
              data-picked={currentLayout === opt.value ? "true" : "false"}
              onClick={() => {
                setReaction({ layout: opt.value });
                onPick("layout", opt.value);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="param-section">
        <div className="param-section-label">Main volume</div>
        <div className="param-slider-row">
          <input
            className="param-slider"
            type="range"
            min={0}
            max={100}
            value={mainVol}
            onChange={(e) => {
              const v = Number(e.target.value);
              setMainVol(v);
              onPick("mainVolume", v);
            }}
            aria-label="Main volume"
          />
          <span className="param-slider-value">{mainVol}%</span>
        </div>
      </div>

      <div className="param-section">
        <div className="param-section-label">Reaction volume</div>
        <div className="param-slider-row">
          <input
            className="param-slider"
            type="range"
            min={0}
            max={100}
            value={reactVol}
            onChange={(e) => {
              const v = Number(e.target.value);
              setReactVol(v);
              onPick("reactionVolume", v);
            }}
            aria-label="Reaction volume"
          />
          <span className="param-slider-value">{reactVol}%</span>
        </div>
      </div>

      <div className="param-section">
        <div className="param-toggle-row">
          <span className="param-toggle-label">Auto-switch speaker</span>
          <button
            type="button"
            className="param-toggle"
            data-on={autoSwitch ? "true" : "false"}
            aria-pressed={autoSwitch}
            onClick={() => {
              const next = !autoSwitch;
              setAutoSwitch(next);
              onPick("autoSwitch", next);
            }}
          />
        </div>
        <div className="param-toggle-row">
          <span className="param-toggle-label">Duck main audio</span>
          <button
            type="button"
            className="param-toggle"
            data-on={duck ? "true" : "false"}
            aria-pressed={duck}
            onClick={() => {
              const next = !duck;
              setDuck(next);
              setReaction({ audioSource: next ? "muted" : "main" });
              onPick("duckMain", next);
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default ReactionPanel;
