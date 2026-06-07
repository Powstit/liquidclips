// ship-lens v0.7.8: W4+W5 — drop view/setView (no Grid mode) + drop ActiveVideoPool/promoteToPool/MAX_ACTIVE_VIDEOS (WindowManager owns singleton playingId).
// Workbench Zustand store.
//
// Single source of truth for the workbench surface:
//   - windows: Map<WindowId, WindowState>  (live editor tiles on the canvas)
//   - selection: which ids are selected, which is focused
//   - lastProjectSlug/lastClipCount: lets us reconcile when the user switches
//     projects without re-mounting the workbench.
//
// All mutators are synchronous + pure. After each mutator we schedule a 250ms
// debounced write to localStorage via ./persistedSession. We also register
// the store with persistedSession's beforeunload flush so an unclean close
// still saves the user's session.
//
// Video playback: at most ONE <video> mounts per canvas at any time —
// WindowManager owns a singleton `playingId` (useState) and ClipWindow
// reads it via prop. The old ActiveVideoPool / promoteToPool / pool
// eviction policy is gone (v0.7.8 W5) because the singleton makes the
// pool a 1-element list with no eviction decision left to make.

import { create } from "zustand";
import type {
  PersistedSession,
  Project,
  SelectionModel,
  WindowId,
  WindowState,
  WorkbenchStore,
} from "./types";
import {
  CANVAS_GRID_COLS,
  CANVAS_GRID_ROWS,
  LC_WORKBENCH_SCHEMA_VERSION,
  MAX_WINDOW_SIZE,
  MIN_WINDOW_SIZE,
} from "./types";
import {
  flush,
  read as readPersisted,
  setFlushSource,
} from "./persistedSession";

// ---------------------------------------------------------------------------
// helpers

const DEBOUNCE_MS = 250;

function newId(): WindowId {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback: monotonically unique-enough for tests / non-secure contexts.
  return `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function clampSize(size: { w: number; h: number }): { w: number; h: number } {
  return {
    w: Math.max(MIN_WINDOW_SIZE.w, Math.min(MAX_WINDOW_SIZE.w, Math.floor(size.w))),
    h: Math.max(MIN_WINDOW_SIZE.h, Math.min(MAX_WINDOW_SIZE.h, Math.floor(size.h))),
  };
}

function clampPos(pos: { col: number; row: number }, size: { w: number; h: number }): { col: number; row: number } {
  const col = Math.max(0, Math.min(CANVAS_GRID_COLS - size.w, Math.floor(pos.col)));
  const row = Math.max(0, Math.min(CANVAS_GRID_ROWS - size.h, Math.floor(pos.row)));
  return { col, row };
}

/** Find the first free 2x2 slot in the 8x8 grid scanning row-major. */
function findFreeSlot(
  windows: Map<WindowId, WindowState>,
  size: { w: number; h: number } = { w: MIN_WINDOW_SIZE.w, h: MIN_WINDOW_SIZE.h },
): { col: number; row: number } | null {
  const occ: boolean[][] = Array.from({ length: CANVAS_GRID_ROWS }, () =>
    new Array(CANVAS_GRID_COLS).fill(false),
  );
  for (const w of windows.values()) {
    for (let r = w.pos.row; r < w.pos.row + w.size.h && r < CANVAS_GRID_ROWS; r += 1) {
      for (let c = w.pos.col; c < w.pos.col + w.size.w && c < CANVAS_GRID_COLS; c += 1) {
        if (r >= 0 && c >= 0) occ[r][c] = true;
      }
    }
  }
  for (let r = 0; r + size.h <= CANVAS_GRID_ROWS; r += 1) {
    for (let c = 0; c + size.w <= CANVAS_GRID_COLS; c += 1) {
      let free = true;
      for (let rr = r; rr < r + size.h && free; rr += 1) {
        for (let cc = c; cc < c + size.w && free; cc += 1) {
          if (occ[rr][cc]) free = false;
        }
      }
      if (free) return { col: c, row: r };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// snapshot <-> persisted state

function snapshotToPersisted(state: WorkbenchStore): PersistedSession {
  const byProject: PersistedSession["byProject"] = {
    // Start from whatever was persisted so projects we haven't touched this
    // session aren't blown away when we save.
    ...readPersisted().byProject,
  };
  if (state.lastProjectSlug) {
    byProject[state.lastProjectSlug] = {
      windows: Array.from(state.windows.values()).map((w) => ({
        id: w.id,
        clipIdx: w.clipIdx,
        pos: w.pos,
        size: w.size,
        manual: w.manual,
        boundChannelIds: [...w.boundChannelIds],
        ratio: w.ratio,
      })),
      selectedIds: Array.from(state.selection.selectedIds),
      focusedId: state.selection.focusedId,
    };
  }
  return {
    version: LC_WORKBENCH_SCHEMA_VERSION,
    byProject,
  };
}

function hydrateForProject(
  persisted: PersistedSession,
  slug: string,
  clipCount: number,
): { windows: Map<WindowId, WindowState>; selection: SelectionModel } {
  const entry = persisted.byProject[slug];
  const windows = new Map<WindowId, WindowState>();
  if (!entry) {
    return {
      windows,
      selection: { selectedIds: new Set(), focusedId: null },
    };
  }
  for (const w of entry.windows) {
    if (w.clipIdx < 0 || w.clipIdx >= clipCount) continue;
    const size = clampSize(w.size);
    const pos = clampPos(w.pos, size);
    windows.set(w.id, {
      id: w.id,
      clipIdx: w.clipIdx,
      pos,
      size,
      manual: !!w.manual,
      boundChannelIds: Array.isArray(w.boundChannelIds) ? [...w.boundChannelIds] : [],
      captionsOpen: false, // never restore an open drawer — always start closed
      ratio: w.ratio ?? null,
    });
  }
  const selectedIds = new Set<WindowId>();
  for (const id of entry.selectedIds) if (windows.has(id)) selectedIds.add(id);
  const focusedId = entry.focusedId && windows.has(entry.focusedId) ? entry.focusedId : null;
  return { windows, selection: { selectedIds, focusedId } };
}

// ---------------------------------------------------------------------------
// debounced persistence

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let getStateRef: (() => WorkbenchStore) | null = null;

function schedulePersist(): void {
  if (!getStateRef) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const fn = getStateRef;
    if (!fn) return;
    flush(snapshotToPersisted(fn()));
  }, DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// initial state from persisted blob (synchronous so first render is correct)

const initialWindows: Map<WindowId, WindowState> = new Map();
const initialSelection: SelectionModel = { selectedIds: new Set(), focusedId: null };

// ---------------------------------------------------------------------------
// store

export const useWorkbenchStore = create<WorkbenchStore>((set) => ({
  windows: initialWindows,
  selection: initialSelection,
  lastProjectSlug: null,
  lastClipCount: 0,

  addWindow(clipIdx) {
    const id = newId();
    const size = { w: MIN_WINDOW_SIZE.w, h: MIN_WINDOW_SIZE.h };
    set((s) => {
      const slot = findFreeSlot(s.windows, size);
      const pos = slot ?? { col: CANVAS_GRID_COLS - size.w, row: CANVAS_GRID_ROWS - size.h };
      const manual = slot === null;
      const next: WindowState = {
        id,
        clipIdx,
        pos,
        size,
        manual,
        boundChannelIds: [],
        captionsOpen: false,
        ratio: null,
      };
      const windows = new Map(s.windows);
      windows.set(id, next);
      return { windows };
    });
    schedulePersist();
    return id;
  },

  removeWindow(id) {
    set((s) => {
      if (!s.windows.has(id)) return s;
      const windows = new Map(s.windows);
      windows.delete(id);
      const selectedIds = new Set(s.selection.selectedIds);
      selectedIds.delete(id);
      const focusedId = s.selection.focusedId === id ? null : s.selection.focusedId;
      return {
        windows,
        selection: { selectedIds, focusedId },
      };
    });
    schedulePersist();
  },

  moveWindow(id, pos) {
    set((s) => {
      const w = s.windows.get(id);
      if (!w) return s;
      const nextPos = clampPos(pos, w.size);
      if (nextPos.col === w.pos.col && nextPos.row === w.pos.row) return s;
      const windows = new Map(s.windows);
      windows.set(id, { ...w, pos: nextPos, manual: true });
      return { windows };
    });
    schedulePersist();
  },

  resizeWindow(id, size) {
    set((s) => {
      const w = s.windows.get(id);
      if (!w) return s;
      const nextSize = clampSize(size);
      const nextPos = clampPos(w.pos, nextSize);
      if (nextSize.w === w.size.w && nextSize.h === w.size.h
        && nextPos.col === w.pos.col && nextPos.row === w.pos.row) return s;
      const windows = new Map(s.windows);
      windows.set(id, { ...w, size: nextSize, pos: nextPos, manual: true });
      return { windows };
    });
    schedulePersist();
  },

  bindChannels(id, channelIds) {
    set((s) => {
      const w = s.windows.get(id);
      if (!w) return s;
      const windows = new Map(s.windows);
      windows.set(id, { ...w, boundChannelIds: [...channelIds] });
      return { windows };
    });
    schedulePersist();
  },

  setCaptionsOpen(id, open) {
    set((s) => {
      const target = s.windows.get(id);
      if (!target) return s;
      const windows = new Map(s.windows);
      if (open) {
        // INVARIANT: at most one drawer open at a time.
        for (const [wid, w] of s.windows) {
          if (wid === id) continue;
          if (w.captionsOpen) windows.set(wid, { ...w, captionsOpen: false });
        }
      }
      if (target.captionsOpen !== open) {
        windows.set(id, { ...target, captionsOpen: open });
      }
      return { windows };
    });
    schedulePersist();
  },

  setRatio(id, ratio) {
    set((s) => {
      const w = s.windows.get(id);
      if (!w) return s;
      if (w.ratio === ratio) return s;
      const windows = new Map(s.windows);
      windows.set(id, { ...w, ratio });
      return { windows };
    });
    schedulePersist();
  },

  toggleSelected(id) {
    set((s) => {
      if (!s.windows.has(id)) return s;
      const selectedIds = new Set(s.selection.selectedIds);
      if (selectedIds.has(id)) selectedIds.delete(id);
      else selectedIds.add(id);
      return { selection: { ...s.selection, selectedIds } };
    });
    schedulePersist();
  },

  selectAll() {
    set((s) => {
      const selectedIds = new Set<WindowId>(s.windows.keys());
      return { selection: { ...s.selection, selectedIds } };
    });
    schedulePersist();
  },

  clearSelection() {
    set((s) => {
      if (s.selection.selectedIds.size === 0 && s.selection.focusedId === null) return s;
      return { selection: { selectedIds: new Set(), focusedId: null } };
    });
    schedulePersist();
  },

  setFocused(id) {
    set((s) => {
      if (id !== null && !s.windows.has(id)) return s;
      if (s.selection.focusedId === id) return s;
      return { selection: { ...s.selection, focusedId: id } };
    });
    // focus does not change persisted output beyond selection; still save.
    schedulePersist();
  },

  reconcileProject(project: Project) {
    const slug = project.slug;
    const clipCount = project.clips.length;
    set((s) => {
      if (s.lastProjectSlug === slug) {
        // Same project — only filter out windows whose clipIdx fell off the end
        // (e.g. a clip was removed from the project).
        const windows = new Map<WindowId, WindowState>();
        for (const [id, w] of s.windows) {
          if (w.clipIdx < 0 || w.clipIdx >= clipCount) continue;
          windows.set(id, w);
        }
        const selectedIds = new Set<WindowId>();
        for (const id of s.selection.selectedIds) if (windows.has(id)) selectedIds.add(id);
        const focusedId = s.selection.focusedId && windows.has(s.selection.focusedId)
          ? s.selection.focusedId : null;
        return {
          windows,
          selection: { selectedIds, focusedId },
          lastClipCount: clipCount,
        };
      }
      // Project switch — hydrate windows from persisted state for this project.
      const persisted = readPersisted();
      const { windows, selection } = hydrateForProject(persisted, slug, clipCount);
      return {
        windows,
        selection,
        lastProjectSlug: slug,
        lastClipCount: clipCount,
      };
    });
    schedulePersist();
  },
}));

// Wire the store into the persisted-session module so beforeunload can flush
// the current snapshot without taking a circular import.
getStateRef = () => useWorkbenchStore.getState();
setFlushSource(() => snapshotToPersisted(useWorkbenchStore.getState()));

// Type-only exports for sibling files.
export type { WorkbenchStore } from "./types";
export type { RatioKey } from "../../lib/sidecar";
