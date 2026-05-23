import Whop from "@whop/sdk";

const apiKey = process.env.WHOP_API_KEY;
if (!apiKey) throw new Error("WHOP_API_KEY missing");

export const whop = new Whop({ apiKey });

export const env = {
  appId: process.env.WHOP_APP_ID!,
  companyId: process.env.WHOP_COMPANY_ID!,
  agentUserId: process.env.WHOP_AGENT_USER_ID!,
  authorizeUrl:
    process.env.NEXT_PUBLIC_WHOP_AUTHORIZE_URL ?? "https://api.whop.com/oauth/authorize",
  tokenUrl: process.env.WHOP_TOKEN_URL ?? "https://api.whop.com/oauth/token",
  baseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000",
};

export const callbackUrl = () => `${env.baseUrl}/auth/whop/callback`;

export async function exchangeCode(code: string, codeVerifier: string) {
  const apiKey = process.env.WHOP_API_KEY ?? "";
  const body: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl(),
    client_id: env.appId,
    code_verifier: codeVerifier,
    client_secret: apiKey, // Whop's App API key (apik_..._A_...) doubles as the OAuth client_secret
  };

  const res = await fetch(env.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as {
    access_token: string;
    refresh_token: string;
    id_token?: string;
    token_type: string;
    expires_in: number;
  };
}

/** Decode the OIDC id_token to extract userId without verifying. Caller must verify. */
export function decodeIdToken(idToken: string): { sub: string; email?: string; name?: string; username?: string } {
  const [, payload] = idToken.split(".");
  if (!payload) throw new Error("Invalid id_token");
  const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  return JSON.parse(json);
}

/** Get-or-create the affiliate record for this user against the Junior company. */
export async function ensureAffiliate(userId: string) {
  return whop.affiliates.create({
    company_id: env.companyId,
    user_identifier: userId,
  });
}
