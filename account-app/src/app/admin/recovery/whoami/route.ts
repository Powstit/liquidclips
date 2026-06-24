import { NextResponse, type NextRequest } from "next/server";

// Diagnostic endpoint · returns the headers Vercel attaches at the edge so
// Daniel can see exactly which IP the HQ gate is comparing against.
//
// Lives under /admin/recovery/* which is EXEMPT from the IP allowlist gate
// per middleware.ts isRecoveryPath() — so this works even when /admin is
// 404-ing the caller. No auth required (the response contains nothing
// sensitive — just the caller's own headers Vercel already saw).
//
// Use case: when /admin returns 404 unexpectedly, hit this URL in the same
// browser and the response tells you exactly which IP to add to
// ADMIN_ALLOWED_IPS.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  const allowed = (process.env.ADMIN_ALLOWED_IPS ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);

  const vercelXff = req.headers.get("x-vercel-forwarded-for") ?? "";
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const realIp = req.headers.get("x-real-ip") ?? "";
  const cfIp = req.headers.get("cf-connecting-ip") ?? "";

  const firstFromVercel = vercelXff.split(",")[0]?.trim() ?? "";
  const wouldPassGate = Boolean(firstFromVercel) && allowed.includes(firstFromVercel);

  return NextResponse.json(
    {
      headers_vercel_sees: {
        "x-vercel-forwarded-for": vercelXff || null,
        "x-forwarded-for": xff || null,
        "x-real-ip": realIp || null,
        "cf-connecting-ip": cfIp || null,
      },
      ip_gate_evaluates: {
        first_hop_from_vercel: firstFromVercel || null,
        allowlist: allowed,
        allowlist_count: allowed.length,
        would_pass_gate: wouldPassGate,
      },
      verdict: wouldPassGate
        ? "✓ this caller's IP IS in the allowlist — /admin should load"
        : firstFromVercel
          ? `✗ caller's IP ${firstFromVercel} is NOT in the allowlist — add it to ADMIN_ALLOWED_IPS env var`
          : "✗ no IP detected from x-vercel-forwarded-for header — Vercel may not be signing the request",
      hint: "If your IP changed, paste the value of `first_hop_from_vercel` back to Claude in chat.",
    },
    {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate",
        "content-type": "application/json",
      },
    },
  );
}
