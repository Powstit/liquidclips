/**
 * Liquid Clips · Motion · Barrel
 *
 * Single import surface: `import { D, E, presets, useMotionGate } from "../motion";`
 *
 * Rule: no other file may import from framer-motion directly except components
 *       inside src/design-os/. Use this barrel.
 */

export { D } from "./durations";
export { E } from "./easings";
export { useMotionGate } from "./useMotionGate";
export * as presets from "./presets";
