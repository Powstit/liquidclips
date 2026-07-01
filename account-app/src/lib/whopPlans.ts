export type WhopPlanKey = "pro" | "growth" | "agency";

export type WhopPlan = {
  key: WhopPlanKey;
  planId: string;
  name: "Solo" | "Pro" | "Agency";
  priceMonthlyUsd: number;
  summary: string;
};

// v2.2.15 · display names aligned to doctrine v2 (Solo/Pro/Agency).
// URL keys ("pro", "growth", "agency") stay unchanged for backward
// compatibility with existing marketing links + backend routing —
// only the customer-facing labels moved:
//   key="pro"    → name="Solo"   ($29.99  · was "Pro")
//   key="growth" → name="Pro"    ($99.99  · was "Growth")
//   key="agency" → name="Agency" ($500    · unchanged)
export const WHOP_PLANS: Record<WhopPlanKey, WhopPlan> = {
  pro: {
    key: "pro",
    planId:
      process.env.NEXT_PUBLIC_WHOP_PRO_PLAN_ID ??
      process.env.NEXT_PUBLIC_WHOP_SOLO_PLAN_ID ??
      "plan_qe8AFXj9J3SWi",
    name: "Solo",
    priceMonthlyUsd: 29.99,
    summary: "Unlimited local clipping, clean exports, and 5 connected accounts.",
  },
  growth: {
    key: "growth",
    planId:
      process.env.NEXT_PUBLIC_WHOP_GROWTH_PLAN_ID ??
      "plan_dhssNse4FfPlI",
    name: "Pro",
    priceMonthlyUsd: 99.99,
    summary: "More capacity, 10 connected accounts, and the hosted AI lane as it becomes available.",
  },
  agency: {
    key: "agency",
    planId:
      process.env.NEXT_PUBLIC_WHOP_AGENCY_PLAN_ID ??
      "plan_BvDBrtybhbxNg",
    name: "Agency",
    priceMonthlyUsd: 500,
    summary: "Campaign operations, multi-brand capacity, and 25 connected accounts.",
  },
};

export function normalizeWhopPlanKey(value: string | null | undefined): WhopPlanKey {
  const key = (value ?? "").trim().toLowerCase();
  // "solo" is the legacy/public alias for the first paid plan.
  if (key === "growth") return "growth";
  if (key === "agency" || key === "autopilot") return "agency";
  return "pro";
}

export function whopUpgradeHref(
  plan: WhopPlanKey,
  affiliateCode?: string | null,
): string {
  const params = new URLSearchParams({ plan });
  if (affiliateCode) params.set("a", affiliateCode);
  return `/upgrade?${params.toString()}`;
}
