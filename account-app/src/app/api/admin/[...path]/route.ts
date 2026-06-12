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

// Next.js 16 route-handler context for a catch-all dynamic segment. Params
// are now an awaitable Promise (per the Next 15+ async-route-context change),
// resolving to { path: string[] } for `[...path]`. typedRoutes isn't enabled
// in next.config.ts, so the auto-generated RouteContext<TPath> global isn't
// available — we type the shape inline instead.
type AdminRouteCtx = { params: Promise<{ path: string[] }> };

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
  /^health$/,
  /^function-heatmap$/,
  /^alerts$/,
  /^users$/,
  /^users\/[^/]+$/,
  /^users\/[^/]+\/timeline$/,
  /^pending-whop$/,
  /^claims$/,
  /^webhooks$/,
  /^postiz$/,
  /^bugs$/,
  // v0.7.55 (Uncle Daniel funnel) — Phase 1 reward bonus ledger. Whop
  // owns the submission + base $1 RPM; this ledger tracks the $4 premium
  // bonus due to paid users only, keyed by whop_submission_id.
  /^bonus-ledger$/,
  // v0.7.55 (community architecture) — tier-gated room CRUD.
  /^community\/channels$/,
  // v0.7.55 (admin mission control) — banners + announcements + missions.
  /^banners$/,
  /^announcements$/,
  /^campaigns$/,
  /^campaigns\/[^/]+$/,
];
const WRITE_PATHS = [
  /^claims\/[^/]+\/expire$/,
  /^claims\/[^/]+\/resend$/,
  /^function-heatmap\/run$/,
  /^alerts\/[^/]+\/read$/,
  // v0.7.55 — admin imports a Whop submission row + marks bonus paid.
  /^bonus-ledger\/import$/,
  /^bonus-ledger\/[^/]+\/mark-paid$/,
  // v0.7.55 — community channel CRUD (POST create, PATCH/DELETE via
  // method override below — Next.js route handlers dispatch on method).
  /^community\/channels$/,
  /^community\/channels\/[^/]+$/,
  // v0.7.55 admin mission control — banners + announcements + missions.
  /^banners$/,
  /^banners\/[^/]+$/,
  /^announcements$/,
  /^announcements\/[^/]+$/,
  /^campaigns$/,
  /^campaigns\/[^/]+$/,
];

function pathAllowed(path: string, method: string): boolean {
  // GET → read paths. Anything else (POST, PATCH, DELETE) is a write.
  // v0.7.55 — pre-fix the proxy only flipped on POST; PATCH/DELETE
  // requests fell through to the GET allow-list, which made the new
  // community CRUD endpoints unreachable.
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

async function handle(req: NextRequest, ctx: AdminRouteCtx): Promise<Response> {
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
  // v0.7.55 — forward the request body on non-GET methods. Pre-fix the
  // proxy stripped the body, so any admin POST/PATCH that carried JSON
  // (bonus-ledger import, community channel create/update) silently
  // hit the backend with an empty body and 422'd.
  const headers: Record<string, string> = {
    "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
  };
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

export async function GET(req: NextRequest, ctx: AdminRouteCtx): Promise<Response> {
  return handle(req, ctx);
}

export async function POST(req: NextRequest, ctx: AdminRouteCtx): Promise<Response> {
  return handle(req, ctx);
}

export async function PATCH(req: NextRequest, ctx: AdminRouteCtx): Promise<Response> {
  return handle(req, ctx);
}

export async function DELETE(req: NextRequest, ctx: AdminRouteCtx): Promise<Response> {
  return handle(req, ctx);
}
