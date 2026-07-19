/**
 * composerHandoff · Composer → Workstation intent bridge.
 *
 * The alias `export: { to: "workstation" }` at
 * `design-os/routing/SimulatorRouter.tsx:264` means clicking Ship in
 * Composer lands the user on Workstation, which owns the real export
 * path (`PublishModule.tsx` → `exportApi.exportClip()`).
 *
 * Settings persistence across routes is a solved problem:
 * `CockpitProvider.patch()` writes every user pick to
 * `clipSettingsStore` keyed by (slug, clipIdx). When Workstation mounts
 * its own `CockpitProvider` for the same (slug, clipIdx), `seedFor()`
 * reads those persisted picks back into cockpit state automatically.
 *
 * This module carries what does NOT ride the store:
 *   - the **intent signal** — "the user got here by clicking Ship,
 *     not by browsing" — so Workstation can auto-focus the right clip
 *     and (future) auto-trigger PublishModule.publish()
 *   - the **campaign context** — which Whop bounty the user was
 *     shipping into, for the auto-mount of SubmitToWhopModal after
 *     export success
 *   - the **clip identity** — so Workstation force-selects the same
 *     (slug, clip.idx) rather than starting at whatever ResultsGrid
 *     last remembered
 *
 * Contract (v1 · never break without a version bump):
 *   - storage key      · `lc.composer.handoff.v1`
 *   - shape            · `{ ts, slug, clipIdx, campaignId? }`
 *   - TTL              · 15 min after `ts` · older entries auto-clear on read
 *   - clear-on-consume · Workstation clears after applying to avoid
 *                        stale prefill on re-nav
 */

export const COMPOSER_HANDOFF_STORAGE_KEY = "lc.composer.handoff.v1";
const HANDOFF_TTL_MS = 15 * 60 * 1000;

export interface ComposerHandoff {
  /** ms · TTL enforcement. */
  ts: number;
  /** Engine project slug the picks belong to. */
  slug: string;
  /** Clip index inside the project. */
  clipIdx: number;
  /** Optional · campaign the user was viewing when they shipped.
   *  Workstation stores it in sessionStorage so a post-export flow
   *  can auto-mount `SubmitToWhopModal` against it. */
  campaignId?: string | null;
}

function _canUseStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch { return false; }
}

/** Write a handoff · called by Composer's Ship button BEFORE nav. */
export function writeComposerHandoff(handoff: Omit<ComposerHandoff, "ts">): void {
  if (!_canUseStorage()) return;
  try {
    const payload: ComposerHandoff = { ...handoff, ts: Date.now() };
    window.localStorage.setItem(COMPOSER_HANDOFF_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private-mode · silent · non-blocking */
  }
}

/** Read + clear a handoff · called by Workstation on mount. Returns
 *  null when nothing is pending, expired, or malformed. */
export function readAndClearComposerHandoff(): ComposerHandoff | null {
  if (!_canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(COMPOSER_HANDOFF_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ComposerHandoff | null;
    if (!parsed || typeof parsed !== "object") {
      window.localStorage.removeItem(COMPOSER_HANDOFF_STORAGE_KEY);
      return null;
    }
    if (typeof parsed.ts !== "number" || Date.now() - parsed.ts > HANDOFF_TTL_MS) {
      window.localStorage.removeItem(COMPOSER_HANDOFF_STORAGE_KEY);
      return null;
    }
    window.localStorage.removeItem(COMPOSER_HANDOFF_STORAGE_KEY);
    return parsed;
  } catch {
    return null;
  }
}

/** Non-destructive peek — for tests + Doctor tab. Never clears. */
export function peekComposerHandoff(): ComposerHandoff | null {
  if (!_canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(COMPOSER_HANDOFF_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ComposerHandoff | null;
  } catch { return null; }
}
