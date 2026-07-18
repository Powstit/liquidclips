/**
 * CockpitContext · UI-2 + BUG-031 persistence
 *
 * Per-clip cockpit settings. As of BUG-031 (Patch A): every section
 * (reaction / caption / trim / style / schedule / publish) round-trips
 * through `clipSettingsStore` (localStorage, keyed by `${slug}:${clipIdx}`),
 * so edits survive tab switch, clip switch, and reload.
 *
 * Seed order on mount / clip-switch:
 *   1. Read store entry for `(slug, clip.idx)`.
 *   2. Deep-merge over LLM-derived defaults (caption text from clip.title,
 *      trim from clip.start/end, etc.).
 *   3. If no entry exists or slug is missing, return defaults unchanged.
 *
 * No sidecar, no engine. UI/state layer only.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Clip, Platform } from "../types";
import * as clipSettingsStore from "./clipSettingsStore";

export type ReactionLayoutKey =
  | "solo" | "side-by-side" | "top-bottom"
  | "pip-tl" | "pip-tr" | "pip-bl" | "pip-br"
  // Phase 1c · Composer route extension. `full-overlay` covers the
  // "reaction takes the entire canvas · source ducks under" layout the
  // Composer simulator ships. Additive only · existing renderer branches
  // still default to `solo` for unknown values via normalizeReactionLayout.
  | "full-overlay";

export type ReactionAudioSource = "main" | "broll" | "muted";

export type CaptionStyleKey =
  | "fuchsia-pop" | "mono-clean" | "amber-soft" | "cyan-bold";

export type CaptionPositionKey = "top" | "mid" | "bottom";

export type StylePresetKey = "uncle-daniel" | "mono" | "loud";
export type StyleAccentKey = "fuchsia" | "cyan" | "amber";

export type ScheduleLane = "tiktok" | "youtube" | "instagram" | "x";
export type ScheduleRepeat = "none" | "daily" | "weekly";

export type ExportFormatKey = "mp4" | "mov";
export type ExportPresetKey = "9:16 · 1080p" | "1:1 · 1080p" | "16:9 · 1080p";

/**
 * Phase 1c · Composer additive extensions.
 *
 * Every field the 12 Composer flow-panels touch that doesn't already live
 * in one of the six existing sections lands here. All fields are optional
 * so old persisted clip entries load clean — the seed path spreads the
 * saved bag over an empty default, and any absent key stays undefined.
 *
 * Nothing in the existing renderer / export contract reads these yet; they
 * are the state ledger for the Composer route's Base Window dev panel.
 */
/* ═════════════════════════════════════════════════════════════════════
   IRON GATE IG-COMPOSER-E · Session persistence contract · LOCKED 2026-07-18
   ─────────────────────────────────────────────────────────────────────
   Composer state persists per-clip via CockpitContext's clipSettingsStore.
   The `baseWindow` field is the ledger for Composer-only fields that
   don't fit in the six legacy CockpitSettings sections. Contract:
     1. `ComposerBaseWindow` interface is an OPTIONAL bag on
        CockpitSettings (line ~141) so old persisted clip entries load
        cleanly · missing key becomes undefined not a runtime error.
     2. Every field on ComposerBaseWindow MUST be optional (`?:`).
        Non-optional fields break v0.7-era clip loads.
     3. `seedFor()` merges `saved.baseWindow` OVER the default empty
        object · custom fields persist across mount/clip-switch.
     4. `setBaseWindow` is a partial-patch setter · calls
        `clipSettingsStore.write(slug, clip.idx, { baseWindow })` so
        every Composer write immediately hits localStorage.
     5. Storage key format stays `${slug}:${clipIdx}` · matches every
        other CockpitSettings section so opt-in/opt-out doesn't fork
        the persistence namespace.
   Removing the `baseWindow` field silently drops every voice/text
   command Composer wrote (aspect, layout, regions, etc). Reversing the
   default `?:` optionality means every legacy clip open crashes.
   Regression test `CockpitContext.baseWindow.test.ts` + lint
   invariants #37–42 enforce.
   ═════════════════════════════════════════════════════════════════════ */
export interface ComposerBaseWindow {
  // ── Reaction extensions ─────────────────────────────────────────
  mainVolume?: number;       // 0-100 · default 70
  reactionVolume?: number;   // 0-100 · default 85
  autoSwitch?: boolean;      // default true

  // ── Captions extensions ─────────────────────────────────────────
  wordsPerLine?: 3 | 4 | 5;
  karaoke?: boolean;
  font?: string;             // default "Inter Display"
  size?: number;             // 10-80 · default 52

  // ── Trim extensions ─────────────────────────────────────────────
  speed?: number;            // 0.5-2.0 · default 1.0
  removeSilence?: boolean;   // default true
  autoTighten?: boolean;     // default false

  // ── Frame extensions ────────────────────────────────────────────
  safeZones?: Array<"tiktok" | "reels" | "shorts">;
  zoom?: number;             // 1.0-3.0 · default 1.4
  hookText?: string;
  emphasisWord?: string;
  hookDuration?: number;     // 1.0-5.0 · default 1.5
  template?: 0 | 1 | 2 | 3 | 4;

  // ── Audio extensions ────────────────────────────────────────────
  audioMainVolume?: number;
  audioMusicVolume?: number;
  audioTrack?: string;

  // ── Timeline extensions ─────────────────────────────────────────
  timelineZoom?: 1 | 2 | 4;

  // ── Watermark extensions ────────────────────────────────────────
  watermarkPreset?: "corner-br" | "corner-bl" | "full-bar";
  watermarkHandle?: string;
  watermarkQr?: boolean;

  // ── ReactionsDeep extensions ────────────────────────────────────
  snapToBeat?: boolean;

  // ── Aspect (from canvas.set-aspect capability) ──────────────────
  aspect?: "9:16" | "16:9" | "1:1";
}

export interface CockpitSettings {
  /**
   * BUG-032 P0 · sourcePath / audioSource / brollOffsetS round-trip through
   * `clipSettingsStore` like every other section. Persistence + clip-switch
   * re-seed are owned by the same code path as layout / frameAtS.
   *
   * `sourcePath` is the absolute filesystem path of the reaction file the
   * user picked (written to `$APPDATA/Liquid Clips/reactions/...`). Null
   * means no reaction selected yet.
   */
  reaction: {
    layout: ReactionLayoutKey;
    frameAtS: number;
    sourcePath: string | null;
    audioSource: ReactionAudioSource;
    brollOffsetS: number;
    swapPanes: boolean;
    syncPlayback: boolean;
  };
  caption:  { text: string; style: CaptionStyleKey; position: CaptionPositionKey; letterSpacing: number };
  trim:     { inS: number; outS: number };
  style:    { preset: StylePresetKey; watermark: boolean; accent: StyleAccentKey };
  schedule: { date: string; time: string; lane: ScheduleLane; repeat: ScheduleRepeat };
  publish:  { format: ExportFormatKey; preset: ExportPresetKey; targetAccountIds: string[]; watermark: boolean };
  /**
   * Phase 1c · optional Composer sub-schema. Undefined for clips whose
   * settings were persisted before the Composer route landed; the seed
   * path fills it in with `{}` on load so consumers can safely spread.
   */
  baseWindow?: ComposerBaseWindow;
}

function defaultsFor(clip: Clip): CockpitSettings {
  // Tomorrow at noon — a useful default for the Schedule picker.
  const t = new Date();
  t.setDate(t.getDate() + 1);
  const date = t.toISOString().slice(0, 10);
  const platformsAsAccountIds: Record<Platform, string> = {
    tiktok:    "ch-1",
    instagram: "ch-3",
    youtube:   "ch-5",
    facebook:  "ch-6",
    x:         "ch-7",
    linkedin:  "ch-8",
  };
  const target = (clip.platforms ?? []).map((p) => platformsAsAccountIds[p]).filter(Boolean);
  return {
    reaction: {
      layout: "solo",
      frameAtS: clip.start,
      sourcePath: null,
      audioSource: "main",
      brollOffsetS: 0,
      swapPanes: false,
      syncPlayback: true,
    },
    caption:  {
      text: clip.title,
      style: ((clip.caption_style as CaptionStyleKey) ?? "fuchsia-pop"),
      position: "bottom",
      letterSpacing: 2,
    },
    trim:     { inS: clip.start, outS: clip.end },
    style:    { preset: "uncle-daniel", watermark: true, accent: "fuchsia" },
    schedule: { date, time: "12:00", lane: "tiktok", repeat: "none" },
    publish:  { format: "mp4", preset: "9:16 · 1080p", targetAccountIds: target, watermark: true },
    // Phase 1c · empty bag by default. Composer flow-panels write into
    // this via setBaseWindow() as the user resolves each intent.
    baseWindow: {},
  };
}

/**
 * Seed = LLM defaults ∪ persisted-store overrides. The store entry only
 * carries the user's actual edits (partial), so missing sections fall back
 * to defaults. Used both on mount and on clip switch.
 */
function seedFor(clip: Clip, slug: string | undefined): CockpitSettings {
  const base = defaultsFor(clip);
  const saved = clipSettingsStore.read(slug, clip.idx);
  if (!saved) return base;
  const savedReaction = saved.reaction ?? {};
  const reactionLayout = normalizeReactionLayout(
    (savedReaction as { layout?: unknown }).layout,
    base.reaction.layout,
  );
  return {
    reaction: { ...base.reaction, ...savedReaction, layout: reactionLayout },
    caption:  { ...base.caption,  ...(saved.caption  ?? {}) },
    trim:     { ...base.trim,     ...(saved.trim     ?? {}) },
    style:    { ...base.style,    ...(saved.style    ?? {}) },
    schedule: { ...base.schedule, ...(saved.schedule ?? {}) },
    publish:  { ...base.publish,  ...(saved.publish  ?? {}) },
    // Phase 1c · additive spread. Old persisted entries carry no
    // `baseWindow` key at all → `saved.baseWindow ?? {}` keeps the
    // default empty bag in place.
    baseWindow: { ...(base.baseWindow ?? {}), ...(saved.baseWindow ?? {}) },
  };
}

function normalizeReactionLayout(
  value: unknown,
  fallback: ReactionLayoutKey,
): ReactionLayoutKey {
  // v2.2 stored a generic "split" key. The renderer/export contract now
  // distinguishes horizontal and vertical 50/50 layouts, so migrate the old
  // value deterministically instead of letting it leak into the sidecar.
  if (value === "split") return "side-by-side";
  if (
    value === "solo"
    || value === "side-by-side"
    || value === "top-bottom"
    || value === "pip-tl"
    || value === "pip-tr"
    || value === "pip-bl"
    || value === "pip-br"
    // Phase 1c · Composer extension. Accepts persisted entries written
    // by the Composer route through setReaction({ layout: "full-overlay" }).
    || value === "full-overlay"
  ) {
    return value;
  }
  return fallback;
}

interface CockpitContextValue {
  focusedClip: Clip;
  settings: CockpitSettings;
  setReaction: (next: Partial<CockpitSettings["reaction"]>) => void;
  setCaption:  (next: Partial<CockpitSettings["caption"]>) => void;
  setTrim:     (next: Partial<CockpitSettings["trim"]>) => void;
  setStyle:    (next: Partial<CockpitSettings["style"]>) => void;
  setSchedule: (next: Partial<CockpitSettings["schedule"]>) => void;
  setPublish:  (next: Partial<CockpitSettings["publish"]>) => void;
  /**
   * Phase 1c · Composer flow-panels write here as the user resolves each
   * intent (volume slider, karaoke toggle, safe-zone chips, etc.). Follows
   * the same shallow-merge pattern as every other setter · persistence
   * round-trips through clipSettingsStore.
   */
  setBaseWindow: (next: Partial<ComposerBaseWindow>) => void;
  resetForClip: (clip: Clip) => void;
}

const Ctx = createContext<CockpitContextValue | null>(null);

/**
 * BUG-032 P0 · the raw context. Exported so consumers that may render
 * OUTSIDE the provider (e.g. ClipPreviewShell, which is also mounted in
 * TimelineStudio without a cockpit) can opt-in safely via
 * `useContext(CockpitContextOptional)` and gracefully degrade when null.
 */
export const CockpitContextOptional = Ctx;

export function CockpitProvider({
  clip,
  slug,
  children,
}: {
  clip: Clip;
  /** Project slug used as the store namespace (`lc.clip.${slug}:${clip.idx}`).
   *  Undefined when the session hasn't bound a project yet — store calls
   *  no-op, the cockpit degrades to in-memory state. */
  slug?: string;
  children: ReactNode;
}) {
  // Initial seed reads any persisted entry for (slug, clip.idx) and merges
  // it over the LLM-derived defaults.
  const [settings, setSettings] = useState<CockpitSettings>(() => seedFor(clip, slug));

  // ───── IRON GATE IG-LC2-018 — see BUG-032 P0 ─────
  // Re-seed when the focused clip identity changes. Before the BUG-032 lift,
  // this lived in CockpitDock.DockShell as an effect that called
  // resetForClip(focusedClip). After the lift the provider sits ABOVE both
  // the preview and the dock — so we own this effect here. Triggers on the
  // *identity* of (slug, clip.idx), not on `clip` referential equality.
  const seededKeyRef = useRef<string>(`${slug ?? ""}:${clip.idx}`);
  useEffect(() => {
    const next = `${slug ?? ""}:${clip.idx}`;
    if (next === seededKeyRef.current) return;
    seededKeyRef.current = next;
    setSettings(seedFor(clip, slug));
  }, [slug, clip.idx, clip]);
  // ───── END IRON GATE IG-LC2-018 (clip-switch re-seed) ─────

  const patch = useCallback(<K extends keyof CockpitSettings>(k: K, next: Partial<CockpitSettings[K]>) => {
    setSettings((s) => {
      const updatedSection = { ...s[k], ...next };
      const updated = { ...s, [k]: updatedSection };
      // BUG-031 · persist every mutation. Writes are scoped to the section
      // that changed so unrelated stored sections survive a partial edit.
      clipSettingsStore.write(slug, clip.idx, { [k]: updatedSection } as Partial<CockpitSettings>);
      return updated;
    });
  }, [slug, clip.idx]);

  const value = useMemo<CockpitContextValue>(() => ({
    focusedClip: clip,
    settings,
    setReaction: (n) => patch("reaction", n),
    setCaption:  (n) => patch("caption",  n),
    setTrim:     (n) => patch("trim",     n),
    setStyle:    (n) => patch("style",    n),
    setSchedule: (n) => patch("schedule", n),
    setPublish:  (n) => patch("publish",  n),
    // Phase 1c · Composer setter. Same `patch(section, partial)` shape as
    // every other setter — persistence, re-seed on clip switch, and
    // in-memory merge all flow through the identical code path.
    setBaseWindow: (n) => patch("baseWindow", n),
    // BUG-031 · clip-switch no longer wipes. Re-seeds from the next clip's
    // saved settings (∪ LLM defaults). resetForClip is still called by
    // CockpitDock.tsx on `focusedClip.idx` change.
    resetForClip: (c) => setSettings(seedFor(c, slug)),
  }), [clip, settings, patch, slug]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCockpit(): CockpitContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCockpit() must be used inside <CockpitProvider>");
  return ctx;
}
