export const INTRO_SEEN_KEY = "lc:intro-seen";
export const LEGACY_INTRO_SEEN_KEYS = ["liquidclips:intro-seen:v2"];

// v0.7.1 — intro now lives in sessionStorage instead of localStorage so it
// plays on every cold app launch (Daniel's locked direction: the intro is
// the brand moment, not a one-time onboarding). Within a single session a
// remount still skips the intro (e.g. if the splash unmounts + remounts on
// a transient sidecar restart). Resets when the webview process exits.
//
// We continue to wipe the LEGACY localStorage keys on every read so anyone
// upgrading from a previous build with localStorage-marked-seen still gets
// the intro on the next launch.

export function hasSeenIntro(): boolean {
  try {
    // Wipe legacy localStorage flags so previous "seen" state can't sticky.
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.removeItem(INTRO_SEEN_KEY);
        for (const key of LEGACY_INTRO_SEEN_KEYS) localStorage.removeItem(key);
      } catch {
        /* swallow — quota / sandbox */
      }
    }
    if (typeof sessionStorage === "undefined") return false;
    return sessionStorage.getItem(INTRO_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markIntroSeen(): void {
  try {
    sessionStorage.setItem(INTRO_SEEN_KEY, "1");
  } catch {
    /* sandboxed */
  }
}

export function resetIntroSeen(): void {
  try {
    sessionStorage.removeItem(INTRO_SEEN_KEY);
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(INTRO_SEEN_KEY);
      for (const key of LEGACY_INTRO_SEEN_KEYS) localStorage.removeItem(key);
    }
  } catch {
    /* sandboxed */
  }
}
