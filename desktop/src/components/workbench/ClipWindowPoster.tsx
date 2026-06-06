// Static poster for inactive workbench windows.
//
// The active-video pool caps at MAX_ACTIVE_VIDEOS live <video> elements.
// Every other window in the canvas renders one of these instead — a single
// <img> for the clip's #1 thumbnail. Bandwidth-cheap; 100 of these in a
// canvas is safe.
//
// Click the poster → parent promotes the window into the pool ("focused").

import { convertFileSrc } from "@tauri-apps/api/core";
import { useMemo } from "react";
import type { Clip } from "./types";

export function ClipWindowPoster({
  clip,
  index,
  onActivate,
}: {
  /** Source clip — only `thumbnails[0].path` and `title` are read. */
  clip: Clip;
  /** 1-based clip position, for the corner badge. */
  index: number;
  /** Fired when the user clicks the poster. Parent should
   *  `setFocused(windowId)` + `promoteToPool(windowId, "focused")`. */
  onActivate: () => void;
}) {
  // Mirrors ClipCard.tsx:110 — same `thumbnails[0]?.path` → convertFileSrc
  // resolution so a click-into doesn't reload a different image than the
  // ResultsGrid card was showing.
  const thumbSrc = useMemo(() => {
    const t = clip.thumbnails?.[0]?.path;
    return t ? convertFileSrc(t) : null;
  }, [clip.thumbnails]);

  return (
    <button
      type="button"
      onClick={onActivate}
      aria-label={`Activate clip ${index}: ${clip.title || "untitled"}`}
      title="Click to play"
      className="group relative grid h-full w-full place-items-center overflow-hidden rounded-none bg-ink text-left"
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
        // "no preview" placeholder — same copy as ClipCard.tsx:290 empty
        // state. If thumbs ever fail to generate the clipper still sees a
        // tappable surface and can promote into the pool to see the video.
        <div className="grid h-full w-full place-items-center font-mono text-[11px] uppercase tracking-[0.10em] text-paper/40">
          no preview
        </div>
      )}

      {/* Clip index badge — same display+italic+fuchsia as the ResultsGrid
          card so a clipper recognises which clip number this tile is at a
          glance, before reading the title in the chrome above. */}
      <span className="pointer-events-none absolute left-2 top-2 font-display text-[18px] font-bold italic text-fuchsia drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">
        {index.toString().padStart(2, "0")}
      </span>

      {/* "click to play" affordance — cockpit fuchsia chevron bottom-right.
          Subtle until hover so 100 of these don't all shout at once. */}
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-ink/60 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-fuchsia opacity-60 transition-opacity group-hover:opacity-100"
      >
        play
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden>
          <path d="M2 1 L6 4 L2 7 Z" fill="currentColor" />
        </svg>
      </span>
    </button>
  );
}
