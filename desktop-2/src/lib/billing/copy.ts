/**
 * Billing copy · L5 six-state canonical strings.
 *
 * One-file source of truth for the strings the UI renders per
 * BillingState. Consumers import from here so future copy revisions
 * are single-file edits and reviewer-friendly.
 *
 * All copy honours the Agency-only pricing pivot (LOCKED 2026-07-06):
 * one paid plan · Free tier = 10 clips · Agency $99.99/mo.
 * Do not add Founder / Solo / Pro / Enterprise copy until the
 * 100-Agency-user milestone unlocks that ladder.
 */

import type { BillingState } from "./types";

export interface StateCopy {
  /** TopHud identity pill sub-label. */
  pillLabel: string;
  /** Upgrade / reactivate CTA button copy. Empty string = hide CTA. */
  ctaLabel: string;
  /** Optional toast copy fired on CTA click. Empty string = no toast. */
  ctaToast: string;
  /** Money-surface heading copy on WalletDetail / Cancellation surfaces. */
  heading: string;
  /** Money-surface body copy. */
  body: string;
}

const AGENCY_PRICE = "$99.99/mo";

function formatDate(iso: string | null): string {
  if (!iso) return "soon";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "soon";
  return new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * Returns the canonical copy for a billing state.
 *
 * `trialEndsAt` and `periodEnd` are ISO-8601 timestamps from the
 * BillingSnapshot. Copy that needs a date interpolates via `formatDate`.
 */
export function copyForState(
  state: BillingState,
  meta: { trialEndsAt: string | null; periodEnd: string | null },
): StateCopy {
  switch (state) {
    case "free":
      return {
        pillLabel: "Free Clipper",
        ctaLabel: "Upgrade to Agency",
        ctaToast: "",
        heading: "You're on the free tier.",
        body: `10 clips included. Agency unlocks the full workstation at ${AGENCY_PRICE}.`,
      };
    case "trial":
      return {
        pillLabel: `Agency · Trial ends ${formatDate(meta.trialEndsAt)}`,
        ctaLabel: `Continue with Agency · ${AGENCY_PRICE}`,
        ctaToast: "",
        heading: "You're inside the Agency trial.",
        body: `Full workstation until ${formatDate(meta.trialEndsAt)}. Continue to keep everything running.`,
      };
    case "active":
      return {
        pillLabel: "Agency · Active",
        ctaLabel: "",
        ctaToast: "",
        heading: "Agency is live.",
        body: "Full workstation, honest earnings, no surprises.",
      };
    case "past_due":
      return {
        pillLabel: "Agency · Payment failed",
        ctaLabel: "Update payment method",
        ctaToast: "Opening billing…",
        heading: "Your last payment didn't go through.",
        body: "Update your payment method to keep Agency running. Access continues during the grace window.",
      };
    case "cancelled":
      return {
        pillLabel: `Agency · Cancels ${formatDate(meta.periodEnd)}`,
        ctaLabel: "Reactivate Agency",
        ctaToast: "Reactivation saved.",
        heading: "Cancellation scheduled.",
        body: `Agency access continues until ${formatDate(meta.periodEnd)}. Reactivate anytime to keep going without a break.`,
      };
    case "expired":
      return {
        pillLabel: "Agency access ended",
        ctaLabel: "Reactivate Agency",
        ctaToast: "",
        heading: "Your Agency access has ended.",
        body: `Reactivate at ${AGENCY_PRICE} to restore the full workstation.`,
      };
    case "checkout_started":
      return {
        pillLabel: "Agency · Checkout in progress",
        ctaLabel: "",
        ctaToast: "",
        heading: "Finish checkout in the Whop window.",
        body: "We'll pick things up as soon as the payment lands.",
      };
    case "checkout_failed":
      return {
        pillLabel: "Agency · Checkout stopped",
        ctaLabel: "Try Agency again",
        ctaToast: "",
        heading: "Checkout didn't finish.",
        body: `Try again to unlock the full workstation for ${AGENCY_PRICE}.`,
      };
    default: {
      // Exhaustiveness — TypeScript will flag if BillingState grows and
      // this file isn't updated. Runtime fallback treats the unknown
      // state as free-tier honest copy.
      const _exhaustive: never = state;
      void _exhaustive;
      return {
        pillLabel: "Free Clipper",
        ctaLabel: "Upgrade to Agency",
        ctaToast: "",
        heading: "You're on the free tier.",
        body: `10 clips included. Agency unlocks the full workstation at ${AGENCY_PRICE}.`,
      };
    }
  }
}
