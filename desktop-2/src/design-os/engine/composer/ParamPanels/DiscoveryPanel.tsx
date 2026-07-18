/**
 * DiscoveryPanel · Composer Phase 1b · F1 flowDiscovery
 *
 * Transcript strip (12 word chips) + hook indicator + clip stack.
 *
 * Cockpit hook: none (discovery reads transcripts / clip candidates from
 * the sidecar in Phase 1c). onPick surfaces the picked hook word or clip
 * to Composer.
 */

import { useEffect, useState, type ReactElement } from "react";
import { bus } from "../../../bridge";
import "./ParamPanel.css";

export interface ParamPanelProps {
  visible: boolean;
  onPick: (fieldName: string, value: unknown) => void;
}

const TRANSCRIPT = [
  "watch",
  "this",
  "to",
  "the",
  "end",
  "because",
  "everything",
  "here",
  "makes",
  "you",
  "money",
  "fast",
] as const;

const HOOK_IDX = 4; // "end" — highlighted

const CLIPS = [
  { id: "d-01", label: "Clip 01 · 12s", score: 92 },
  { id: "d-02", label: "Clip 02 · 15s", score: 88 },
  { id: "d-03", label: "Clip 03 · 09s", score: 85 },
] as const;

export function DiscoveryPanel(props: ParamPanelProps): ReactElement {
  const { visible, onPick } = props;
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    bus.emit("kade:speak", {
      title: "Discovery",
      body: "3 clips · hook highlighted.",
      severity: "info",
    });
  }, [visible]);

  return (
    <div className="param-panel" data-visible={visible ? "true" : "false"}>
      <div className="param-panel-header">
        <span className="param-panel-eb">F1</span>
        <span className="param-panel-title">Discovery</span>
      </div>

      <div className="param-section">
        <div className="param-section-label">Transcript</div>
        <div className="param-word-strip">
          {TRANSCRIPT.map((w, i) => (
            <span
              key={`${w}-${i}`}
              className="param-word"
              data-hook={i === HOOK_IDX ? "true" : "false"}
            >
              {w}
            </span>
          ))}
        </div>
      </div>

      <div className="param-section">
        <div className="param-section-label">Clip stack</div>
        <div>
          {CLIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              className="param-tile"
              data-picked={picked === c.id ? "true" : "false"}
              style={{
                display: "flex",
                justifyContent: "space-between",
                width: "100%",
                marginBottom: 4,
              }}
              onClick={() => {
                setPicked(c.id);
                onPick("clipId", c.id);
              }}
            >
              <span>{c.label}</span>
              <span style={{ color: "var(--money-green)" }}>{c.score}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default DiscoveryPanel;
