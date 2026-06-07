// ship-lens v0.7.8: W4+W5 — drop dead `view` union (no Grid mode) + drop dead ActiveVideoPool/MAX_ACTIVE_VIDEOS (singleton playingId in WindowManager replaces the pool).
// Workbench shared types + constants.
//
// Single source of truth for the workbench feature surface. Agents 2-5
// (ClipPreview, ResultsGrid, MasterToolbar, hover/keyboard wiring) import
// everything from here. No runtime side-effects.

import type { Clip, Project, RatioKey } from "../../lib/sidecar";
import type { CaptionStyleKey, CaptionPalette } from "../../lib/caption-styles";
import type { LayoutKey } from "../clips-feed/LayoutIcon";

export type WindowId = string; // crypto.randomUUID()

export type WindowState = {
  id: WindowId;
  clipIdx: number;
  pos: { col: number; row: number };
  size: { w: number; h: number };
  manual: boolean;
  boundChannelIds: string[];
  captionsOpen: boolean;
  ratio: RatioKey | null;
};

export type SelectionModel = {
  selectedIds: Set<WindowId>;
  focusedId: WindowId | null;
};

export type MasterAction =
  | { kind: "apply_caption_style"; style: CaptionStyleKey; palette?: CaptionPalette }
  | { kind: "apply_layout"; layout: LayoutKey; sourcePath?: string }
  | { kind: "apply_ratio"; ratio: RatioKey }
  | { kind: "schedule"; channels: string[]; when: "now" | "1h" | "24h"; captionOverride?: string }
  | { kind: "remove" };

export type MasterActionResult = {
  ok: WindowId[];
  failed: Array<{ id: WindowId; clipIdx: number; reason: string }>;
};

export type WorkbenchStore = {
  windows: Map<WindowId, WindowState>;
  selection: SelectionModel;
  lastProjectSlug: string | null;
  lastClipCount: number;
  addWindow(clipIdx: number): WindowId;
  removeWindow(id: WindowId): void;
  moveWindow(id: WindowId, pos: { col: number; row: number }): void;
  resizeWindow(id: WindowId, size: { w: number; h: number }): void;
  bindChannels(id: WindowId, channelIds: string[]): void;
  setCaptionsOpen(id: WindowId, open: boolean): void;
  setRatio(id: WindowId, ratio: RatioKey | null): void;
  toggleSelected(id: WindowId): void;
  selectAll(): void;
  clearSelection(): void;
  setFocused(id: WindowId | null): void;
  reconcileProject(project: Project): void;
};

export type PersistedSession = {
  version: 1;
  byProject: Record<string, {
    windows: Array<Pick<WindowState, "id" | "clipIdx" | "pos" | "size" | "manual" | "boundChannelIds" | "ratio">>;
    selectedIds: WindowId[];
    focusedId: WindowId | null;
  }>;
};

export const LC_WORKBENCH_PREF_KEY = "lc:workbench_session_v1";
export const LC_WORKBENCH_SCHEMA_VERSION = 1 as const;
export const MIN_WINDOW_SIZE = { w: 2, h: 2 } as const;
export const MAX_WINDOW_SIZE = { w: 8, h: 8 } as const;
export const CANVAS_GRID_COLS = 8 as const;
export const CANVAS_GRID_ROWS = 8 as const;
export const WORKBENCH_MIN_WIDTH_PX = 1024 as const;

// Re-export referenced types so siblings can `import { Clip } from "./types"`
// without reaching into lib/. Keeps the workbench feature surface self-contained.
export type { Clip, Project, RatioKey, CaptionStyleKey, CaptionPalette, LayoutKey };
