// WindowManager.tsx
//
// The 8x8 canvas owner. Renders one <ClipWindow /> per entry in the workbench
// store, plus a "+" tile at the next free slot, plus the MasterToolbar across
// the top. Also the SINGLE document-level keydown owner for the workbench —
// individual windows and drawers should never attach competing global listeners.
//
// Keyboard contract (single document listener):
//   Esc cascade (first match wins):
//     1. #__reaction-source-picker mounted → no-op (picker owns Esc)
//     2. Any window has captionsOpen === true → no-op (drawer owns Esc)
//     3. selection.selectedIds.size > 0 → clearSelection()
//     4. Otherwise → no-op
//   Cmd+A           → store.selectAll()
//   Cmd+D           → store.clearSelection()
//   Cmd+Enter       → MasterToolbar default action (deferred to toolbar wiring)
//   Tab / Shift+Tab → cycle focus across windows
//   Cmd+`           → cycle focus across windows (same as Tab; macOS muscle memory)
//
// USER JOURNEY · WindowManager
//   ENABLES — multi-clip canvas + keyboard-driven selection/focus
//   PREVENTS — competing global listeners (single owner = no Esc double-fires)
//   BREAKS — none in grid mode (WindowManager only mounts inside the workbench branch)
//   STRANDS — empty windows[]: a "+" tile is always rendered so the user can seed.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkbenchStore } from "./useWorkbenchStore";
import { ClipWindow } from "./ClipWindow";
import { MasterToolbar } from "./MasterToolbar";
import type { Project } from "../../lib/sidecar";
import type { WindowState } from "./types";
import { CANVAS_GRID_COLS, CANVAS_GRID_ROWS } from "./types";

function isMetaKey(e: KeyboardEvent): boolean {
  // macOS uses metaKey; we still accept ctrl for the rare cross-platform Tauri
  // dev rebuild on Linux/Windows.
  return e.metaKey || e.ctrlKey;
}

function nextFreeSlot(windows: WindowState[]): { col: number; row: number } {
  // Tiny placement helper: walk row-major; first cell with no window's top-left
  // anchored there wins. The real layout work (overlap, snap, push) is the
  // store's job — this is purely a hint for the "+" tile and seed-window.
  const occupied = new Set<string>();
  for (const w of windows) {
    occupied.add(`${w.pos.col}:${w.pos.row}`);
  }
  for (let row = 0; row < CANVAS_GRID_ROWS; row++) {
    for (let col = 0; col < CANVAS_GRID_COLS; col++) {
      if (!occupied.has(`${col}:${row}`)) return { col, row };
    }
  }
  return { col: 0, row: 0 };
}

export function WindowManager({
  project,
  onProjectChange,
}: {
  project: Project;
  onProjectChange: (p: Project) => void;
}): JSX.Element {
  // Coarse selectors — re-render on any store change. Fine for an 8x8
  // canvas (max ~32 windows in practice); refine when profiling demands it.
  const windowsMap = useWorkbenchStore((s) => s.windows);
  const selection = useWorkbenchStore((s) => s.selection);
  const addWindow = useWorkbenchStore((s) => s.addWindow);
  const selectAll = useWorkbenchStore((s) => s.selectAll);
  const clearSelection = useWorkbenchStore((s) => s.clearSelection);
  const setFocused = useWorkbenchStore((s) => s.setFocused);
  const reconcileProject = useWorkbenchStore((s) => s.reconcileProject);

  // Reconcile store with project on every render. Per Agent 1's contract the
  // method is idempotent — it diffs against its own internal cache and skips
  // when slug+clipCount are unchanged.
  useEffect(() => {
    reconcileProject(project);
  }, [project, reconcileProject]);

  const windowList = useMemo<WindowState[]>(() => {
    // Map values, stable order. The store's tests guarantee insertion order
    // matches user creation order, which is what Tab/Shift+Tab should follow.
    return Array.from(windowsMap.values());
  }, [windowsMap]);

  const focusedId = selection.focusedId;

  // Tab / Cmd+` focus cycler — pure function of windowList + current focus.
  const cycleFocus = useCallback(
    (direction: 1 | -1): void => {
      if (windowList.length === 0) return;
      const ids = windowList.map((w) => w.id);
      const idx = focusedId ? ids.indexOf(focusedId) : -1;
      const nextIdx = (idx + direction + ids.length) % ids.length;
      setFocused(ids[nextIdx] ?? null);
    },
    [windowList, focusedId, setFocused],
  );

  // Single document-level keydown owner. The Esc cascade is documented at the
  // top of the file; selection / focus shortcuts share this listener so we
  // never end up with three handlers fighting for the same key.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      // ── Esc cascade ────────────────────────────────────────────────────
      if (e.key === "Escape") {
        // 1. Reaction-source picker owns Esc.
        if (typeof document !== "undefined" && document.getElementById("__reaction-source-picker")) {
          return;
        }
        // 2. Any caption drawer open → drawer's listener handles Esc.
        for (const w of windowList) {
          if (w.captionsOpen) return;
        }
        // 3. Selection → clear it.
        if (selection.selectedIds.size > 0) {
          e.preventDefault();
          clearSelection();
          return;
        }
        return; // 4. otherwise no-op
      }

      // Cmd+A → select all
      if (isMetaKey(e) && e.key.toLowerCase() === "a") {
        // Skip when an input/textarea is focused — we'd hijack their native
        // select-all otherwise.
        const tag = (document.activeElement as HTMLElement | null)?.tagName ?? "";
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        selectAll();
        return;
      }

      // Cmd+D → clear selection
      if (isMetaKey(e) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        clearSelection();
        return;
      }

      // Cmd+Enter → MasterToolbar default action (deferred to Agent 5).
      // Fire a window-level event so the toolbar can subscribe without us
      // having to import its imperative handle.
      if (isMetaKey(e) && e.key === "Enter") {
        e.preventDefault();
        try {
          window.dispatchEvent(new CustomEvent("lc:workbench:master-default"));
        } catch {
          // Some sandboxes refuse CustomEvent — silently no-op.
        }
        return;
      }

      // Tab / Shift+Tab → cycle focus (no modifier — we own focus inside the
      // canvas). Skip when focus is in an input — let the form take Tab.
      if (e.key === "Tab" && !isMetaKey(e) && !e.altKey) {
        const tag = (document.activeElement as HTMLElement | null)?.tagName ?? "";
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (windowList.length === 0) return;
        e.preventDefault();
        cycleFocus(e.shiftKey ? -1 : 1);
        return;
      }

      // Cmd+` → cycle focus (macOS window-cycling muscle memory)
      if (isMetaKey(e) && e.key === "`") {
        if (windowList.length === 0) return;
        e.preventDefault();
        cycleFocus(e.shiftKey ? -1 : 1);
        return;
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [windowList, selection.selectedIds, clearSelection, selectAll, cycleFocus]);

  // "+ window" popover state — click the tile, get a clip-index picker.
  const [pickerOpen, setPickerOpen] = useState(false);
  const freeSlot = useMemo(() => nextFreeSlot(windowList), [windowList]);

  const onAddClip = useCallback(
    (clipIdx: number): void => {
      addWindow(clipIdx);
      setPickerOpen(false);
    },
    [addWindow],
  );

  return (
    <div className="mt-3 flex flex-col gap-3">
      {/* Master toolbar lives ABOVE the canvas so it never overlaps a window
          drag handle. Agent 5 owns its internals — we just mount it. */}
      <MasterToolbar project={project} onProjectChange={onProjectChange} />

      <div
        className="relative grid gap-2 rounded-2xl border border-line bg-paper-warm/30 p-3"
        style={{
          // 8x8 named tracks per spec. Square cells keep visual rhythm with
          // the grid view's card aspect.
          gridTemplateColumns: `repeat(${CANVAS_GRID_COLS}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${CANVAS_GRID_ROWS}, minmax(72px, 1fr))`,
          minHeight: "640px",
        }}
        role="application"
        aria-label="Workbench canvas"
      >
        {windowList.map((w) => (
          <div
            key={w.id}
            style={{
              gridColumn: `${w.pos.col + 1} / span ${w.size.w}`,
              gridRow: `${w.pos.row + 1} / span ${w.size.h}`,
            }}
          >
            {/* Agent 2 owns ClipWindow. While it's pending we render a
                placeholder card so the canvas isn't empty. */}
            <ClipWindow windowId={w.id} project={project} onProjectChange={onProjectChange} />
          </div>
        ))}

        {/* "+" tile at the next free slot. Stays mounted even when the canvas
            is empty so the user always has a way to seed the workbench. */}
        <button
          type="button"
          onClick={() => {
            if (project.clips.length === 0) return;
            setPickerOpen((v) => !v);
          }}
          disabled={project.clips.length === 0}
          title={project.clips.length === 0 ? "No clips yet" : "Add a window"}
          aria-label="Add window"
          style={{
            gridColumn: `${freeSlot.col + 1} / span 2`,
            gridRow: `${freeSlot.row + 1} / span 2`,
          }}
          className="flex items-center justify-center rounded-xl border-2 border-dashed border-line bg-transparent font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary transition-colors hover:border-fuchsia hover:text-fuchsia-deep disabled:opacity-40"
        >
          + window
        </button>

        {pickerOpen && (
          <div
            className="absolute z-20 max-h-[60vh] w-[260px] overflow-auto rounded-xl border border-line bg-paper p-2 shadow-xl"
            style={{
              left: `${(freeSlot.col / CANVAS_GRID_COLS) * 100}%`,
              top: `${(freeSlot.row / CANVAS_GRID_ROWS) * 100}%`,
            }}
            role="listbox"
            aria-label="Pick a clip"
          >
            <div className="mb-2 px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
              Pick a clip
            </div>
            {project.clips.map((c, idx) => (
              <button
                key={`${idx}-${c.slug}`}
                type="button"
                onClick={() => onAddClip(idx)}
                className="block w-full rounded-md px-2 py-1.5 text-left font-sans text-[13px] text-ink hover:bg-fuchsia-soft/30 hover:text-fuchsia-deep"
              >
                <span className="font-mono text-[10px] tabular-nums text-text-tertiary">
                  #{idx + 1}
                </span>{" "}
                {c.title || c.slug}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              className="mt-2 block w-full rounded-md border border-line px-2 py-1 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary hover:text-ink"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
