// Agency invite-accept forwarder · Sprint B (2026-07-02).
//
// The Liquid Clips backend's `POST /agency/invites/{token}/accept` requires
// a Bearer license JWT. The invited clipper only has a Clerk session, so we
// bridge here:
//   1. Verify a signed-in Clerk user
//   2. Mint (or reuse) a license JWT via /desktop/connect + INTERNAL_API_SECRET
//   3. POST the backend accept with Authorization: Bearer
//   4. Stream the backend response back to the client
//
// Deliberately kept separate from src/app/api/agency/[...path]/route.ts so the
// invite flow does NOT inherit that route's agency-tier gate (the invitee is
// almost always NOT yet an agency-tier user — they're a Solo/Free clipper
// being added to an owner's roster). Sharing that gate would 403 every valid
// invite acceptance.

import { NextResponse, type NextRequest } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import {
  readBoundAgencyLicenseJwt,
  storeBoundAgencyLicenseJwt,
} from "@/lib/agency-license-cache";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "http://localhost:8000";

async function mintLicenseJwt(
  clerkUserId: string,
  email: string,
  firstName: string,
): Promise<string | null> {
  const jar = await cookies();
  const cached = readBoundAgencyLicenseJwt(jar, clerkUserId);
  if (cached) return cached;

  const challenge = `invite-accept-${clerkUserId.replace(/[^A-Za-z0-9_-]/g, "")}`.slice(
    0,
    255,
  );

  try {
    const res = await fetch(`${BACKEND_URL}/desktop/connect`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
      },
      body: JSON.stringify({
        clerk_user_id: clerkUserId,
        email,
        first_name: firstName,
        challenge,
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { license_jwt?: string };
    if (!j.license_jwt) return null;
    storeBoundAgencyLicenseJwt(jar, clerkUserId, j.license_jwt);
    return j.license_jwt;
  } catch {
    return null;
  }
}

type RouteCtx = { params: Promise<{ token: string }> };

export async function POST(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { error: "signed_out", message: "Sign in with the invited email to accept." },
      { status: 401 },
    );
  }
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress?.trim();
  if (!email) {
    return NextResponse.json(
      { error: "no_email", message: "No primary email on this Clerk account." },
      { status: 400 },
    );
  }

  const { token } = await ctx.params;
  if (!token || token.length < 10) {
    return NextResponse.json({ error: "bad_token" }, { status: 400 });
  }

  const firstName = (user?.firstName ?? "").trim();
  const jwt = await mintLicenseJwt(userId, email, firstName);
  if (!jwt) {
    return NextResponse.json(
      { error: "license_mint_failed", message: "Could not mint license — try again." },
      { status: 502 },
    );
  }

  try {
    const res = await fetch(
      `${BACKEND_URL}/agency/invites/${encodeURIComponent(token)}/accept`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${jwt}`,
        },
        cache: "no-store",
      },
    );
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/json",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "backend_unreachable" },
      { status: 502 },
    );
  }
}
