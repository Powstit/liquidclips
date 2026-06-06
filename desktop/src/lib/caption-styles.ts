// Caption style specs — must stay in sync with python-sidecar/captions.py:_STYLES.
// The Python side is authoritative for the rendered ASS (file that ships).
// This side is authoritative for the LIVE OVERLAY preview the user sees in
// the drawer while editing.
//
// If you change one, change the other. The 5 keys match exactly.

export type CaptionStyleKey =
  | "brand_fuchsia"
  | "tiktok_stack"
  | "bold_yellow"
  | "clean_white"
  | "subway_surfer";

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
};

export const CAPTION_STYLE_KEYS: CaptionStyleKey[] = [
  "brand_fuchsia",
  "tiktok_stack",
  "bold_yellow",
  "clean_white",
  "subway_surfer",
];

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
