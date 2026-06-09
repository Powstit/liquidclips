export const INTRO_SEEN_KEY = "lc:intro-seen:v1";
export const LEGACY_INTRO_SEEN_KEYS = [
  "lc:intro-seen",
  "liquidclips:intro-seen:v2",
];

// v0.7.34 — intro now lives in localStorage so users see the brand moment
// once per install, not on every cold launch. Daniel confirmed on
// 2026-06-09: the every-launch replay punished beta users who relaunch
// daily ("if users dont see intro window after second install and it
// works its fine"). First install captures the brand moment; subsequent
// launches skip straight to the app. A "Replay intro" Settings toggle
// can re-introduce the brand moment on demand post-beta.
//
// The LEGACY_INTRO_SEEN_KEYS purge runs once per read so anyone upgrading
// from the v0.7.1 sessionStorage build (or older localStorage builds with
// a different key) gets a clean state migration: their old "seen" flag
// stops applying, and the new flag is written the first time the intro
// finishes (or is skipped).

export function hasSeenIntro(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    // Purge stale keys from prior builds so they can't fight the new gate.
    for (const key of LEGACY_INTRO_SEEN_KEYS) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* swallow — sandboxed / quota */
      }
    }
    return localStorage.getItem(INTRO_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markIntroSeen(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(INTRO_SEEN_KEY, "1");
  } catch {
    /* sandboxed / quota */
  }
}

export function resetIntroSeen(): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(INTRO_SEEN_KEY);
      for (const key of LEGACY_INTRO_SEEN_KEYS) localStorage.removeItem(key);
    }
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(INTRO_SEEN_KEY);
      sessionStorage.removeItem("lc:intro-seen");
    }
  } catch {
    /* sandboxed */
  }
}
