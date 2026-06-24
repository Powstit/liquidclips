/**
 * Liquid Clips · Motion · Durations
 * Mirrors brand-kit.css `--lc-d-*` tokens. Numeric (seconds) for framer-motion.
 * Every duration is semantically named — never pick a number for vibe.
 */

export const D = {
  /** instant pulse / blink — 120ms */
  fast: 0.12,
  /** standard interactive transition (cards, pills) — 240ms */
  med: 0.24,
  /** route + drawer + modal — 480ms */
  slow: 0.48,
  /** ambient breathing (idle loops) — 8s */
  ambient: 8,
  /** world drift — 44s */
  world: 44,
} as const;

export type Duration = keyof typeof D;
