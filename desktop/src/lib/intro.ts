export const INTRO_SEEN_KEY = "lc:intro-seen";
export const LEGACY_INTRO_SEEN_KEYS = ["liquidclips:intro-seen:v2"];

export function hasSeenIntro(): boolean {
  try {
    if (localStorage.getItem(INTRO_SEEN_KEY) === "1") return true;
    return LEGACY_INTRO_SEEN_KEYS.some((key) => localStorage.getItem(key) === "1");
  } catch {
    return true;
  }
}

export function markIntroSeen(): void {
  try {
    localStorage.setItem(INTRO_SEEN_KEY, "1");
    for (const key of LEGACY_INTRO_SEEN_KEYS) localStorage.setItem(key, "1");
  } catch {
    /* sandboxed */
  }
}

export function resetIntroSeen(): void {
  try {
    localStorage.removeItem(INTRO_SEEN_KEY);
    for (const key of LEGACY_INTRO_SEEN_KEYS) localStorage.removeItem(key);
  } catch {
    /* sandboxed */
  }
}
