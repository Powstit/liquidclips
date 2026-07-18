/**
 * CaptionsPanel · Composer Phase 1b · F3 flowCaptions
 *
 * Style picker (4 real values) + position chips + words-per-line +
 * karaoke toggle + font dropdown + size slider.
 *
 * Cockpit hook: `setCaption` from `useCockpit()`. Words-per-line, karaoke,
 * font, and size are NOT part of CockpitSettings.caption today — flagged
 * for Agent 3 to extend CockpitSettings.baseWindow.
 */

import { useEffect, useState, type ReactElement } from "react";
import { bus } from "../../../bridge";
import {
  useCockpit,
  type CaptionStyleKey,
  type CaptionPositionKey,
} from "../../cockpit/CockpitContext";
import "./ParamPanel.css";

export interface ParamPanelProps {
  visible: boolean;
  onPick: (fieldName: string, value: unknown) => void;
}

const STYLES: ReadonlyArray<{ value: CaptionStyleKey; label: string }> = [
  { value: "fuchsia-pop", label: "Bold" },
  { value: "cyan-bold", label: "Pop" },
  { value: "amber-soft", label: "Subtle" },
  { value: "mono-clean", label: "Clean" },
];

const POSITIONS: ReadonlyArray<{ value: CaptionPositionKey; label: string }> = [
  { value: "top", label: "Top" },
  { value: "mid", label: "Mid" },
  { value: "bottom", label: "Bot" },
];

const WORDS_PER_LINE = [3, 4, 5] as const;

export function CaptionsPanel(props: ParamPanelProps): ReactElement {
  const { visible, onPick } = props;
  const { settings, setCaption } = useCockpit();
  const [wpl, setWpl] = useState<3 | 4 | 5>(4);
  const [karaoke, setKaraoke] = useState(true);
  const [fontSize, setFontSize] = useState(38);

  useEffect(() => {
    if (!visible) return;
    bus.emit("kade:speak", {
      title: "Captions",
      body: "Pick a style · then the position.",
      severity: "info",
    });
  }, [visible]);

  return (
    <div className="param-panel" data-visible={visible ? "true" : "false"}>
      <div className="param-panel-header">
        <span className="param-panel-eb">F3</span>
        <span className="param-panel-title">Captions · Style</span>
      </div>

      <div className="param-section">
        <div className="param-section-label">Style</div>
        <div className="param-chip-row">
          {STYLES.map((s) => (
            <button
              key={s.value}
              type="button"
              className="param-chip"
              data-picked={settings.caption.style === s.value ? "true" : "false"}
              onClick={() => {
                setCaption({ style: s.value });
                onPick("style", s.value);
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="param-section">
        <div className="param-section-label">Position</div>
        <div className="param-chip-row">
          {POSITIONS.map((p) => (
            <button
              key={p.value}
              type="button"
              className="param-chip"
              data-picked={
                settings.caption.position === p.value ? "true" : "false"
              }
              onClick={() => {
                setCaption({ position: p.value });
                onPick("position", p.value);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="param-section">
        <div className="param-section-label">Words / line</div>
        <div className="param-chip-row">
          {WORDS_PER_LINE.map((n) => (
            <button
              key={n}
              type="button"
              className="param-chip"
              data-picked={wpl === n ? "true" : "false"}
              onClick={() => {
                setWpl(n);
                onPick("wordsPerLine", n);
              }}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="param-section">
        <div className="param-toggle-row">
          <span className="param-toggle-label">Karaoke highlight</span>
          <button
            type="button"
            className="param-toggle"
            data-on={karaoke ? "true" : "false"}
            aria-pressed={karaoke}
            onClick={() => {
              const next = !karaoke;
              setKaraoke(next);
              onPick("karaoke", next);
            }}
          />
        </div>
      </div>

      <div className="param-section">
        <div className="param-section-label">Font</div>
        <select
          className="param-input"
          value="inter-display"
          onChange={(e) => onPick("font", e.target.value)}
          aria-label="Caption font"
        >
          <option value="inter-display">Inter Display</option>
        </select>
      </div>

      <div className="param-section">
        <div className="param-section-label">Size</div>
        <div className="param-slider-row">
          <input
            className="param-slider"
            type="range"
            min={10}
            max={80}
            value={fontSize}
            onChange={(e) => {
              const v = Number(e.target.value);
              setFontSize(v);
              onPick("size", v);
            }}
            aria-label="Caption size"
          />
          <span className="param-slider-value">{fontSize}px</span>
        </div>
      </div>
    </div>
  );
}

export default CaptionsPanel;
