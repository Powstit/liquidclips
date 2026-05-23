import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, decodeIdToken } from "@/lib/whop";
import { consumePkceCookies, createSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDesc = url.searchParams.get("error_description");

  console.log("[whop/callback] entered", { hasCode: !!code, hasState: !!state, error, errorDesc });

  if (error) {
    console.error("[whop/callback] whop returned error:", error, errorDesc);
    return NextResponse.redirect(`${url.origin}/?error=${encodeURIComponent(error + (errorDesc ? ": " + errorDesc : ""))}`);
  }
  if (!code) {
    console.error("[whop/callback] missing code in callback");
    return NextResponse.redirect(`${url.origin}/?error=missing_code`);
  }

  const { verifier, state: storedState } = await consumePkceCookies();
  console.log("[whop/callback] pkce cookies", { hasVerifier: !!verifier, hasStoredState: !!storedState, statesMatch: storedState === state });

  if (!verifier) {
    console.error("[whop/callback] no PKCE verifier — cookie didn't survive OAuth round-trip (likely 3p-cookie block)");
    return NextResponse.redirect(`${url.origin}/?error=pkce_cookie_missing`);
  }
  if (!storedState || storedState !== state) {
    console.error("[whop/callback] state mismatch", { storedState, state });
    return NextResponse.redirect(`${url.origin}/?error=state_mismatch`);
  }

  try {
    console.log("[whop/callback] exchanging code…");
    const tokens = await exchangeCode(code, verifier);
    console.log("[whop/callback] tokens received", { hasIdToken: !!tokens.id_token, hasAccessToken: !!tokens.access_token, expiresIn: tokens.expires_in });

    const id = tokens.id_token ? decodeIdToken(tokens.id_token) : null;
    console.log("[whop/callback] id_token decoded", { sub: id?.sub, email: id?.email, username: id?.username });

    if (!id?.sub) {
      console.error("[whop/callback] id_token missing sub claim");
      return NextResponse.redirect(`${url.origin}/?error=no_user_in_id_token`);
    }

    await createSession({
      userId: id.sub,
      email: id.email,
      name: id.name,
      username: id.username,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
    });
    console.log("[whop/callback] session created, redirecting to /");

    return NextResponse.redirect(`${url.origin}/`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[whop/callback] exception:", msg, e);
    return NextResponse.redirect(`${url.origin}/?error=${encodeURIComponent("exchange_failed: " + msg.slice(0, 200))}`);
  }
}
