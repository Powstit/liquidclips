import { NextResponse, type NextRequest } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";

// Server-side proxy for the Admin HQ client component. The browser calls
// /api/admin/<backend-path>; this handler:
//   1. re-checks the signed-in Clerk user is an admin (defence in depth — the
//      page already gated, and the BACKEND gates again),
//   2. injects ?clerk_user_id=<signed-in id> so the caller can never spoof
//      another user, and
//   3. forwards the x-internal-secret header (server-only env) to the backend.
//
// The internal secret + admin email list NEVER reach the browser. Allowed
// backend paths are restricted to the read-only admin surface + the two safe
// claim actions; anything else is rejected here before a network call.

const BACKEND_URL = process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

const ADMIN_FALLBACK = [
  "danieldiyepriye@gmail.com",
  "mrddokubo@gmail.com",
  "crazycatjackkids@gmail.com",
  "thedoks2019@gmail.com",
];

function adminList(): string[] {
  const env = process.env.JUNIOR_ADMIN_EMAILS ?? "";
  const src = env ? env.split(",") : ADMIN_FALLBACK;
  return src.map((e) => e.trim().toLowerCase()).filter(Boolean);
}

// Allow-list of backend admin paths reachable through this proxy. GET = read,
// POST = the two explicitly-safe claim actions only. No other mutation path
// can be reached even if the client tries.
const READ_PATHS = [
  /^overview$/,
  /^users$/,
  /^users\/[^/]+$/,
  /^users\/[^/]+\/timeline$/,
  /^pending-whop$/,
  /^claims$/,
  /^webhooks$/,
  /^postiz$/,
  /^bugs$/,
];
const WRITE_PATHS = [/^claims\/[^/]+\/expire$/, /^claims\/[^/]+\/resend$/];

function pathAllowed(path: string, method: string): boolean {
  const list = method === "POST" ? WRITE_PATHS : READ_PATHS;
  return list.some((re) => re.test(path));
}

async function requireAdminId(): Promise<string | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const user = await currentUser();
  if (!user) return null;
  const email = (user.primaryEmailAddress?.emailAddress ?? "").trim().toLowerCase();
  if (!email || !adminList().includes(email)) return null;
  return userId;
}

async function handle(req: NextRequest, ctx: RouteContext<"/api/admin/[...path]">): Promise<Response> {
  const adminId = await requireAdminId();
  if (!adminId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { path: segments } = await ctx.params;
  const path = (segments ?? []).join("/");
  if (!pathAllowed(path, req.method)) {
    return NextResponse.json({ error: "path not allowed" }, { status: 400 });
  }

  // Rebuild query, forcing our verified clerk_user_id (never trust the client's).
  const incoming = new URL(req.url).searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of incoming.entries()) {
    if (k === "clerk_user_id") continue; // ignore any client-supplied value
    params.set(k, v);
  }
  params.set("clerk_user_id", adminId);

  const target = `${BACKEND_URL}/admin/${path}?${params.toString()}`;
  try {
    const res = await fetch(target, {
      method: req.method,
      headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "" },
      cache: "no-store",
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function GET(req: NextRequest, ctx: RouteContext<"/api/admin/[...path]">): Promise<Response> {
  return handle(req, ctx);
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/admin/[...path]">): Promise<Response> {
  return handle(req, ctx);
}
