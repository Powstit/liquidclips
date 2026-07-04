import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { sql } from "@/lib/db";
import { preflight, withCors } from "@/lib/cors";
import { isValidReferralCode } from "@/lib/referralCode";

export const runtime = "nodejs";

/**
 * POST /api/referrals/click
 *
 * Fire-and-forget logger called by the referral middleware whenever a
 * visitor lands with a valid `?ref=CODE` URL. Hashes IP + user-agent
 * (with a salt) so the audit trail is de-anonymised but de-duplicatable,
 * then inserts a row into `referral_clicks`.
 *
 * Gracefully no-ops when DATABASE_URL isn't set so the marketing site
 * stays alive during the Neon provisioning window.
 */

type Body = {
  referralCode?: string;
  country?: string | null;
  ip?: string | null;
  ua?: string | null;
  landedPath?: string | null;
};

// P1 fix 2026-07-04 · fail-CLOSED if LC_REF_HASH_SALT env is missing.
// Previous default "lc-default-salt" leaked in the codebase = attacker could
// de-anonymize IP↔visitor mapping if prod ever forgot to set the env var.
// Refuse to write hashes rather than write reversible ones.
const SALT = process.env.LC_REF_HASH_SALT;
if (!SALT && process.env.NODE_ENV === "production") {
  console.error(
    "[referrals/click] LC_REF_HASH_SALT env var MUST be set in production. " +
    "Referral clicks will be logged with null hashes until this is fixed."
  );
}

function hash(value: string | null | undefined): string | null {
  if (!value || !SALT) return null;
  return createHash("sha256").update(SALT + ":" + value).digest("hex").slice(0, 32);
}

export async function OPTIONS(request: Request) {
  return preflight(request.headers.get("origin"));
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return withCors(NextResponse.json({ error: "invalid json" }, { status: 400 }), origin);
  }

  const code = (body.referralCode ?? "").trim();
  if (!isValidReferralCode(code)) {
    return withCors(NextResponse.json({ error: "invalid code" }, { status: 400 }), origin);
  }

  if (!sql) {
    // No DB connected yet — accept the call, log nothing. Returns 202
    // so callers know the request was received but not persisted.
    return withCors(NextResponse.json({ ok: true, persisted: false }), origin);
  }

  const ipHash = hash(body.ip);
  const uaHash = hash(body.ua);
  const country = (body.country ?? "").slice(0, 2) || null;
  const landedPath = (body.landedPath ?? "").slice(0, 200) || null;

  try {
    await sql`
      INSERT INTO referral_clicks
        (referral_code, ip_hash, ua_fingerprint, landed_path, country)
      VALUES
        (${code}, ${ipHash}, ${uaHash}, ${landedPath}, ${country})
    `;
    return withCors(NextResponse.json({ ok: true, persisted: true }), origin);
  } catch (err) {
    console.error("[referral/click] insert failed", err);
    // Don't 500 the middleware fire-and-forget — return 202.
    return withCors(
      NextResponse.json({ ok: true, persisted: false }, { status: 202 }),
      origin,
    );
  }
}
