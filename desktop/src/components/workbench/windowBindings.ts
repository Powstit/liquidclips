// Pure binding helpers shared between the store + AccountBindingChip.
//
// No React, no async — these are deterministic transformations over
// `WindowState[]`. Tests and callers can rely on them being side-effect free.

import type { WindowState } from "./types";

/**
 * Union of channel ids across the given windows.
 *
 * Used by MasterToolbar's schedule action to compute the fan-out target set
 * when N windows are selected: the post should hit every channel any
 * selected window is bound to, without duplicates and without caring about
 * iteration order quirks of Set.
 *
 * Order is preserved as "first seen across the input" so the master
 * toolbar's avatar stack feels stable as the user adds/removes selections.
 */
export function unionBindings(windows: WindowState[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const w of windows) {
    for (const id of w.boundChannelIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      ordered.push(id);
    }
  }
  return ordered;
}

/**
 * Removes a channel id from every window's binding.
 *
 * Called when the channel is deleted upstream (Settings → Connections, or a
 * stale OAuth link tear-down). Without this, a deleted channel would linger
 * in `boundChannelIds` and the schedule action would try to fan-out to a
 * 404 target — strands the user staring at a failed-publish row with no
 * obvious cause.
 *
 * Returns a new array of NEW WindowState objects (immutable update) so
 * downstream Zustand consumers re-render correctly.
 */
export function purgeBinding(windows: WindowState[], channelId: string): WindowState[] {
  return windows.map((w) => {
    if (!w.boundChannelIds.includes(channelId)) return w;
    return {
      ...w,
      boundChannelIds: w.boundChannelIds.filter((id) => id !== channelId),
    };
  });
}
