/**
 * Billing types · 2026-06-23 monetisation pass.
 *
 * Adapter-boundary types so PaywallGate + Settings + Inbox can read
 * billing state from one canonical source. Real wire-up (Clerk/Stripe)
 * lands in `clerkAdapter.ts` later; this file just defines the shape.
 *
 * Daniel's directive: do not pretend real billing is connected if it
 * isn't. The MockBillingAdapter exposes `isMock: true` so any consumer
 * that needs honesty (e.g. the YOU callout) can render `[simulator]`.
 */

import type { Tier } from "../../design-os/state/useTierCaps";

/** Where the user is in the subscription lifecycle. */
export type BillingState =
  | "free"               // No paid plan · default
  | "checkout_started"   // Redirected to Whop checkout
  | "checkout_failed"    // Returned to app without an active subscription
  | "trial"              // Active but inside the trial window · countdown copy
  | "active"             // Subscription confirmed
  | "past_due"           // Payment failed; grace period; tier may still be active
  | "cancelled"          // Cancelled · entitlement holds until periodEnd
  | "expired";           // Cancelled + periodEnd elapsed · no entitlement

/** Plan keys the app knows about. `accountpack` remains for legacy state, but
 *  new purchases route to Pro because there is no live Whop add-on plan. */
export type PlanKey = "free" | "pro" | "growth" | "agency" | "accountpack";

export interface Plan {
  key: PlanKey;
  /** User-facing name · matches BRAND_ASSETS.md ladder. */
  displayName: "Free Clipper" | "Pro" | "Growth" | "Agency" | "Account pack";
  /** Monthly price in USD · 0 for Free. This is the price the app charges
   *  RIGHT NOW · matches what Whop actually bills. During a launch offer
   *  window this is the discounted price; the post-launch price lives on
   *  `launchOffer.normalPriceMonthlyUsd`. */
  priceMonthlyUsd: number;
  /** Maps to the Tier enum used by useTierCaps + TIER_CAPS. Add-ons reuse
   *  the buyer's current tier — accountpack stays on "clipper" for free
   *  users, "pro" for pro users, etc. The catalog default reflects the
   *  most common purchaser (clipper hitting the 1-channel cap). */
  tier: Tier;
  /** One-line value-prop pitch for upgrade CTAs. */
  pitch: string;
  /** Whether this is an add-on rather than a tier. Add-ons stack on top
   *  of the buyer's current subscription instead of replacing it. */
  isAddon?: boolean;
  /** Optional launch offer window. When present + `active === true`, the
   *  UI shows priceMonthlyUsd as the primary CTA price with a "Launch
   *  offer" label + fine print that the normal price is normalPriceMonthlyUsd
   *  after the sunset condition. Existing customers are grandfathered. */
  launchOffer?: LaunchOffer;
}

/** Launch-offer envelope for time-limited pricing. NOT attached to any
 *  plan today (pricing pivot 2026-07-06 · Agency is a flat $99.99/mo,
 *  no strike-through, no $500 confusion). Kept as a type so a future
 *  discount campaign can flip a plan onto it without shape churn. */
export interface LaunchOffer {
  /** Whether the launch window is still open. When false, UI hides the
   *  "Launch offer" label and renders normalPriceMonthlyUsd instead. */
  active: boolean;
  /** User-facing label for the discount · "Launch offer" per Daniel. */
  label: string;
  /** Post-launch monthly price in USD · shown as fine print while
   *  active, becomes the checkout price when active === false. */
  normalPriceMonthlyUsd: number;
  /** Currency symbol for the normal price · "$" for USD, "£" for GBP.
   *  The MRR threshold is denominated in GBP · the seat threshold is
   *  a raw count. Keep this a plain symbol so surfaces render honestly. */
  normalPriceCurrencySymbol: string;
  /** Sunset copy · "Launch price available until £100k MRR or 12,000 seats" */
  sunsetCopy: string;
  /** Grandfather promise · "Existing launch customers stay at their
   *  offer price after the window closes." */
  grandfatherCopy: string;
}

/** Canonical plan catalog. Read-only; mock + real adapters return slices
 *  of this when rendering checkout/upgrade UIs. Real Clerk plan IDs live
 *  on the server — the desktop only knows display + price.
 *
 *  Prices verified 2026-06-28 against Whop's live Plans API. */
export const PLAN_CATALOG: Record<PlanKey, Plan> = {
  free: {
    key: "free",
    displayName: "Free Clipper",
    priceMonthlyUsd: 0,
    tier: "clipper",
    pitch: "Get started · watermarked clips · 25 posts/mo",
  },
  pro: {
    key: "pro",
    displayName: "Pro",
    priceMonthlyUsd: 29.99,
    tier: "pro",
    pitch: "Watermark off · 5 channels · 250 posts/mo",
  },
  growth: {
    key: "growth",
    displayName: "Growth",
    priceMonthlyUsd: 99.99,
    tier: "growth",
    pitch: "Hosted AI lane · priority queue · 10 channels · 750 posts/mo",
  },
  agency: {
    key: "agency",
    // Pricing Pivot 2026-07-06 (LOCKED · liquid_clips_pricing_pivot_2026-07-06):
    // ONE paid plan today · Agency $99.99/mo. Sign-up is $0 · real
    // price is $99.99. No $500 confusion, no fake "normally X" strike-
    // through. If a launch discount is ever reintroduced it lands via
    // launchOffer.active=true; today launchOffer is absent so surfaces
    // just render "$99.99/mo" as the single honest price.
    displayName: "Agency",
    priceMonthlyUsd: 99.99,
    tier: "agency",
    pitch: "Multi-brand · campaign launch · analytics rollups · 2,500 posts/mo",
  },
  accountpack: {
    key: "accountpack",
    displayName: "Account pack",
    priceMonthlyUsd: 6,
    tier: "clipper",
    pitch: "+1 connected social account · stacks on any plan · cancel anytime",
    isAddon: true,
  },
};

export interface CheckoutOutcome {
  ok: boolean;
  planKey: PlanKey;
  error?: string;
}

export interface BillingSnapshot {
  state: BillingState;
  currentPlan: PlanKey;
  /** Source-of-truth label · "real" when the adapter talks to Clerk;
   *  "mock" when sim/dev. Consumers render [simulator] copy on mock. */
  source: "real" | "mock";
  /** True when a recent checkout failed; cleared on successful re-attempt. */
  lastCheckoutFailed: boolean;
  /** ISO-8601 · when the trial window ends. Populated only when
   *  `state === "trial"`. Consumers render countdown copy from this. */
  trialEndsAt: string | null;
  /** ISO-8601 · when the current paid period ends. Populated when
   *  `state === "cancelled"` (period not elapsed) or `state === "expired"`
   *  (period elapsed). May also carry the renewal timestamp for
   *  `state === "active"` when the backend supplies it. */
  periodEnd: string | null;
}

export interface BillingAdapter {
  /** Whether this adapter is a mock/dev impl. Render `[simulator]` on UIs
   *  driven by a mock adapter. */
  readonly isMock: boolean;
  /** Get the current snapshot (called once per useBillingState mount). */
  getSnapshot(): BillingSnapshot;
  /** Open the checkout flow for a target plan. Real adapter redirects to
   *  Clerk/Stripe; mock adapter just flips state locally. */
  startCheckout(planKey: PlanKey): Promise<CheckoutOutcome>;
  /** Subscribe to snapshot changes. Returns an unsubscribe function. */
  subscribe(listener: (snap: BillingSnapshot) => void): () => void;
}
