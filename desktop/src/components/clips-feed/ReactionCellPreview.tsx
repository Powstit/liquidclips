"use client";

import { useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Play, Pause, Volume2, AudioLines, VolumeX, WandSparkles, X } from "lucide-react";
import { LAYOUT_TOPOLOGY } from "./layout-cells";
import type { LayoutKey } from "./LayoutIcon";

// Playable preview of the composed clip. Renders a single 9:16 frame —
// matching the actual shipped vertical short — with each cell positioned
// from LAYOUT_TOPOLOGY.cells[].rect. This way the preview reads as
// "what the published clip will look like", not "two thumbnails in a row".
//
// Each cell stays independently playable so the user can scrub either
// source. Final composite still ships from the sidecar renderer; this
// preview never tries to composite live.

export type AudioSource = "main" | "broll" | "muted";

export function ReactionCellPreview({
  kind,
  mainPath,
  mainTitle,
  reactionPath,
  audioSource,
  busy,
  onPick,
  onRemove,
  onApply,
}: {
  kind: LayoutKey;
  mainPath: string | null;
  mainTitle: string;
  reactionPath: string | null;
  audioSource: AudioSource;
  busy: boolean;
  onPick: () => void;
  onRemove: () => void;
  onApply: () => void;
}) {
  const topology = LAYOUT_TOPOLOGY[kind];
  const reactionName = reactionPath?.split("/").pop() ?? null;

  return (
    <div className="rounded-xl border border-line bg-paper p-3.5 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          preview · {topology.label.toLowerCase()}
        </span>
        {reactionPath && (
          <button
            onClick={onRemove}
            disabled={busy}
            title="Remove reaction"
            className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary hover:border-[#DC2626] hover:text-[#DC2626] disabled:opacity-40"
          >
            <X size={11} strokeWidth={2.5} />
            remove
          </button>
        )}
      </div>

      {/* The composite frame — 9:16 to match shipped vertical output.
          max-w caps the height so it fits the right-column editor; mx-auto
          keeps it centered when the column is wider than the frame. */}
      <div className="relative mx-auto aspect-[9/16] w-full max-w-[260px] overflow-hidden rounded-lg border border-line bg-ink">
        {topology.cells.map((cell) => {
          const isMainCell = cell.isMain === true;
          const path = isMainCell ? mainPath : reactionPath;
          const audioOn = isMainCell
            ? audioSource === "main"
            : audioSource === "broll";
          const muted = audioSource === "muted";
          const isInsetCell = cell.role === "inset";

          // Empty reaction slot — CTA to pick. Sits in the same rect the
          // real reaction will occupy so the layout reads correctly.
          if (!isMainCell && !path) {
            return (
              <button
                key={cell.role}
                onClick={onPick}
                disabled={busy}
                style={rectStyle(cell.rect)}
                className={`absolute z-10 grid place-items-center bg-fuchsia-soft/40 backdrop-blur-[2px] text-fuchsia-deep transition-colors hover:bg-fuchsia-soft/60 disabled:opacity-50 ${
                  isInsetCell
                    ? "rounded-md border-2 border-dashed border-fuchsia ring-2 ring-fuchsia/30 shadow-[0_4px_12px_rgba(0,0,0,0.45)]"
                    : "border border-dashed border-fuchsia-soft"
                }`}
              >
                <span className="px-1.5 text-center font-mono text-[9px] uppercase tracking-[0.1em] leading-tight">
                  pick a reaction
                </span>
              </button>
            );
          }

          return (
            <div
              key={cell.role}
              style={rectStyle(cell.rect)}
              className={`absolute overflow-hidden ${
                isInsetCell
                  ? "z-10 rounded-md ring-2 ring-white/50 shadow-[0_4px_14px_rgba(0,0,0,0.55)]"
                  : ""
              }`}
            >
              <VideoTile
                path={path}
                muted={!audioOn || muted}
              />
              <CellChrome
                role={isMainCell ? "main" : "reaction"}
                title={isMainCell ? mainTitle : (reactionName ?? "")}
                audioOn={audioOn && !muted}
                muted={muted}
                compact={isInsetCell}
              />
            </div>
          );
        })}
      </div>

      {kind !== "none" && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <button
            onClick={onPick}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 font-sans text-[12px] font-medium text-text-secondary hover:border-fuchsia hover:text-fuchsia disabled:opacity-40"
          >
            {reactionPath ? "Change reaction" : "Pick a reaction clip"}
          </button>
          <button
            onClick={onApply}
            disabled={busy || !reactionPath}
            title={reactionPath ? "Render the composite" : "Pick a reaction first"}
            className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-4 py-1.5 font-sans text-[13px] font-medium text-white hover:bg-fuchsia-bright disabled:opacity-40"
          >
            <WandSparkles size={13} strokeWidth={2.2} />
            {busy ? "Rendering…" : "Apply reaction"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Cell chrome (role badge + audio badge + title strip) ───────────────

function CellChrome({
  role,
  title,
  audioOn,
  muted,
  compact,
}: {
  role: "main" | "reaction";
  title: string;
  audioOn: boolean;
  muted: boolean;
  compact: boolean;
}) {
  // Inset cells are tiny; drop the title strip and shrink the badges so
  // the chrome doesn't eat the whole tile.
  const padClass = compact ? "p-1" : "p-2";
  const badgePad = compact ? "px-1 py-0" : "px-2 py-0.5";
  const badgeText = compact ? "text-[8px]" : "text-[9px]";

  return (
    <div className={`pointer-events-none absolute inset-0 flex flex-col justify-between ${padClass}`}>
      <div className="flex items-start justify-between gap-1">
        <span
          className={`pointer-events-auto inline-flex items-center rounded-full font-mono uppercase tracking-[0.14em] ${badgePad} ${badgeText} ${
            role === "main"
              ? "bg-paper/85 text-ink"
              : "bg-fuchsia text-white"
          }`}
        >
          {role}
        </span>
        <span
          className={`pointer-events-auto inline-flex items-center gap-1 rounded-full font-mono uppercase tracking-[0.14em] ${badgePad} ${badgeText} ${
            audioOn ? "bg-fuchsia text-white" : "bg-paper/20 text-paper/70"
          }`}
          title={
            muted
              ? "All audio muted in render"
              : audioOn
              ? "Audio plays from this cell"
              : "Silent in render"
          }
        >
          {muted ? (
            <VolumeX size={compact ? 8 : 10} strokeWidth={2.4} />
          ) : audioOn ? (
            role === "main" ? (
              <Volume2 size={compact ? 8 : 10} strokeWidth={2.4} />
            ) : (
              <AudioLines size={compact ? 8 : 10} strokeWidth={2.4} />
            )
          ) : (
            <VolumeX size={compact ? 8 : 10} strokeWidth={2.4} />
          )}
          {compact ? "" : audioOn && !muted ? "audio" : "silent"}
        </span>
      </div>
      {!compact && title && (
        <div className="pointer-events-auto rounded-md bg-ink/70 px-2 py-1 backdrop-blur-sm">
          <p className="truncate font-sans text-[11px] font-medium leading-tight text-white">{title}</p>
        </div>
      )}
    </div>
  );
}

// ── Playable video tile ────────────────────────────────────────────────

function VideoTile({ path, muted }: { path: string | null; muted: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);

  if (!path) {
    return (
      <div className="grid h-full w-full place-items-center bg-paper-warm">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          no video yet
        </span>
      </div>
    );
  }

  const src = convertFileSrc(path);

  function toggle() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  }

  return (
    <div className="relative h-full w-full">
      <video
        ref={videoRef}
        src={src}
        muted={muted}
        playsInline
        loop
        preload="metadata"
        className="h-full w-full object-cover"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={(e) => { (e.currentTarget as HTMLVideoElement).style.display = "none"; }}
      />
      <button
        onClick={toggle}
        className="absolute inset-0 grid place-items-center bg-black/0 transition-colors hover:bg-black/30"
        aria-label={playing ? "Pause" : "Play"}
      >
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-ink shadow-[0_4px_14px_rgba(0,0,0,0.35)] transition-opacity ${
            playing ? "opacity-0 hover:opacity-100" : "opacity-90"
          }`}
        >
          {playing ? <Pause size={14} strokeWidth={2.4} /> : <Play size={14} strokeWidth={2.4} />}
        </span>
      </button>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function rectStyle(rect: { x: number; y: number; w: number; h: number }): React.CSSProperties {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
  };
}
