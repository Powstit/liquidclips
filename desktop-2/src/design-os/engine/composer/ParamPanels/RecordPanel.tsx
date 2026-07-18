/**
 * RecordPanel · Composer Phase 1b · F8 flowRecord
 *
 * 6-tile source picker (Tutorial · Display · Window · Screen+mic ·
 * Screen+audio · Camera). Tutorial tile is wide + carries an Earn badge.
 * On mount cycles through tiles then lands on the resolved source.
 *
 * Cockpit hook: none (record is a pre-flight modal · lives outside
 * CockpitSettings). onPick surfaces the resolved source to Composer;
 * Agent 3 wires it to the actual sidecar RPC in Phase 1c.
 */

import { useEffect, useRef, useState, type ReactElement } from "react";
import { bus } from "../../../bridge";
import "./ParamPanel.css";

export interface ParamPanelProps {
  visible: boolean;
  onPick: (fieldName: string, value: unknown) => void;
}

type SourceValue =
  | "tutorial"
  | "display"
  | "window"
  | "screen-mic"
  | "screen-audio"
  | "camera";

interface SourceTile {
  value: SourceValue;
  label: string;
  earn?: boolean;
  wide?: boolean;
}

const SOURCES: ReadonlyArray<SourceTile> = [
  { value: "tutorial", label: "Tutorial · demo Kade", earn: true, wide: true },
  { value: "display", label: "Full screen" },
  { value: "window", label: "Just window" },
  { value: "screen-mic", label: "Screen + mic" },
  { value: "screen-audio", label: "Screen + audio" },
  { value: "camera", label: "Camera only" },
];

export function RecordPanel(props: ParamPanelProps): ReactElement {
  const { visible, onPick } = props;
  const [cycleIdx, setCycleIdx] = useState<number>(0);
  const [resolved, setResolved] = useState<SourceValue | null>(null);
  const cycleTimer = useRef<number | null>(null);

  // Cycle through tiles on mount · lands on "tutorial" after ~1.2s
  useEffect(() => {
    if (!visible) {
      if (cycleTimer.current) window.clearInterval(cycleTimer.current);
      setCycleIdx(0);
      setResolved(null);
      return;
    }
    let step = 0;
    cycleTimer.current = window.setInterval(() => {
      step += 1;
      setCycleIdx((prev) => (prev + 1) % SOURCES.length);
      if (step >= 6) {
        if (cycleTimer.current) window.clearInterval(cycleTimer.current);
        cycleTimer.current = null;
        setResolved("tutorial");
        setCycleIdx(0);
      }
    }, 160);
    return () => {
      if (cycleTimer.current) window.clearInterval(cycleTimer.current);
      cycleTimer.current = null;
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    bus.emit("kade:speak", {
      title: "Record",
      body: "Tutorial pays double · pick your surface.",
      severity: "info",
    });
  }, [visible]);

  return (
    <div className="param-panel" data-visible={visible ? "true" : "false"}>
      <div className="param-panel-header">
        <span className="param-panel-eb">F8</span>
        <span className="param-panel-title">Record · Source</span>
      </div>

      <div className="param-section">
        <div className="param-section-label">Pick source</div>
        <div className="param-grid">
          {SOURCES.map((s, i) => {
            const picked = resolved === s.value || (resolved == null && cycleIdx === i);
            return (
              <button
                key={s.value}
                type="button"
                className={s.wide ? "param-tile param-tile-wide" : "param-tile"}
                data-picked={picked ? "true" : "false"}
                onClick={() => {
                  setResolved(s.value);
                  onPick("source", s.value);
                }}
              >
                {s.label}
                {s.earn ? (
                  <span className="param-tile-badge">EARN</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default RecordPanel;
