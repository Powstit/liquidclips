// Caption editor state — used by CaptionDrawer + CaptionOverlay.
//
// Each clip's caption state lives in two places:
//   1. Persisted on disk by the sidecar — project.root/captions/{idx}-edits.json
//   2. In-memory while the drawer is open (this module).
//
// Undo/redo is local-only; persistence happens on Save (the "Apply · re-render"
// CTA fires `edit_captions` RPC which atomically replaces the rendered MP4).

import type { CaptionPalette, CaptionStyleKey } from "./caption-styles";

export type CaptionWord = {
  start: number;
  end: number;
  text: string;
};

export type CaptionLine = {
  /** Clip-relative seconds. */
  start: number;
  end: number;
  text: string;
  /** Optional per-word timings — present when the line came from the
   * AI transcript. Missing on lines the user added manually; the bake
   * treats those as a single karaoke chunk over the full line duration. */
  words?: CaptionWord[];
  /** ASR confidence (0..1). Lines below 0.7 get a verify chip in the drawer. */
  confidence?: number;
  /** True if the user has changed the text or timing since AI gen.
   * Used to render the "modified" pip and to suppress auto-fix on next load. */
  modified?: boolean;
};

export type CaptionState = {
  clipIdx: number;
  style: CaptionStyleKey;
  lines: CaptionLine[];
  /** Per-platform length budget for the length advisor in the footer. */
  totalChars: number;
  /** Server-side sync state. */
  syncStatus: "synced" | "dirty" | "baking" | "error";
  updatedAt?: string | null;
  /** Source — "edits" means we loaded the user's persisted version,
   * "transcript" means this is the first time the drawer opens for this clip. */
  source: "edits" | "transcript";
  /** User-picked palette overrides for primary / secondary / outline.
   *  Active when `style === "custom"`. When the user toggles off Custom we
   *  KEEP this in state so a later toggle-back restores the same swatches —
   *  the sidecar only persists it when the bake style is also "custom". */
  palette?: CaptionPalette;
  /** ASS text the last bake produced. Drives the libass-wasm preview so
   *  what the clipper sees during edit matches the rendered MP4 1:1. */
  assText?: string;
};

export type CaptionPatch =
  | { kind: "text"; idx: number; value: string }
  | { kind: "time"; idx: number; start: number; end: number }
  | { kind: "style"; value: CaptionStyleKey }
  | { kind: "palette"; value: CaptionPalette }
  | { kind: "add"; afterIdx: number; line: CaptionLine }
  | { kind: "delete"; idx: number }
  | { kind: "reset-line"; idx: number; from: CaptionLine };

// ---- Apply patches to a state ---------------------------------------------

export function applyPatch(state: CaptionState, p: CaptionPatch): CaptionState {
  switch (p.kind) {
    case "text": {
      const lines = state.lines.map((ln, i) =>
        i === p.idx ? { ...ln, text: p.value, modified: true } : ln,
      );
      return { ...state, lines, totalChars: charsTotal(lines), syncStatus: "dirty" };
    }
    case "time": {
      const lines = state.lines.map((ln, i) =>
        i === p.idx ? { ...ln, start: p.start, end: p.end, modified: true } : ln,
      );
      return { ...state, lines, syncStatus: "dirty" };
    }
    case "style":
      return { ...state, style: p.value, syncStatus: "dirty" };
    case "palette":
      // Merge — partial palettes (just one swatch changed) keep the others.
      // The undo stack picks up the new state via the same dirty flip as
      // every other patch so Cmd-Z reverses colour edits too.
      return {
        ...state,
        palette: { ...(state.palette ?? {}), ...p.value },
        syncStatus: "dirty",
      };
    case "add": {
      const lines = [...state.lines];
      lines.splice(p.afterIdx + 1, 0, { ...p.line, modified: true });
      return { ...state, lines, totalChars: charsTotal(lines), syncStatus: "dirty" };
    }
    case "delete": {
      const lines = state.lines.filter((_, i) => i !== p.idx);
      return { ...state, lines, totalChars: charsTotal(lines), syncStatus: "dirty" };
    }
    case "reset-line": {
      const lines = state.lines.map((ln, i) =>
        i === p.idx ? { ...p.from, modified: false } : ln,
      );
      return { ...state, lines, totalChars: charsTotal(lines), syncStatus: "dirty" };
    }
  }
}

function charsTotal(lines: CaptionLine[]): number {
  return lines.reduce((sum, ln) => sum + (ln.text?.length ?? 0), 0);
}

// ---- Undo / redo stack ----------------------------------------------------

export type HistoryEntry = { state: CaptionState };

export class History {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];

  push(state: CaptionState) {
    this.past.push({ state });
    this.future = [];
    if (this.past.length > 64) this.past.shift();
  }

  undo(current: CaptionState): CaptionState | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push({ state: current });
    return prev.state;
  }

  redo(current: CaptionState): CaptionState | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push({ state: current });
    return next.state;
  }

  canUndo(): boolean { return this.past.length > 0; }
  canRedo(): boolean { return this.future.length > 0; }
}

// ---- ASR auto-fix ---------------------------------------------------------

/** Common ASR mistakes a clipper sees over and over. Run on initial load only;
 * lines flagged `modified` are skipped (user edits take priority). */
const ASR_FIXES: { pattern: RegExp; replacement: string }[] = [
  { pattern: /\bi\b/g, replacement: "I" },
  { pattern: /\bim\b/g, replacement: "I'm" },
  { pattern: /\bdont\b/gi, replacement: "don't" },
  { pattern: /\bcant\b/gi, replacement: "can't" },
  { pattern: /\bwont\b/gi, replacement: "won't" },
  { pattern: /\byoure\b/gi, replacement: "you're" },
  { pattern: /\btheyre\b/gi, replacement: "they're" },
  { pattern: /\bisnt\b/gi, replacement: "isn't" },
  { pattern: /\barent\b/gi, replacement: "aren't" },
  { pattern: /\bdidnt\b/gi, replacement: "didn't" },
  { pattern: /\bwasnt\b/gi, replacement: "wasn't" },
  { pattern: /\bdoesnt\b/gi, replacement: "doesn't" },
];

export function autoFix(text: string): { text: string; changed: boolean } {
  let result = text;
  let changed = false;
  for (const { pattern, replacement } of ASR_FIXES) {
    const next = result.replace(pattern, replacement);
    if (next !== result) { changed = true; result = next; }
  }
  return { text: result, changed };
}

export function autoFixLines(lines: CaptionLine[]): { lines: CaptionLine[]; count: number } {
  let count = 0;
  const next = lines.map((ln) => {
    if (ln.modified) return ln;
    const fix = autoFix(ln.text);
    if (fix.changed) count += 1;
    return fix.changed ? { ...ln, text: fix.text } : ln;
  });
  return { lines: next, count };
}

// ---- Profanity gate (PG mode) ---------------------------------------------

const PROFANITY = new Set([
  "fuck", "shit", "bitch", "cunt", "dick", "asshole", "bastard", "damn",
]);

export function redactProfanity(text: string): string {
  return text.replace(/\b[\w']+\b/g, (word) =>
    PROFANITY.has(word.toLowerCase()) ? "***" : word,
  );
}

// ---- Platform length advisor ----------------------------------------------

export type LengthVerdict = "ok" | "long" | "short";

export type PlatformLengthOpinion = {
  platform: "tiktok" | "reels" | "shorts" | "x" | "youtube";
  verdict: LengthVerdict;
};

/** Per-platform soft caps on caption character count. Not blockers — just
 * informs the user. Numbers from common-sense observation, not platform docs. */
const PLATFORM_CAPS = [
  { platform: "tiktok" as const, soft: 110 },
  { platform: "reels" as const, soft: 130 },
  { platform: "shorts" as const, soft: 140 },
  { platform: "x" as const, soft: 220 },
  { platform: "youtube" as const, soft: 320 },
];

export function lengthOpinion(totalChars: number): PlatformLengthOpinion[] {
  return PLATFORM_CAPS.map(({ platform, soft }) => ({
    platform,
    verdict: totalChars > soft ? "long" : totalChars < 6 ? "short" : "ok",
  }));
}
