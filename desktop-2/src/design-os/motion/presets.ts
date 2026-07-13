/**
 * Liquid Clips · Motion · Presets
 *
 * Every preset is named after the STATE it communicates — never picked for vibe.
 * Rule: a motion must communicate one of:
 *   state | progress | success | warning | error | reward
 *
 * If you can't name what a new preset communicates, don't add it.
 */

import type { Variants, Transition } from "framer-motion";
import { D } from "./durations";
import { E } from "./easings";

/* ============================================================
   STATE · route + card + drawer + queue + modal + Kade
   ============================================================ */

/** Page/route enter — quick fade. Navigation must feel immediate; heavier
 * motion belongs inside cards/modals, not every route swap. */
export const routeEnter: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: D.fast, ease: E.out } },
  exit: { opacity: 0, transition: { duration: D.fast, ease: E.in } },
};

/** Card hover — lift + glow. Stateful, not random. */
export const cardHover: Variants = {
  rest: { y: 0, scale: 1, transition: { duration: D.med, ease: E.out } },
  hover: { y: -3, scale: 1, transition: { duration: D.med, ease: E.out } },
};

/** Drawer expansion — height + opacity. For queue rows + side panels. */
export const drawerExpand: Variants = {
  collapsed: { height: 0, opacity: 0, transition: { duration: D.med, ease: E.in } },
  expanded: { height: "auto", opacity: 1, transition: { duration: D.slow, ease: E.out } },
};

/** Queue row expansion — slightly faster than drawer, no height pop. */
export const queueExpand: Variants = {
  collapsed: { opacity: 0, y: -4, transition: { duration: D.fast, ease: E.in } },
  expanded: { opacity: 1, y: 0, transition: { duration: D.med, ease: E.out } },
};

/** Modal in/out — scale + fade. Always paired with backdrop. */
export const modalIn: Variants = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1, transition: { duration: D.med, ease: E.out } },
  exit: { opacity: 0, scale: 0.98, transition: { duration: D.fast, ease: E.in } },
};

/** Kade pose crossfade — 240ms opacity swap between still poses. */
export const kadeXfade: Transition = { duration: D.med, ease: E.out };

/* ============================================================
   PROGRESS · loading bar / ring pulse
   ============================================================ */

/** Slow glow breathing on progress bars while filling. */
export const progressGlow: Variants = {
  idle: {
    boxShadow: "0 0 18px rgba(255,26,140,.55)",
    transition: { duration: 2.4, ease: E.soft, repeat: Infinity, repeatType: "reverse" as const },
  },
  pulse: {
    boxShadow: "0 0 32px rgba(255,26,140,.9)",
    transition: { duration: 2.4, ease: E.soft, repeat: Infinity, repeatType: "reverse" as const },
  },
};

/* ============================================================
   SUCCESS · achievement / payout / launch burst
   ============================================================ */

/** Achievement unlock — scale + rotate snap + glow. One-shot. */
export const achievementUnlock: Variants = {
  initial: { opacity: 0, scale: 0.4, rotate: -10 },
  animate: {
    opacity: 1,
    scale: [0.4, 1.15, 1],
    rotate: [10, -4, 0],
    transition: { duration: D.slow, ease: E.out, times: [0, 0.7, 1] },
  },
};

/** Success burst — used on first-clip / first-payout. */
export const successBurst: Variants = {
  initial: { opacity: 0, scale: 0.6 },
  animate: {
    opacity: [0, 1, 1],
    scale: [0.6, 1.08, 1],
    transition: { duration: D.slow, ease: E.out, times: [0, 0.6, 1] },
  },
  exit: { opacity: 0, scale: 1.04, transition: { duration: D.med, ease: E.in } },
};

/* ============================================================
   WARNING / ERROR
   ============================================================ */

/** Warning pulse — amber rim breathing. Communicates needs-attention. */
export const warningPulse: Variants = {
  idle: { opacity: 0.55, transition: { duration: 1.2, ease: E.soft, repeat: Infinity, repeatType: "reverse" as const } },
  pulse: { opacity: 1, transition: { duration: 1.2, ease: E.soft, repeat: Infinity, repeatType: "reverse" as const } },
};

/** Error shake — quick lateral shake on submit failure. */
export const errorShake: Variants = {
  initial: { x: 0 },
  animate: {
    x: [0, -6, 6, -4, 4, 0],
    transition: { duration: 0.32, ease: E.linear },
  },
};

/* ============================================================
   REWARD · coin orbit / payout-stamp
   ============================================================ */

/** Coin orbit — slow rotate around the orb. */
export const coinOrbit: Variants = {
  idle: {
    rotate: 360,
    transition: { duration: 20, ease: E.linear, repeat: Infinity },
  },
};

/** Stop-page enter — slide + fade. Used on every blocking screen. */
export const stopPageEnter: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: D.slow, ease: E.out } },
  exit: { opacity: 0, y: 6, transition: { duration: D.med, ease: E.in } },
};

/* ============================================================
   AMBIENT · world drift + Kade bob
   These are LOOPS, but they communicate "the world is alive,
   no error" — they DO communicate a state.
   ============================================================ */

export const worldDrift: Variants = {
  idle: {
    scale: [1.02, 1.06, 1.02],
    x: [0, -18, 0],
    transition: { duration: D.world, ease: E.soft, repeat: Infinity },
  },
};

export const kadeBob: Variants = {
  idle: {
    y: [0, -8, 0],
    rotate: [0, -1.2, 0],
    transition: { duration: 6.6, ease: E.soft, repeat: Infinity },
  },
};

/* ============================================================
   STAGGER · used on initial section paints
   ============================================================ */

export const staggerContainer: Variants = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.07,
      delayChildren: 0.05,
    },
  },
};

export const staggerItem: Variants = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0, transition: { duration: D.slow, ease: E.out } },
};
