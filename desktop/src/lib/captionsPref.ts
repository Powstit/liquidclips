// v0.7.55 — Captions on/off preference.
//
// Single source of truth for the "should we burn captions into exports"
// toggle Daniel asked for at the export entry point. Persists across
// app restarts via localStorage. On every read AND on every write, we
// also push the value to the sidecar's `JUNIOR_ANIMATED_CAPTIONS` env
// var so the next clip-reframe call picks it up (the sidecar already
// reads that env var in `_animated_captions_enabled()` — see
// `python-sidecar/stages.py:51`).
//
// Default: ON. Caption styling defaults to the canonical
// `brand_fuchsia` preset (per Daniel's locked spec — "Default preset:
// Liquid Clips/brand_fuchsia"). The actual style is controlled per-
// clip in the existing CaptionDrawer; THIS toggle only flips burn-in
// on/off for the export step.

import { sidecar } from "./sidecar";

const KEY = "lc:captions-enabled:v1";

export function readCaptionsEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return true; // default ON
    return raw === "1" || raw === "true";
  } catch {
    return true;
  }
}

export function setCaptionsEnabled(value: boolean): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(KEY, value ? "1" : "0");
    } catch {
      /* quota / private mode — non-fatal; the sidecar push below still
         lands the flag for the current session. */
    }
  }
  // Best-effort propagate to the sidecar. If the sidecar is restarting
  // (Tauri tear-down race), the next call to `syncCaptionsFlag` on app
  // boot re-pushes the value.
  void sidecar
    .setRuntimeFlag("JUNIOR_ANIMATED_CAPTIONS", value)
    .catch(() => undefined);
}

/** Call once on App boot so the sidecar's env reflects the user's
 *  persisted preference. The sidecar default is ON (Full Polish mode)
 *  so this only matters when the user has previously turned captions
 *  OFF — without this sync, their preference would silently flip back
 *  on every relaunch. */
export function syncCaptionsFlag(): void {
  const v = readCaptionsEnabled();
  void sidecar
    .setRuntimeFlag("JUNIOR_ANIMATED_CAPTIONS", v)
    .catch(() => undefined);
}
