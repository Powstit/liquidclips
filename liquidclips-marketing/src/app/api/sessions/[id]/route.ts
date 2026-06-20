import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildSession, isValidId } from "@/lib/sessionStore";
import { preflight, withCors } from "@/lib/cors";

export const runtime = "nodejs";

const URL_COOKIE = "lc_funnel_url";

export async function OPTIONS(request: Request) {
  return preflight(request.headers.get("origin"));
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get("origin");
  const { id } = await ctx.params;
  if (!isValidId(id)) {
    return withCors(NextResponse.json({ error: "invalid id" }, { status: 404 }), origin);
  }
  // Recover the URL hint from the visitor's cookie · falls back to
  // empty (neutral subtitle) if the cookie isn't present (different
  // browser, deep-link share, etc.).
  const cookieStore = await cookies();
  const url = cookieStore.get(URL_COOKIE)?.value ?? null;
  const session = buildSession(id, url);
  return withCors(NextResponse.json(session), origin);
}
