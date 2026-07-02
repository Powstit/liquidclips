/**
 * browse:open default subscriber · Phase 6L-B
 *
 * Single source of truth for `browse:open` events. The global Browser overlay
 * store is the primary destination. A system-handler fallback is used only
 * when that module is unavailable.
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
    // v2.2.18 sprint · in-app overlay is the primary handler. Only if
    //   the store isn't available do we fall back to openSmart (system
    //   browser). This prevents `browse:open` events from escaping the
    //   app when a call site emits without the overlay being subscribed.
    try {
      const store = await import("../../state/browseOverlay");
      store.useBrowseOverlay.getState().openWith(p.url);
      return;
    } catch { /* fall through */ }
    try {
      const mod = await import("../../lib/openSmart");
      await mod.openSmart(p.url);
      bus.emit("toast", {
        kind: "info",
        title: "External browser",
        body: `${label}${mirrorTag} · opened in your browser.`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      bus.emit("toast", { kind: "error", title: "Couldn't open discussion", body: msg });
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
