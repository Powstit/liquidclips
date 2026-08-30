/**
 * rewardCopy · one source of truth for what the sponsored-reward
 * surfaces (card, module, strip) render.
 *
 * Model (per Daniel 2026-08-30 clarification):
 *   The $50 IS a carrot — same shape as Google/Crew referral carrots.
 *   Each of the two unlock paths represents real economic value to
 *   Liquid Clips:
 *
 *     Path A · Views:     5,000 authenticated tracked views · proof
 *                         of clip-earning activity worth ad-attributed
 *                         revenue to LC.
 *     Path B · Referrals: 5 paying subscribers × $99.99 Agency plan =
 *                         $499.95/mo recurring — user unlocks $50
 *                         (net of 5% protocol fee = $47.50) from that
 *                         real inflow.
 *
 *   So we frame the $50 as a PENDING BALANCE the user is working
 *   toward, not as a "coming soon" mystery amount. The state machine
 *   (useActivationBonus) already tracks progress across both paths;
 *   backend rails already exist (User.carrot_total_paid_usd_cents,
 *   whop_payments.transfer, 7-day clearance, email confirmation) —
 *   payouts fire when thresholds hit, not when a flag flips.
 *
 * Launch-mode flag (`VITE_LAUNCH_COMING_SOON=1`) still coerces
 * clipper-facing CAMPAIGNS to `status: "coming_soon"` (see
 * useCampaigns.ts) — that half stays valid because no live sponsored
 * campaigns are running during the beta. The reward carrot IS live
 * · its threshold-driven state machine works · this file no longer
 * gates on the launch flag.
 */

import {
  SPONSORED_REWARD_AMOUNT_USD,
  SPONSORED_REWARD_VIEW_THRESHOLD,
  SPONSORED_REWARD_AFFILIATE_THRESHOLD,
} from "./sponsoredReward";

/** Public price of the Agency plan (per whopCheckout.ts:49 + main.tsx
 *  pricing snapshot). Used in the pending-balance copy so the user
 *  understands each paid referral represents $99.99/mo recurring —
 *  that's the LTV Liquid Clips pays the $50 carrot out of. */
const AGENCY_PLAN_PRICE_USD = 99.99;

export interface SponsoredRewardCopy {
  /** Big card headline · always pending-balance framing. */
  title: string;
  /** Amount overlay on the banner (e.g. "$50"). */
  amountLabel: string;
  /** Amount sub-line (e.g. "pending balance"). */
  amountSub: string;
  /** Card sub-copy paragraph · references the two unlock paths + the
   *  $99.99 math so the pending amount is honestly explained. */
  sub: string;
  /** CTA arrow copy inside the card. */
  cta: string;
  /** Home-strip short label. */
  stripAmount: string;
}

export function getSponsoredRewardCopy(): SponsoredRewardCopy {
  const amount = `$${SPONSORED_REWARD_AMOUNT_USD}`;
  const views = SPONSORED_REWARD_VIEW_THRESHOLD.toLocaleString();
  const refs = SPONSORED_REWARD_AFFILIATE_THRESHOLD;
  const agencyPrice = AGENCY_PLAN_PRICE_USD.toFixed(2);

  return {
    title: `${amount} pending balance`,
    amountLabel: amount,
    amountSub: "pending",
    // Two unlock paths + why the number is honest. The `$99.99` math
    // surfaces the LTV Liquid Clips pays the carrot from — same shape
    // as Google's k-factor / Crew referral carrots.
    sub: `Unlock at ${views} authenticated views OR ${refs} paid Agency referrals. Each referral = $${agencyPrice}/mo recurring · your slice = ${amount} net of 5% protocol fee.`,
    cta: "Track progress →",
    stripAmount: `${amount} pending`,
  };
}
