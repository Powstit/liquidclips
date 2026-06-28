"use client";

import { track } from "@/lib/analytics";
import { whopUpgradeHref, type WhopPlanKey } from "@/lib/whopPlans";

// Custom pricing UI. Every paid CTA enters the plan-aware Whop checkout.
//
// Currency note: pricing is USD-native. Public tiers are Free / Pro / Growth /
// Agency; backend aliases keep legacy stored tier values compatible.

type Feature = {
  label: string;
  built: boolean;        // true = live; false = entitled but not shipped yet
  sprint?: string;       // e.g. "Sprint 5" — shown when built === false
};

type Plan = {
  id: string;            // Stable UI/analytics id.
  checkoutPlan: WhopPlanKey | null;
  name: string;
  slug: string;          // Backend tier alias used to mark the current plan.
  tagline: string;
  priceUsd: number;      // USD — what Clerk charges AND what we display
  features: Feature[];
  highlight?: boolean;   // "Most popular" badge
};

// Mirrors junior-backend/app/features.py FEATURES_BY_TIER. Keep them in sync.
// If a `built: false` line ships, flip BOTH this list AND the backend matrix
// in the same change.
const PLANS: Plan[] = [
  {
    id: "free",
    checkoutPlan: null,
    slug: "free_user",
    name: "Free",
    tagline: "Try it. 100 free clip exports, no card.",
    priceUsd: 0,
    features: [
      { label: "100 free clip exports", built: true },
      { label: "Bring your own OpenAI key", built: true },
      { label: "Multi-ratio export (9:16, 1:1, 4:5)", built: true },
      { label: "B-roll overlay + hook burn-in", built: true },
      { label: "Manual posting only", built: true },
    ],
  },
  {
    id: "solo",
    checkoutPlan: "pro",
    slug: "solo",
    name: "Pro",
    tagline: "Unlimited clips for one creator.",
    priceUsd: 29.99,
    features: [
      { label: "Unlimited videos per month", built: true },
      { label: "Local-only processing — your machine, your keys", built: true },
      { label: "5 social accounts included", built: true },
      { label: "Multi-ratio export (9:16, 1:1, 4:5)", built: true },
      { label: "B-roll overlay + hook burn-in", built: true },
      { label: "Publish one platform at a time", built: false, sprint: "Beta" },
    ],
  },
  {
    id: "growth",
    checkoutPlan: "growth",
    slug: "growth",
    name: "Growth",
    tagline: "Hosted AI and multi-platform publishing.",
    priceUsd: 99.99,
    features: [
      { label: "Everything in Pro", built: true },
      { label: "10 social accounts included", built: true },
      { label: "Hosted LLM — no OpenAI key needed", built: false, sprint: "Beta" },
      { label: "All platform connections", built: true },
      { label: "Multi-platform publish in one click", built: false, sprint: "Beta" },
      { label: "Schedule one post at a time", built: false, sprint: "Beta" },
      { label: "Priority support", built: false, sprint: "Sprint 6" },
    ],
    highlight: true,
  },
  {
    id: "agency",
    checkoutPlan: "agency",
    slug: "agency",
    name: "Agency",
    tagline: "For client accounts and white-label teams.",
    priceUsd: 199.99,
    features: [
      { label: "Everything in Pro", built: true },
      { label: "25 social accounts included", built: true },
      { label: "Drip scheduling — a whole month of clips", built: false, sprint: "Beta" },
      { label: "Sub-accounts for client work", built: false, sprint: "v1.1" },
      { label: "White-label exports", built: false, sprint: "v1.1" },
      { label: "Priority support", built: false, sprint: "Sprint 6" },
    ],
  },
];

export function PricingCards({
  currentSlug,
  affiliateCode,
}: {
  currentSlug?: string;
  affiliateCode?: string | null;
}) {
  const normalizedCurrentSlug = normalizePlanSlug(currentSlug);
  // Monthly billing only — annual ships once we have real pricing data to
  // back a discount. No fake "save 20%" theatre.
  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PLANS.map((p) => (
          <PlanCard
            key={p.id}
            plan={p}
            isCurrent={normalizedCurrentSlug === p.slug}
            isOnPaidPlan={!!normalizedCurrentSlug && normalizedCurrentSlug !== "free_user"}
            currentSlug={normalizedCurrentSlug}
            affiliateCode={affiliateCode}
          />
        ))}
      </div>

      <p className="mt-6 text-center font-mono text-[11px] text-text-tertiary">
        Billed monthly in USD by Whop. Manage payment details and cancellation in Whop.
      </p>
    </div>
  );
}

function normalizePlanSlug(slug?: string): string | undefined {
  if (!slug) return undefined;
  if (slug === "free") return "free_user";
  // 2026-06-23 · Clerk slug rename Pro → Growth. Legacy users still tagged
  // "pro" / "channel" must normalise UP to "growth" (the new card slug)
  // so PricingCards correctly marks their current plan.
  if (slug === "pro" || slug === "channel") return "growth";
  if (slug === "autopilot") return "agency";
  return slug;
}

function PlanCard({
  plan,
  isCurrent,
  isOnPaidPlan,
  currentSlug,
  affiliateCode,
}: {
  plan: Plan;
  isCurrent: boolean;
  isOnPaidPlan: boolean;
  currentSlug?: string;
  affiliateCode?: string | null;
}) {
  const isFreePlan = plan.priceUsd === 0;
  const canCheckout = !!plan.checkoutPlan;
  const accentClasses = plan.highlight
    ? "border-fuchsia bg-gradient-to-br from-fuchsia-soft/30 to-paper shadow-[0_20px_60px_rgba(255,26,140,0.10)]"
    : "border-line bg-paper";

  return (
    <div
      className={`relative flex flex-col rounded-3xl border p-7 transition-shadow ${accentClasses}`}
    >
      {plan.highlight && (
        <span className="absolute -top-3 left-7 rounded-full bg-fuchsia px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-paper">
          Most popular
        </span>
      )}
      {isCurrent && (
        <span className="absolute -top-3 right-7 rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          Current plan
        </span>
      )}

      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
        {plan.name}
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-display text-[44px] font-bold tracking-[-0.03em] text-ink">
          {isFreePlan ? "Free" : `$${plan.priceUsd.toFixed(2)}`}
        </span>
        {!isFreePlan && (
          <span className="font-mono text-[12px] text-text-tertiary">/month</span>
        )}
      </div>
      {!isFreePlan && (
        <div className="mt-1 font-mono text-[11px] text-text-tertiary">
          USD billed monthly
        </div>
      )}

      <p className="mt-4 font-sans text-[14px] leading-relaxed text-text-secondary">
        {plan.tagline}
      </p>

      <div className="mt-6">
        {isFreePlan ? (
          <button
            disabled
            className="w-full rounded-full border border-line bg-paper px-5 py-3 font-sans text-[13px] font-medium text-text-tertiary"
          >
            {isCurrent ? "You're on Free" : "Sign up — it's free"}
          </button>
        ) : isCurrent ? (
          <button
            disabled
            className="w-full rounded-full border border-fuchsia bg-fuchsia-soft/40 px-5 py-3 font-sans text-[13px] font-medium text-fuchsia-deep"
          >
            Current plan
          </button>
        ) : canCheckout && plan.checkoutPlan ? (
          <a
            href={whopUpgradeHref(plan.checkoutPlan, affiliateCode)}
            onClick={() =>
              track("checkout_started", {
                billing_provider: "whop",
                plan_key: plan.checkoutPlan,
                plan_name: plan.name,
                current_tier: currentSlug,
              })
            }
            className={`block w-full rounded-full px-5 py-3 text-center font-sans text-[13px] font-medium transition-all ${
              plan.highlight
                ? "bg-fuchsia text-paper hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)]"
                : "bg-ink text-paper hover:bg-fuchsia"
            }`}
          >
            {isOnPaidPlan ? "Change to " + plan.name : "Start with " + plan.name}
          </a>
        ) : (
          <button
            disabled
            className="w-full rounded-full border border-line bg-paper px-5 py-3 font-sans text-[13px] font-medium text-text-tertiary"
            title="This Whop plan is not configured."
          >
            Join waitlist
          </button>
        )}
      </div>

      <ul className="mt-7 space-y-3 font-sans text-[13px] text-ink">
        {plan.features.map((f) => (
          <li key={f.label} className="flex items-start gap-3">
            {f.built ? (
              <span
                className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-fuchsia"
                aria-label="Live"
              />
            ) : (
              <span
                className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full border border-fuchsia bg-paper"
                aria-label="Coming soon"
                title="Coming soon"
              />
            )}
            <span className={`flex-1 ${f.built ? "" : "text-text-secondary"}`}>
              {f.label}
              {!f.built && (
                <span className="ml-2 inline-flex items-center rounded-full border border-line bg-paper-warm/60 px-2 py-[1px] font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
                  Soon
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
