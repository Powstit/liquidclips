/**
 * HUD mode store · Kade / Classic persistent toggle (2026-07-19)
 *
 * Persists the HUD's mode toggle across sessions so the app can key
 * behavior off "kade" (agent-forward · Kade drives the workstation)
 * vs "classic" (manual · user drives every micro-decision). Written
 * to `lc:hud-mode.v1` in localStorage · default `"kade"`.
 *
 * Pattern mirrors `deepWorkMode.ts`. This store is intentionally
 * setState-only (no toggle helper) because the mockup HUD sends the
 * explicit mode value each click — there is no toggle button.
 *
 * Wired from `MockComposer.tsx` via the `mode-set` bridge event.
 * Any other surface can call `useModeStore()` to read the current
 * mode and re-render on change.
 */

import { useCallback, useState } from "react";

export const MODE_STORAGE_KEY = "lc:hud-mode.v1";

export type HudMode = "kade" | "classic";

function readInitial(): HudMode {
  if (typeof window === "undefined") return "kade";
  try {
    const raw = window.localStorage.getItem(MODE_STORAGE_KEY);
    if (raw === "classic") return "classic";
    if (raw === "kade") return "kade";
    return "kade";
  } catch {
    return "kade";
  }
}

export function useModeStore(): [HudMode, (next: HudMode) => void] {
  const [mode, setModeState] = useState<HudMode>(() => readInitial());

  const setMode = useCallback((next: HudMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch { /* localStorage disabled · non-fatal */ }
  }, []);

  return [mode, setMode];
}
