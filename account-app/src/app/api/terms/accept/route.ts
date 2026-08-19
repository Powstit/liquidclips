import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";

// Server-side proxy: browser → backend `/terms/accept`.
// Handles the Clerk-authed side of the pre-checkout T&C click-wrap.

const BACKEND_URL =
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

interface ClientAcceptRequest {
  document_version?: unknown;
}

function clientIp(req: NextRequest): string | null {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const first = fwd.split(",")[0]?.trim();
  if (first) return first;
  return req.headers.get("x-real-ip") ?? null;
}

export async function POST(req: NextRequest): Promise<Response> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  let body: ClientAcceptRequest;
  try {
    body = (await req.json()) as ClientAcceptRequest;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { document_version } = body;
  if (typeof document_version !== "string" || document_version.length === 0) {
    return NextResponse.json({ error: "document_version required" }, { status: 400 });
  }

  const upstreamBody = {
    document_version,
    client_ip: clientIp(req),
    client_user_agent: req.headers.get("user-agent") ?? null,
  };

  try {
    const res = await fetch(
      `${BACKEND_URL}/terms/accept?clerk_user_id=${encodeURIComponent(userId)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
        },
        body: JSON.stringify(upstreamBody),
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
