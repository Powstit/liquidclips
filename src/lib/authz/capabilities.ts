/**
 * Client mirror of the backend Capability enum.
 *
 * Batch 2F of SELF_ONBOARDING_RELEASE_MASTER.md §Step 2 introduces this
 * primitive. Before it, desktop UI gates read `tier.adminOverride` (a
 * boolean derived from the backend's legacy `admin_override` field which
 * mirrored `is_admin_email`) or `tier.tier === "agency"` — both are
 * client-side inferences that can drift from what the server actually
 * grants. From Batch 2F onward, gates read `hasCapability(caps, CAP.X)`
 * where `caps` is the server-authoritative array returned by /me and
 * /sync.
 *
 * Adding a capability requires an edit in BOTH `app/authz/capabilities.py`
 * on the backend AND this file. The closed-registry discipline stops
 * gates from referencing capability strings that don't exist.
 *
 * `tier.adminOverride` remains available for one compat release so an
 * unmigrated UI gate keeps working; new gates MUST use `hasCapability`.
 */

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

export type PlatformRole = "none" | "staff" | "admin";
export type OperatingMode = "self" | "demo" | "support";

export interface TenantContext {
  tenantId: string;
  role: "owner" | "member" | "mod" | "none";
}

/**
 * Server-authoritative capability check. Returns `false` when the caps
 * array is null / undefined so an unloaded snapshot never unlocks a
 * gate accidentally. Callers should render a loading state, not treat
 * absence as denial.
 */
export function hasCapability(
  caps: string[] | null | undefined,
  capability: Capability,
): boolean {
  if (!caps || caps.length === 0) return false;
  return caps.includes(capability);
}

/**
 * Convenience predicate for coarse "am I an admin?" signals. Prefer
 * `hasCapability(caps, CAP.HQ_READ)` for action-specific gates.
 */
export function isPlatformAdmin(role: PlatformRole | null | undefined): boolean {
  return role === "admin";
}
