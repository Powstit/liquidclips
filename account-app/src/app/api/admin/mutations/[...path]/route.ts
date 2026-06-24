import { NextResponse, type NextRequest } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";

// HQ Agent 3 · Mutations proxy.
//
// Catch-all for /api/admin/mutations/<...>. Mirrors the security model of
// the parent /api/admin/[...path] proxy:
//   1. re-checks Clerk session + admin allow-list,
//   2. forces ?clerk_user_id=<verified id> so the caller can't spoof,
//   3. injects x-internal-secret (server-only env) before the backend call,
//   4. allows-lists only the /admin/mutations/* paths Agent 3 owns,
//   5. forwards the idempotence-key header transparently when present.
//
// The browser never sees the internal secret.

const BACKEND_URL = process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

type MutationsRouteCtx = { params: Promise<{ path: string[] }> };

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

// Explicit allow-list for the 11 mutation endpoints + the audit-log read.
// Anything that doesn't match gets a 400 before any network hop.
const READ_PATHS: RegExp[] = [
  /^recent-sales$/,
  /^audit-log$/,
];
const WRITE_PATHS: RegExp[] = [
  /^campaigns\/[^/]+\/edit$/,
  /^campaigns\/create$/,
  /^campaigns\/[^/]+\/archive$/,
  /^users\/[^/]+\/tier-change$/,
  /^users\/[^/]+\/refund$/,
  /^users\/[^/]+\/ban$/,
  /^agents\/[^/]+\/kill$/,
  /^agents\/[^/]+\/restart$/,
  /^agents\/[^/]+\/rotate-key$/,
];

function pathAllowed(path: string, method: string): boolean {
  const list = method === "GET" ? READ_PATHS : WRITE_PATHS;
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

async function handle(req: NextRequest, ctx: MutationsRouteCtx): Promise<Response> {
  const adminId = await requireAdminId();
  if (!adminId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { path: segments } = await ctx.params;
  const path = (segments ?? []).join("/");
  if (!pathAllowed(path, req.method)) {
    return NextResponse.json({ error: "path not allowed" }, { status: 400 });
  }

  // Rebuild query — force our verified clerk_user_id.
  const incoming = new URL(req.url).searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of incoming.entries()) {
    if (k === "clerk_user_id") continue;
    params.set(k, v);
  }
  params.set("clerk_user_id", adminId);

  const target = `${BACKEND_URL}/admin/mutations/${path}?${params.toString()}`;

  const headers: Record<string, string> = {
    "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
  };
  // Forward the idempotence-key header transparently when present.
  const idem = req.headers.get("idempotence-key");
  if (idem) headers["idempotence-key"] = idem;

  let body: string | undefined;
  if (req.method !== "GET" && req.method !== "DELETE") {
    body = await req.text();
    const ct = req.headers.get("content-type");
    if (ct) headers["content-type"] = ct;
    else if (body) headers["content-type"] = "application/json";
  }

  try {
    const res = await fetch(target, {
      method: req.method,
      headers,
      body,
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

export async function GET(req: NextRequest, ctx: MutationsRouteCtx): Promise<Response> {
  return handle(req, ctx);
}

export async function POST(req: NextRequest, ctx: MutationsRouteCtx): Promise<Response> {
  return handle(req, ctx);
}
