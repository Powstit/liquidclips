import { NextResponse } from "next/server";
import { env, callbackUrl } from "@/lib/whop";
import { randomString, codeChallenge } from "@/lib/pkce";
import { setPkceCookies } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const verifier = randomString(32);
  const state = randomString(16);
  const challenge = await codeChallenge(verifier);

  await setPkceCookies(verifier, state);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.appId,
    redirect_uri: callbackUrl(),
    scope: "openid profile email",
    state,
    nonce: randomString(16),
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  return NextResponse.redirect(`${env.authorizeUrl}?${params.toString()}`);
}
