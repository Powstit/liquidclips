export type WhopPlanKey = "pro" | "growth" | "agency";

export type WhopPlan = {
  key: WhopPlanKey;
  planId: string;
  name: "Pro" | "Growth" | "Agency";
  priceMonthlyUsd: number;
  summary: string;
};

// Customer-facing billing is Whop-first. These defaults are the live plans
// verified against Whop's Plans API on 2026-06-28. Environment overrides let
// us rotate a plan without changing application code.
export const WHOP_PLANS: Record<WhopPlanKey, WhopPlan> = {
  pro: {
    key: "pro",
    planId:
      process.env.NEXT_PUBLIC_WHOP_PRO_PLAN_ID ??
      process.env.NEXT_PUBLIC_WHOP_SOLO_PLAN_ID ??
      "plan_qe8AFXj9J3SWi",
    name: "Pro",
    priceMonthlyUsd: 29.99,
    summary: "Unlimited local clipping, clean exports, and 5 connected accounts.",
  },
  growth: {
    key: "growth",
    planId:
      process.env.NEXT_PUBLIC_WHOP_GROWTH_PLAN_ID ??
      "plan_dhssNse4FfPlI",
    name: "Growth",
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
