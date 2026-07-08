import { NextResponse, type NextRequest } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { isAdmin } from "@/lib/admin-allowlist";
// 2026-07-03 · Step 2 batch 2e · server-owned capability gate.
// The admin proxy now reads platform_role + capabilities from the
// backend projection (via /authz/whoami) instead of the local email
// allowlist. The email allowlist stays wired as a fallback for one
// compat release so a backend outage still allows the founders in.
import {
  fetchCapabilities,
  hasCapability,
  CAP,
} from "@/lib/server-capabilities";

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
  /^ayrshare$/,
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
  // 2026-06-25 · Promo / discount-code admin reads
  /^promo$/,
  /^promo\/[^/]+\/stats$/,
  // 2026-07-06 · Login-screen carousel + cold-leads admin reads.
  /^carousel-clips$/,
  /^cold-leads$/,
  // 2026-06-24 · HQ demo-data wipe — live-data endpoints for tabs that
  // used to render hardcoded sample arrays.
  /^revenue\/summary$/,
  /^revenue\/blockers$/,
  /^customer-signals$/,
  /^inbox$/,
  /^employees$/,
  /^agents$/,
  /^api-services$/,
  /^iron-gates$/,
  /^releases$/,
  /^bug-intake$/,
  /^agent-reports$/,
  // Constellation Engine · self-healing node runtime (2026-07-06). Read
  // shape covers the state page (sky map), pool status, and patch review.
  // Every path is served by app/routes/constellation.py in junior-backend
  // and gated by require_admin (internal-secret + clerk-user-id + email).
  /^constellation\/state$/,
  /^constellation\/pool\/status$/,
  /^constellation\/patches$/,
  /^constellation\/patches\/[^/]+\/diff$/,
  /^constellation\/recommended-models$/,
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
  // 2026-06-25 · Promo / discount-code admin writes (create + revoke)
  /^promo$/,
  /^promo\/[^/]+\/revoke$/,
  // 2026-07-06 · Login-screen carousel + cold-leads admin writes.
  // POST/DELETE for both. Cold-lead delete uses query params
  // (email + campaign_id) so slashes in campaign ids don't split the
  // URL path.
  /^carousel-clips$/,
  /^carousel-clips\/[^/]+$/,
  /^cold-leads$/,
  // 2026-07-08 · P0 first-run access · dev-issue license path (E)
  // exposed via SignInOpsTab. Env-flag + internal-secret + admin
  // allowlist gated inside the backend. Empty-body POST doubles as
  // the "is the window open?" probe (400 = enabled, 403 = disabled).
  /^dev-issue-license$/,
  // Constellation Engine · self-healing node runtime (2026-07-06).
  // Mutations: pool inserts + LLM hire/fire + node override + patch review.
  // node_id in the URL can contain "/" (convention: <cluster>/<journey-id>/<component>)
  // so the regex uses `.+` for that segment.
  /^constellation\/pool\/[1-3]\/set-member$/,
  /^constellation\/pool\/[1-3]\/rotate-key$/,
  /^constellation\/pool\/[1-3]\/disable$/,
  /^constellation\/fallback-llm\/set$/,
  /^constellation\/nodes\/.+\/assign-llm$/,
  /^constellation\/nodes\/.+\/fire$/,
  /^constellation\/nodes\/.+\/override$/,
  /^constellation\/nodes\/.+\/dispatch$/,
  /^constellation\/patches\/[^/]+\/approve$/,
  /^constellation\/patches\/[^/]+\/reject$/,
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

  // Batch 2E primary gate — server-authoritative capability check.
  // `hq.read` is the required capability for every /api/admin/* proxy
  // path (both READ and WRITE lists — write additionally requires
  // hq.mutate but the backend enforces that at the mutation endpoint).
  const snapshot = await fetchCapabilities(userId);
  if (snapshot && hasCapability(snapshot, CAP.HQ_READ)) {
    return userId;
  }

  // Legacy fallback for one compat release. Fires ONLY when the backend
  // snapshot lookup failed (returned null) — never overrides a valid
  // capability-based denial. Guards against a backend outage silently
  // locking the founders out of the HQ. Delete once the whoami endpoint
  // has been stable in prod for a full release cycle.
  if (snapshot === null && isAdmin(email)) {
    return userId;
  }

  return null;
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
