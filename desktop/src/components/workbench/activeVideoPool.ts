// Active-video pool helpers.
//
// At most MAX_ACTIVE_VIDEOS clips have a live <video> element mounted at any
// given time. The pool is an LRU with two pin classes ("focused", "playing")
// that protect their entries from eviction.
//
// Pure functions — no React, no zustand. Both the store and components import
// these so the pool policy is one definition, not three.

import type { ActiveVideoPool, WindowId } from "./types";
import { MAX_ACTIVE_VIDEOS } from "./types";

export function isInPool(pool: ActiveVideoPool, id: WindowId): boolean {
  return pool.ids.indexOf(id) !== -1;
}

/**
 * Decide which window id should be evicted to make room for a new entry.
 *
 * Rules:
 *  - Never evict an entry whose reason is "focused" (single focused window).
 *  - Never evict an entry whose reason is "playing" (during master play_all).
 *  - Otherwise evict the LRU head (oldest at ids[0]).
 *
 * Returns null when there's room OR when every entry is protected (caller
 * must drop the incoming entry on the floor rather than evict a protected one).
 *
 * `addingReason` is accepted for forward-compat (e.g. a future policy where
 * "pinned" beats "hover"); current implementation does not branch on it.
 */
export function evictionTarget(
  pool: ActiveVideoPool,
  _addingReason: ActiveVideoPool["reason"][string],
): WindowId | null {
  if (pool.ids.length < MAX_ACTIVE_VIDEOS) return null;
  for (const id of pool.ids) {
    const reason = pool.reason[id];
    if (reason === "focused" || reason === "playing") continue;
    return id;
  }
  return null;
}
