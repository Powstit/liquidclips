import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";

// Server-side proxy: browser → backend `/terms/status`.
// Used by the pre-checkout T&C gate to decide whether to show the
// placeholder document + checkbox, or skip straight to the embed
// because this user already accepted the current version.

const BACKEND_URL =
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

export async function GET(_req: NextRequest): Promise<Response> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  try {
    const res = await fetch(
      `${BACKEND_URL}/terms/status?clerk_user_id=${encodeURIComponent(userId)}`,
      {
        headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "" },
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
