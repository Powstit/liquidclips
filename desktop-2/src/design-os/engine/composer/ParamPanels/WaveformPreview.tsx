/**
 * WaveformPreview · Composer F2 · wavesurfer.js audio track preview.
 *
 * ⚠ IRON GATE IG-COMPOSER-HH · Waveform preview contract.
 *
 * Verified via WebSearch (2026-07-18) — wavesurfer.js current is
 * 7.12.11 · @wavesurfer/react 1.0.12 is the maintained React wrapper.
 * Both pnpm-added in this commit.
 *
 * The `url` prop points at the currently-selected music track (or
 * null when the user hasn't picked one yet). The waveform renders
 * inside the AudioPanel · height matches the panel's slider row.
 */

import { useMemo, useRef, useState, type ReactElement } from "react";
import WavesurferPlayer from "@wavesurfer/react";
import type WaveSurfer from "wavesurfer.js";

export interface WaveformPreviewProps {
  url: string | null;
  height?: number;
}

export function WaveformPreview(props: WaveformPreviewProps): ReactElement | null {
  const { url, height = 40 } = props;
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // Plugins must be memoised per @wavesurfer/react docs · wavesurfer.js
  // mutates plugin instances during init. We ship without plugins for
  // the minimum contract; adding a Regions/Timeline plugin is
  // additive.
  const plugins = useMemo(() => [], []);

  if (!url) return null;

  return (
    <div
      className="param-waveform"
      data-testid="composer-waveform-preview"
      style={{
        width: "100%",
        background: "rgba(255,255,255,0.03)",
        borderRadius: 8,
        padding: "6px 8px",
      }}
    >
      <WavesurferPlayer
        height={height}
        waveColor="#a49fb0"
        progressColor="#ff1a8c"
        cursorColor="rgba(255,26,140,0.7)"
        url={url}
        plugins={plugins}
        onReady={(ws) => {
          wavesurferRef.current = ws;
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />
      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        <button
          type="button"
          className="param-chip"
          data-testid="composer-waveform-play"
          onClick={() => wavesurferRef.current?.playPause()}
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
      </div>
    </div>
  );
}

export default WaveformPreview;
