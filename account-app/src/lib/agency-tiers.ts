/** Canonical account-app entitlement contract for agency products. */

export const AGENCY_TIERS = new Set([
  "agency_solo",
  "agency",
  "agency_whitelabel",
] as const);

export function normalizeAccountTier(
  tier: string | null | undefined,
): string {
  if (tier === "autopilot") return "agency";
  if (tier === "channel" || tier === "growth") return "pro";
  return tier || "free";
}

export function isAgencyTier(tier: string | null | undefined): boolean {
  return AGENCY_TIERS.has(
    normalizeAccountTier(tier) as "agency_solo" | "agency" | "agency_whitelabel",
  );
}
