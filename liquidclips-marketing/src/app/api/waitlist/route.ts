import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { preflight, withCors } from "@/lib/cors";
import { isValidReferralCode, makeReferralCode } from "@/lib/referralCode";

export const runtime = "nodejs";

const REF_COOKIE = "lc_ref";
const ROLES = new Set(["creator", "clipper", "agency"]);
const SOURCES = new Set(["product_hunt", "website", "referral", "direct"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Product Hunt usernames: 2-30 chars, alphanumeric + dot/underscore/dash.
// Leading @ stripped on accept.
const PH_USERNAME_RE = /^[a-zA-Z0-9._-]{2,30}$/;

type Body = {
  email?: string;
  role?: string;
  source?: string;              // 'product_hunt' | 'website' | 'referral' | 'direct'
  sourcePage?: string;          // e.g. '/launch'
  productHuntUsername?: string; // optional · for PH upvote correlation
};

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

  const email = (body.email ?? "").trim().toLowerCase();
  const roleRaw = (body.role ?? "").trim().toLowerCase();
  const sourceRaw = (body.source ?? "").trim().toLowerCase();
  const sourcePage = (body.sourcePage ?? "").trim().slice(0, 200) || null;
  const phUsernameRaw = (body.productHuntUsername ?? "").trim().replace(/^@/, "");

  if (!EMAIL_RE.test(email)) {
    return withCors(NextResponse.json({ error: "valid email required" }, { status: 400 }), origin);
  }
  // Role is now OPTIONAL · the PH capture flow doesn't ask for it.
  // If provided, it must be valid; if omitted, we store null.
  const role: string | null = roleRaw ? (ROLES.has(roleRaw) ? roleRaw : null) : null;
  if (roleRaw && !role) {
    return withCors(
      NextResponse.json({ error: "role must be creator, clipper or agency" }, { status: 400 }),
      origin,
    );
  }
  // PH username optional — must look like a real handle if provided.
  const phUsername =
    phUsernameRaw && PH_USERNAME_RE.test(phUsernameRaw) ? phUsernameRaw : null;
  if (phUsernameRaw && !phUsername) {
    return withCors(
      NextResponse.json({ error: "product hunt username looks malformed" }, { status: 400 }),
      origin,
    );
  }

  const cookieStore = await cookies();
  const refCookie = cookieStore.get(REF_COOKIE)?.value ?? null;
  const referredBy = isValidReferralCode(refCookie) ? refCookie : null;

  // Source bucket — if the client didn't provide one, derive it from
  // (cookie referral → 'referral') else default 'website'.
  let source = SOURCES.has(sourceRaw) ? sourceRaw : null;
  if (!source) source = referredBy ? "referral" : "website";

  // Graceful DB-down path · if Neon isn't provisioned yet, accept the
  // signup, mint a referral code on the fly, return success with
  // persisted=false so the UI still shows the "you're in" state. The
  // client never knows the difference; we monitor `persisted` server-
  // side for telemetry.
  if (!sql) {
    return withCors(
      NextResponse.json({
        ok: true,
        alreadyJoined: false,
        persisted: false,
        referralCode: makeReferralCode(),
      }),
      origin,
    );
  }

  // Validate the cookie's ref code is real (someone may hand-type a URL).
  let validReferrer: string | null = null;
  if (referredBy) {
    const found = await sql`
      SELECT 1 FROM waitlist WHERE referral_code = ${referredBy} LIMIT 1
    `;
    if (found.length > 0) validReferrer = referredBy;
  }

  // Generate a unique code for this signup. Retry on the astronomically
  // unlikely collision.
  let newCode = makeReferralCode();
  for (let attempt = 0; attempt < 4; attempt++) {
    const taken = await sql`
      SELECT 1 FROM waitlist WHERE referral_code = ${newCode} LIMIT 1
    `;
    if (taken.length === 0) break;
    newCode = makeReferralCode();
  }

  try {
    await sql`
      INSERT INTO waitlist
        (email, role, source, source_page, product_hunt_username, referral_code, referred_by)
      VALUES
        (${email}, ${role}, ${source}, ${sourcePage}, ${phUsername}, ${newCode}, ${validReferrer})
    `;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/duplicate key|unique constraint|waitlist_email/i.test(msg)) {
      // Already on the list — return the existing referral_code so they
      // don't lose attribution.
      const rows = await sql`
        SELECT referral_code FROM waitlist WHERE email = ${email} LIMIT 1
      `;
      return withCors(
        NextResponse.json({
          ok: true,
          alreadyJoined: true,
          persisted: true,
          referralCode: rows[0]?.referral_code ?? null,
        }),
        origin,
      );
    }
    console.error("[waitlist] insert failed", err);
    return withCors(NextResponse.json({ error: "could not save" }, { status: 500 }), origin);
  }

  return withCors(
    NextResponse.json({
      ok: true,
      alreadyJoined: false,
      persisted: true,
      referralCode: newCode,
    }),
    origin,
  );
}
