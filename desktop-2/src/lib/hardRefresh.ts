/**
 * hardRefresh · permanent "Refresh app" primitive
 *
 * Daniel confirmed 2026-07-11 that the three existing reload paths
 *   (UpdateBeacon, BrowseOverlay, Cmd+R)
 * are all conditional or undiscoverable — the UpdateBeacon only appears
 * when a staged bundle is present, the BrowseOverlay reload only fires
 * when the overlay is open, and Cmd+R is a raw webview shortcut with no
 * user-facing affordance. This primitive is the single, permanent
 * "Refresh app" action wired into the TopHud avatar-orbit menu.
 *
 * Contract:
 *   1. Emit `hard_refresh_triggered` diagnostic (correlates the pre-
 *      refresh state to any post-refresh diagnostics landing on the same
 *      session id).
 *   2. Fire `app:hard-refresh` on the shared bus. Reserved for future
 *      cancellation subscribers (fetch owners, timer queues, WebSocket
 *      cleanup) · today no listeners live in the tree, so this is a
 *      forward-compatible hook and NOT a runtime guarantee that in-
 *      flight work is aborted. Emit-and-forget — never blocks refresh.
 *      Ship-lens P1-002 · 2026-07-11 · doc softened to match reality.
 *   3. `sessionStorage.clear()` — session-scoped state is safe to wipe
 *      unconditionally because it doesn't survive a real webview reload
 *      anyway; this just makes the wipe explicit and immediate.
 *   4. Preserve a curated set of localStorage keys, wipe everything else
 *      matching known Liquid Clips namespaces:
 *        Preserve: `lc.license.jwt.v1` (JWT · sign-out only),
 *                  `lc.affiliate.snapshot.v1` (attribution cache · sales
 *                                              regression if wiped),
 *                  `lc.mode` (Clipper vs Agency chrome · UX regression),
 *                  `lc.nav.collapsed.v1` (SideNav layout preference).
 *        Wipe:     any key starting with `lc.` / `lc:` / `postiz.` /
 *                  `engine.` that isn't in the preserve list.
 *   5. Do NOT touch the OS Keychain — that would prompt macOS. Real
 *      sign-out already calls `clearJwtKeychainForAuthAction()`.
 *   6. `window.location.reload()` — Tauri webview picks up any staged
 *      bundle from `~/Library/AppSupport` on the next mount.
 */

import { bus } from "../design-os/bridge";
import { lcDiag } from "./diagnosticLogger";

/** Keys we NEVER wipe on hard refresh. Adding a key here is a Daniel-
 *  visible decision (JWT preservation is the reason this isn't a
 *  full clear — a fresh sign-in dance every refresh is unacceptable). */
export const HARD_REFRESH_PRESERVED_KEYS: readonly string[] = [
  "lc.license.jwt.v1",
  "lc.affiliate.snapshot.v1",
  "lc.mode",
  "lc.nav.collapsed.v1",
  // Ship-lens P1-001 · 2026-07-11 · zustand user-mode store shares the
  // clipper/agency choice with lc.mode. Wiping this key while preserving
  // lc.mode caused the TopHud pill to show Agency while EditorSection's
  // useUserMode() reset to clipper — silent chrome/state drift. Both
  // preserved until a follow-up sweep collapses the two into one source
  // of truth.
  "lc:user-mode:v1",
];

/** Prefixes that gate the wipe. A key that doesn't match any of these
 *  is left alone — hard refresh is a Liquid Clips + Postiz + engine
 *  session reset, NOT a "clear everything I don't recognise" bulldozer. */
const WIPE_PREFIXES: readonly string[] = [
  "lc.",
  "lc:",
  "postiz.",
  "engine.",
];

function shouldWipe(key: string): boolean {
  if (HARD_REFRESH_PRESERVED_KEYS.includes(key)) return false;
  for (const prefix of WIPE_PREFIXES) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

export async function hardRefresh(): Promise<void> {
  // Step 1 · farewell diagnostic — must land BEFORE any storage mutation
  // so a listener reading window.location.hash sees the pre-refresh route.
  try {
    lcDiag("hard_refresh_triggered", {
      from_route: typeof window !== "undefined" ? window.location.hash : "",
    });
  } catch { /* diagnostic failure must not block a refresh */ }

  // Step 2 · best-effort abort signal · emit-and-forget.
  // The bus is synchronous; subscribers get their tick immediately.
  try {
    bus.emit("app:hard-refresh", {});
  } catch { /* a bad handler cannot block the refresh */ }

  // Step 3 · sessionStorage · wholesale clear.
  try {
    if (typeof window !== "undefined") {
      window.sessionStorage.clear();
    }
  } catch { /* jsdom / privacy-mode edge cases · non-fatal */ }

  // Step 4 · localStorage · curated wipe.
  try {
    if (typeof window !== "undefined") {
      const ls = window.localStorage;
      // Snapshot keys FIRST — removing while iterating shifts the index.
      const allKeys: string[] = [];
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (typeof k === "string") allKeys.push(k);
      }
      for (const k of allKeys) {
        if (shouldWipe(k)) {
          try { ls.removeItem(k); } catch { /* per-key failure · continue */ }
        }
      }
    }
  } catch { /* localStorage unavailable · non-fatal · reload still runs */ }

  // Step 5 · deliberately NOT calling clearJwtKeychainForAuthAction —
  // that would prompt the macOS Keychain and stomp the sign-in state.
  // Sign-out remains the only path that clears the Keychain mirror.

  // Step 6 · reload the webview. This is the hard cut — any code past
  // this line runs only if `reload()` is stubbed (tests) or missing.
  try {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  } catch { /* test seams may throw · non-fatal */ }
}
