/**
 * kadePoses · Composer Sprint 3 E2 · pose registry for Kade portrait swaps.
 *
 * ⚠ IRON GATE IG-COMPOSER-N · Kade pose registry contract.
 *
 * Every pose id maps to a real asset under public/brand/kade/. Every
 * setPose() call fires the "kade:pose" bus event so any KadeController
 * (or StickyKade, if it opts in) can swap the inner portrait.
 *
 * The pose enum stays flat + string-keyed (not a typed enum) so future
 * pose adds don't require a compile-step everywhere the emitter lives.
 * The registry object is the source of truth for known poses; unknown
 * poses fall back to "idle" at emit time.
 */

import { bus } from "../../bridge";

/**
 * POSES · pose id → asset path. Every entry MUST resolve to a real
 * file in public/brand/kade/. If you add a pose here you MUST add the
 * matching webp/png in the same commit.
 */
export const POSES = {
  idle: "/brand/kade/kade-idle.webp",
  hover: "/brand/kade/kade-hover.webp",
  base: "/brand/kade/kade-base.png",
  checking: "/brand/kade/kade-checking.png",
  celebration: "/brand/kade/kade-celebration.webp",
  "first-clip-celebration": "/brand/kade/kade-first-clip-celebration.png",
  success: "/brand/kade/kade-success.webp",
  error: "/brand/kade/kade-error.webp",
  warning: "/brand/kade/kade-warning.webp",
  "cutting-clips": "/brand/kade/kade-cutting-clips.webp",
  "generating-captions": "/brand/kade/kade-generating-captions.webp",
  exporting: "/brand/kade/kade-exporting.webp",
  "reading-brief": "/brand/kade/kade-reading-brief.webp",
  "create-clips": "/brand/kade/kade-create-clips.webp",
  shooter: "/brand/kade/kade-shooter.webp",
  "campaign-mode": "/brand/kade/kade-campaign-mode.webp",
  "community-mode": "/brand/kade/kade-community-mode.webp",
  "earn-mode": "/brand/kade/kade-earn-mode.webp",
  "settings-mode": "/brand/kade/kade-settings-mode.webp",
  "tier-rookie": "/brand/kade/kade-tier-rookie.webp",
  "tier-climber": "/brand/kade/kade-tier-climber.webp",
  "tier-growth": "/brand/kade/kade-tier-growth.webp",
} as const;

export type KadePose = keyof typeof POSES;

/** Return the asset path for a pose id, falling back to "idle" for
 *  unknown poses so a caller can never end up with a broken <img src>. */
export function posePath(pose: string): string {
  if (pose in POSES) {
    return POSES[pose as KadePose];
  }
  return POSES.idle;
}

/**
 * Fire the "kade:pose" bus event so any pose-aware surface can swap
 * its portrait. Unknown poses coerce to "idle" for safety.
 */
export function setPose(pose: string, statusText?: string): void {
  const safePose: KadePose = pose in POSES ? (pose as KadePose) : "idle";
  bus.emit("kade:pose", { pose: safePose, statusText });
}
