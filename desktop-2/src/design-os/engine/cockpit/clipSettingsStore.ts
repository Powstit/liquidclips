/**
 * clipSettingsStore · BUG-031 · per-clip cockpit settings persistence.
 *
 * Pure localStorage adapter, keyed by `lc.clip.${slug}:${clipIdx}`. Edits
 * made in Reaction / Caption / Trim / Style / Schedule / Publish modules
 * survive tab switch, clip switch, and reload.
 *
 * Contract (UI/state layer only — no sidecar, no engine):
 *   read(slug, clipIdx)            → Partial<CockpitSettings> | null
 *   write(slug, clipIdx, partial)  → void (deep-merges over existing entry)
 *   clear(slug, clipIdx)           → void
 *
 * Storage failures (QuotaExceeded, private-mode rejection, JSON parse
 * errors) are swallowed silently after a single console.warn so the
 * cockpit always degrades to in-memory state rather than crashing the
 * Workstation route.
 */

import type { CockpitSettings } from "./CockpitContext";

const KEY_PREFIX = "lc.clip.";

function keyFor(slug: string, clipIdx: number): string {
  return `${KEY_PREFIX}${slug}:${clipIdx}`;
}

let warnedOnce = false;
function warnOnce(err: unknown) {
  if (warnedOnce) return;
  warnedOnce = true;
  // eslint-disable-next-line no-console
  console.warn("[clipSettingsStore] localStorage unavailable — cockpit edits will not persist.", err);
}

export function read(slug: string | undefined, clipIdx: number): Partial<CockpitSettings> | null {
  if (!slug) return null;
  try {
    const raw = window.localStorage.getItem(keyFor(slug, clipIdx));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Partial<CockpitSettings>;
    return null;
  } catch (err) {
    warnOnce(err);
    return null;
  }
}

export function write(slug: string | undefined, clipIdx: number, partial: Partial<CockpitSettings>): void {
  if (!slug) return;
  try {
    const k = keyFor(slug, clipIdx);
    const prev = read(slug, clipIdx) ?? {};
    const next: Partial<CockpitSettings> = { ...prev };
    // Per-section shallow merge — each CockpitSettings key holds its own
    // object literal (reaction, caption, trim, style, schedule, publish),
    // so merging at section level keeps unrelated sections untouched.
    for (const sectionKey of Object.keys(partial) as Array<keyof CockpitSettings>) {
      const incoming = partial[sectionKey];
      if (incoming == null) continue;
      const prevSection = (prev as Record<string, unknown>)[sectionKey];
      (next as Record<string, unknown>)[sectionKey] =
        prevSection && typeof prevSection === "object"
          ? { ...prevSection, ...incoming }
          : incoming;
    }
    window.localStorage.setItem(k, JSON.stringify(next));
  } catch (err) {
    warnOnce(err);
  }
}

export function clear(slug: string | undefined, clipIdx: number): void {
  if (!slug) return;
  try {
    window.localStorage.removeItem(keyFor(slug, clipIdx));
  } catch (err) {
    warnOnce(err);
  }
}
