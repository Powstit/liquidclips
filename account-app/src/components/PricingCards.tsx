"use client";

import { CheckoutButton } from "@clerk/nextjs/experimental";
import { track } from "@/lib/analytics";

// Custom pricing UI. Replaces Clerk's stock <PricingTable> so we control the
// layout, copy, and brand expression while Clerk still owns the checkout +
// card capture under the hood (CheckoutButton wraps any child element).
//
// Currency note: pricing is USD-native. Public v2 tiers are Free / Solo / Pro
// / Agency. Pro/Agency checkout stays disabled until the verified Clerk plan
// IDs are supplied via env; backend aliases map legacy billing events to the
// new tier names.

type Feature = {
  label: string;
  built: boolean;        // true = live; false = entitled but not shipped yet
  sprint?: string;       // e.g. "Sprint 5" — shown when built === false
};

type Plan = {
  id: string;            // Stable UI/analytics id.
  checkoutPlanId?: string; // Clerk cplan_xxx. Omit until the public price is verified in Clerk.
  name: string;
  slug: string;          // Clerk plan slug — also load-bearing for the webhook
  tagline: string;
  priceUsd: number;      // USD — what Clerk charges AND what we display
  features: Feature[];
  highlight?: boolean;   // "Most popular" badge
};

// Clerk plan IDs (live). Env vars override the defaults so Vercel can swap
// without a redeploy. Defaults pinned 2026-06-01 after creating Pro + Agency
// in the Clerk dashboard (Backend API is read-only for billing — `Allow: GET`
// is explicit, so plan create/edit only happens in the dashboard UI).
const SOLO_PLAN_ID =
  process.env.NEXT_PUBLIC_CLERK_SOLO_PLAN_ID ?? "cplan_3E4VBeiWtZP0CJsvPwrIz91uDFk";
const PRO_PLAN_ID =
  process.env.NEXT_PUBLIC_CLERK_PRO_PLAN_ID ?? "cplan_3EV9Jjn8qLG130iSSRpAUOmqAfm";
const AGENCY_PLAN_ID =
  process.env.NEXT_PUBLIC_CLERK_AGENCY_PLAN_ID ?? "cplan_3E4VBfKWkQlIuYRQG0YE5LfJPjx";
// Account Pack — $6/mo per extra social account add-on (one Clerk subscription
// quantity = one additional account). Wired here as a const for the eventual
// purchase flow in Settings; PricingCards doesn't render it as a card today
// (it's an upsell shown at the account-limit wall later).
export const ACCOUNT_PACK_PLAN_ID =
  process.env.NEXT_PUBLIC_CLERK_ACCOUNT_PACK_PLAN_ID ?? "cplan_3EV9znSsguzmwoQoEr5kXpumkfM";

// Mirrors junior-backend/app/features.py FEATURES_BY_TIER. Keep them in sync.
// If a `built: false` line ships, flip BOTH this list AND the backend matrix
// in the same change.
const PLANS: Plan[] = [
  {
    id: "free",
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
    checkoutPlanId: SOLO_PLAN_ID,
    slug: "solo",
    name: "Solo",
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
    id: "pro",
    checkoutPlanId: PRO_PLAN_ID,
    slug: "pro",
    name: "Pro",
    tagline: "Hosted AI and multi-platform publishing.",
    priceUsd: 79.99,
    features: [
      { label: "Everything in Solo", built: true },
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
    checkoutPlanId: AGENCY_PLAN_ID,
    slug: "agency",
    name: "Agency",
    tagline: "For client accounts and white-label teams.",
    priceUsd: 149,
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

export function PricingCards({ currentSlug }: { currentSlug?: string }) {
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
          />
        ))}
      </div>

      <p className="mt-6 text-center font-mono text-[11px] text-text-tertiary">
        Billed monthly in USD by Stripe via Clerk. Your bank converts at their card-network rate.
      </p>
    </div>
  );
}

function normalizePlanSlug(slug?: string): string | undefined {
  if (!slug) return undefined;
  if (slug === "free") return "free_user";
  if (slug === "growth" || slug === "channel") return "pro";
  if (slug === "autopilot") return "agency";
  return slug;
}

function PlanCard({
  plan,
  isCurrent,
  isOnPaidPlan,
  currentSlug,
}: {
  plan: Plan;
  isCurrent: boolean;
  isOnPaidPlan: boolean;
  currentSlug?: string;
}) {
  const isFreePlan = plan.priceUsd === 0;
  const canCheckout = !!plan.checkoutPlanId;
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
        ) : canCheckout ? (
          <CheckoutButton planId={plan.checkoutPlanId!} planPeriod="month">
            <button
              onClick={() =>
                track("checkout_started", {
                  plan_id: plan.checkoutPlanId,
                  plan_name: plan.name,
                  current_tier: currentSlug,
                })
              }
              className={`w-full rounded-full px-5 py-3 font-sans text-[13px] font-medium transition-all ${
                plan.highlight
                  ? "bg-fuchsia text-paper hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)]"
                  : "bg-ink text-paper hover:bg-fuchsia"
              }`}
            >
              {isOnPaidPlan ? "Switch to " + plan.name : "Start with " + plan.name}
            </button>
          </CheckoutButton>
        ) : (
          <button
            disabled
            className="w-full rounded-full border border-line bg-paper px-5 py-3 font-sans text-[13px] font-medium text-text-tertiary"
            title={`Set NEXT_PUBLIC_CLERK_${plan.slug.toUpperCase()}_PLAN_ID after verifying the public price in Clerk.`}
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
