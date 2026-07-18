/**
 * TimelinePanel · Composer Phase 1b · F11 flowTimeline
 *
 * 5-track stack (Video · Reaction · Caption · Hook · Audio) + zoom chip row
 * (1x/2x/4x) + ruler (0s · 5s · 10s · 15s).
 *
 * Cockpit hook: read-only preview · no writes today. Zoom level is NOT part
 * of CockpitSettings — flagged for Agent 3 to extend
 * CockpitSettings.baseWindow if timeline zoom needs persistence.
 */

import { useEffect, useState, type ReactElement } from "react";
import { bus } from "../../../bridge";
import { useCockpit } from "../../cockpit/CockpitContext";
import "./ParamPanel.css";

export interface ParamPanelProps {
  visible: boolean;
  onPick: (fieldName: string, value: unknown) => void;
}

const TRACKS = [
  { key: "video", label: "Video", detail: "clip · 15.4s" },
  { key: "reaction", label: "Reaction", detail: "PIP · TR" },
  { key: "caption", label: "Caption", detail: "bold · bot" },
  { key: "hook", label: "Hook", detail: "0.0 → 2.5s" },
  { key: "audio", label: "Audio", detail: "main · music" },
] as const;

const ZOOMS = [1, 2, 4] as const;

export function TimelinePanel(props: ParamPanelProps): ReactElement {
  const { visible, onPick } = props;
  useCockpit(); // preserve provider gate (IG-LC2-018)
  const [zoom, setZoom] = useState<1 | 2 | 4>(1);

  useEffect(() => {
    if (!visible) return;
    bus.emit("kade:speak", {
      title: "Timeline",
      body: "Zoom in · every track lives here.",
      severity: "info",
    });
  }, [visible]);

  return (
    <div className="param-panel" data-visible={visible ? "true" : "false"}>
      <div className="param-panel-header">
        <span className="param-panel-eb">F11</span>
        <span className="param-panel-title">Timeline</span>
      </div>

      <div className="param-section">
        <div className="param-section-label">Zoom</div>
        <div className="param-chip-row">
          {ZOOMS.map((z) => (
            <button
              key={z}
              type="button"
              className="param-chip"
              data-picked={zoom === z ? "true" : "false"}
              onClick={() => {
                setZoom(z);
                onPick("zoom", z);
              }}
            >
              {z}×
            </button>
          ))}
        </div>
      </div>

      <div className="param-section">
        <div className="param-section-label">Tracks</div>
        <div>
          {TRACKS.map((t) => (
            <div className="param-track" key={t.key}>
              <b>{t.label}</b>
              <span>{t.detail}</span>
            </div>
          ))}
        </div>
        <div className="param-tl-ruler" aria-hidden="true">
          <span>0s</span>
          <span>5s</span>
          <span>10s</span>
          <span>15s</span>
        </div>
      </div>
    </div>
  );
}

export default TimelinePanel;
