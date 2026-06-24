/**
 * browse:open default subscriber · Phase 6L-B
 *
 * Single source of truth for "how does the app handle a browse:open event
 * when no in-app browser overlay is mounted?". Tries `openSmart` (Tauri
 * shell plugin) first, falls back to `window.open` in plain-browser
 * preview, then surfaces a toast either way.
 *
 * A future in-app browser overlay should:
 *   1. subscribe to `browse:open` before this module mounts (or run
 *      `setBrowseOpenDefault(false)` to disable this default), and
 *   2. handle the event in-process.
 *
 * Toast copy stays generic ("discussion" / "external mirror") so the
 * Community → Campaign mental-model shift in Phase 6M doesn't require
 * a string rewrite.
 */

import { bus } from "./events";

let mounted = false;
let enabled = true;

export function setBrowseOpenDefault(active: boolean): void {
  enabled = active;
}

export function mountBrowseOpenDefault(): () => void {
  if (mounted) return () => undefined;
  mounted = true;
  const off = bus.on("browse:open", async (p) => {
    if (!enabled) return;
    const label = p.title ?? "Discussion";
    const mirrorTag = p.mirror === "whop" ? " · Whop mirror" : "";
    try {
      const mod = await import("../../lib/openSmart");
      await mod.openSmart(p.url);
      bus.emit("toast", {
        kind: "success",
        title: "Opening discussion",
        body: `${label}${mirrorTag} · launching.`,
      });
    } catch {
      try {
        window.open(p.url, "_blank", "noopener,noreferrer");
        bus.emit("toast", {
          kind: "info",
          title: "Browser fallback",
          body: `Opened ${label}${mirrorTag} in your browser · native discussion lands later.`,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        bus.emit("toast", { kind: "error", title: "Couldn't open discussion", body: msg });
      }
    }
  });
  return () => { off(); mounted = false; };
}

/* Auto-mount at import time so any surface that emits browse:open after
 * boot gets the default behaviour. Idempotent · safe to import many
 * times. */
if (typeof window !== "undefined") {
  mountBrowseOpenDefault();
}
