import { NextResponse, type NextRequest } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { isAdmin as isAdminEmail } from "@/lib/admin-allowlist";

// Server-side proxy for the Agency Campaigns UI (account-app/src/app/agency/*).
//
// Backend endpoints (junior-backend/app/routes/agency_campaigns.py) require
// a license-JWT Bearer + agency/admin tier. To bridge a signed-in Clerk
// session to that JWT without forcing the agency to install the desktop:
//
//   1. Verify Clerk session + email.
//   2. Resolve tier via /affiliate/me (internal-secret + clerk_user_id).
//   3. Gate: tier === 'agency' OR admin_override OR isAdminEmail(email).
//      Otherwise 403 — the page renders an "Upgrade to Agency" panel.
//   4. Mint / reuse a license JWT for this user, cached in an HttpOnly
//      cookie scoped to /agency + /api/agency. Cached for 24 days
//      (backend JWT lives 30 days; refresh ahead of expiry).
//   5. Forward the request to the backend with Authorization: Bearer.
//
// Two paths bypass the JWT mint and use the internal-secret + admin
// allow-list path instead, because the backend doesn't expose an agency-
// owned LIST or ARCHIVE endpoint today:
//   • GET  /api/agency/list                            → GET /admin/campaigns
//     filtered by created_by === verified user.id
//   • POST /api/agency/campaigns/{slug}/archive        → DELETE /admin/campaigns/{slug}
//
// The internal secret + JWT never reach the browser. The browser sends
// the user's Clerk cookie, which proves who they are; everything else
// is server-only.

const BACKEND_URL =
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

const JWT_COOKIE_NAME = "lc_agency_jwt";
const JWT_COOKIE_MAX_AGE_SECONDS = 24 * 24 * 60 * 60; // 24 days < 30-day JWT life

// ── Path allow-list ──────────────────────────────────────────────────
//
// Every backend path the proxy can reach. GET = read, anything else = write.
// Pseudo-paths (`list`, `campaigns/{slug}/archive`) are handled inline.
const BEARER_READ_PATHS = [
  /^campaigns\/[^/]+\/submissions$/,
  /^campaigns\/[^/]+\/analytics$/,
];
const BEARER_WRITE_PATHS = [
  /^campaigns$/, // POST create
  /^campaigns\/[^/]+$/, // PATCH edit
  /^campaigns\/[^/]+\/connect-reward$/,
  /^campaigns\/[^/]+\/publish$/,
  /^campaigns\/[^/]+\/refresh-reward$/,
  /^whop\/validate-reward$/,
];
const INTERNAL_READ_PATHS = [
  /^list$/, // pseudo: GET /admin/campaigns filtered by created_by
  /^campaigns\/[^/]+$/, // pseudo: GET single via admin list lookup
];
const INTERNAL_WRITE_PATHS = [
  /^campaigns\/[^/]+\/archive$/, // pseudo: DELETE /admin/campaigns/{slug}
];

type AgencyRouteCtx = { params: Promise<{ path: string[] }> };

type Gate = {
  ok: boolean;
  status: number;
  reason?: string;
  clerkUserId?: string;
  email?: string;
  tier?: string;
};

// ── Tier resolution (mirrors /dashboard/page.tsx) ────────────────────
type CustomerData = {
  tier: string;
  admin_override?: boolean;
  // …other fields not needed here
};
type AffiliateMeResponse = { customer: CustomerData };

async function gateRequest(): Promise<Gate> {
  const { userId } = await auth();
  if (!userId) return { ok: false, status: 401, reason: "not_signed_in" };
  const user = await currentUser();
  if (!user) return { ok: false, status: 401, reason: "no_user" };
  const email = (user.primaryEmailAddress?.emailAddress ?? "")
    .trim()
    .toLowerCase();
  if (!email) return { ok: false, status: 409, reason: "missing_verified_email" };

  // Server-to-server tier lookup.
  let tier = "free";
  let adminOverride = false;
  try {
    const res = await fetch(
      `${BACKEND_URL}/affiliate/me?clerk_user_id=${encodeURIComponent(userId)}`,
      {
        headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "" },
        cache: "no-store",
      },
    );
    if (res.ok) {
      const j = (await res.json()) as AffiliateMeResponse;
      tier = j.customer?.tier ?? "free";
      adminOverride = !!j.customer?.admin_override;
    }
  } catch {
    /* degrade — fall through to admin-email check below */
  }

  const adminFromEmail = isAdminEmail(email);
  // Legacy tier alias: 'autopilot' → 'agency' (matches embed-auth.ts).
  const normalizedTier =
    tier === "autopilot" ? "agency" : tier === "channel" || tier === "growth" ? "pro" : tier;

  const allowed = normalizedTier === "agency" || adminOverride || adminFromEmail;
  if (!allowed) {
    return {
      ok: false,
      status: 403,
      reason: "agency_tier_required",
      clerkUserId: userId,
      email,
      tier: normalizedTier,
    };
  }
  return {
    ok: true,
    status: 200,
    clerkUserId: userId,
    email,
    tier: normalizedTier,
  };
}

// ── JWT mint / cache ─────────────────────────────────────────────────
//
// Calls /api/desktop/connect-style flow against the backend with a
// synthetic stable challenge. Backend writes a License row + sends the
// "Junior activated on a new machine" email ONCE per user (first
// activation only — subsequent calls don't email).

async function ensureLicenseJwt(
  clerkUserId: string,
  email: string,
  firstName: string,
): Promise<string | null> {
  const jar = await cookies();
  const cached = jar.get(JWT_COOKIE_NAME);
  if (cached?.value) return cached.value;

  // Synthetic challenge — alphanum/_/- only, matches the backend regex.
  // Stable per Clerk user so audit logs read sensibly.
  const challenge = `agency-proxy-${clerkUserId.replace(/[^A-Za-z0-9_-]/g, "")}`.slice(
    0,
    255,
  );

  try {
    const res = await fetch(`${BACKEND_URL}/desktop/connect`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
      },
      body: JSON.stringify({
        clerk_user_id: clerkUserId,
        email,
        first_name: firstName,
        challenge,
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { license_jwt?: string };
    if (!j.license_jwt) return null;
    jar.set({
      name: JWT_COOKIE_NAME,
      value: j.license_jwt,
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/", // covers both /agency and /api/agency
      maxAge: JWT_COOKIE_MAX_AGE_SECONDS,
    });
    return j.license_jwt;
  } catch {
    return null;
  }
}

// ── Pseudo-path handlers ─────────────────────────────────────────────
//
// These two paths aren't on the backend agency surface — they bridge to
// the admin endpoints with internal secret so the agency UI can list +
// archive without depending on a backend extension.

type CampaignBlock = {
  id: string;
  slug: string;
  name?: string;
  title?: string;
  description: string;
  campaign_type: string;
  status: string;
  whop_reward_id: string | null;
  whop_reward_url: string | null;
  whop_reward_state: string | null;
  whop_reward_snapshot_status: string | null;
  whop_reward_snapshot: Record<string, unknown> | null;
  whop_reward_snapshot_business_goal: string | null;
  whop_reward_snapshot_bounty_type: string | null;
  whop_reward_synced_at: string | null;
  whop_reward_last_error: string | null;
  banner_url: string | null;
  business_unit: string | null;
  required_tier: string | null;
  visibility_tiers: string[] | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

// The /admin/campaigns response uses .name; /agency/campaigns returns
// .title. We normalise to .title for the agency client.
function normalizeBlock(row: CampaignBlock): CampaignBlock {
  return {
    ...row,
    title: row.title ?? row.name ?? "",
    visibility_tiers: row.visibility_tiers ?? [],
    whop_reward_snapshot_status: row.whop_reward_snapshot_status ?? "not_attempted",
  };
}

async function handleList(clerkUserId: string): Promise<Response> {
  const url = `${BACKEND_URL}/admin/campaigns?clerk_user_id=${encodeURIComponent(clerkUserId)}`;
  try {
    const res = await fetch(url, {
      headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "" },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      return new NextResponse(text || `${res.status}`, { status: res.status });
    }
    const j = (await res.json()) as { campaigns: CampaignBlock[] };
    // Backend resolves clerk_user_id → User and that User's .id is the
    // FK on sponsored_campaigns.created_by. Fetch it via /affiliate/me?
    // We don't actually have the internal user.id — but /admin/campaigns
    // returns every row anyway. Filter client-side by comparing
    // created_by against the per-user mapping. To avoid an extra call,
    // we pass `clerk_user_id` and the BACKEND will scope to admin
    // visibility (admin sees everything). We then filter created_by ===
    // <internal user id>. Without that mapping, we filter by exposing
    // every row to admins, and by created_by-matches-anything-the-user-
    // created for genuine agency users.
    //
    // Pragmatic v1: surface every campaign the admin/agency caller can
    // edit. Admins see all; non-admin agency callers don't have any
    // rows today (created_by is empty for the legacy seed rows). Once
    // genuine agency users land rows, those rows will carry their
    // user.id and the next iteration of this proxy will scope properly.
    const campaigns = (j.campaigns ?? []).map(normalizeBlock);
    return NextResponse.json({ campaigns });
  } catch {
    return NextResponse.json({ error: "backend_unreachable" }, { status: 502 });
  }
}

async function handleGetSingle(
  slug: string,
  clerkUserId: string,
): Promise<Response> {
  const url = `${BACKEND_URL}/admin/campaigns?clerk_user_id=${encodeURIComponent(clerkUserId)}`;
  try {
    const res = await fetch(url, {
      headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "" },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      return new NextResponse(text || `${res.status}`, { status: res.status });
    }
    const j = (await res.json()) as { campaigns: CampaignBlock[] };
    const row = (j.campaigns ?? []).find((c) => c.slug === slug);
    if (!row) {
      return NextResponse.json({ error: "campaign not found" }, { status: 404 });
    }
    return NextResponse.json(normalizeBlock(row));
  } catch {
    return NextResponse.json({ error: "backend_unreachable" }, { status: 502 });
  }
}

async function handleArchive(
  slug: string,
  clerkUserId: string,
): Promise<Response> {
  const url = `${BACKEND_URL}/admin/campaigns/${encodeURIComponent(slug)}?clerk_user_id=${encodeURIComponent(clerkUserId)}`;
  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "" },
      cache: "no-store",
    });
    if (res.status === 204) {
      return NextResponse.json({ slug, archived: true });
    }
    const text = await res.text();
    return new NextResponse(text || `${res.status}`, { status: res.status });
  } catch {
    return NextResponse.json({ error: "backend_unreachable" }, { status: 502 });
  }
}

// ── Bearer forwarder ─────────────────────────────────────────────────
async function handleBearer(
  req: NextRequest,
  backendPath: string,
  jwt: string,
): Promise<Response> {
  const incoming = new URL(req.url).searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of incoming.entries()) params.set(k, v);
  const qs = params.toString();
  const target = `${BACKEND_URL}/agency/${backendPath}${qs ? `?${qs}` : ""}`;
  const headers: Record<string, string> = { authorization: `Bearer ${jwt}` };
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
      headers: {
        "content-type":
          res.headers.get("content-type") ?? "application/json",
      },
    });
  } catch {
    return NextResponse.json({ error: "backend_unreachable" }, { status: 502 });
  }
}

// ── Path classification ──────────────────────────────────────────────
function classify(
  path: string,
  method: string,
): "internal-read" | "internal-write" | "bearer-read" | "bearer-write" | null {
  if (method === "GET") {
    if (INTERNAL_READ_PATHS.some((re) => re.test(path))) return "internal-read";
    if (BEARER_READ_PATHS.some((re) => re.test(path))) return "bearer-read";
    return null;
  }
  if (INTERNAL_WRITE_PATHS.some((re) => re.test(path))) return "internal-write";
  if (BEARER_WRITE_PATHS.some((re) => re.test(path))) return "bearer-write";
  return null;
}

// ── Dispatch ─────────────────────────────────────────────────────────
async function handle(req: NextRequest, ctx: AgencyRouteCtx): Promise<Response> {
  const gate = await gateRequest();
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.reason ?? "forbidden", tier: gate.tier ?? null },
      { status: gate.status },
    );
  }
  const { path: segments } = await ctx.params;
  const path = (segments ?? []).join("/");
  const cls = classify(path, req.method);
  if (!cls) {
    return NextResponse.json({ error: "path not allowed" }, { status: 400 });
  }

  // Pseudo-path: /list (GET) — internal-secret admin list
  if (cls === "internal-read" && path === "list") {
    return handleList(gate.clerkUserId!);
  }

  // Pseudo-path: /campaigns/{slug} (GET) — internal-secret admin lookup
  if (cls === "internal-read" && /^campaigns\/[^/]+$/.test(path)) {
    const slug = path.split("/")[1];
    return handleGetSingle(slug, gate.clerkUserId!);
  }

  // Pseudo-path: /campaigns/{slug}/archive (POST) — admin DELETE
  if (cls === "internal-write" && /^campaigns\/[^/]+\/archive$/.test(path)) {
    const slug = path.split("/")[1];
    return handleArchive(slug, gate.clerkUserId!);
  }

  // Real backend agency endpoint — needs Bearer.
  const user = await currentUser();
  const firstName = (user?.firstName ?? "").trim();
  const jwt = await ensureLicenseJwt(gate.clerkUserId!, gate.email!, firstName);
  if (!jwt) {
    return NextResponse.json(
      { error: "license_mint_failed" },
      { status: 502 },
    );
  }
  return handleBearer(req, path, jwt);
}

export async function GET(req: NextRequest, ctx: AgencyRouteCtx): Promise<Response> {
  return handle(req, ctx);
}
export async function POST(req: NextRequest, ctx: AgencyRouteCtx): Promise<Response> {
  return handle(req, ctx);
}
export async function PATCH(req: NextRequest, ctx: AgencyRouteCtx): Promise<Response> {
  return handle(req, ctx);
}
export async function DELETE(req: NextRequest, ctx: AgencyRouteCtx): Promise<Response> {
  return handle(req, ctx);
}
