/**
 * F5 · Layer 2 · production drivers for the Crew scanner.
 *
 * The SyncMailMoneyDrop route ships DI'd — three collaborators are
 * injected: `oauthDriver`, `httpFetch`, `batchLookup`. This module
 * provides the real, no-demo implementations that connect to Google
 * (via OS-browser deep-link) and to the Liquid Clips backend.
 *
 * Never imports the demo drivers. Never persists tokens beyond the
 * scanner's own memory. Never leaks the license JWT to any host other
 * than the Liquid Clips backend.
 *
 * Wired into `sections/outreach/OutreachSection.tsx` behind an
 * `import.meta.env.DEV` boundary so demo drivers only reach code
 * paths that a shipped user never touches.
 */

import { openSmart } from "../openSmart";
import { getJwt } from "../authStorage";
import { awaitGoogleOAuth, mintOAuthNonce } from "../googleOAuthPending";
import type { HttpFetch } from "./contactScan";
import type { OAuthDriver } from "./googleOAuth";
import { REQUIRED_SCOPES } from "./googleOAuth";
import type { BatchLookup, YouTubeMatch } from "./youtubeCrossRef";

// ─── OAuth · openSmart(Google consent URL) + deep-link callback ────

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

function backendUrl(): string {
  try {
    const env = (import.meta as unknown as { env?: { VITE_BACKEND_URL?: string } }).env ?? {};
    return (env.VITE_BACKEND_URL ?? "https://api.liquidclips.app").replace(/\/+$/, "");
  } catch {
    return "https://api.liquidclips.app";
  }
}

function redirectUri(): string {
  try {
    const env = (import.meta as unknown as { env?: { VITE_GOOGLE_REDIRECT_URI?: string } }).env ?? {};
    if (env.VITE_GOOGLE_REDIRECT_URI) return env.VITE_GOOGLE_REDIRECT_URI;
  } catch {
    /* fall through */
  }
  return `${backendUrl()}/auth/google/callback`;
}

function buildConsentUrl(clientId: string, state: string): string {
  const scope = REQUIRED_SCOPES.join(" ");
  const params = new URLSearchParams({
    client_id: clientId,
    scope,
    redirect_uri: redirectUri(),
    response_type: "code",
    state,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Real Google OAuth driver.
 *
 * Flow:
 *   1. Mint an anti-CSRF nonce (`state`).
 *   2. Build the Google consent URL with our client_id + scopes.
 *   3. `openSmart()` opens it in the OS default browser (never in-app
 *      webview — Google's consent screen refuses iframe/webview hosts).
 *   4. `awaitGoogleOAuth({ state })` returns a promise settled when
 *      the `liquidclips://google-oauth?...` deep-link fires.
 *
 * The driver returns a typed `OAuthResult`. The scanner walks
 * DENIED / MISCONFIGURED / NETWORK / TIMEOUT branches into the
 * corresponding UI states.
 */
export const productionOAuthDriver: OAuthDriver = async ({ clientId }) => {
  if (!clientId) {
    // Should already be caught upstream in runOAuth (googleOAuth.ts:57),
    // but keep the guard local so misuses surface the right error.
    return { ok: false, error: "MISCONFIGURED", note: "clientId absent" };
  }
  const state = mintOAuthNonce();
  const consentUrl = buildConsentUrl(clientId, state);
  const pending = awaitGoogleOAuth({ state });
  try {
    await openSmart(consentUrl);
  } catch (e) {
    return {
      ok: false,
      error: "NETWORK",
      note: `os-browser failed: ${String(e).slice(0, 200)}`,
    };
  }
  // Await the deep-link callback. If Google denies, the backend sends
  // us `liquidclips://google-oauth?error=DENIED&state=<nonce>`; if the
  // env vars aren't set, `error=MISCONFIGURED`.
  return pending;
};

// ─── HTTP fetch · Google APIs · minimal wrapper around global fetch ──

/**
 * Real HTTP fetch for Google APIs. Injects the caller-supplied auth
 * header (contactScan.ts already passes `authorization: Bearer <token>`)
 * and returns the same `{ status, body }` shape the scanner expects.
 *
 * Deliberately dumb: no retry, no caching, no telemetry. Everything
 * heavier belongs in scanner.ts / contactScan.ts.
 */
export const productionHttpFetch: HttpFetch = async ({ url, headers }) => {
  const res = await fetch(url, {
    method: "GET",
    headers,
    // No credentials on cross-origin google.com calls — the Bearer
    // header carries auth. Cookies would leak nothing useful.
    credentials: "omit",
    cache: "no-store",
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
};

// ─── Batch YouTube lookup · POSTs to junior-backend /yt/batch-lookup ──

interface BackendBatchLookupMatch {
  channel_id: string;
  channel_handle: string;
  subs: number;
  video_id?: string | null;
  verified_at?: string;
}
interface BackendBatchLookupResponse {
  matches: BackendBatchLookupMatch[];
  partial?: boolean;
}

/**
 * Real batch-lookup driver.
 *
 * The F5 scanner passes `{ domains, min_subs }`. The backend YT worker
 * accepts `{ video_ids, channel_ids }` (see junior-backend/app/yt_worker.py).
 * Domains aren't directly resolvable to YouTube channels without an
 * extra lookup step that isn't implemented today, so this driver:
 *   * Forwards the request when the callers supply channel_ids
 *     (future upgrade path).
 *   * Otherwise returns [] which triggers the roster builder's
 *     fallback branch (top-N inbox contacts by sent-count) — the
 *     honest empty state per Daniel's directive.
 *
 * This preserves the "zero matches → honest fallback" behavior in
 * production without inventing fake matches.
 */
export const productionBatchLookup: BatchLookup = async (req) => {
  const domains = req.domains ?? [];
  const minSubs = req.min_subs ?? 25_000;
  // Extract any channel-shaped tokens from the domain list — a real
  // resolver would extract channels via People API metadata (org.website)
  // but that lives on a future sprint. For now we surface an empty
  // match set so the roster falls back to inbox contacts.
  const channelIds = domains.filter((d) => /^UC[A-Za-z0-9_-]{20,24}$/.test(d));
  if (channelIds.length === 0) return [];

  const jwt = getJwt();
  if (!jwt) return [];

  try {
    const res = await fetch(`${backendUrl()}/yt/batch-lookup`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ channel_ids: channelIds }),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const payload = (await res.json()) as BackendBatchLookupResponse;
    const matches = payload.matches ?? [];
    return matches
      .filter((m) => (m.subs ?? 0) >= minSubs)
      .map<YouTubeMatch>((m) => ({
        domain: m.channel_handle,
        channel_id: m.channel_id,
        handle: m.channel_handle,
        avatar_url: "",
        sub_count: m.subs ?? 0,
        latest_10_videos: [],
      }));
  } catch {
    return [];
  }
};
