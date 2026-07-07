/**
 * Thumbnail types · mirrors the legacy desktop/python-sidecar contract
 *
 * 9-field brand preset whitelist + ThumbnailItem (per-generation payload) +
 * ThumbnailGenerateResult + LedgerRow + Variant + IdentityImage.
 *
 * Phase 6F default model: gpt-image-1 (per audit §5.1 + Daniel's brief).
 * Legacy sidecar still ships gpt-image-2; the auto-fallback at
 * sidecar.py:4429 catches model_not_found and retries with gpt-image-1.
 */

export type ThumbnailModel = "gpt-image-1" | "gpt-image-2";
export type ThumbnailQuality = "low" | "medium" | "high";

/** Cost per generation in USD (from thumbnail_engine.py:77). */
export const COST_USD: Record<ThumbnailQuality, number> = {
  low: 0.05,
  medium: 0.07,
  high: 0.20,
};

/** Style-mood enum from the legacy advanced brand-preset section. Field
 *  is declared in the 9-field whitelist but not currently consumed by
 *  build_prompt — surface as "experimental" in the UI. */
export type StyleMood =
  | "cinematic" | "playful" | "luxury" | "editorial" | "brutalist";

/** The 9-field brand preset whitelist (sidecar.py:4097–4100). */
export interface BrandPreset {
  brand: string;
  identity: string;
  wardrobe: string;
  model: ThumbnailModel;
  size: string;
  quality: ThumbnailQuality;
  /** Forward-compat (not consumed by build_prompt yet). */
  style_mood?: StyleMood;
  /** Forward-compat (not consumed by build_prompt yet). */
  props?: string;
  /** Forward-compat (not consumed by build_prompt yet). */
  font_directive?: string;
  /** Mapping of accent-key → display name (e.g. { pink: "pink/magenta" }). */
  accents?: Record<string, string>;
}

/** Per-generation payload — matches `ThumbnailItem` in legacy. */
export interface ThumbnailItem {
  text: string;           // headline / title (≤30 chars)
  metaphor?: string;      // free-text concept hook
  accent: string;         // accent key from BrandPreset.accents
  quality: ThumbnailQuality;
  order: number;          // index into EMO/PAT rotations
  prop?: string;          // optional per-item personality
}

/** Result of a successful generate (sidecar.py:4328). */
export interface ThumbnailGenerateResult {
  output_path: string;
  cost_usd: number;
  model: ThumbnailModel;
  completed_at: string;
  prompt_used: string;
  slug: string;
  ledger_warning?: string;
}

/** One row in the lifetime ledger (~/LiquidClips/thumbgen_ledger.jsonl). */
export interface LedgerRow {
  ts: string;
  slug: string;
  model: ThumbnailModel;
  cost_usd: number;
  output_path: string;
  title: string;
}

/** A generated variant tile in the gallery. */
export interface ThumbnailVariant {
  id: string;
  path: string;         // local file path or asset URL
  name: string;
  cost_usd: number;
  model: ThumbnailModel;
  modified_at: string;
  score?: number;       // 0..100 (LC-Score)
  scoreBreakdown?: {
    hook?: number;
    clarity?: number;
    contrast?: number;
    face?: number;
  };
  isWinner?: boolean;   // true on the top-scoring variant in a batch
}

/** A face-crop reference image in identity/. */
export interface IdentityImage {
  path: string;
  name: string;
  /** Size in bytes (display). */
  size?: number;
}

/* ============================================================
   Prompt-builder constants — mirrored from thumbnail_engine.py
   ============================================================ */

/** EMO list (8 expressions) — rotated by (order-1) % 8.
 *  Mirrors thumbnail_engine.py:82–91. */
export const EMO_ROTATION: ReadonlyArray<string> = [
  "wide-eyed shock",
  "smug confidence",
  "knowing smile",
  "concerned focus",
  "fierce determination",
  "raised brow",
  "mouth-open call-out",
  "calm authority",
];

/** PAT list (5 stop-power treatments) — rotated by (order-1) % 5.
 *  Mirrors thumbnail_engine.py:93–99. */
export const PAT_ROTATION: ReadonlyArray<string> = [
  "tight headshot · subject left",
  "subject right · accent block fills negative space",
  "centred subject · symmetrical accent",
  "wide subject · environmental backdrop",
  "subject pushed to bottom · headline dominates top",
];

/** Default brand-preset accent palette (matches legacy DEFAULT_CONFIG line 64). */
export const DEFAULT_ACCENTS: Record<string, string> = {
  fuchsia: "fuchsia/magenta",
  cyan: "cyan",
  amber: "amber",
  emerald: "emerald",
  indigo: "indigo",
  rose: "rose",
  ivory: "ivory",
  ink: "ink/dark",
};

/* ============================================================
   Default brand preset
   ============================================================
   FEATURE-002 · scrubbed customer-visible "Uncle Daniel" naming from
   the default preset. The constant identifier UNCLE_DANIEL_PRESET is
   kept to avoid a churning rename across importers · the rendered
   value the customer actually sees is `brand` + `identity`. */

export const UNCLE_DANIEL_PRESET: BrandPreset = {
  brand: "Your brand",
  identity: "Replace with your on-camera identity (build, look, vibe). The thumbnail engine will match this across every generated cover.",
  wardrobe: "Describe your usual on-camera outfit so generated covers match your real videos.",
  model: "gpt-image-1",   // Phase 6F: gpt-image-1 (audit §5.1)
  size: "1536x1024",
  quality: "medium",
  style_mood: "cinematic",
  accents: DEFAULT_ACCENTS,
};

/* ============================================================
   Fixture variants — Phase 6F simulator data
   ============================================================ */

export const FIXTURE_VARIANTS: ThumbnailVariant[] = [
  {
    id: "v1", path: "/brand/kade/kade-success.webp", name: "Variant A · 92",
    cost_usd: 0.07, model: "gpt-image-1",
    modified_at: "2026-06-18T14:00:00Z",
    score: 92,
    scoreBreakdown: { hook: 96, clarity: 90, contrast: 92, face: 90 },
    isWinner: true,
  },
  {
    id: "v2", path: "/brand/kade/kade-create-clips.webp", name: "Variant B · 84",
    cost_usd: 0.07, model: "gpt-image-1",
    modified_at: "2026-06-18T14:00:30Z",
    score: 84,
    scoreBreakdown: { hook: 86, clarity: 84, contrast: 80, face: 86 },
  },
  {
    id: "v3", path: "/brand/kade/kade-reading-brief.webp", name: "Variant C · 78",
    cost_usd: 0.07, model: "gpt-image-1",
    modified_at: "2026-06-18T14:01:00Z",
    score: 78,
    scoreBreakdown: { hook: 74, clarity: 82, contrast: 78, face: 78 },
  },
];

export const FIXTURE_LEDGER_ROWS: LedgerRow[] = [
  { ts: "2026-06-18T14:00:00Z", slug: "uncle-daniel-clip-squad-2026", model: "gpt-image-1", cost_usd: 0.07, output_path: "/brand/kade/kade-success.webp",       title: "The cold-open that actually works" },
  { ts: "2026-06-18T14:00:30Z", slug: "uncle-daniel-clip-squad-2026", model: "gpt-image-1", cost_usd: 0.07, output_path: "/brand/kade/kade-create-clips.webp",  title: "The cold-open that actually works" },
  { ts: "2026-06-18T14:01:00Z", slug: "uncle-daniel-clip-squad-2026", model: "gpt-image-1", cost_usd: 0.07, output_path: "/brand/kade/kade-reading-brief.webp", title: "The cold-open that actually works" },
];
