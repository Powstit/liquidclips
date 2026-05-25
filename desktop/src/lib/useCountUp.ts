import { useEffect, useRef, useState } from "react";

/**
 * Count a number up to `target` on mount and whenever `target` changes, so the
 * product's emotional payload (virality scores, money) animates instead of
 * snapping in. Returns a formatted string.
 *
 * Respects `prefers-reduced-motion`: returns the final formatted value
 * immediately, no animation. For currency, keep the symbol in `prefix` — only
 * the numeric portion animates.
 *
 * Design-uplift scope §4. Mirror this contract in account-app / partner-app.
 */
export interface CountUpOptions {
  durationMs?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function useCountUp(target: number, opts: CountUpOptions = {}): string {
  const { durationMs = 900, decimals = 0, prefix = "", suffix = "" } = opts;
  const [value, setValue] = useState(() => target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const finite = Number.isFinite(target) ? target : 0;
    if (prefersReducedMotion() || durationMs <= 0) {
      setValue(finite);
      fromRef.current = finite;
      return;
    }
    const from = fromRef.current;
    const delta = finite - from;
    if (delta === 0) {
      setValue(finite);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      setValue(from + delta * easeOutCubic(p));
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = finite;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      fromRef.current = finite;
    };
  }, [target, durationMs]);

  const formatted = value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${prefix}${formatted}${suffix}`;
}
