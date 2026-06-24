/**
 * GET /api/whop-oauth/start?challenge=<nonce>
 *
 * Marketing-side OAuth kickoff. Same-origin shim that:
 *   1. Validates the challenge shape so a malformed param fails fast at the
 *      apex domain (where the user is) instead of after a cross-domain bounce.
 *   2. Sets a short-lived HttpOnly state cookie so the optional callback
 *      route (`/api/whop-oauth/callback`) can verify the state token if
 *      Whop's redirect_uri is ever reconfigured to land on marketing.
 *   3. 302s to the canonical backend route
 *      (`api.liquidclips.app/auth/whop/start`) which holds the OAuth client
 *      secret and the rest of the state machine.
 *
 * The user sees ONE redirect from `liquidclips.app/api/whop-oauth/start` to
 * Whop, never a flicker through `api.liquidclips.app` in the URL bar.
 *
 * Architecture invariant (memory `liquid-clips-whop-lead-decision`):
 *   Whop is PRIMARY. This route exists so that ownership of the "start"
 *   surface lives on the apex marketing domain, not on the API subdomain —
 *   making it trivial later to move the entire OAuth state machine off
 *   the backend without breaking the URL the desktop opens.
 */

import { NextResponse } from "next/server";
import {
  WHOP_BACKEND_OAUTH_BASE,
  isValidChallenge,
} from "@/lib/whop-oauth";

export const runtime = "nodejs";

const STATE_COOKIE = "lc_whop_oauth_state";
const STATE_COOKIE_MAX_AGE_SECONDS = 60 * 10; // 10 minutes — matches Whop's
// authorise-code TTL plus a healthy buffer for slow consent screens.

export async function GET(request: Request) {
  const url = new URL(request.url);
  const challenge = url.searchParams.get("challenge") ?? "";

  if (!isValidChallenge(challenge)) {
    // Bounce the user back to the connect page with a marker the UI can
    // render as a real error message. Never echo the bad value back.
    const back = new URL("/connect-desktop", url.origin);
    back.searchParams.set("whop_error", "bad_challenge");
    return NextResponse.redirect(back, 302);
  }

  // Build the upstream target. The backend will handle the full
  // authorise → token → mint → deep-link cycle.
  const upstream = new URL(`${WHOP_BACKEND_OAUTH_BASE}/auth/whop/start`);
  upstream.searchParams.set("challenge", challenge);

  const response = NextResponse.redirect(upstream, 302);

  // Stash an HttpOnly state cookie. The state value is the challenge itself
  // (already a one-time nonce from the desktop) — that's safe because the
  // desktop verifies the challenge again on `liquidclips://activate`. The
  // cookie is only used IF the callback route ever needs to verify state
  // server-side (i.e. if Whop's redirect_uri is migrated to marketing).
  response.cookies.set({
    name: STATE_COOKIE,
    value: challenge,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
  });

  return response;
}
