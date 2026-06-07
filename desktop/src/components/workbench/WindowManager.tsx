// SURFACE: Workbench canvas
// MAP TAGS: (O #1)(O #2)(O #3)(O #4) — owns the tile grid + Edit drawer mount
//           (S) keyboard: E, Space, Cmd-Backspace, Cmd-A, Tab, Esc cascade
//           (S "act on this tile") right-click context menu
//           (N → Edit drawer) E / double-click
// See docs/UI_MAP_workbench.md — the contract.
//
// The canvas owner. Renders one <ClipWindow /> per workbench-store window,
// plus a "+" tile at the next free slot, plus the MasterToolbar above, plus
// the singleton ClipEditDrawer and right-click ContextMenu surfaces.
//
// SINGLE OWNER for:
//   • document-level keydown (no competing window-level listeners)
//   • right-click context menu (one element on screen, dispatched to the
//     focused tile — NOT one per tile)
//   • per-canvas playingId (only ONE tile plays at a time; explicit user
//     gesture required — fixes the founder's "sound in workbench but no
//     display" symptom)
//
// Keyboard contract:
//   Esc cascade (first match wins):
//     1. #__reaction-source-picker mounted → no-op
//     2. Any window has captionsOpen / Edit drawer open → drawer owns Esc
//     3. Context menu open → close it
//     4. selection.selectedIds.size > 0 → clearSelection()
//     5. Otherwise → no-op
//   E              → open Edit drawer on focused tile
//   Space          → play/pause focused tile
//   Cmd-Backspace  → confirm-remove focused tile
//   Cmd-A          → selectAll()
//   Cmd-D          → clearSelection()
//   Cmd+Enter      → MasterToolbar default action (dispatched via CustomEvent)
//   Tab / Shift+Tab → cycle focus across windows
//   Cmd+`          → cycle focus (macOS muscle memory)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useWorkbenchStore } from "./useWorkbenchStore";
import { ClipWindow } from "./ClipWindow";
import { ClipEditDrawer } from "./ClipEditDrawer";
import { MasterToolbar } from "./MasterToolbar";
import { ConfirmDialog } from "../ConfirmDialog";
import { sidecar } from "../../lib/sidecar";
import type { Project } from "../../lib/sidecar";
import type { WindowState, WindowId } from "./types";
import { CANVAS_GRID_COLS, CANVAS_GRID_ROWS } from "./types";

function isMetaKey(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey;
}

function nextFreeSlot(windows: WindowState[]): { col: number; row: number } {
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

type ContextMenuState = {
  windowId: WindowId;
  x: number;
  y: number;
};

export function WindowManager({
  project,
  onProjectChange,
}: {
  project: Project;
  onProjectChange: (p: Project) => void;
}): JSX.Element {
  const windowsMap = useWorkbenchStore((s) => s.windows);
  const selection = useWorkbenchStore((s) => s.selection);
  const addWindow = useWorkbenchStore((s) => s.addWindow);
  const removeWindow = useWorkbenchStore((s) => s.removeWindow);
  const selectAll = useWorkbenchStore((s) => s.selectAll);
  const clearSelection = useWorkbenchStore((s) => s.clearSelection);
  const setFocused = useWorkbenchStore((s) => s.setFocused);
  const setCaptionsOpen = useWorkbenchStore((s) => s.setCaptionsOpen);
  const reconcileProject = useWorkbenchStore((s) => s.reconcileProject);

  useEffect(() => {
    reconcileProject(project);
  }, [project, reconcileProject]);

  const windowList = useMemo<WindowState[]>(
    () => Array.from(windowsMap.values()),
    [windowsMap],
  );

  const focusedId = selection.focusedId;
  const focusedWindow = focusedId ? windowsMap.get(focusedId) ?? null : null;

  // Singleton playing tile — at most ONE <video> mounted per canvas.
  const [playingId, setPlayingId] = useState<WindowId | null>(null);
  // Single right-click context menu.
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  // Branded confirm dialog for Cmd-Backspace / "Remove" right-click.
  const [confirmRemoveId, setConfirmRemoveId] = useState<WindowId | null>(null);

  // Reset playing/context-menu state when the project changes underneath us.
  const lastSlugRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastSlugRef.current !== project.slug) {
      setPlayingId(null);
      setContextMenu(null);
      setConfirmRemoveId(null);
      lastSlugRef.current = project.slug;
    }
  }, [project.slug]);

  // Drop stale playingId if its window was removed.
  useEffect(() => {
    if (playingId && !windowsMap.has(playingId)) setPlayingId(null);
  }, [windowsMap, playingId]);

  const togglePlay = useCallback((id: WindowId) => {
    setPlayingId((prev) => (prev === id ? null : id));
  }, []);

  const openEditDrawer = useCallback(
    (id: WindowId | null) => {
      if (!id) return;
      setFocused(id);
      setCaptionsOpen(id, true);
    },
    [setFocused, setCaptionsOpen],
  );

  const openContextMenu = useCallback(
    (id: WindowId, x: number, y: number) => {
      setContextMenu({ windowId: id, x, y });
    },
    [],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // Cycle focus.
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

  // Remove a clip + window. Used by Cmd-Backspace + context-menu Remove.
  const performRemove = useCallback(
    async (id: WindowId) => {
      const w = windowsMap.get(id);
      if (!w) return;
      try {
        const r = await sidecar.removeClip(project.slug, w.clipIdx);
        onProjectChange(r.project);
        // The store's reconcileProject (driven by onProjectChange flowing back
        // through props) will prune the window with the now-removed clipIdx.
        // Also defensively close anything pointing at it.
        if (playingId === id) setPlayingId(null);
        if (focusedId === id) setFocused(null);
        removeWindow(id);
      } catch (e) {
        // Silent failure here — the toast surface lives in MasterToolbar.
        // The confirm dialog re-shows on next attempt.
        // Keeping console.warn for now so the dev sees what broke.
        console.warn("[WindowManager] removeClip failed:", e);
      }
    },
    [windowsMap, project.slug, onProjectChange, removeWindow, setFocused, playingId, focusedId],
  );

  // Single document-level keydown owner.
  useEffect(() => {
    function inTextInput(): boolean {
      const tag = (document.activeElement as HTMLElement | null)?.tagName ?? "";
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    }

    function onKeyDown(e: KeyboardEvent): void {
      // ── Esc cascade ────────────────────────────────────────────────────
      if (e.key === "Escape") {
        if (typeof document !== "undefined" && document.getElementById("__reaction-source-picker")) {
          return;
        }
        for (const w of windowList) {
          // captionsOpen is the workbench-store flag the Edit drawer uses.
          // The drawer's own listener owns Esc when mounted.
          if (w.captionsOpen) return;
        }
        if (contextMenu) {
          e.preventDefault();
          closeContextMenu();
          return;
        }
        if (selection.selectedIds.size > 0) {
          e.preventDefault();
          clearSelection();
          return;
        }
        return;
      }

      // Cmd+A → select all
      if (isMetaKey(e) && e.key.toLowerCase() === "a") {
        if (inTextInput()) return;
        e.preventDefault();
        selectAll();
        return;
      }

      // Cmd+D → clear selection
      if (isMetaKey(e) && e.key.toLowerCase() === "d") {
        if (inTextInput()) return;
        e.preventDefault();
        clearSelection();
        return;
      }

      // Cmd+Backspace → confirm-remove focused tile
      if (isMetaKey(e) && (e.key === "Backspace" || e.key === "Delete")) {
        if (inTextInput()) return;
        if (!focusedId) return;
        e.preventDefault();
        setConfirmRemoveId(focusedId);
        return;
      }

      // Cmd+Enter → MasterToolbar default action (delegated via CustomEvent)
      if (isMetaKey(e) && e.key === "Enter") {
        if (inTextInput()) return;
        e.preventDefault();
        try {
          window.dispatchEvent(new CustomEvent("lc:workbench:master-default"));
        } catch {
          /* sandboxed contexts */
        }
        return;
      }

      // Tab / Shift+Tab → cycle focus
      if (e.key === "Tab" && !isMetaKey(e) && !e.altKey) {
        if (inTextInput()) return;
        if (windowList.length === 0) return;
        e.preventDefault();
        cycleFocus(e.shiftKey ? -1 : 1);
        return;
      }

      // Cmd+` → cycle focus
      if (isMetaKey(e) && e.key === "`") {
        if (windowList.length === 0) return;
        e.preventDefault();
        cycleFocus(e.shiftKey ? -1 : 1);
        return;
      }

      // E → open Edit drawer on focused tile.
      // Keep capital + lower; require no modifier so editing inside the
      // drawer's own inputs doesn't trigger the shortcut.
      if (e.key.toLowerCase() === "e" && !isMetaKey(e) && !e.altKey && !e.shiftKey) {
        if (inTextInput()) return;
        if (!focusedId) return;
        e.preventDefault();
        openEditDrawer(focusedId);
        return;
      }

      // Space → play/pause focused tile.
      if (e.key === " " || e.code === "Space") {
        if (inTextInput()) return;
        if (!focusedId) return;
        e.preventDefault();
        togglePlay(focusedId);
        return;
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    windowList,
    selection.selectedIds,
    contextMenu,
    focusedId,
    clearSelection,
    closeContextMenu,
    selectAll,
    cycleFocus,
    openEditDrawer,
    togglePlay,
  ]);

  // Close the context menu on any outside-click. Capture so it fires before
  // the tile's own click handler — context menu wins.
  useEffect(() => {
    if (!contextMenu) return;
    function onPointer(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("[data-lc-context-menu]")) return;
      closeContextMenu();
    }
    document.addEventListener("mousedown", onPointer, true);
    return () => document.removeEventListener("mousedown", onPointer, true);
  }, [contextMenu, closeContextMenu]);

  // "+ window" popover state.
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
      <MasterToolbar project={project} onProjectChange={onProjectChange} />

      <div
        className="relative grid gap-2 rounded-2xl border border-line bg-paper-warm/30 p-3"
        style={{
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
            <ClipWindow
              windowId={w.id}
              project={project}
              isPlaying={playingId === w.id}
              onActivateContextMenu={openContextMenu}
              onPlayToggle={togglePlay}
            />
          </div>
        ))}

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

      {/* Singleton Edit drawer — only mounts when focused tile has the
          captionsOpen (== "edit drawer open") flag set. */}
      <ClipEditDrawer project={project} onProjectChange={onProjectChange} />

      {/* Singleton right-click context menu. */}
      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          windowState={windowsMap.get(contextMenu.windowId) ?? null}
          project={project}
          onOpenEdit={() => {
            const id = contextMenu.windowId;
            closeContextMenu();
            openEditDrawer(id);
          }}
          onReveal={async () => {
            const w = windowsMap.get(contextMenu.windowId);
            closeContextMenu();
            if (!w) return;
            const clip = project.clips[w.clipIdx];
            const revealPath = clip?.vertical_path || clip?.cut_path || null;
            if (!revealPath) return;
            const sep = revealPath.includes("\\") ? "\\" : "/";
            const idx = revealPath.lastIndexOf(sep);
            const dir = idx > 0 ? revealPath.slice(0, idx) : revealPath;
            try {
              await openExternal(dir);
            } catch (e) {
              console.warn("[WindowManager] reveal failed:", e);
            }
          }}
          onSaveCopy={async () => {
            const w = windowsMap.get(contextMenu.windowId);
            closeContextMenu();
            if (!w) return;
            const clip = project.clips[w.clipIdx];
            const revealPath = clip?.vertical_path || clip?.cut_path || null;
            if (!revealPath) return;
            try {
              const [{ save }, { copyFile }] = await Promise.all([
                import("@tauri-apps/plugin-dialog"),
                import("@tauri-apps/plugin-fs"),
              ]);
              const baseName = (clip?.title || clip?.slug || "clip")
                .replace(/[\\/:*?"<>|]+/g, "_")
                .trim()
                .slice(0, 80) || "clip";
              const dest = await save({
                defaultPath: `${baseName}.mp4`,
                filters: [{ name: "Video", extensions: ["mp4"] }],
              });
              if (!dest) return;
              await copyFile(revealPath, dest);
            } catch (e) {
              console.warn("[WindowManager] save copy failed:", e);
            }
          }}
          onPlayDefault={async () => {
            const w = windowsMap.get(contextMenu.windowId);
            closeContextMenu();
            if (!w) return;
            const clip = project.clips[w.clipIdx];
            const path = clip?.vertical_path || clip?.cut_path;
            if (!path) return;
            try {
              await openExternal(path);
            } catch (e) {
              console.warn("[WindowManager] open external failed:", e);
            }
          }}
          onRemove={() => {
            const id = contextMenu.windowId;
            closeContextMenu();
            setConfirmRemoveId(id);
          }}
          onClose={closeContextMenu}
        />
      )}

      {/* Branded remove-confirm dialog — Cmd-Backspace + context-menu Remove
          both route here. */}
      <ConfirmDialog
        open={confirmRemoveId !== null}
        tone="destructive"
        title="Remove this clip?"
        body="The clip's files on disk go too. This can't be undone."
        confirmLabel="Remove clip"
        cancelLabel="Keep clip"
        onCancel={() => setConfirmRemoveId(null)}
        onConfirm={() => {
          const id = confirmRemoveId;
          setConfirmRemoveId(null);
          if (id) void performRemove(id);
        }}
      />

      {/* Hidden focused-window debug surface — empty placeholder so the
          MasterToolbar's "Edit ▾" button has a focused tile to read. */}
      <span hidden data-focused-window-id={focusedWindow?.id ?? ""} />
    </div>
  );
}

/* ─────────────────────────────── context menu ─────────────────────────────── */

function ContextMenu({
  state,
  windowState,
  project,
  onOpenEdit,
  onReveal,
  onSaveCopy,
  onPlayDefault,
  onRemove,
  onClose,
}: {
  state: ContextMenuState;
  windowState: WindowState | null;
  project: Project;
  onOpenEdit: () => void;
  onReveal: () => void;
  onSaveCopy: () => void;
  onPlayDefault: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const clip = windowState ? project.clips[windowState.clipIdx] : null;
  const hasFile = !!(clip?.vertical_path || clip?.cut_path);

  return (
    <div
      data-lc-context-menu
      role="menu"
      aria-label="Tile actions"
      style={{
        position: "fixed",
        left: state.x,
        top: state.y,
        zIndex: 60,
      }}
      className="min-w-[200px] rounded-md border border-line bg-paper p-1 shadow-2xl"
    >
      <MenuItem onClick={onOpenEdit}>Open Edit</MenuItem>
      <MenuItem onClick={onReveal} disabled={!hasFile}>
        Reveal in Finder
      </MenuItem>
      <MenuItem onClick={onSaveCopy} disabled={!hasFile}>
        Save copy as…
      </MenuItem>
      <MenuItem onClick={onPlayDefault} disabled={!hasFile}>
        Play in default app
      </MenuItem>
      <div className="my-1 h-px bg-line" aria-hidden />
      <MenuItem onClick={onRemove} destructive>
        Remove
      </MenuItem>
      <MenuItem onClick={onClose} subtle>
        Cancel
      </MenuItem>
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  disabled,
  destructive,
  subtle,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  subtle?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={[
        "block w-full rounded-sm px-3 py-1.5 text-left font-sans text-[13px] transition-colors",
        disabled
          ? "cursor-not-allowed text-text-tertiary opacity-50"
          : destructive
          ? "text-[#DC2626] hover:bg-[#DC2626]/10"
          : subtle
          ? "text-text-tertiary hover:text-ink"
          : "text-ink hover:bg-fuchsia-soft/30 hover:text-fuchsia-deep",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
