// Server-authoritative capability snapshot for the account-app proxy layer.
//
// Batch 2E of SELF_ONBOARDING_RELEASE_MASTER.md §Step 2 introduces this
// helper. Before it, every /admin/* + /agency/* server component gated on
// `isAdmin(email)` from `lib/admin-allowlist.ts` — an email allowlist
// evaluated in the Next.js process using JUNIOR_ADMIN_EMAILS env, entirely
// independent of the backend. Two divergent sources of truth for the same
// question ("is this user an admin?") — that's a class of drift bug the
// server-owned capability matrix exists to sever.
//
// From Batch 2E onward, all account-app admin/agency gates read
// `platform_role` + `capabilities` from this helper. The email allowlist
// remains available for a single compatibility release for callers we
// haven't migrated yet; new gates MUST use `hasCapability`.
//
// Do not cache the snapshot across requests — the projection is meant to
// take effect on the very next hit so a downgrade / role change lands
// immediately. The `cache: "no-store"` on the fetch is deliberate.

const BACKEND_URL =
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

export type TenantContext = {
  tenant_id: string;
  role: "owner" | "member" | "mod" | "none";
};

// Mirror of the backend Capability enum values so call sites reference a
// stable string constant instead of hand-rolling ad-hoc names. Adding a
// capability requires an edit in both `app/authz/capabilities.py` and
// this file — that's the closed-registry discipline.
export const CAP = {
  CLIPPER_USE: "clipper.use",
  AGENCY_WORKSPACE_READ: "agency.workspace.read",
  AGENCY_CAMPAIGN_CREATE: "agency.campaign.create",
  AGENCY_CAMPAIGN_UPDATE: "agency.campaign.update",
  AGENCY_CAMPAIGN_PUBLISH: "agency.campaign.publish",
  AGENCY_CAMPAIGN_ARCHIVE: "agency.campaign.archive",
  AGENCY_ROSTER_READ: "agency.roster.read",
  AGENCY_ROSTER_MANAGE: "agency.roster.manage",
  AGENCY_RULES_MANAGE: "agency.rules.manage",
  AGENCY_PAYOUTS_READ: "agency.payouts.read",
  AGENCY_PAYOUTS_MANAGE: "agency.payouts.manage",
  HQ_READ: "hq.read",
  HQ_MUTATE: "hq.mutate",
  SUPPORT_TENANT_READ: "support.tenant.read",
  SUPPORT_TENANT_WRITE: "support.tenant.write",
  DEMO_PLAN_OVERRIDE: "demo.plan_override",
} as const;

export type Capability = (typeof CAP)[keyof typeof CAP];

export type ServerCapabilitySnapshot = {
  backend_user_id: string;
  clerk_id: string | null;
  email: string | null;
  platform_role: "none" | "staff" | "admin";
  capabilities: string[];
  tenant_contexts: TenantContext[];
  limits: Record<string, number>;
  capability_schema_version: number;
  raw_tier: string;
  effective_plan: string;
};

/**
 * Fetch the server-authoritative capability snapshot for a Clerk user.
 * Returns `null` when the backend is unreachable or reports the user
 * does not exist — callers should treat `null` as "closed gate" and
 * NOT fall back to the legacy email allowlist for new code paths.
 *
 * Only callable from Next.js server components / API routes — this
 * function forwards the INTERNAL_API_SECRET env, which must never
 * reach the browser.
 */
export async function fetchCapabilities(
  clerkUserId: string,
): Promise<ServerCapabilitySnapshot | null> {
  if (!clerkUserId) return null;
  const secret = process.env.INTERNAL_API_SECRET ?? "";
  const url = `${BACKEND_URL}/authz/whoami?clerk_user_id=${encodeURIComponent(
    clerkUserId,
  )}`;
  try {
    const res = await fetch(url, {
      headers: { "x-internal-secret": secret },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ServerCapabilitySnapshot;
    return data;
  } catch {
    return null;
  }
}

/**
 * Server-authoritative capability check. Returns `false` for a null
 * snapshot so a backend outage never accidentally unlocks a gate — the
 * caller must decide separately whether to render a degraded state or
 * a hard error.
 */
export function hasCapability(
  snapshot: ServerCapabilitySnapshot | null,
  capability: Capability,
): boolean {
  if (!snapshot) return false;
  return snapshot.capabilities.includes(capability);
}

/**
 * Convenience predicate — `true` when the user has admin platform role.
 * Prefer `hasCapability(snapshot, CAP.HQ_READ)` for specific action
 * checks; use this only for coarse "am I an admin?" UX signals.
 */
export function isPlatformAdmin(
  snapshot: ServerCapabilitySnapshot | null,
): boolean {
  if (!snapshot) return false;
  return snapshot.platform_role === "admin";
}
