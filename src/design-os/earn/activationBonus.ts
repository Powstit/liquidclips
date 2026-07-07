/**
 * Activation bonus · 2026-06-23 monetisation pass.
 *
 * The $50 "first 5,000 views" carrot. State-only foundation — UI lives
 * in src/design-os/earn/, real Ayrshare/Stripe payouts wire in a later
 * pass. Daniel's directive:
 *   - Pending bonus is NOT withdrawable.
 *   - Approved balance IS withdrawable.
 *   - Don't say the subscription is paid from the pending reward.
 *   - User pays through Clerk/Whop/Stripe checkout FIRST.
 *   - After subscription, bonus enters 7-day clearance.
 *   - Clearance checks decide approved / rejected.
 *
 * State source-of-truth (mock for now):
 *   - viewCount: aggregated tracking-link clicks from useRewardClips
 *     (real-ish · backend /me/reward-clips returns them today).
 *   - subscriptionActive: from useBillingState · derived from real JWT
 *     + tier.
 *   - clearance timer + state transitions: LOCAL ONLY · labelled
 *     [simulator] in UI. Will move to backend ledger in a future pass.
 */

export const ACTIVATION_BONUS_AMOUNT_USD = 50;
export const ACTIVATION_BONUS_VIEW_THRESHOLD = 5_000;
export const ACTIVATION_BONUS_CLEARANCE_DAYS = 7;

/** Lifecycle states · matches Daniel's spec verbatim. */
export type ActivationBonusState =
  | "not_started"            // anon, or 0 tracked views
  | "tracking"               // <5,000 cumulative views
  | "milestone_reached"      // ≥5,000 views · no subscription yet
  | "subscription_required"  // user clicked "claim" without paid plan
  | "pending_clearance"      // subscription active · in 7-day hold
  | "approved"               // hold cleared · withdrawable
  | "rejected"               // anti-fraud failed
  | "paid";                  // payout sent

export interface ActivationBonusInputs {
  /** Cumulative authenticated tracked views (real, from /me/reward-clips). */
  viewCount: number;
  /** Whether the user has a paid plan active (real, from useBillingState). */
  subscriptionActive: boolean;
  /** When the user first reached `subscription_active` AFTER hitting the
   *  milestone. Drives the 7-day clearance window. Null until they hit
   *  pending_clearance. */
  clearanceStartedAt: string | null;
  /** When the clearance check finished and the verdict landed.
   *  Null while pending or before clearance started. */
  clearanceVerdict: "approved" | "rejected" | null;
  /** When the bonus was paid out. Null until paid. */
  paidAt: string | null;
}

export interface ActivationBonusSnapshot {
  state: ActivationBonusState;
  /** Pending bonus amount in USD · NOT withdrawable. Show in UI for clarity. */
  pendingUsd: number;
  /** Approved + withdrawable amount in USD. */
  approvedUsd: number;
  /** Paid-out amount in USD (historical). */
  paidUsd: number;
  /** Number of days remaining in the 7-day clearance window. 0 once cleared. */
  clearanceDaysRemaining: number;
  /** Human-readable status for the UI. */
  statusCopy: string;
  /** True when this snapshot was derived from local-only / mock data. */
  isMock: boolean;
}

/** Pure state-machine reducer · derive snapshot from inputs.
 *  No side-effects · safe to call from a useMemo. */
export function deriveActivationBonusSnapshot(
  inputs: ActivationBonusInputs,
  now: Date = new Date(),
): ActivationBonusSnapshot {
  const { viewCount, subscriptionActive, clearanceStartedAt, clearanceVerdict, paidAt } = inputs;

  // Paid · terminal state.
  if (paidAt) {
    return {
      state: "paid",
      pendingUsd: 0,
      approvedUsd: 0,
      paidUsd: ACTIVATION_BONUS_AMOUNT_USD,
      clearanceDaysRemaining: 0,
      statusCopy: "Paid out",
      isMock: true,
    };
  }

  // Rejected · terminal until manual override.
  if (clearanceVerdict === "rejected") {
    return {
      state: "rejected",
      pendingUsd: 0,
      approvedUsd: 0,
      paidUsd: 0,
      clearanceDaysRemaining: 0,
      statusCopy: "Bonus rejected · contact support",
      isMock: true,
    };
  }

  // Approved · clearance done, awaiting withdraw.
  if (clearanceVerdict === "approved") {
    return {
      state: "approved",
      pendingUsd: 0,
      approvedUsd: ACTIVATION_BONUS_AMOUNT_USD,
      paidUsd: 0,
      clearanceDaysRemaining: 0,
      statusCopy: "Approved · withdrawable from Earn",
      isMock: true,
    };
  }

  // Pending clearance · subscription is active, in the 7-day window.
  if (clearanceStartedAt) {
    const startedMs = new Date(clearanceStartedAt).getTime();
    const elapsedDays = (now.getTime() - startedMs) / (1000 * 60 * 60 * 24);
    const daysRemaining = Math.max(0, Math.ceil(ACTIVATION_BONUS_CLEARANCE_DAYS - elapsedDays));
    return {
      state: "pending_clearance",
      pendingUsd: ACTIVATION_BONUS_AMOUNT_USD,
      approvedUsd: 0,
      paidUsd: 0,
      clearanceDaysRemaining: daysRemaining,
      statusCopy: daysRemaining > 0
        ? `Pending · ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining (anti-fraud hold)`
        : "Pending · clearance check imminent",
      isMock: true,
    };
  }

  // Milestone reached but no subscription yet.
  if (viewCount >= ACTIVATION_BONUS_VIEW_THRESHOLD && !subscriptionActive) {
    return {
      state: "subscription_required",
      pendingUsd: ACTIVATION_BONUS_AMOUNT_USD,
      approvedUsd: 0,
      paidUsd: 0,
      clearanceDaysRemaining: 0,
      statusCopy: "Subscribe to claim your $50 bonus",
      isMock: true,
    };
  }

  if (viewCount >= ACTIVATION_BONUS_VIEW_THRESHOLD && subscriptionActive) {
    // Milestone reached + sub active but clearance hasn't started yet ·
    // useActivationBonus hook will record clearanceStartedAt on the next
    // tick. We classify as milestone_reached so the UI can prompt.
    return {
      state: "milestone_reached",
      pendingUsd: ACTIVATION_BONUS_AMOUNT_USD,
      approvedUsd: 0,
      paidUsd: 0,
      clearanceDaysRemaining: ACTIVATION_BONUS_CLEARANCE_DAYS,
      statusCopy: "Milestone reached · clearance starting",
      isMock: true,
    };
  }

  // Tracking · accumulating views.
  if (viewCount > 0) {
    return {
      state: "tracking",
      pendingUsd: 0,
      approvedUsd: 0,
      paidUsd: 0,
      clearanceDaysRemaining: 0,
      statusCopy: `${viewCount.toLocaleString()} / ${ACTIVATION_BONUS_VIEW_THRESHOLD.toLocaleString()} views toward $${ACTIVATION_BONUS_AMOUNT_USD} bonus`,
      isMock: true,
    };
  }

  return {
    state: "not_started",
    pendingUsd: 0,
    approvedUsd: 0,
    paidUsd: 0,
    clearanceDaysRemaining: 0,
    statusCopy: `Publish clips to start tracking toward your $${ACTIVATION_BONUS_AMOUNT_USD} bonus`,
    isMock: true,
  };
}
