// Permissive CORS for the funnel API · the desktop app at localhost:1420
// (dev) and any `liquidclips://` or app.liquidclips.desktop origin must be
// able to read a session it owns. We don't expose any user data through
// this surface — sessions are public by id.

import { NextResponse } from "next/server";

const ALLOW_HEADERS = "content-type, x-internal-secret";

export function corsHeaders(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin && origin !== "null" ? origin : "*",
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
