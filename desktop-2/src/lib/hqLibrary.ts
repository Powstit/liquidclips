/**
 * ⚠ IRON GATE IG-COMPOSER-K · HQ library client contract.
 *
 * This module is the ONLY desktop-side entry point to HQ's 1.3M-channel
 * archive. It talks to junior-backend's /library/* proxy — never to
 * the HQ hostname directly. The upstream shared secret stays inside the
 * backend perimeter; the desktop authenticates with its license JWT
 * via authedFetch and lets the backend attach the upstream header.
 *
 * Reference: HQ_YOUTUBE_LIBRARY_API_HANDOFF_2026-07-17.md ·
 *            HQ_YOUTUBE_LIBRARY_RESPONSE_ANALYSIS.md ·
 *            FRONT-DOOR-thumbnail-wall.html
 * Backend:   junior-backend/app/routes/library.py
 * Composer:  src/design-os/routes/Composer.tsx (source-picker · B-4)
 */

import { authedFetch } from "./authedFetch";

// Backend base URL is env-overridable (VITE_BACKEND_URL) so dev + CI can
// point at a local FastAPI. Default is production api.jnremployee.com,
// same as useAuditableAction.ts. The desktop must NEVER address the HQ
// hostname directly — that path leaves the shared read secret exposed
// and breaks the IG-COMPOSER-K contract.
const BACKEND_URL =
  (import.meta as { env?: { VITE_BACKEND_URL?: string } }).env?.VITE_BACKEND_URL?.replace(
    /\/+$/,
    "",
  ) ?? "https://api.jnremployee.com";

export interface LibraryChannelHit {
  lc_id: string;
  handle: string;
  name: string;
  niche: string;
  subs: number;
  tier: "small" | "big" | "whale" | string;
  video_id: string;
  thumb?: string | null;
  channel_url?: string | null;
}

export interface LibrarySearchResponse {
  ok?: boolean;
  results: LibraryChannelHit[];
  next_cursor?: string | null;
  total?: number;
}

export interface LibrarySearchParams {
  q?: string;
  niche?: string;
  tier?: string;
  min_subs?: number;
  has_video?: 0 | 1;
  limit?: number;
  cursor?: string;
}

export interface HandoffMoment {
  start_s: number;
  end_s: number;
  hook: string;
}

export interface LibraryHandoffResponse {
  video_id: string;
  source_url: string;
  thumb?: string | null;
  caption_track_url?: string | null;
  duration_s?: number;
  moments: HandoffMoment[];
  whisper_needed: boolean;
  _cache?: "live" | "warm" | "cold" | string;
}

export interface PodcastHandoffResponse {
  episode_id: string;
  kind: "podcast";
  source_url: string;
  audio_url: string;
  image?: string | null;
  title: string;
  podcast: string;
  duration_s: number;
  word_count?: number;
  transcript_segments: Array<{ start_s: number; end_s: number; text: string }>;
  moments: HandoffMoment[];
  whisper_needed: false;
  _cache?: "live" | "warm" | "cold" | string;
}

async function getJson<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${BACKEND_URL}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  const resp = await authedFetch(url.toString());
  if (!resp.ok) {
    throw new Error(`hq_library.${path}.status_${resp.status}`);
  }
  return (await resp.json()) as T;
}

export function searchLibrary(params: LibrarySearchParams = {}): Promise<LibrarySearchResponse> {
  return getJson<LibrarySearchResponse>("/library/search", {
    q: params.q ?? "",
    niche: params.niche,
    tier: params.tier,
    min_subs: params.min_subs,
    has_video: params.has_video ?? 1,
    limit: params.limit ?? 24,
    cursor: params.cursor,
  });
}

export function getLibraryChannel(lcId: string): Promise<Record<string, unknown>> {
  return getJson<Record<string, unknown>>(`/library/channel/${encodeURIComponent(lcId)}`);
}

export function getLibraryHandoff(videoId: string): Promise<LibraryHandoffResponse> {
  return getJson<LibraryHandoffResponse>(`/library/handoff/${encodeURIComponent(videoId)}`);
}

export function getPodcastHandoff(episodeId: string): Promise<PodcastHandoffResponse> {
  return getJson<PodcastHandoffResponse>(`/podcast/handoff/${encodeURIComponent(episodeId)}`);
}

/** Public thumbnail URL from YouTube's own CDN — zero API cost, per HQ
 *  FRONT-DOOR guidance. Always exists for any videoId. */
export function ytThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}
