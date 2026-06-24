import { NextResponse, type NextRequest } from "next/server";

// HQ Agent 5 · Recovery /verify proxy.
//
// This route deliberately does NOT call Clerk's auth() — the whole point of
// the recovery flow is that the admin is signed-out and locked out of every
// other gate. We proxy the body straight through to the backend, which runs
// the 3-of-5 email + PIN + auth-code check + IP rate limit. The backend is
// the single source of truth; this handler only:
//   1. forwards the request body verbatim,
//   2. injects the server-only x-internal-secret header,
//   3. preserves the original status code (so 429 reaches the form).
//
// The internal secret never reaches the browser.

const BACKEND_URL =
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function clientIp(req: NextRequest): string {
  // Forward the originating client IP to the backend so its rate-limiter
  // groups attempts by the human, not by Vercel's edge proxy IP.
  //
  // P1-005 trust boundary: x-vercel-forwarded-for is SIGNED by Vercel —
  // the browser cannot spoof a value that survives the edge. We trust it
  // unconditionally. x-forwarded-for / x-real-ip can be set client-side
  // before reaching Vercel; we only trust them as a fallback in
  // development (NODE_ENV !== "production") for local testing.
  const vercel = req.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0].trim();
  if (process.env.NODE_ENV !== "production") {
    const fwd = req.headers.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0].trim();
    const real = req.headers.get("x-real-ip");
    if (real) return real;
  }
  return "unknown";
}

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.text();

  const ip = clientIp(req);
  const target = `${BACKEND_URL}/admin/recovery/verify`;

  try {
    const res = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": req.headers.get("content-type") ?? "application/json",
        "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
        // Pass-through so the backend rate-limit sees the real client IP
        // rather than Vercel's edge node. Backend reads
        // x-vercel-forwarded-for first (signed, unspoofable) per P1-005.
        "x-vercel-forwarded-for": ip,
        "x-forwarded-for": ip,
        "x-real-ip": ip,
      },
      body,
      cache: "no-store",
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/json",
        // Recovery responses must never be cached anywhere — they contain
        // one-time seed/backup-code material on success.
        "cache-control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "backend unreachable" },
      { status: 502 },
    );
  }
}
