/**
 * Liquid Clips · Motion · Easings
 * Calm, never bouncy. Mirrors brand-kit.css `--lc-ease-*`.
 */

export const E = {
  /** default · cubic-bezier(.2,.7,.2,1) — assertive ease-out */
  out: [0.2, 0.7, 0.2, 1] as [number, number, number, number],
  /** sharp ease-in for dismissals — cubic-bezier(.6,0,.8,.3) */
  in: [0.6, 0, 0.8, 0.3] as [number, number, number, number],
  /** ambient soft — cubic-bezier(.4,0,.2,1) */
  soft: [0.4, 0, 0.2, 1] as [number, number, number, number],
  /** linear · for progress bars and constant-velocity loops */
  linear: "linear" as const,
} as const;

export type Easing = keyof typeof E;
