import { NextResponse, type NextRequest } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";

// Server-side desktop activation mint. The /connect-desktop page (signed-in
// browser) POSTs { challenge } here; this handler:
//   1. derives the clerk_user_id from the VERIFIED Clerk session (auth()) — the
//      browser can never spoof another user,
//   2. forwards x-internal-secret (server-only env) to the backend, which mints
//      the license JWT for that user's tier.
//
// The internal secret never reaches the browser, and the backend rejects any
// /desktop/connect call that doesn't carry it — so a license can only be minted
// through this verified server path, never by the desktop or browser directly.

const BACKEND_URL = process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

export async function POST(req: NextRequest): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  // Pass the VERIFIED email + first name from the Clerk session so the backend
  // can upsert the User row if the user.created webhook hasn't landed yet.
  // Desktop sign-in must not depend on a webhook race — webhook is sync,
  // this is the resilient bridge.
  const user = await currentUser();
  const email = (user?.primaryEmailAddress?.emailAddress ?? "").trim().toLowerCase();
  const firstName = (user?.firstName ?? "").trim();
  if (!email) {
    return NextResponse.json({ error: "missing_verified_email" }, { status: 409 });
  }

  let challenge = "";
  try {
    const body = await req.json();
    challenge = typeof body?.challenge === "string" ? body.challenge : "";
  } catch {
    /* fall through to validation */
  }
  // The desktop generates a hex nonce; reject anything that isn't one.
  if (!challenge || challenge.length > 256 || !/^[A-Za-z0-9_-]+$/.test(challenge)) {
    return NextResponse.json({ error: "bad_challenge" }, { status: 400 });
  }

  try {
    const res = await fetch(`${BACKEND_URL}/desktop/connect`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
      },
      body: JSON.stringify({
        clerk_user_id: userId,
        email,
        first_name: firstName,
        challenge,
      }),
      cache: "no-store",
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "backend_unreachable" }, { status: 502 });
  }
}
