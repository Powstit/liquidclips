/**
 * StudioTimelineRail · Phase 6D
 *
 * Trim handles + playhead + caption markers + duration display. Ported
 * shape from the legacy ClipPreview trim editor (start/end seconds inputs
 * + Re-cut button) and the per-word burn timeline used by CaptionDrawer.
 *
 * No real export logic. Drag handles update local state only; "Apply trim"
 * fires a stub toast — real re-cut requires sidecar runtime (legacy
 * `startRegenerateClip` RPC).
 *
 * Validation guard: matches legacy 30s..75s clip-length cap.
 */

import { useEffect, useRef, useState } from "react";
import { GlassCard } from "../components";
import { bus } from "../bridge";
import type { Clip } from "../engine/types";
import "./StudioTimelineRail.css";

const MIN_CLIP_S = 30;
const MAX_CLIP_S = 75;

export interface StudioTimelineRailProps {
  clip: Clip | null;
  /** Optional caption markers (start seconds within the clip). */
  captionMarkers?: number[];
}

export function StudioTimelineRail({ clip, captionMarkers = [] }: StudioTimelineRailProps) {
  // Local trim state in clip-seconds (0..duration)
  const initialStart = 0;
  const initialEnd = clip ? Math.max(MIN_CLIP_S, Math.min((clip.end - clip.start), MAX_CLIP_S)) : MIN_CLIP_S;
  const [trimStart, setTrimStart] = useState(initialStart);
  const [trimEnd, setTrimEnd] = useState(initialEnd);
  const [playhead, setPlayhead] = useState(0);
  const railRef = useRef<HTMLDivElement | null>(null);

  // Reset when clip changes
  useEffect(() => {
    if (!clip) return;
    setTrimStart(0);
    setTrimEnd(Math.max(MIN_CLIP_S, Math.min(clip.end - clip.start, MAX_CLIP_S)));
    setPlayhead(0);
  }, [clip]);

  if (!clip) {
    return (
      <GlassCard density="quiet" className="lc-stl">
        <span className="lc-stl-eb">Timeline</span>
        <p className="lc-stl-empty">Pick a clip in Engine to open the trim rail.</p>
      </GlassCard>
    );
  }

  const totalDuration = Math.max(0, clip.end - clip.start);
  const trimDuration = Math.max(0, trimEnd - trimStart);
  const tooShort = trimDuration < MIN_CLIP_S;
  const tooLong  = trimDuration > MAX_CLIP_S;
  const invalid = tooShort || tooLong;

  const onRailClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rail = railRef.current;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setPlayhead(ratio * totalDuration);
  };

  const onApplyTrim = () => {
    if (invalid) return;
    bus.emit("toast", {
      kind: "info",
      title: "Trim",
      body: `Trim preview only · re-cut lands with sidecar runtime (${trimStart.toFixed(1)}s → ${trimEnd.toFixed(1)}s).`,
    });
  };

  const pct = (s: number) => Math.max(0, Math.min(100, (s / totalDuration) * 100));

  return (
    <GlassCard density="default" className="lc-stl">
      <header className="lc-stl-head">
        <span className="lc-stl-eb">Timeline · clip #{clip.idx}</span>
        <span className="lc-stl-dur">
          {fmt(trimStart)} – {fmt(trimEnd)} · <strong>{fmt(trimDuration)}</strong> of {fmt(totalDuration)}
        </span>
      </header>

      <div
        ref={railRef}
        className={`lc-stl-rail ${invalid ? "is-invalid" : ""}`}
        onClick={onRailClick}
        role="presentation"
      >
        {/* Trimmed-out left + right segments */}
        <span className="lc-stl-out lc-stl-out-l" style={{ width: `${pct(trimStart)}%` }} />
        <span className="lc-stl-out lc-stl-out-r" style={{ left: `${pct(trimEnd)}%`, width: `${100 - pct(trimEnd)}%` }} />

        {/* Active selection */}
        <span
          className="lc-stl-selection"
          style={{ left: `${pct(trimStart)}%`, width: `${pct(trimEnd) - pct(trimStart)}%` }}
        />

        {/* Caption markers */}
        {captionMarkers.map((m, i) => (
          <span
            key={i}
            className="lc-stl-marker"
            style={{ left: `${pct(m)}%` }}
            title={`Caption · ${fmt(m)}`}
          />
        ))}

        {/* Playhead */}
        <span className="lc-stl-playhead" style={{ left: `${pct(playhead)}%` }} aria-hidden="true" />

        {/* Trim handles */}
        <TrimHandle
          side="in"
          position={pct(trimStart)}
          onDragRatio={(r) => setTrimStart(Math.max(0, Math.min(trimEnd - 1, r * totalDuration)))}
        />
        <TrimHandle
          side="out"
          position={pct(trimEnd)}
          onDragRatio={(r) => setTrimEnd(Math.max(trimStart + 1, Math.min(totalDuration, r * totalDuration)))}
        />
      </div>

      {/* Numeric inputs (accessibility + precise edits) */}
      <div className="lc-stl-inputs">
        <label className="lc-stl-input">
          <span>In</span>
          <input
            type="number" min={0} max={totalDuration} step={0.1}
            value={trimStart.toFixed(1)}
            onChange={(e) => {
              const v = Math.max(0, Math.min(trimEnd - 1, parseFloat(e.target.value || "0")));
              setTrimStart(v);
            }}
          />
        </label>
        <label className="lc-stl-input">
          <span>Out</span>
          <input
            type="number" min={0} max={totalDuration} step={0.1}
            value={trimEnd.toFixed(1)}
            onChange={(e) => {
              const v = Math.max(trimStart + 1, Math.min(totalDuration, parseFloat(e.target.value || "0")));
              setTrimEnd(v);
            }}
          />
        </label>
      </div>

      {invalid && (
        <p className="lc-stl-warn">
          {tooShort && `Clips must be at least ${MIN_CLIP_S}s.`}
          {tooLong && ` Clips must be at most ${MAX_CLIP_S}s.`}
        </p>
      )}

      <footer className="lc-stl-foot">
        <button
          type="button"
          className="lc-stl-btn lc-stl-btn-quiet"
          onClick={() => { setTrimStart(0); setTrimEnd(initialEnd); }}
        >
          Reset
        </button>
        <button
          type="button"
          className="lc-stl-btn"
          onClick={onApplyTrim}
          disabled={invalid}
        >
          Apply trim
        </button>
      </footer>
    </GlassCard>
  );
}

/* ------- Trim handle (pointer-event drag) ------- */
function TrimHandle({
  side, position, onDragRatio,
}: {
  side: "in" | "out";
  position: number;
  onDragRatio: (r: number) => void;
}) {
  const onPointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    const rail = (e.currentTarget.parentElement) as HTMLElement | null;
    if (!rail) return;
    e.currentTarget.setPointerCapture(e.pointerId);

    const onMove = (mv: PointerEvent) => {
      const rect = rail.getBoundingClientRect();
      const r = Math.max(0, Math.min(1, (mv.clientX - rect.left) / rect.width));
      onDragRatio(r);
    };
    const onUp = (up: PointerEvent) => {
      (e.currentTarget as HTMLSpanElement | null)?.releasePointerCapture(up.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <span
      className={`lc-stl-handle lc-stl-handle-${side}`}
      style={{ left: `${position}%` }}
      onPointerDown={onPointerDown}
      role="slider"
      aria-label={`Trim ${side === "in" ? "in-point" : "out-point"}`}
      aria-valuenow={position}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span className="lc-stl-handle-grip" aria-hidden="true" />
    </span>
  );
}

function fmt(sec: number): string {
  const sign = sec < 0 ? "-" : "";
  const a = Math.abs(sec);
  const m = Math.floor(a / 60);
  const s = Math.floor(a % 60);
  return `${sign}${m}:${s.toString().padStart(2, "0")}`;
}
