// ship-lens v0.7.8: W2 — wire master Apply ratio end-to-end (read windowState.ratio, prefer matching square/portrait file with vertical fallback). W3 — cache-bust videoSrc on captions re-bake using clip.captions_updated_at (same pattern as ClipPreview videoCacheBuster). W5 — drop promoteToPool consumer (pool deleted).
// SURFACE: Workbench tile
// MAP TAGS: (O #1) static poster | (S "play this clip") click-to-play
//           (O #1) title | (O #2) AccountBindingChip slot | (S "select for batch") tick
// See docs/UI_MAP_workbench.md — the contract.
//
// Per-window minimal tile inside the workbench canvas. Composes:
//   • ClipWindowChrome — top bar (tick + title + AccountBindingChip)
//   • ClipWindowPoster — static thumbnail (default state) OR inline <video>
//     when this tile has been promoted to "playing".
//
// Hard rule from the founder's verbatim feedback:
//   "Keep clip static. … no autoplay, no loop."
//
// The tile NEVER mounts a `<video>` element with autoplay/loop. Playback is
// strictly opt-in — the user clicks the poster (or hits Space on focus),
// the parent (WindowManager) sets `playingId`, and this tile swaps to a
// controlled <video> paused-to-playing on first frame.
//
// Right-click, keyboard shortcuts (E, Space, Cmd-Backspace, Cmd-A) and the
// global context menu live in WindowManager. This tile only fires the
// `onActivate` callback on poster click + the chrome's selection toggle.

import { convertFileSrc } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useWorkbenchStore } from "./useWorkbenchStore";
import { PlatformBadge } from "../PlatformBadge";
import { ClipWindowChrome } from "./ClipWindowChrome";
import { ClipWindowPoster } from "./ClipWindowPoster";
import type { WindowId } from "./types";
import type { Clip, Project, RatioKey } from "../../lib/sidecar";

// v0.7.8 W3: sidecar writes `captions_updated_at` (python-sidecar/sidecar.py:892
// inside method_edit_captions) but the field isn't declared on the TS Clip
// type yet. Read it via a narrowed view rather than reaching into sidecar.ts
// (outside this agent's ownership). Same fallback shape for future-added
// fields we want to depend on without rewriting the public type today.
type ClipMaybeUpdated = Clip & {
  captions_updated_at?: string;
};

function preferredPathForRatio(clip: Clip, ratio: RatioKey | null): string | null {
  // v0.7.8 W2: ratio control now changes which file the tile renders.
  // Prefer the ratio-specific file when present; vertical_path is the
  // canonical fallback (every clip has one once reframe lands). cut_path
  // is the pre-reframe rough cut — last-resort for Fast Draft tail clips.
  if (ratio === "square" && clip.square_path) return clip.square_path;
  if (ratio === "portrait" && clip.portrait_path) return clip.portrait_path;
  if (ratio === "vertical" && clip.vertical_path) return clip.vertical_path;
  return clip.vertical_path || clip.portrait_path || clip.cut_path || null;
}

export function ClipWindow({
  windowId,
  project,
  isPlaying,
  onActivateContextMenu,
  onPlayToggle,
}: {
  windowId: WindowId;
  project: Project;
  /** Whether this tile is the currently "playing" one (WindowManager-owned). */
  isPlaying: boolean;
  /** Right-click handler — bubbles up to WindowManager which renders the
   *  single canvas-level context menu. */
  onActivateContextMenu: (windowId: WindowId, clientX: number, clientY: number) => void;
  /** Toggle play/pause for this tile (Space on focus, click on poster). */
  onPlayToggle: (windowId: WindowId) => void;
}) {
  const windowState = useWorkbenchStore((s) => s.windows.get(windowId) ?? null);
  const focused = useWorkbenchStore((s) => s.selection.focusedId === windowId);
  const selected = useWorkbenchStore((s) => s.selection.selectedIds.has(windowId));
  const setFocused = useWorkbenchStore((s) => s.setFocused);

  const clipIdx = windowState?.clipIdx ?? -1;
  const clip = clipIdx >= 0 ? (project.clips[clipIdx] as ClipMaybeUpdated | undefined) : undefined;
  const ratio = windowState?.ratio ?? null;

  const videoRef = useRef<HTMLVideoElement | null>(null);

  const handleFocus = useCallback(() => {
    setFocused(windowId);
  }, [setFocused, windowId]);

  const handleActivate = useCallback(() => {
    handleFocus();
    onPlayToggle(windowId);
  }, [handleFocus, onPlayToggle, windowId]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      handleFocus();
      onActivateContextMenu(windowId, e.clientX, e.clientY);
    },
    [handleFocus, onActivateContextMenu, windowId],
  );

  // When this tile flips from not-playing → playing, kick the inline <video>
  // into play(). When it flips back, pause + reset. The element is unmounted
  // entirely when not playing — that's intentional: the founder's complaint
  // ("hearing sound in workbench but no display") came from inline <video>s
  // running constantly. We mount exactly one, on demand.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) {
      v.play().catch(() => {
        // Autoplay policy may block; user gesture (Space/click) usually
        // satisfies it. If not, the static poster + controls let them retry.
      });
    } else {
      v.pause();
    }
  }, [isPlaying]);

  // Resolve the playback path. v0.7.8 W2: pick the file matching the
  // window's ratio (square/portrait), fall back to vertical when the
  // chosen ratio doesn't exist on disk yet.
  // v0.7.8 W3: append `?cb=${captions_updated_at}` so a captions re-bake
  // (which overwrites the vertical/square/portrait mp4 in place via the
  // edit_captions RPC) busts the browser's media cache. Same pattern as
  // ClipPreview's `videoCacheBuster` at ClipPreview.tsx:170-173, but
  // here driven by a sidecar-written timestamp instead of a local counter
  // so master fan-out re-bakes refresh the tile too.
  const videoSrc = useMemo(() => {
    if (!clip) return null;
    const path = preferredPathForRatio(clip, ratio);
    if (!path) return null;
    const base = convertFileSrc(path);
    const cb = clip.captions_updated_at;
    return cb ? `${base}?cb=${encodeURIComponent(cb)}` : base;
  }, [clip, ratio]);

  if (!clip) {
    return (
      <div
        className="flex h-full w-full flex-col bg-paper"
        data-window-id={windowId}
      >
        <ClipWindowChrome
          windowId={windowId}
          clip={{
            start: 0,
            end: 0,
            title: "(clip unavailable)",
            description: "",
            theme: "",
            virality: 0,
            slug: project.slug,
            title_variants: [],
          } as Clip}
          selected={selected}
          focused={focused}
        />
        <div className="grid flex-1 place-items-center bg-ink">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-paper/40">
            clip not found
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group relative flex h-full w-full flex-col bg-paper"
      data-window-id={windowId}
      data-focused={focused ? "true" : "false"}
      data-playing={isPlaying ? "true" : "false"}
      onContextMenu={handleContextMenu}
      onMouseDownCapture={() => {
        if (!focused) handleFocus();
      }}
    >
      <ClipWindowChrome
        windowId={windowId}
        clip={clip}
        selected={selected}
        focused={focused}
      />
      <div className="relative flex-1 overflow-hidden">
        {/* v0.7.14 — PlatformBadge stack top-right of the tile. Hidden when
            no platforms selected (default state on imports + fresh cuts). */}
        {clip.platforms && clip.platforms.length > 0 && (
          <span className="pointer-events-none absolute right-1.5 top-1.5 z-10">
            <PlatformBadge platforms={clip.platforms} size="sm" />
          </span>
        )}
        {isPlaying && videoSrc ? (
          // Single explicitly-mounted <video>. NO `autoPlay`, NO `loop`. We
          // call .play() from the effect above only after the user gesture.
          // v0.7.8 W3: `key={videoSrc}` so a fresh captions re-bake URL
          // remounts the element — React doesn't reload <video src> on a
          // mere src prop change, only on a new element.
          <video
            key={videoSrc}
            ref={videoRef}
            src={videoSrc}
            controls
            playsInline
            className="h-full w-full bg-black object-contain"
            onClick={(e) => e.stopPropagation()}
            onError={(e) => {
              // ship-lens v0.7.13 F4 pattern-grep — apply onError to every
              // <video> the user can reach on the critical clip-flow. MediaError
              // codes: 1=aborted, 2=network, 3=decode, 4=unsupported. WebKit
              // often leaves `.message` empty, so branch on code.
              const err = e.currentTarget.error;
              const msg = err?.code === 4
                ? "Unsupported codec — try re-exporting as H.264 MP4."
                : err?.code === 3
                ? "Couldn't decode this clip — the file may be corrupt."
                : err?.code === 2
                ? "Network error while loading the clip."
                : err?.message || "Couldn't play this clip.";
              console.error("[workbench-clip-video]", msg);
            }}
          />
        ) : (
          <ClipWindowPoster
            clip={clip}
            index={clipIdx + 1}
            onActivate={handleActivate}
          />
        )}
      </div>
    </div>
  );
}
