import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";

// Server-side bridge: account dashboard → backend Stripe Connect endpoints.
// The dashboard's "Set up Stripe Connect" button (AffiliateCard.tsx) POSTs
// here; this handler derives the verified clerk_user_id from the session and
// forwards the call to the backend with x-internal-secret. The browser never
// sees the secret or talks to the backend directly.
//
// POST  → creates/refreshes the Stripe-hosted onboarding URL and returns it
//         so the client can window.location.assign() to Stripe.
// GET   → returns the persisted Stripe Connect status (status / payouts /
//         charges) for refreshing the dashboard after the user returns from
//         Stripe's hosted onboarding.

const BACKEND_URL =
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

export async function POST(req: NextRequest): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  let country: string | undefined;
  try {
    const body = await req.json();
    if (typeof body?.country === "string" && /^[A-Z]{2}$/.test(body.country)) {
      country = body.country;
    }
  } catch {
    /* body optional — backend has a default */
  }

  try {
    const res = await fetch(
      `${BACKEND_URL}/me/affiliate/stripe-connect/onboarding?clerk_user_id=${encodeURIComponent(userId)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
        },
        body: JSON.stringify({ country: country ?? null }),
        cache: "no-store",
      },
    );
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: "backend_failed", status: res.status, detail: text.slice(0, 500) },
        { status: res.status },
      );
    }
    return new NextResponse(text, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "backend_unreachable", detail: String(e) },
      { status: 502 },
    );
  }
}

export async function GET(): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  try {
    const res = await fetch(
      `${BACKEND_URL}/me/affiliate/stripe-connect/status?clerk_user_id=${encodeURIComponent(userId)}`,
      {
        method: "GET",
        headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "" },
        cache: "no-store",
      },
    );
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "backend_unreachable", detail: String(e) },
      { status: 502 },
    );
  }
}
