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
//   key="pro"    → name="Solo"   ($29.99)
//   key="growth" → name="Pro"    ($99.99)
//   key="agency" → name="Agency" ($99.99  · fixed 2026-08-05)
//
// 2026-08-05 — the "agency" planId pointed at plan_BvDBrtybhbxNg, which is
// genuinely configured on Whop at $500/mo (internal_notes: "Agency",
// confirmed live via the Whop API) — a leftover from before the single-
// $99.99-plan pricing pivot that every UI surface (Settings, the upgrade
// modal) already promises. Real customers clicking "Upgrade to Agency
// $99.99/mo" were being routed to a genuine $500 checkout. Fixed by
// minting a new plan rather than reusing the "growth" plan's id — Growth
// is itself a real, separately-purchasable tier (see PricingCards.tsx on
// the dashboard), not deferred, so sharing its plan id would have
// misclassified genuine Growth buyers as Agency (or vice versa) at the
// webhook's plan-id→tier mapping layer.
//
// Two false starts before landing on plan_0revJ8hp7YDO6, both now
// harmless orphans (nothing points at them, safe to delete via the
// dashboard whenever convenient):
//   - plan_b9p0aliMI2okA — created with the Whop API's stock default
//     (0, not unlimited) → unpurchasable.
//   - plan_fcYLS5GWhd3t7 — unlimited_stock fixed, but created with
//     initial_price=99.99 alongside renewal_price=99.99. Whop's working
//     plans (Growth, Solo) both use initial_price=0 — the recurring
//     renewal_price alone is what's charged going forward. Setting both
//     to 99.99 made checkout show "Initial fee $99.99 + Renewal fee
//     $99.99 = Total due today $199.98" — a real double-charge on day
//     one, confirmed live before catching it.
// plan_0revJ8hp7YDO6 matches the Growth/Solo pattern exactly
// (initial_price=0, renewal_price=99.99, unlimited_stock=true) and is
// confirmed via the Whop API to be correctly configured. The old $500
// plan_BvDBrtybhbxNg is left untouched in
// junior-backend/app/routes/webhooks_whop.py::PLAN_TIER_BY_ID so any
// pre-existing membership on it keeps resolving correctly — it's just no
// longer the checkout target for new purchases.
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
      "plan_0revJ8hp7YDO6",
    name: "Agency",
    priceMonthlyUsd: 99.99,
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
