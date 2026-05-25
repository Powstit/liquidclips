"use client";

import { CheckoutButton } from "@clerk/nextjs/experimental";
import { track } from "@/lib/analytics";

// Custom pricing UI. Replaces Clerk's stock <PricingTable> so we control the
// layout, copy, and brand expression while Clerk still owns the checkout +
// card capture under the hood (CheckoutButton wraps any child element).
//
// Currency note: pricing is now USD-native. The headline figures here are the
// exact USD amounts Clerk charges (Solo $29.99, Growth $99.99, Autopilot
// $199.99, Free $0) — what the user sees IS what the card is billed. No GBP
// conversion layer anymore.

type Feature = {
  label: string;
  built: boolean;        // true = live; false = entitled but not shipped yet
  sprint?: string;       // e.g. "Sprint 5" — shown when built === false
};

type Plan = {
  id: string;            // Clerk cplan_xxx
  name: string;
  slug: string;          // Clerk plan slug — also load-bearing for the webhook
  tagline: string;
  priceUsd: number;      // USD — what Clerk charges AND what we display
  features: Feature[];
  highlight?: boolean;   // "Most popular" badge
};

// Plan IDs from the PRODUCTION Clerk instance (ins_3E4VB…346T).
// Re-created on production 2026-05-22 because Clerk plans don't transfer
// dev→prod. Slugs match across instances; IDs do not.
// Mirrors junior-backend/app/features.py FEATURES_BY_TIER. Keep them in sync
// — the backend gate uses the same flags. If a `built: false` line ships,
// flip BOTH this list AND the backend matrix in the same change.
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
    id: "cplan_3E4VBeiWtZP0CJsvPwrIz91uDFk",
    slug: "solo",
    name: "Solo",
    tagline: "Unlimited clips. Bring your own keys.",
    priceUsd: 29.99,
    features: [
      { label: "Unlimited videos per month", built: true },
      { label: "Local-only processing — your machine, your keys", built: true },
      { label: "Multi-ratio export (9:16, 1:1, 4:5)", built: true },
      { label: "B-roll overlay + hook burn-in", built: true },
      { label: "2 platform connections (YouTube, TikTok, X)", built: true },
      { label: "Manual publish — one platform at a time", built: true },
    ],
  },
  {
    id: "cplan_3E4VBjLfMONo1z1qyyK4dIkJGl5",
    slug: "growth",
    name: "Growth",
    tagline: "Hosted transcribe and LLM. Nothing to plug in.",
    priceUsd: 99.99,
    features: [
      { label: "Everything in Solo", built: true },
      { label: "Hosted transcribe — no Whisper download", built: true },
      { label: "Hosted LLM — no OpenAI key needed", built: true },
      { label: "4 platform connections", built: true },
      { label: "Multi-platform publish in one click", built: true },
      { label: "Schedule one post at a time", built: true },
      { label: "200 clips / month", built: true },
      { label: "Priority support", built: false, sprint: "Sprint 6" },
    ],
    highlight: true,
  },
  {
    id: "cplan_3E4VBfKWkQlIuYRQG0YE5LfJPjx",
    slug: "autopilot",
    name: "Autopilot",
    tagline: "Drip-mode. Junior posts while you sleep.",
    priceUsd: 199.99,
    features: [
      { label: "Everything in Growth", built: true },
      { label: "Drip scheduling — a whole month of clips", built: true },
      { label: "Unlimited platform connections", built: true },
      { label: "500 clips / month", built: true },
      { label: "Project memory — learns your voice", built: false, sprint: "v1.2" },
      { label: "Cross-platform smart timing", built: false, sprint: "v1.2" },
      { label: "Founder community access", built: false, sprint: "Sprint 6" },
    ],
  },
];

export function PricingCards({ currentSlug }: { currentSlug?: string }) {
  // Monthly billing only — annual ships once we have real pricing data to
  // back a discount. No fake "save 20%" theatre.
  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PLANS.map((p) => (
          <PlanCard
            key={p.id}
            plan={p}
            isCurrent={currentSlug === p.slug}
            isOnPaidPlan={!!currentSlug && currentSlug !== "free_user"}
            currentSlug={currentSlug}
          />
        ))}
      </div>

      <p className="mt-6 text-center font-mono text-[11px] text-text-tertiary">
        Billed monthly in USD by Stripe via Clerk. Your bank converts at their card-network rate.
      </p>
    </div>
  );
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
        ) : (
          <CheckoutButton planId={plan.id} planPeriod="month">
            <button
              onClick={() =>
                track("checkout_started", {
                  plan_id: plan.id,
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
