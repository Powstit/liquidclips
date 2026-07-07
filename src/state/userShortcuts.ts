// User-added scheduling shortcuts store · Stage 8+ port from
// docs/ui-master/mockups/browser_overlay_mockup.html (verified visually
// as "green" before this port). Ships alongside the existing
// browseOverlay store so the BrowseOverlay Sovereign Scheduling Station
// rail can render the three default platform icons + up to 3 user-added
// shortcuts. Persistence lifts the mockup's localStorage key verbatim
// so an install upgrade from mock-page usage (unlikely) would carry the
// same rows.
//
// Zero-touch on `useBrowseOverlay`; the BrowseOverlay component reads
// both stores side-by-side.

import { create } from "zustand";

/* ==================================================================
 * Public constants
 * ================================================================== */

/** Cap chosen to fit the 90vw × 88vh preview overlay height at the
 *  76-px rail width without vertical scroll — mirrors the mockup. Bump
 *  this + rail height CSS together if you widen the rail. */
export const USER_SHORTCUT_MAX_TOTAL = 6;

/** Number of platform icons hard-mounted in the rail (TikTok /
 *  YouTube / Instagram). User shortcuts share the same cap so the
 *  total is bounded. */
export const USER_SHORTCUT_DEFAULT_COUNT = 3;

const STORAGE_KEY = "lc.scheduler.shortcuts.v1";
const HTTPS_URL_RE = /^https?:\/\/\S+/i;

/* ==================================================================
 * Types
 * ================================================================== */

export interface UserShortcut {
  id: string;
  label: string;
  url: string;
}

export type AddShortcutResult =
  | { ok: true; shortcut: UserShortcut }
  | { ok: false; error: string };

interface UserShortcutsState {
  shortcuts: UserShortcut[];
  /** Add a new shortcut. Returns `{ ok:false, error }` on:
   *    · empty / whitespace-only label
   *    · URL not matching `^https?://\S+`
   *    · cap reached (isFull() === true) */
  add: (label: string, url: string) => AddShortcutResult;
  /** Remove by id · no-op when the id isn't present. */
  remove: (id: string) => void;
  /** Convenience read of `total() >= MAX_TOTAL`. */
  isFull: () => boolean;
  /** Live total = defaults + user shortcuts. */
  total: () => number;
}

/* ==================================================================
 * Helpers
 * ================================================================== */

function canUseDom(): boolean {
  return typeof window !== "undefined";
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "s_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }
}

function isRecord(value: unknown): value is UserShortcut {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<UserShortcut>;
  return (
    typeof r.id === "string"
    && typeof r.label === "string"
    && typeof r.url === "string"
  );
}

function loadInitial(): UserShortcut[] {
  if (!canUseDom()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Cap enforcement on load · a corrupted / manually-edited store
    // that carries more than MAX_TOTAL - DEFAULT_COUNT shortcuts is
    // truncated so the UI never overflows the rail.
    const valid = parsed.filter(isRecord);
    return valid.slice(0, USER_SHORTCUT_MAX_TOTAL - USER_SHORTCUT_DEFAULT_COUNT);
  } catch {
    return [];
  }
}

function persist(list: UserShortcut[]): void {
  if (!canUseDom()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // private mode / quota — degrade silently, matching browseOverlay.ts.
  }
}

/* ==================================================================
 * Store
 * ================================================================== */

export const useUserShortcuts = create<UserShortcutsState>((set, get) => ({
  shortcuts: loadInitial(),

  add: (label, url) => {
    const trimmedLabel = (label ?? "").trim();
    const trimmedUrl = (url ?? "").trim();
    if (!trimmedLabel) {
      return { ok: false, error: "Name can't be empty." };
    }
    if (!HTTPS_URL_RE.test(trimmedUrl)) {
      return { ok: false, error: "URL must start with http:// or https://" };
    }
    const current = get().shortcuts;
    if (USER_SHORTCUT_DEFAULT_COUNT + current.length >= USER_SHORTCUT_MAX_TOTAL) {
      return {
        ok: false,
        error: `Shortcut cap reached (${USER_SHORTCUT_MAX_TOTAL}). Remove one to add another.`,
      };
    }
    const shortcut: UserShortcut = {
      id: newId(),
      label: trimmedLabel,
      url: trimmedUrl,
    };
    const next = current.concat(shortcut);
    persist(next);
    set({ shortcuts: next });
    return { ok: true, shortcut };
  },

  remove: (id) => {
    const current = get().shortcuts;
    const next = current.filter((s) => s.id !== id);
    if (next.length === current.length) return;
    persist(next);
    set({ shortcuts: next });
  },

  isFull: () => USER_SHORTCUT_DEFAULT_COUNT + get().shortcuts.length >= USER_SHORTCUT_MAX_TOTAL,
  total: () => USER_SHORTCUT_DEFAULT_COUNT + get().shortcuts.length,
}));

/* ==================================================================
 * Grapheme-aware first-letter monogram helper — exported for the rail
 * icon renderer + any future consumers.
 * ================================================================== */

export function firstGraphemeUpper(label: string): string {
  const trimmed = (label ?? "").trim();
  if (!trimmed) return "?";
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Seg: any = (Intl as unknown as { Segmenter?: unknown }).Segmenter;
    if (Seg) {
      const seg = new Seg("en", { granularity: "grapheme" });
      for (const s of seg.segment(trimmed)) {
        return String(s.segment).toUpperCase();
      }
    }
  } catch {
    /* fall through */
  }
  return trimmed[0].toUpperCase();
}
