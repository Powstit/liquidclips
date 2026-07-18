/**
 * AudioPanel · Composer Phase 1b · F10 flowAudio
 *
 * Main volume + Music volume + 3 track picker chips + Duck toggle.
 *
 * Cockpit hook: `setReaction` (audioSource) from `useCockpit()`. Music
 * volume and track selection are NOT part of CockpitSettings today —
 * flagged for Agent 3 to extend CockpitSettings.baseWindow.
 */

import { useEffect, useState, type ReactElement } from "react";
import { bus } from "../../../bridge";
import { useCockpit } from "../../cockpit/CockpitContext";
import { WaveformPreview } from "./WaveformPreview";
import "./ParamPanel.css";

export interface ParamPanelProps {
  visible: boolean;
  onPick: (fieldName: string, value: unknown) => void;
}

const TRACKS = [
  { id: "upbeat-lofi-01", label: "Upbeat Lofi 01", url: "/brand/audio/upbeat-lofi-01.mp3" },
  { id: "ambient-focus", label: "Ambient Focus", url: "/brand/audio/ambient-focus.mp3" },
  { id: "trap-chill", label: "Trap Chill", url: "/brand/audio/trap-chill.mp3" },
] as const;

export function AudioPanel(props: ParamPanelProps): ReactElement {
  const { visible, onPick } = props;
  // B6 · Audio mixing UI wires through CockpitSettings.baseWindow so the
  // export pipeline receives audioMainVolume + audioMusicVolume +
  // audioTrack. Sidecar `amix` filter graph will consume in a follow-up
  // export edit · the fields already exist on ComposerBaseWindow.
  const { settings, setReaction, setBaseWindow } = useCockpit();
  const bw = settings.baseWindow ?? {};
  const [mainVol, setMainVol] = useState<number>(bw.audioMainVolume ?? 85);
  const [musicVol, setMusicVol] = useState<number>(bw.audioMusicVolume ?? 45);
  const [track, setTrack] = useState<string>(bw.audioTrack ?? TRACKS[0].id);
  const duck = settings.reaction.audioSource === "muted";
  const activeTrack = TRACKS.find((t) => t.id === track) ?? null;

  useEffect(() => {
    if (!visible) return;
    bus.emit("kade:speak", {
      title: "Audio",
      body: "Set the mix · pick a track.",
      severity: "info",
    });
  }, [visible]);

  return (
    <div className="param-panel" data-visible={visible ? "true" : "false"}>
      <div className="param-panel-header">
        <span className="param-panel-eb">F10</span>
        <span className="param-panel-title">Audio · Mix</span>
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
              setBaseWindow({ audioMainVolume: v });
              onPick("mainVolume", v);
            }}
            aria-label="Main volume"
          />
          <span className="param-slider-value">{mainVol}%</span>
        </div>
      </div>

      <div className="param-section">
        <div className="param-section-label">Music volume</div>
        <div className="param-slider-row">
          <input
            className="param-slider"
            type="range"
            min={0}
            max={100}
            value={musicVol}
            onChange={(e) => {
              const v = Number(e.target.value);
              setMusicVol(v);
              setBaseWindow({ audioMusicVolume: v });
              onPick("musicVolume", v);
            }}
            aria-label="Music volume"
          />
          <span className="param-slider-value">{musicVol}%</span>
        </div>
      </div>

      <div className="param-section">
        <div className="param-section-label">Track</div>
        <div className="param-chip-row">
          {TRACKS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="param-chip"
              data-picked={track === t.id ? "true" : "false"}
              onClick={() => {
                setTrack(t.id);
                setBaseWindow({ audioTrack: t.id });
                onPick("track", t.id);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {/* F2 · Waveform preview · IG-COMPOSER-HH */}
        <WaveformPreview url={activeTrack?.url ?? null} />
      </div>

      <div className="param-section">
        <div className="param-toggle-row">
          <span className="param-toggle-label">Duck main under music</span>
          <button
            type="button"
            className="param-toggle"
            data-on={duck ? "true" : "false"}
            aria-pressed={duck}
            onClick={() => {
              const nextMuted = !duck;
              setReaction({ audioSource: nextMuted ? "muted" : "main" });
              onPick("duckMain", nextMuted);
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default AudioPanel;
