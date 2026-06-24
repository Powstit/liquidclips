import { NextResponse, type NextRequest } from "next/server";

// HQ Agent 5 · Recovery /status proxy.
//
// Returns whether the PIN, auth-code, and TOTP seed are configured. The
// security landing page (Agent 1) reads this BEFORE the admin has signed
// in to render setup-state pills, so the route is intentionally NOT
// behind Clerk auth.
//
// We still forward the x-internal-secret header so the backend can require
// it for the broader /admin/* surface in deployments where the secret is
// non-empty. The backend's /status handler accepts the call without the
// require_admin dep, but is consistent with the rest of the admin API.

const BACKEND_URL =
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function clientIp(req: NextRequest): string {
  // P1-005: x-vercel-forwarded-for is signed by Vercel — trust it
  // unconditionally. x-forwarded-for / x-real-ip can be spoofed by the
  // browser; only honour them in development for local testing.
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

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const ip = clientIp(req);
    const res = await fetch(`${BACKEND_URL}/admin/recovery/status`, {
      method: "GET",
      headers: {
        "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
        // Pass-through so backend's ip_allowlisted check sees the real
        // client IP, not Vercel's edge proxy. Backend reads
        // x-vercel-forwarded-for first (signed, unspoofable) per P1-005.
        "x-vercel-forwarded-for": ip,
        "x-forwarded-for": ip,
        "x-real-ip": ip,
      },
      cache: "no-store",
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/json",
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
