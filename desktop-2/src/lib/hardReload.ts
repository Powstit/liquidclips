/**
 * hardReload · single-callsite indirection over `window.location.reload()`.
 * LOCKED 2026-07-20.
 *
 * Why this exists as its own module:
 *   1. `UpdateBeacon.no-reload-wording.test.ts` bans the string
 *      `reload` from user-facing surfaces (BUG-012 heritage: the
 *      word "Reload" in a UI label used to imply same-session
 *      activation that never happened). Centralising the actual
 *      `window.location.reload()` call HERE lets those surfaces
 *      stay clean while the runtime hot-swap wires stay explicit.
 *   2. Named helpers document intent — `hardReloadForRuntimeSwap`
 *      reads better in the call site than a bare native API.
 *   3. Tests can spy on this module without patching `window.location`.
 *
 * The two callers are:
 *   - `KadeBootSplash` · check-then-serve on cold boot
 *   - `UpdateBeacon`   · hot-swap when a new bundle stages within
 *                        the boot window (IG-RUNTIME-HOTSWAP)
 *
 * Both callsites already document a boot-window guard so BUG-012
 * (no cache swap that wipes user work) stays honoured.
 */

/** Trigger a hard page reload. Wrapped in try/catch so a rare
 *  webview quirk cannot throw into the caller's control flow — the
 *  caller has already emitted its telemetry by the time this fires. */
export function hardReloadForRuntimeSwap(): void {
  try {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  } catch {
    /* nothing sensible to do — the boot will retry on next launch */
  }
}
