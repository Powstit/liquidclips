// Caption style specs — must stay in sync with python-sidecar/captions.py:_STYLES.
// The Python side is authoritative for the rendered ASS (file that ships).
// This side is authoritative for the LIVE OVERLAY preview the user sees in
// the drawer while editing.
//
// If you change one, change the other. All 11 keys (5 platform-recognisable
// presets + 5 brand presets + Custom) must match exactly — same names, same
// order in CAPTION_STYLE_KEYS / STYLE_KEYS, same labels.

export type CaptionStyleKey =
  | "brand_fuchsia"
  | "tiktok_stack"
  | "bold_yellow"
  | "clean_white"
  | "subway_surfer"
  | "instagram_clean"
  | "news_ticker"
  | "neon_arcade"
  | "comic_bubble"
  | "youtube_bold"
  | "custom";

/** User-picked palette — react-colorful drives these. When `style === "custom"`
 *  the bake uses these colours instead of the preset. Optional fields fall
 *  back to the "custom" preset defaults so a partial palette renders cleanly. */
export type CaptionPalette = {
  primary?: string;
  secondary?: string;
  outline?: string;
};

/** User-picked caption position. Overrides the style's hardcoded alignment +
 *  vertical margin so the clipper can move text out from under platform
 *  overlays (e.g. captions on top because TikTok overlays bottom-right). */
export type CaptionPosition = {
  /** ASS alignment code:
   *   8 = top-centre, 5 = middle-centre, 2 = bottom-centre (default).
   *  These are the canonical "numpad" alignment values libass expects. */
  align: 2 | 5 | 8;
  /** Vertical offset in CSS-pixel terms (matches `margin_v` field on the
   *  style spec). 0-400 range. Drawer slider exposes this. */
  marginV: number;
};

/** Slider cap. Matches the Python clamp in captions._build_style_line.
 *  At 400px on a 1920-tall canvas the caption block is still ~21% from
 *  whichever edge align points at — comfortably on-screen so the clipper
 *  can't strand the text behind the platform UI by dragging the slider. */
export const CAPTION_MARGIN_V_MAX = 400;

export type CaptionStyleSpec = {
  key: CaptionStyleKey;
  label: string;
  /** Font family CSS value. */
  fontFamily: string;
  /** Font size on a 1920-tall canvas, in px. CSS scales relative to video height. */
  fontPx: number;
  /** Active / "sung" word colour. */
  primary: string;
  /** Baseline / "unsung" word colour. */
  secondary: string;
  /** Outline / stroke colour. */
  outline: string;
  /** Outline stroke width in px. */
  outlinePx: number;
  /** Optional drop shadow CSS. */
  shadow?: string;
  /** Optional opaque rectangle behind every line ("box mode" — tiktok-stack). */
  boxBg?: string;
  /** font-weight CSS. */
  fontWeight: 400 | 600 | 700 | 800;
  /** Words per line override the engine uses for grouping. Drawer mirrors it
   * in the line table so the live preview matches the eventual bake. */
  wordsPerLine: number;
  /** CSS top-from-bottom offset for the caption block (matches ASS MarginV). */
  marginVPercent: number;
  /** Whether karaoke fill is visually meaningful for this style. clean_white
   * has primary === secondary, so karaoke is a no-op visually. */
  karaoke: boolean;
};

export const CAPTION_STYLES: Record<CaptionStyleKey, CaptionStyleSpec> = {
  brand_fuchsia: {
    key: "brand_fuchsia",
    label: "Brand Fuchsia",
    fontFamily: "Inter, system-ui, sans-serif",
    fontPx: 72,
    primary: "#ff1a8c",
    secondary: "#c8c4be",
    outline: "#0b0b10",
    outlinePx: 5,
    shadow: "0 4px 16px rgba(0,0,0,0.55)",
    fontWeight: 800,
    wordsPerLine: 4,
    marginVPercent: 12.5,
    karaoke: true,
  },
  tiktok_stack: {
    key: "tiktok_stack",
    label: "TikTok Stack",
    fontFamily: "Inter, system-ui, sans-serif",
    fontPx: 80,
    primary: "#ffffff",
    secondary: "#00e5ff",
    outline: "#000000",
    outlinePx: 8,
    shadow: "0 6px 18px rgba(0,0,0,0.65)",
    boxBg: "rgba(0,0,0,0.75)",
    fontWeight: 800,
    wordsPerLine: 2,
    marginVPercent: 16.7,
    karaoke: true,
  },
  bold_yellow: {
    key: "bold_yellow",
    label: "Bold Yellow",
    fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif",
    fontPx: 72,
    primary: "#ffff00",
    secondary: "#ffffff",
    outline: "#000000",
    outlinePx: 5,
    shadow: "0 4px 14px rgba(0,0,0,0.6)",
    fontWeight: 800,
    wordsPerLine: 4,
    marginVPercent: 12.5,
    karaoke: true,
  },
  clean_white: {
    key: "clean_white",
    label: "Clean White",
    fontFamily: "Inter, system-ui, sans-serif",
    fontPx: 56,
    primary: "#ffffff",
    secondary: "#ffffff",
    outline: "#000000",
    outlinePx: 3,
    shadow: "0 2px 8px rgba(0,0,0,0.55)",
    fontWeight: 600,
    wordsPerLine: 5,
    marginVPercent: 10.4,
    karaoke: false,
  },
  subway_surfer: {
    key: "subway_surfer",
    label: "Subway Surfer",
    fontFamily: '"Impact", "Anton", "Bebas Neue", sans-serif',
    fontPx: 84,
    primary: "#00e5ff",
    secondary: "#ffffff",
    outline: "#ff1a8c",
    outlinePx: 6,
    shadow: "0 6px 18px rgba(255,26,140,0.4)",
    fontWeight: 800,
    wordsPerLine: 2,
    marginVPercent: 14.6,
    karaoke: true,
  },
  // User-tunable starter style. The drawer mounts react-colorful pickers
  // for `primary` / `secondary` / `outline` when this key is active, and
  // the sidecar bake reads the same palette so what the clipper sees in
  // the live overlay matches the rendered MP4.
  custom: {
    key: "custom",
    label: "Custom",
    fontFamily: "Inter, system-ui, sans-serif",
    fontPx: 76,
    primary: "#ff1a8c",   // brand default — clipper picking Custom without
    secondary: "#ffffff", // dragging a swatch still gets a brand-safe render.
    outline: "#0b0b10",
    outlinePx: 6,
    shadow: "0 4px 16px rgba(0,0,0,0.55)",
    fontWeight: 800,
    wordsPerLine: 3,
    marginVPercent: 12.5,
    karaoke: true,
  },
  // IG Reels-recognisable clean look. White Helvetica Neue with a thin
  // black outline + soft drop-shadow, no box, no karaoke fill. The
  // 4-words/line read pace matches IG's own auto-captions.
  instagram_clean: {
    key: "instagram_clean",
    label: "Instagram Clean",
    fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif",
    fontPx: 64,
    primary: "#ffffff",
    secondary: "#ffffff",
    outline: "#000000",
    outlinePx: 4,
    shadow: "0 2px 10px rgba(0,0,0,0.55)",
    fontWeight: 700,
    wordsPerLine: 4,
    marginVPercent: 10.4,
    karaoke: false,
  },
  // Broadcast news-ticker chyron. Filled fuchsia bar behind white Inter,
  // no glyph outline, sits low. 6 words/line reads like a real ticker.
  news_ticker: {
    key: "news_ticker",
    label: "News Ticker",
    fontFamily: "Inter, system-ui, sans-serif",
    fontPx: 56,
    primary: "#ffffff",
    secondary: "#ffffff",
    outline: "#ff1a8c",
    outlinePx: 0,
    shadow: "0 2px 8px rgba(0,0,0,0.4)",
    boxBg: "rgba(255,26,140,0.88)", // near-opaque fuchsia (#ff1a8c)
    fontWeight: 700,
    wordsPerLine: 6,
    marginVPercent: 3.1,
    karaoke: false,
  },
  // Heavier than brand_fuchsia — fuchsia primary on white, white outline,
  // glowing cyan back-shadow. Reads like an arcade marquee.
  neon_arcade: {
    key: "neon_arcade",
    label: "Neon Arcade",
    fontFamily: "Inter, system-ui, sans-serif",
    fontPx: 76,
    primary: "#ff1a8c",
    secondary: "#ffffff",
    outline: "#ffffff",
    outlinePx: 3,
    shadow: "0 0 18px rgba(0,229,255,0.75), 0 0 6px rgba(0,229,255,0.9)",
    fontWeight: 800,
    wordsPerLine: 3,
    marginVPercent: 13.5,
    karaoke: true,
  },
  // Comic-book pop. Bold yellow primary on white, fat black outline +
  // fat black shadow, Impact at 80px. 2 words/line lands each beat.
  comic_bubble: {
    key: "comic_bubble",
    label: "Comic Bubble",
    fontFamily: '"Impact", "Anton", "Bebas Neue", sans-serif',
    fontPx: 80,
    primary: "#ffe500",
    secondary: "#ffffff",
    outline: "#000000",
    outlinePx: 6,
    shadow: "6px 6px 0 rgba(0,0,0,0.85)",
    fontWeight: 800,
    wordsPerLine: 2,
    marginVPercent: 14.6,
    karaoke: true,
  },
  // YouTube creator-cam style. White Inter at 72px with a heavy 5px black
  // outline, no box, light shadow. Karaoke ON with fuchsia primary so
  // each word pops as it's "sung".
  youtube_bold: {
    key: "youtube_bold",
    label: "YouTube Bold",
    fontFamily: "Inter, system-ui, sans-serif",
    fontPx: 72,
    primary: "#ff1a8c",
    secondary: "#ffffff",
    outline: "#000000",
    outlinePx: 5,
    shadow: "0 2px 10px rgba(0,0,0,0.55)",
    fontWeight: 800,
    wordsPerLine: 4,
    marginVPercent: 12.5,
    karaoke: true,
  },
};

export const CAPTION_STYLE_KEYS: CaptionStyleKey[] = [
  "brand_fuchsia",
  "tiktok_stack",
  "bold_yellow",
  "clean_white",
  "subway_surfer",
  "instagram_clean",
  "news_ticker",
  "neon_arcade",
  "comic_bubble",
  "youtube_bold",
  "custom",
];

/** Merge a user palette over a style spec — returns a NEW spec where the
 *  palette swatches override `primary` / `secondary` / `outline`. Used by
 *  the live overlay so the clipper sees their picks before Apply. */
export function applyPalette(
  spec: CaptionStyleSpec,
  palette: CaptionPalette | undefined,
): CaptionStyleSpec {
  if (!palette) return spec;
  return {
    ...spec,
    primary: palette.primary ?? spec.primary,
    secondary: palette.secondary ?? spec.secondary,
    outline: palette.outline ?? spec.outline,
  };
}

/** CSS `text-shadow` value that simulates an ASS stroke. Stacks 8 cardinal
 * directions so the outline reads crisp even at small sizes. */
export function strokeShadow(color: string, px: number): string {
  const offsets: [number, number][] = [
    [-px, -px], [0, -px], [px, -px],
    [-px, 0],            [px, 0],
    [-px, px],  [0, px],  [px, px],
  ];
  return offsets.map(([x, y]) => `${x}px ${y}px 0 ${color}`).join(", ");
}
