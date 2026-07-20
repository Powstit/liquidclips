/**
 * HUD speed store · 1× / 2× / 5× persistent throttle (2026-07-19)
 *
 * Persists the HUD's speed selector so agent/animation cadence
 * survives reloads. Written to `lc:hud-speed.v1` in localStorage ·
 * default `1`. Only 1 / 2 / 5 are accepted values; anything else
 * on read falls back to the default.
 *
 * Pattern mirrors `deepWorkMode.ts` and `modeStore.ts`. The mockup
 * HUD emits the exact speed on click via the `speed-set` bridge
 * event; this store owns the localStorage side.
 */

import { useCallback, useState } from "react";

export const SPEED_STORAGE_KEY = "lc:hud-speed.v1";

export type HudSpeed = 1 | 2 | 5;

function readInitial(): HudSpeed {
  if (typeof window === "undefined") return 1;
  try {
    const raw = window.localStorage.getItem(SPEED_STORAGE_KEY);
    if (raw === "2") return 2;
    if (raw === "5") return 5;
    if (raw === "1") return 1;
    return 1;
  } catch {
    return 1;
  }
}

export function useSpeedStore(): [HudSpeed, (next: HudSpeed) => void] {
  const [speed, setSpeedState] = useState<HudSpeed>(() => readInitial());

  const setSpeed = useCallback((next: HudSpeed) => {
    setSpeedState(next);
    try {
      window.localStorage.setItem(SPEED_STORAGE_KEY, String(next));
    } catch { /* localStorage disabled · non-fatal */ }
  }, []);

  return [speed, setSpeed];
}
