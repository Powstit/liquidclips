// Cell topology per layout. Each layout has N "cells" that can hold an
// independent video source. One cell's audio wins (or a music bed supersedes).
// Coordinates are in a 0..1 unit square so layouts scale to any output ratio.

import type { OverlayType } from "../../lib/sidecar";
import type { LayoutKey } from "./LayoutIcon";

export type CellRole = "main" | "broll" | "left" | "right" | "inset";

export type Cell = {
  /** stable id within the layout (used for keying + drill-in editing) */
  role: CellRole;
  /** user-friendly label shown in the editor */
  label: string;
  /** 0..1 unit-square rectangle position (x, y, w, h) — for the diagram */
  rect: { x: number; y: number; w: number; h: number };
  /** which cell holds the source clip Junior produced. The main clip is
   *  always exactly one cell — the others can be user-uploaded b-roll. */
  isMain?: boolean;
};

export type LayoutTopology = {
  key: LayoutKey;
  label: string;
  cells: Cell[];
};

export const LAYOUT_TOPOLOGY: Record<LayoutKey, LayoutTopology> = {
  none: {
    key: "none",
    label: "Full frame",
    cells: [
      { role: "main", label: "Main clip", rect: { x: 0, y: 0, w: 1, h: 1 }, isMain: true },
    ],
  },
  "stack-bottom": {
    key: "stack-bottom",
    label: "Stack below",
    // v0.7.46 — 30 / 70 split (reactor top, viral bottom). The viral source
    // is the proven canvas and must dominate; the reactor is a 30% header.
    // Keep the ffmpeg filter (_build_overlay_filter in stages.py) in sync.
    cells: [
      { role: "main",  label: "Top — reactor (30%)",       rect: { x: 0, y: 0,   w: 1, h: 0.3 }, isMain: true },
      { role: "broll", label: "Bottom — viral source (70%)", rect: { x: 0, y: 0.3, w: 1, h: 0.7 } },
    ],
  },
  "stack-top": {
    key: "stack-top",
    label: "Stack above",
    // v0.7.46 — 70 / 30 split: viral source on top (70%), reactor below
    // (30%). Same editorial intent as stack-bottom, flipped vertical order.
    cells: [
      { role: "broll", label: "Top — viral source (70%)",  rect: { x: 0, y: 0,   w: 1, h: 0.7 } },
      { role: "main",  label: "Bottom — reactor (30%)",    rect: { x: 0, y: 0.7, w: 1, h: 0.3 }, isMain: true },
    ],
  },
  "split-left": {
    key: "split-left",
    label: "Split left",
    cells: [
      { role: "broll", label: "Left — reaction",     rect: { x: 0,   y: 0, w: 0.5, h: 1 } },
      { role: "main",  label: "Right — main clip",   rect: { x: 0.5, y: 0, w: 0.5, h: 1 }, isMain: true },
    ],
  },
  "split-right": {
    key: "split-right",
    label: "Split right",
    cells: [
      { role: "main",  label: "Left — main clip",    rect: { x: 0,   y: 0, w: 0.5, h: 1 }, isMain: true },
      { role: "broll", label: "Right — reaction",    rect: { x: 0.5, y: 0, w: 0.5, h: 1 } },
    ],
  },
  "pip-br": {
    key: "pip-br",
    label: "PiP right",
    cells: [
      { role: "main",  label: "Full — main clip",       rect: { x: 0, y: 0,   w: 1, h: 1 },   isMain: true },
      { role: "inset", label: "Inset — bottom right",   rect: { x: 0.6, y: 0.65, w: 0.36, h: 0.32 } },
    ],
  },
  "pip-bl": {
    key: "pip-bl",
    label: "PiP left",
    cells: [
      { role: "main",  label: "Full — main clip",      rect: { x: 0, y: 0,   w: 1, h: 1 },   isMain: true },
      { role: "inset", label: "Inset — bottom left",   rect: { x: 0.04, y: 0.65, w: 0.36, h: 0.32 } },
    ],
  },
  "pip-tr-circle": {
    key: "pip-tr-circle",
    label: "Circle top-right",
    // v0.7.46 — viral source fills the frame; reactor sits as a soft-edged
    // circle (~25% diameter) in the top-right so the content stays the
    // primary read. ffmpeg filter at stages._build_overlay_filter.
    cells: [
      { role: "main",  label: "Full — viral source",   rect: { x: 0, y: 0, w: 1, h: 1 }, isMain: true },
      { role: "inset", label: "Top-right — reactor (circle)", rect: { x: 0.71, y: 0.04, w: 0.25, h: 0.25 } },
    ],
  },
};

// What a cell's audio + source resolves to. Stored on the clip as a sibling of
// the existing `overlay` field; we evolve `overlay.cells[role]` as the canon.
export type CellState = {
  source_path: string | null;   // null = no b-roll picked yet
  audio: "this" | "muted";       // "this" = play this cell's audio
};

export type CellsMap = Partial<Record<CellRole, CellState>>;

export function cellsForLayout(kind: LayoutKey): Cell[] {
  return LAYOUT_TOPOLOGY[kind].cells;
}

export function topologyLabel(kind: LayoutKey): string {
  return LAYOUT_TOPOLOGY[kind].label;
}

// Type guards so the editor doesn't crash on a layout key the backend hasn't
// caught up with yet (e.g. when we ship split-h later).
export function isKnownLayout(kind: string): kind is LayoutKey {
  return kind in LAYOUT_TOPOLOGY;
}

export function overlayTypeOf(kind: LayoutKey): OverlayType | null {
  return kind === "none" ? null : (kind as OverlayType);
}
