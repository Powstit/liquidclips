import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";

// Server-side proxy: browser → backend `/affiliate/agreement/sign`.
// Handles the Clerk-authed side of click-wrap signing.
//
// Contract:
//   * Requires an active Clerk session (401 otherwise).
//   * Forwards the browser's IP + User-Agent to the backend so the
//     receipt reflects the actual signer, not the Vercel edge.
//   * Backend rejects any submission where `scroll_completed !== true`.
//   * Response is proxied through as-is so the client sees the
//     `receipt_sha256` directly.

const BACKEND_URL =
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

interface ClientSignRequest {
  contract_version?: unknown;
  signing_capacity?: unknown;
  scroll_completed?: unknown;
  signature_action?: unknown;
}

function clientIp(req: NextRequest): string | null {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const first = fwd.split(",")[0]?.trim();
  if (first) return first;
  // Vercel exposes the origin IP via this header on the edge.
  return req.headers.get("x-real-ip") ?? null;
}

export async function POST(req: NextRequest): Promise<Response> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  let body: ClientSignRequest;
  try {
    body = (await req.json()) as ClientSignRequest;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const {
    contract_version,
    signing_capacity,
    scroll_completed,
    signature_action = "EXPLICIT_CLICK_TO_ACCEPT",
  } = body;

  if (typeof contract_version !== "string" || contract_version.length === 0) {
    return NextResponse.json({ error: "contract_version required" }, { status: 400 });
  }
  if (signing_capacity !== "BUSINESS" && signing_capacity !== "INDIVIDUAL") {
    return NextResponse.json({ error: "signing_capacity must be BUSINESS or INDIVIDUAL" }, { status: 400 });
  }
  if (scroll_completed !== true) {
    return NextResponse.json({ error: "scroll_completed must be true" }, { status: 400 });
  }

  const upstreamBody = {
    contract_version,
    signing_capacity,
    scroll_completed,
    signature_action,
    client_ip: clientIp(req),
    client_user_agent: req.headers.get("user-agent") ?? null,
  };

  try {
    const res = await fetch(
      `${BACKEND_URL}/affiliate/agreement/sign?clerk_user_id=${encodeURIComponent(userId)}`,
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
