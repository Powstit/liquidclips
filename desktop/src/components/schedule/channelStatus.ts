// v0.7.32 — single source of truth for the defensive stale-status override.
// ChannelRow (Schedule + Settings/Connections list) and ChannelPicker (Routes
// modal) both render channel state. The per-channel DB `status` column can lag
// behind Ayrshare's actual link state — Ayrshare reports the platform as
// linked but our DB row is still `pending_link`/`unlinked`/`error`. The
// backend `/sync` handler now reconciles on every tick, but the UI keeps a
// belt-and-suspenders override so the user never sees a publishable channel
// as un-routable while the backend catches up.
//
// Extracted from inline copies in ChannelRow.tsx + ChannelPicker.tsx so a
// future tweak (e.g. add Threads, change Twitter/X handling) lands in ONE
// place.

import type { Channel } from "./types";

/** DB statuses the Ayrshare snapshot is allowed to flip to "active". Active /
 *  paused / deleted are user-intent states that the override must never
 *  silently override. */
export const STALE_OVERRIDABLE: ReadonlySet<Channel["status"]> = new Set([
  "pending_link",
  "unlinked",
  "error",
]);

/** True when the channel should be treated as routable, accounting for the
 *  Ayrshare snapshot. Returns the raw `status === "active"` if no snapshot
 *  was provided (defensive — the override is opt-in per call site). */
export function isEffectivelyActive(
  channel: Channel,
  ayrshareLinkedPlatforms: readonly string[],
): boolean {
  if (channel.status === "active") return true;
  if (!STALE_OVERRIDABLE.has(channel.status)) return false;
  if (ayrshareLinkedPlatforms.length === 0) return false;
  const platform = channel.platform.toLowerCase();
  const linkedLc = ayrshareLinkedPlatforms.map((p) => p.toLowerCase());
  // Twitter/X reconciliation — Ayrshare reports `twitter` for what our DB
  // stores as `x`. Treat them as equivalent in the override check.
  return (
    linkedLc.includes(platform) ||
    (platform === "x" && linkedLc.includes("twitter")) ||
    (platform === "twitter" && linkedLc.includes("x"))
  );
}
