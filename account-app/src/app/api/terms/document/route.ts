import { NextResponse } from "next/server";

// Server-side proxy: browser → backend `/terms/document`. No auth on
// either side — the T&C text itself isn't user-specific, and the
// checkout page that needs it may render before any Clerk session
// exists (anonymous acquisition flow).

const BACKEND_URL =
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

export async function GET(): Promise<Response> {
  try {
    const res = await fetch(`${BACKEND_URL}/terms/document`, { cache: "no-store" });
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
