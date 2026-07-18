/**
 * kadeMove · Composer Sprint 3 E4 · move Kade around the canvas.
 *
 * ⚠ IRON GATE IG-COMPOSER-P · moveKade animation contract.
 *
 * The Composer canvas can render an absolute-positioned Kade element
 * whose `data-kade-pos` attribute encodes its current x/y so CSS
 * transform transitions can carry it between beats. moveKade(x, y, ms)
 * is the shared write path. Any consumer (CanvasKade, DevPanel etc.)
 * listens for the "kade:move" bus event and applies the transform.
 *
 * Turbo interaction: when the composer root carries `data-turbo="true"`
 * (see IG-COMPOSER-D), the actual duration is clamped to 40 ms so
 * turbo mode stays visually snappy. clampMoveDuration() is exported so
 * consumers can honour the same rule when they compute their own
 * animation duration.
 */

import { bus } from "../../bridge";

/** The tightest legal move duration in turbo mode. Matches the CSS
 *  clamp used by Composer.css when the root carries data-turbo="true". */
export const TURBO_MOVE_DURATION_MS = 40;

/**
 * Format the data-kade-pos attribute value. Standardised as `x,y` in
 * integer px so multiple readers can parse it consistently. Consumers
 * that also need duration can read the `--kade-move-ms` CSS var.
 */
export function formatKadePos(x: number, y: number): string {
  return `${Math.round(x)},${Math.round(y)}`;
}

/**
 * Parse the data-kade-pos attribute back to numbers. Returns null for a
 * malformed input so a consumer can no-op instead of crashing on NaN.
 */
export function parseKadePos(raw: string | null | undefined): { x: number; y: number } | null {
  if (!raw) return null;
  const parts = raw.split(",");
  if (parts.length !== 2) return null;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/**
 * Clamp the animation duration when turbo mode is on. Turbo pins every
 * transition to 40 ms so the visible motion feels instant. Non-turbo
 * pass-through preserves the caller's intent.
 */
export function clampMoveDuration(ms: number, turbo: boolean): number {
  if (turbo) return Math.min(TURBO_MOVE_DURATION_MS, ms);
  return Math.max(0, ms);
}

/**
 * Fire the "kade:move" bus event so any pose-aware canvas can transition
 * Kade to (x, y) over `ms` ms. The turbo scaling is applied by the
 * consumer (which knows whether its root is in turbo mode) so this
 * helper stays pure.
 */
export function moveKade(x: number, y: number, ms: number): void {
  bus.emit("kade:move", { x, y, ms: Math.max(0, ms) });
}
