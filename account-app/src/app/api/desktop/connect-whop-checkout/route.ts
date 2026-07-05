/**
 * Server-side desktop activation mint for Whop-checkout-first buyers.
 *
 * 2026-07-05 · user-journey-lens P0 + customer-journey-lens P0 · closes
 * the "new Whop buyer, no Clerk account yet" dead-end. The buyer
 * lands here via `whop_checkout_success.py:145-158` after Clerk
 * signup with `?whop_checkout=1&membership_id=X`.
 *
 * Contract:
 *   - Verified Clerk session required (auth() must resolve userId).
 *   - Body carries `membership_id` (the Whop membership id from the
 *     redirect · used to correlate the PendingWhopMembership drain).
 *   - Forwards `x-internal-secret` + `clerk_user_id` +
 *     `whop_membership_id` to backend `/desktop/connect-from-checkout`
 *     which mints a JWT via the same `apply_membership_tier` path the
 *     webhook uses.
 *   - Returns `{ license_jwt }` on success · deep link fires from
 *     the client with `source=whop-checkout` so `activation.ts` skips
 *     the challenge check via `TRUSTED_CHALLENGELESS_SOURCES`.
 *
 * Different from `/api/desktop/connect`: no challenge needed. The
 * Clerk session + INTERNAL_API_SECRET together provide the auth
 * guarantee that the challenge nonce carried in the OAuth flow.
 */

import { NextResponse, type NextRequest } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

export async function POST(req: NextRequest): Promise<Response> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const user = await currentUser();
  const email = (user?.primaryEmailAddress?.emailAddress ?? "").trim().toLowerCase();
  const firstName = (user?.firstName ?? "").trim();
  if (!email) {
    return NextResponse.json({ error: "missing_verified_email" }, { status: 409 });
  }

  let membershipId = "";
  try {
    const body = await req.json();
    membershipId = typeof body?.membership_id === "string" ? body.membership_id : "";
  } catch {
    /* fall through */
  }
  if (!membershipId || membershipId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(membershipId)) {
    return NextResponse.json({ error: "bad_membership_id" }, { status: 400 });
  }

  try {
    const res = await fetch(`${BACKEND_URL}/desktop/connect-from-checkout`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
      },
      body: JSON.stringify({
        clerk_user_id: userId,
        email,
        first_name: firstName,
        whop_membership_id: membershipId,
      }),
      cache: "no-store",
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/json",
      },
    });
  } catch {
    return NextResponse.json({ error: "backend_unreachable" }, { status: 502 });
  }
}
