/**
 * whopSubmit · Composer C7 · desktop-side one-click clip submission client.
 *
 * ⚠ IRON GATE IG-COMPOSER-Z · Whop clip submit contract (desktop side).
 *
 * Composer's Ship module POSTs the finished clip meta to
 * junior-backend/routes/whop.py :: POST /whop/submit which wraps the
 * Whop GraphQL createPublicBountySubmission mutation. Returns the
 * hosted submission URL so Kade can open it in the persistent-cookie
 * in-app webview (LOCKED memory liquidclips_publish_walkaround.md).
 */

import { authedFetch } from "./authedFetch";

const BACKEND_URL =
  (import.meta as { env?: { VITE_BACKEND_URL?: string } }).env?.VITE_BACKEND_URL?.replace(
    /\/+$/,
    "",
  ) ?? "https://api.jnremployee.com";

export interface ComposerSubmitRequest {
  campaign_id: string;
  clip_url: string;
  caption?: string;
  duration_s: number;
  aspect: string;
}

export interface ComposerSubmitResponse {
  submission_id: string;
  submission_url: string;
  campaign_id: string;
  source: string;
}

export async function submitClipToBounty(
  req: ComposerSubmitRequest,
): Promise<ComposerSubmitResponse> {
  const resp = await authedFetch(`${BACKEND_URL}/whop/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!resp.ok) {
    throw new Error(`whop_submit.status_${resp.status}`);
  }
  return (await resp.json()) as ComposerSubmitResponse;
}
