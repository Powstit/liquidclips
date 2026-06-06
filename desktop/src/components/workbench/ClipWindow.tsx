// Per-window clip editor inside the workbench canvas.
//
// Composes:
//   • ClipWindowChrome — top bar (tick / title / close)
//   • EITHER ClipPreview in "window" mode (when this window is in the
//     active-video pool) OR ClipWindowPoster (static thumb, bandwidth-cheap)
//
// The pool is owned by useWorkbenchStore. Promotion happens on chrome/poster
// click and on hover (Agent 4 wires hover). Eviction is LRU with "focused"
// and "playing" pins protecting their entries — see ./activeVideoPool.ts.

import { useCallback } from "react";
import { useWorkbenchStore } from "./useWorkbenchStore";
import { ClipPreview } from "../ClipPreview";
import { ClipWindowChrome } from "./ClipWindowChrome";
import { ClipWindowPoster } from "./ClipWindowPoster";
import { isInPool } from "./activeVideoPool";
import type { WindowId } from "./types";
import type { Project } from "../../lib/sidecar";

export function ClipWindow({
  windowId,
  project,
  onProjectChange,
}: {
  windowId: WindowId;
  project: Project;
  onProjectChange: (p: Project) => void;
}) {
  // Subscribe to only the slices this window cares about. Whole-store
  // subscription would re-render every tile on every other tile's move.
  const windowState = useWorkbenchStore((s) => s.windows.get(windowId) ?? null);
  const focused = useWorkbenchStore((s) => s.selection.focusedId === windowId);
  const selected = useWorkbenchStore((s) => s.selection.selectedIds.has(windowId));
  const pool = useWorkbenchStore((s) => s.pool);
  const setFocused = useWorkbenchStore((s) => s.setFocused);
  const promoteToPool = useWorkbenchStore((s) => s.promoteToPool);

  // 1. Resolve which clip this window edits.
  const clipIdx = windowState?.clipIdx ?? -1;
  const clip = clipIdx >= 0 ? project.clips[clipIdx] : undefined;
  const inPool = isInPool(pool, windowId);

  const handleActivate = useCallback(() => {
    setFocused(windowId);
    promoteToPool(windowId, "focused");
  }, [setFocused, promoteToPool, windowId]);

  if (!clip) {
    return (
      <div
        className="flex h-full w-full flex-col bg-paper"
        data-window-id={windowId}
      >
        {/* Chrome still renders so the user can close the orphan. */}
        {/* Synthetic clip stub keeps the title slot non-empty and gives the
            "no signal" heuristic a falsy `caption_palette` so close is silent. */}
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
          }}
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
      className="relative flex h-full w-full flex-col bg-paper"
      data-window-id={windowId}
      data-focused={focused ? "true" : "false"}
      data-in-pool={inPool ? "true" : "false"}
      onMouseDownCapture={(e) => {
        // Single source of truth for focus: chrome click or poster click
        // promote. Avoid double-firing when the inner ClipPreview handles
        // its own clicks — only promote when the user isn't already focused
        // here and the click landed somewhere that should activate. Modal
        // close, drawer toggles etc. are inert because the window-mode
        // ClipPreview already swallows close affordances.
        if (focused) return;
        // Defer to a microtask so the inner control's onClick can run first
        // (otherwise focusing into an input would race with focus promotion).
        Promise.resolve().then(() => {
          if (e.defaultPrevented) return;
          handleActivate();
        });
      }}
    >
      <ClipWindowChrome
        windowId={windowId}
        clip={clip}
        selected={selected}
        focused={focused}
      />
      <div className="relative flex-1 overflow-hidden">
        {inPool ? (
          <ClipPreview
            mode="window"
            clip={clip}
            index={clipIdx + 1}
            slug={project.slug}
            project={project}
            totalClips={project.clips.length}
            onClose={handleActivate /* no-op-ish in window mode; chrome owns close */}
            onProjectChange={onProjectChange}
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
