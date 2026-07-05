// Liquid Clips canonical brand tokens.
// Mirrored from /Users/dipdip/code/jnr/desktop-2/src/brand/brandTheme.css.
// Do NOT drift — regen from source if brandTheme.css changes.

export const colors = {
  fuchsia: "#ff1a8c",
  fuchsiaBright: "#ff3da5",
  fuchsiaDeep: "#ff66b8",
  fuchsiaSoft: "rgba(255, 26, 140, 0.16)",
  fuchsiaGlow: "#ff8fcb",
  cyanCool: "#00e5ff",
  ink: "#f4f1ea",
  inkSoft: "#c8c4be",
  paper: "#0b0b10",
  paperWarm: "#15151c",
  paperElev: "#1c1c25",
} as const;

export const radius = {
  chip: 8,
  control: 12,
  card: 16,
  cardLg: 24,
  pill: 9999,
} as const;

export const font = {
  display: '"Inter", ui-sans-serif, system-ui, sans-serif',
  sans: '"Inter", ui-sans-serif, system-ui, sans-serif',
  mono: '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace',
} as const;

export const timing = {
  windowIn: [0, 20] as const,
  thumbnailDrop: [20, 45] as const,
  progressBar: [45, 130] as const,
  tilesReveal: [130, 380] as const,
  gridFill: [380, 480] as const,
  ctaCard: [480, 600] as const,
};
