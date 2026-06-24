/**
 * GET /api/whop-oauth/callback?code=<c>&state=<challenge>
 *
 * Marketing-side OAuth callback. This route is OPTIONAL — the canonical
 * Whop OAuth redirect_uri is still `https://api.liquidclips.app/auth/whop/callback`
 * (junior-backend handles the full exchange + JWT mint there).
 *
 * This route exists so that:
 *   1. The marketing /api/whop-oauth/* surface is complete and self-describing.
 *   2. If `WHOP_OAUTH_REDIRECT_URI` is ever flipped to the marketing apex
 *      (e.g. for a future zero-backend-dependency UX), this route already
 *      handles state-cookie verification + forwards to the backend for the
 *      secret-bearing exchange.
 *   3. Anyone landing on `/api/whop-oauth/callback` accidentally (e.g. an
 *      old bookmark, a misconfigured Whop dashboard, a copy-paste error in a
 *      preview) gets a clear, branded redirect back to /connect-desktop
 *      instead of a 404.
 *
 * State verification:
 *   - The `state` query param MUST match the value of the `lc_whop_oauth_state`
 *     HttpOnly cookie set by /api/whop-oauth/start. CSRF defence.
 *   - On mismatch we 302 to /connect-desktop?whop_error=state_mismatch.
 *
 * Until the backend exposes a `POST /auth/whop/exchange` endpoint that
 * returns the license JWT as JSON, the only way to complete the flow with
 * a code in hand is via the backend's existing GET callback. So if this
 * route receives a real Whop code, it forwards the user to the canonical
 * backend callback (preserving code + state) — guaranteeing no flow is
 * ever stranded mid-OAuth regardless of which redirect_uri Whop used.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { WHOP_BACKEND_OAUTH_BASE } from "@/lib/whop-oauth";

export const runtime = "nodejs";

const STATE_COOKIE = "lc_whop_oauth_state";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // User cancelled, or Whop returned an error before issuing a code.
  if (error) {
    const back = new URL("/connect-desktop", url.origin);
    back.searchParams.set("whop_cancelled", "1");
    return clearStateAndRedirect(back);
  }

  // Missing required params → can't complete. Send to the cancelled state
  // (same UX as a user-aborted consent screen).
  if (!code || !state) {
    const back = new URL("/connect-desktop", url.origin);
    back.searchParams.set("whop_error", "missing_params");
    return clearStateAndRedirect(back);
  }

  // CSRF defence — state in URL must match the HttpOnly cookie value set on
  // /start. On mismatch we refuse to forward to the backend.
  const cookieStore = await cookies();
  const cookieState = cookieStore.get(STATE_COOKIE)?.value ?? "";
  if (!cookieState || cookieState !== state) {
    const back = new URL("/connect-desktop", url.origin);
    back.searchParams.set("whop_error", "state_mismatch");
    return clearStateAndRedirect(back);
  }

  // Forward to the canonical backend callback. The backend exchanges the
  // code with its own client_secret, mints the license JWT, and 302s back
  // to liquidclips://activate?token=...&challenge=<state>. The desktop
  // verifies the challenge matches what it generated.
  //
  // We deliberately re-issue the redirect rather than proxying the request
  // server-side: Whop's authorisation_code is single-use, and the backend's
  // 302 to the deep link must reach the user's browser (not our server).
  const upstream = new URL(`${WHOP_BACKEND_OAUTH_BASE}/auth/whop/callback`);
  upstream.searchParams.set("code", code);
  upstream.searchParams.set("state", state);

  return clearStateAndRedirect(upstream);
}

/** Issue a 302 and clear the one-time state cookie in the same response. */
function clearStateAndRedirect(target: URL): NextResponse {
  const response = NextResponse.redirect(target, 302);
  response.cookies.set({
    name: STATE_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
