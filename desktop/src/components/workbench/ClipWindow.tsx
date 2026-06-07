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
import { ClipWindowChrome } from "./ClipWindowChrome";
import { ClipWindowPoster } from "./ClipWindowPoster";
import type { WindowId } from "./types";
import type { Clip, Project } from "../../lib/sidecar";

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
  const promoteToPool = useWorkbenchStore((s) => s.promoteToPool);

  const clipIdx = windowState?.clipIdx ?? -1;
  const clip = clipIdx >= 0 ? project.clips[clipIdx] : undefined;

  const videoRef = useRef<HTMLVideoElement | null>(null);

  const handleFocus = useCallback(() => {
    setFocused(windowId);
    promoteToPool(windowId, "focused");
  }, [setFocused, promoteToPool, windowId]);

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

  // Resolve the playback path. Prefer vertical (the canonical published cut);
  // fall back to portrait or the raw cut.
  const videoSrc = useMemo(() => {
    if (!clip) return null;
    const path = clip.vertical_path || clip.portrait_path || clip.cut_path;
    return path ? convertFileSrc(path) : null;
  }, [clip]);

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
        {isPlaying && videoSrc ? (
          // Single explicitly-mounted <video>. NO `autoPlay`, NO `loop`. We
          // call .play() from the effect above only after the user gesture.
          <video
            ref={videoRef}
            src={videoSrc}
            controls
            playsInline
            className="h-full w-full bg-black object-contain"
            onClick={(e) => e.stopPropagation()}
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
