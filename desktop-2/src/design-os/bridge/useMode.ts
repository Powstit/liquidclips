/**
 * useMode · UI-3
 *
 * Reads the persisted Clipper / Agency mode from localStorage on mount and
 * keeps it in sync with the TopHud pill via the existing `mode:change` event.
 *
 * The pill was emitting since UI-1 with no subscribers; UI-3 wakes it up.
 * Mock-only — mode is a UI affordance, no backend persistence.
 */

import { useEffect, useState } from "react";
import { useEvent } from "./useEvent";
import { bus } from "./events";
import type { AppMode } from "./events";

const MODE_STORAGE_KEY = "lc.mode";

function readPersistedMode(): AppMode {
  try {
    const raw = window.localStorage.getItem(MODE_STORAGE_KEY);
    return raw === "agency" ? "agency" : "clipper";
  } catch {
    return "clipper";
  }
}

/* TASK 7B · agency visual identity · reflect mode to `body[data-app-mode]`
 * so the CSS can swap accent tokens (`--lc-accent`) without React having
 * to touch every styled element. A module-level subscriber + boot-time
 * write keeps the attribute synchronised regardless of which component
 * mounts first. */
function applyBodyModeAttribute(mode: AppMode): void {
  if (typeof document === "undefined") return;
  document.body.setAttribute("data-app-mode", mode);
}

if (typeof window !== "undefined") {
  /* Synchronise immediately + on every mode:change broadcast. */
  applyBodyModeAttribute(readPersistedMode());
  bus.on("mode:change", (p) => applyBodyModeAttribute(p.mode));
}

export function useMode(): AppMode {
  const [mode, setMode] = useState<AppMode>(() => readPersistedMode());
  useEvent("mode:change", (p) => setMode(p.mode));
  /* 2026-06-26 · C2 hardening · belt-and-braces · the module-level
   * `bus.on("mode:change", ...)` listener above races React's re-render
   * under CPU load (splash-and-agency-palette flake). When React state
   * lands, push the body attribute again so `data-app-mode` is
   * authoritative on the rendered React tree, not on the bus listener
   * firing order. Test seeding pathways that bypass useMode (e.g. the
   * splash test that emits mode:change directly without a remount) get
   * a deterministic body attribute. */
  useEffect(() => {
    applyBodyModeAttribute(mode);
  }, [mode]);
  return mode;
}
