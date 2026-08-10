import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";

// Server-side proxy for POST /onboarding/link-whop, mirroring
// api/desktop/connect/route.ts's pattern exactly.
//
// WhopLinkBoot.tsx and app/get/page.tsx used to POST straight from the
// browser to the backend with a client-supplied clerk_user_id + email and
// no auth header. The backend requires a license JWT that neither caller
// ever holds (both are web-context Clerk sign-ins, not the desktop app),
// so every call 401'd — the affiliate/Whop-checkout auto-link feature has
// been silently broken since the 2026-07-04 security fix that locked the
// endpoint down. Route through this verified server proxy instead: derive
// clerk_user_id from the VERIFIED Clerk session (never client-supplied),
// forward x-internal-secret (server-only env), matching how
// /api/desktop/connect already does this safely.

const BACKEND_URL = process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

export async function POST(req: NextRequest): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  let email = "";
  try {
    const body = await req.json();
    email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  } catch {
    /* fall through to validation */
  }
  if (!email) {
    return NextResponse.json({ error: "missing_email" }, { status: 400 });
  }

  try {
    const res = await fetch(`${BACKEND_URL}/onboarding/link-whop`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
      },
      body: JSON.stringify({ clerk_user_id: userId, email }),
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
