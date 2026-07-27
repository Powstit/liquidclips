/**
 * Deep-work mode · full-viewport cinema editor (2026-07-19)
 *
 * Collapses ALL shell chrome (nav rail, TopHud, chat bubble) so the
 * canvas gets the full 1440×900. Keyboard: Cmd+B toggles. Escape exits.
 * Persisted per-user in localStorage · defaults to OFF so first-launch
 * users keep the nav rail + account/settings chrome visible. Deep-work
 * remains an opt-in focus view via the corner toggle or Cmd+B.
 *
 * NOT a route · NOT a mode-store field · NOT a per-clip flag. It's a
 * shell-level toggle that lives above the design-os pipeline. The value
 * flows down as `data-deep-work="true|false"` on `.lc-app`.
 */

import { useCallback, useEffect, useState } from "react";

export const DEEP_WORK_STORAGE_KEY = "lc:deep-work:v1";

function readInitial(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(DEEP_WORK_STORAGE_KEY);
    // First-run default: OFF. Launch/user-lens journeys require the
    // account pill, settings, notifications, and rail to be visible
    // without requiring the user to discover the corner escape toggle.
    if (raw === null) return false;
    return raw === "1";
  } catch {
    return false;
  }
}

export function useDeepWorkMode(): {
  deepWork: boolean;
  setDeepWork: (next: boolean) => void;
  toggleDeepWork: () => void;
} {
  const [deepWork, setDeepWorkState] = useState<boolean>(() => readInitial());

  const setDeepWork = useCallback((next: boolean) => {
    setDeepWorkState(next);
    try {
      window.localStorage.setItem(DEEP_WORK_STORAGE_KEY, next ? "1" : "0");
    } catch { /* localStorage disabled · non-fatal */ }
  }, []);

  const toggleDeepWork = useCallback(() => {
    // 2026-07-19 · single-setter fix. The prior body called both
    // `setDeepWork(!readInitial())` AND `setDeepWorkState((prev) => !prev)`
    // in the same callback · React 18 automatic batching runs the direct
    // value setter first, then the functional updater sees the JUST-set
    // value and inverts it AGAIN, netting zero change. The toggle button
    // appeared to do nothing. Fix: one functional updater, one localStorage
    // write, done.
    setDeepWorkState((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(DEEP_WORK_STORAGE_KEY, next ? "1" : "0");
      } catch { /* localStorage disabled · non-fatal */ }
      return next;
    });
  }, []);

  // Global Cmd+B (Ctrl+B on non-Mac) → toggle. Placed at document level
  // so any focused input surface accepts the keystroke without needing
  // a listener attached to it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "b" && e.key !== "B") return;
      if (!(e.metaKey || e.ctrlKey)) return;
      // Don't fight browser bookmarks bar (Cmd+B is Chrome's bookmark
      // sidebar toggle). Prevent default so we own it inside the app.
      e.preventDefault();
      toggleDeepWork();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleDeepWork]);

  return { deepWork, setDeepWork, toggleDeepWork };
}
