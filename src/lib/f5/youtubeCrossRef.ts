/**
 * F5 · Layer 2 · YouTube cross-reference (STUB).
 *
 * TODO(claude-1-layer-4): Real F7 worker (`POST /yt/batch-lookup`) is
 * built in Layer 4 (G2). Until then this module exposes the exact
 * interface F5 expects and every caller mocks it — the fallback roster
 * builder tests exercise the flow with synthetic YT match counts at
 * 0, 3, and 8 without ever hitting a real YouTube API.
 *
 * When Layer 4 lands, replace the body of `batchLookup` with the real
 * `fetch('/yt/batch-lookup', ...)` call. Callers don't change.
 */

export interface YouTubeMatch {
  domain: string;
  channel_id: string;
  handle: string;
  avatar_url: string;
  sub_count: number;
  latest_10_videos: string[];
}

export interface BatchLookupRequest {
  domains: readonly string[];
  min_subs?: number;
}

export type BatchLookup = (req: BatchLookupRequest) => Promise<YouTubeMatch[]>;

/** Default stub that returns []. Callers inject a real impl for tests. */
export const stubBatchLookup: BatchLookup = async () => {
  // TODO(claude-1-layer-4) · wire to backend POST /yt/batch-lookup
  return [];
};

export function filterBySubCount(matches: readonly YouTubeMatch[], minSubs: number): YouTubeMatch[] {
  return matches.filter((m) => (m.sub_count ?? 0) >= minSubs);
}
