import { NextResponse, type NextRequest } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { isAdmin as isAdminEmail } from "@/lib/admin-allowlist";
import {
  isAgencyTier,
  normalizeAccountTier,
} from "@/lib/agency-tiers";
import {
  readBoundAgencyLicenseJwt,
  storeBoundAgencyLicenseJwt,
} from "@/lib/agency-license-cache";

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
// The internal secret + JWT never reach the browser. The browser sends
// the user's Clerk cookie, which proves who they are; everything else
// is server-only.

const BACKEND_URL =
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

// ── Path allow-list ──────────────────────────────────────────────────
//
// Every backend path the proxy can reach. All campaign operations use
// owner-scoped /agency endpoints with the signed-in user's Bearer JWT.
const BEARER_READ_PATHS = [
  /^list$/, // browser alias → GET /agency/campaigns
  /^campaigns\/[^/]+$/,
  /^campaigns\/[^/]+\/submissions$/,
  /^campaigns\/[^/]+\/analytics$/,
];
const BEARER_WRITE_PATHS = [
  /^campaigns$/, // POST create
  /^campaigns\/[^/]+$/, // PATCH edit
  /^campaigns\/[^/]+\/connect-reward$/,
  /^campaigns\/[^/]+\/publish$/,
  /^campaigns\/[^/]+\/refresh-reward$/,
  /^campaigns\/[^/]+\/archive$/,
  /^whop\/validate-reward$/,
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
  const normalizedTier = normalizeAccountTier(tier);

  const allowed = isAgencyTier(normalizedTier) || adminOverride || adminFromEmail;
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
  const cached = readBoundAgencyLicenseJwt(jar, clerkUserId);
  if (cached) return cached;

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
    storeBoundAgencyLicenseJwt(jar, clerkUserId, j.license_jwt);
    return j.license_jwt;
  } catch {
    return null;
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
): "bearer-read" | "bearer-write" | null {
  if (method === "GET") {
    if (BEARER_READ_PATHS.some((re) => re.test(path))) return "bearer-read";
    return null;
  }
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

  // Every campaign operation reaches an owner-scoped backend endpoint
  // with the signed-in user's Bearer JWT. `/list` remains a stable
  // browser alias for GET /agency/campaigns.
  const user = await currentUser();
  const firstName = (user?.firstName ?? "").trim();
  const jwt = await ensureLicenseJwt(gate.clerkUserId!, gate.email!, firstName);
  if (!jwt) {
    return NextResponse.json(
      { error: "license_mint_failed" },
      { status: 502 },
    );
  }
  return handleBearer(req, path === "list" ? "campaigns" : path, jwt);
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
