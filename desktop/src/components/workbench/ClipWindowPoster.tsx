// SURFACE: Workbench tile poster
// MAP TAGS: (O #1) static poster (default state)
//           (O #3) hover-only LC score + "why" overlay
//           (S "play this clip") click-tile → play
// See docs/UI_MAP_workbench.md — the contract.
//
// Static thumbnail for inactive workbench tiles. The tile defaults to this
// component — NO <video> mounted, NO autoplay, NO sound. The founder's
// verbatim feedback: "Keep clip static. … I'm hearing sound in workbench
// but no display." This is the fix.
//
// Hover-only overlay (bottom-left of poster):
//   • LC score pill (with virality-based fuchsia tint)
//   • One-line "why" microcopy from `clip.score_reason`
//
// The overlay fades in via `group-hover` on the parent tile (ClipWindow
// wraps in `group`). Tailwind pattern: `opacity-0 group-hover:opacity-100
// transition-opacity`. This keeps a 12-tile canvas QUIET at rest — every
// piece of chrome we don't burn into the poster is one less thing the
// clipper has to read past to see the actual clip.

import { convertFileSrc } from "@tauri-apps/api/core";
import { useMemo } from "react";
import type { Clip } from "./types";

function viralityClass(score: number): string {
  if (score >= 90) return "bg-fuchsia text-white";
  if (score >= 75) return "bg-fuchsia-bright text-white";
  if (score >= 50) return "bg-fuchsia-glow text-ink";
  return "bg-paper-warm text-text-tertiary";
}

export function ClipWindowPoster({
  clip,
  index,
  onActivate,
}: {
  /** Source clip — `thumbnails[0].path`, `title`, `virality`, `score_reason`. */
  clip: Clip;
  /** 1-based clip position, for the corner badge. */
  index: number;
  /** Fired when the user clicks the poster. Parent should promote this
   *  tile into playing state. */
  onActivate: () => void;
}) {
  const thumbSrc = useMemo(() => {
    const t = clip.thumbnails?.[0]?.path;
    return t ? convertFileSrc(t) : null;
  }, [clip.thumbnails]);

  return (
    <button
      type="button"
      onClick={onActivate}
      aria-label={`Play clip ${index}: ${clip.title || "untitled"}`}
      title="Click to play"
      className="relative grid h-full w-full place-items-center overflow-hidden rounded-none bg-ink text-left"
    >
      {thumbSrc ? (
        <img
          src={thumbSrc}
          alt={clip.title}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="grid h-full w-full place-items-center font-mono text-[11px] uppercase tracking-[0.10em] text-paper/40">
          no preview
        </div>
      )}

      {/* Clip index badge — always visible, top-left. */}
      <span className="pointer-events-none absolute left-2 top-2 font-display text-[18px] font-bold italic text-fuchsia drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">
        {index.toString().padStart(2, "0")}
      </span>

      {/* Hover-only LC score + "why" overlay, bottom-left. The parent
          tile wraps in `group` so this fades in on tile hover (NOT just
          poster hover — the chrome counts as part of the tile surface). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-2 bottom-2 flex flex-col items-start gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
      >
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.10em] ${viralityClass(
            clip.virality,
          )}`}
          title={clip.score_reason || "LC Score"}
        >
          <span className="opacity-80">LC</span>
          <span className="font-display text-[11px] font-bold leading-none tracking-[-0.02em]">
            {clip.virality}
          </span>
        </span>
        {clip.score_reason && (
          <span className="line-clamp-2 max-w-full rounded-md bg-ink/75 px-1.5 py-0.5 font-sans text-[10px] leading-snug text-paper/90 backdrop-blur-sm">
            {clip.score_reason}
          </span>
        )}
      </div>

      {/* Play-affordance chevron, bottom-right. Hover-only so 12 tiles
          don't all shout at once. */}
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-ink/60 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-fuchsia opacity-0 transition-opacity duration-150 group-hover:opacity-100"
      >
        play
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden>
          <path d="M2 1 L6 4 L2 7 Z" fill="currentColor" />
        </svg>
      </span>
    </button>
  );
}
