// v0.7.45 — Centralized "open whatever" helper. Routes URLs through the
// shell plugin (which enforces a strict `^(mailto:|tel:|https?://)` regex)
// and filesystem paths through the opener plugin (which has no such scope).
//
// The bug this fixes: every Library card's "Open folder" click, every
// ClipPreview "Reveal in Finder", every WindowManager "open dir", every
// Settings "open in Finder" fed a `/Users/...` path into shell.open and got
// the red banner: "Scoped command argument at position 0 was found, but
// failed regex validation `^((mailto:\w+)|(tel:\w+)|(https?://\w+)).+`".
// Filesystem paths simply aren't URLs — shell.open was the wrong API.
//
// Usage:
//   openSmart("https://liquidclips.app/terms")  → routed through shell
//   openSmart("/Users/dipdip/LiquidClips/foo")  → routed through opener
//   openSmart("mailto:support@…")               → routed through shell
//
// The router is conservative: anything with a URL-shaped prefix
// (http/https/mailto/tel) goes to shell; everything else goes to opener.
// Tauri 2's opener plugin gracefully handles macOS paths (delegates to
// `open` / `xdg-open`), so the wrapper is byte-identical to direct calls
// for the call sites we care about.

import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { openPath as openerOpenPath, openUrl as openerOpenUrl } from "@tauri-apps/plugin-opener";

const URL_PREFIX = /^(https?:|mailto:|tel:)/i;

/**
 * Open a URL or filesystem path with the correct Tauri plugin.
 *
 * - http(s)/mailto/tel → shell plugin (matches its allow-list regex)
 * - everything else (paths, file:// URLs) → opener plugin
 *
 * Throws if both plugins reject the target. Callers should `try/catch`
 * the same way they already do around `shell.open`.
 */
export async function openSmart(target: string): Promise<void> {
  if (!target) {
    // Guard against empty / null props that previously fired a scope-regex
    // error banner the user couldn't action.
    throw new Error("openSmart: empty target");
  }
  if (URL_PREFIX.test(target)) {
    await shellOpen(target);
    return;
  }
  await openerOpenPath(target);
}

/**
 * Force-open a URL through the opener plugin's URL channel. Useful when
 * the URL host might not match shell's allow-list (e.g. custom schemes
 * like `liquidclips://` deep links rendered from external chrome).
 */
export async function openUrlViaOpener(url: string): Promise<void> {
  await openerOpenUrl(url);
}
