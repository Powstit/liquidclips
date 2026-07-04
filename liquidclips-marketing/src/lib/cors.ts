// Strict CORS allowlist for the funnel API. The previous implementation
// reflected the incoming Origin header on any request, so:
//   * evil.com could POST to /api/waitlist / /api/referrals/click and get
//     an Access-Control-Allow-Credentials: true response that a browser
//     would treat as trusted → CSRF-with-credentials via lc_ref cookie.
//   * Any third-party site could scrape /api/funnel/session/<id> without
//     the browser preflight refusing.
// The allowlist is now explicit: liquidclips.app + tauri://localhost +
// localhost dev origins (only when NODE_ENV=development).
//
// Any origin not on the list receives no CORS headers, so the browser
// enforces the same-origin default and rejects the response.

import { NextResponse } from "next/server";

const ALLOW_HEADERS = "content-type, x-internal-secret";

const ALLOWED_ORIGINS = new Set<string>([
  "https://liquidclips.app",
  "https://www.liquidclips.app",
  "tauri://localhost",
  "https://tauri.localhost",
  "http://tauri.localhost",
  ...(process.env.NODE_ENV === "development"
    ? ["http://localhost:3000", "http://localhost:1420"]
    : []),
]);

function isAllowed(origin: string | null): boolean {
  return !!origin && origin !== "null" && ALLOWED_ORIGINS.has(origin);
}

export function corsHeaders(origin: string | null): HeadersInit {
  // If origin is not allowlisted, return only Vary — no
  // Access-Control-Allow-Origin, so the browser blocks credentialed
  // reads from the response.
  if (!isAllowed(origin)) {
    return { Vary: "Origin" };
  }
  return {
    "Access-Control-Allow-Origin": origin as string,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    Vary: "Origin",
  };
}

export function withCors(res: NextResponse, origin: string | null): NextResponse {
  const headers = corsHeaders(origin);
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v as string);
  return res;
}

export function preflight(origin: string | null): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}
