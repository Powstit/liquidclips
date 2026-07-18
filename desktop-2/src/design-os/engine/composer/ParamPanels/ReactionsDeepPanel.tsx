/**
 * ReactionsDeepPanel · Composer Phase 1b · F5 flowReactionsDeep
 *
 * Timing-lock waveform + beat marker slider + snap-to-beat toggle.
 * Requires a slot to be selected — uses `useCockpit().focusedClip` gate
 * (IRON GATE IG-LC2-016). When no clip is focused, renders a small
 * "Select a clip first." card instead of firing writes.
 *
 * Cockpit hook: `setReaction` (brollOffsetS + syncPlayback). Beat marker
 * position writes to brollOffsetS. Snap-to-beat toggle writes to
 * syncPlayback (best-fit today · a proper `snapToBeat` field belongs on
 * CockpitSettings.reaction and is flagged for Agent 3).
 */

import { useEffect, useState, type ReactElement } from "react";
import { bus } from "../../../bridge";
import { useCockpit } from "../../cockpit/CockpitContext";
import "./ParamPanel.css";

export interface ParamPanelProps {
  visible: boolean;
  onPick: (fieldName: string, value: unknown) => void;
}

// 8 mock beat markers along the strip, in %
const BEAT_MARKS = [8, 20, 32, 44, 56, 68, 80, 92] as const;

export function ReactionsDeepPanel(props: ParamPanelProps): ReactElement {
  const { visible, onPick } = props;
  const cockpit = useCockpit();
  const focusedClip = cockpit.focusedClip;
  const [beat, setBeat] = useState<number>(50); // % across the waveform

  useEffect(() => {
    if (!visible) return;
    bus.emit("kade:speak", {
      title: "Timing lock",
      body: "Snap the reaction to the beat.",
      severity: "info",
    });
  }, [visible]);

  // IRON GATE IG-LC2-016 · block writes without a focused clip
  if (!focusedClip) {
    return (
      <div className="param-panel" data-visible={visible ? "true" : "false"}>
        <div className="param-panel-header">
          <span className="param-panel-eb">F5</span>
          <span className="param-panel-title">Reactions · Timing</span>
        </div>
        <div className="param-gate">Select a clip first.</div>
      </div>
    );
  }

  const snap = cockpit.settings.reaction.syncPlayback;

  return (
    <div className="param-panel" data-visible={visible ? "true" : "false"}>
      <div className="param-panel-header">
        <span className="param-panel-eb">F5</span>
        <span className="param-panel-title">Reactions · Timing</span>
      </div>

      <div className="param-section">
        <div className="param-section-label">Waveform</div>
        <div className="param-waveform" aria-hidden="true">
          {BEAT_MARKS.map((pct) => (
            <span
              key={pct}
              className="param-beat-marker"
              style={{ left: `${pct}%`, opacity: 0.5 }}
            />
          ))}
          <span
            className="param-beat-marker"
            style={{ left: `${beat}%`, opacity: 1 }}
          />
        </div>
      </div>

      <div className="param-section">
        <div className="param-section-label">Beat marker</div>
        <div className="param-slider-row">
          <input
            className="param-slider"
            type="range"
            min={0}
            max={100}
            value={beat}
            onChange={(e) => {
              const v = Number(e.target.value);
              setBeat(v);
              // Rough map · % across a 15s window → seconds offset
              const offsetS = (v / 100) * 15;
              cockpit.setReaction({ brollOffsetS: offsetS });
              onPick("beatOffsetS", offsetS);
            }}
            aria-label="Beat marker"
          />
          <span className="param-slider-value">{beat}%</span>
        </div>
      </div>

      <div className="param-section">
        <div className="param-toggle-row">
          <span className="param-toggle-label">Snap to beat</span>
          <button
            type="button"
            className="param-toggle"
            data-on={snap ? "true" : "false"}
            aria-pressed={snap}
            onClick={() => {
              const next = !snap;
              cockpit.setReaction({ syncPlayback: next });
              onPick("snapToBeat", next);
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default ReactionsDeepPanel;
