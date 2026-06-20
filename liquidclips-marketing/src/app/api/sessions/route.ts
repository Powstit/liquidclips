import { NextResponse } from "next/server";
import { shortId } from "@/lib/sessionStore";
import { preflight, withCors } from "@/lib/cors";

export const runtime = "nodejs";

const URL_COOKIE = "lc_funnel_url";
const URL_COOKIE_MAX_AGE = 60 * 60 * 24; // 24 h is plenty for the funnel

export async function OPTIONS(request: Request) {
  return preflight(request.headers.get("origin"));
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return withCors(NextResponse.json({ error: "invalid json" }, { status: 400 }), origin);
  }
  const url = (body.url ?? "").trim();
  if (!url) return withCors(NextResponse.json({ error: "url required" }, { status: 400 }), origin);
  try {
    new URL(url);
  } catch {
    return withCors(
      NextResponse.json({ error: "url must be a full http(s) link" }, { status: 400 }),
      origin,
    );
  }
  // Stateless · just mint an id. The URL the visitor pasted is held on
  // the client via a cookie so the subsequent page can render the right
  // host name (`long video · YouTube`). Fallback to a neutral label if
  // the cookie is missing (different browser / deep link).
  const id = shortId();
  const res = withCors(NextResponse.json({ id }), origin);
  res.cookies.set(URL_COOKIE, url, {
    path: "/",
    maxAge: URL_COOKIE_MAX_AGE,
    sameSite: "lax",
    secure: true,
    httpOnly: false,
  });
  return res;
}
