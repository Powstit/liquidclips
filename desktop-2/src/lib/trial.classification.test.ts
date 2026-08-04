/**
 * Regression guard · organic "trial" vs real Whop "trialing" pill logic.
 *
 * Prior to this fix, `isTrialing` was true for status "trial" OR
 * "trialing", so an organic (no-card) signup 7+ days old rendered a
 * permanent, false "0 days left · critical" pill in the TopHud — see
 * TrialStatusPill.tsx's urgency calc (days <= 1 → critical) and
 * junior-backend/app/routes/sync.py's matching fix. This pins the
 * classification client-side so it can't silently regress.
 */
import { describe, expect, it } from "vitest";
import { toSnapshot } from "./trial";

describe("trial.toSnapshot · isTrialing classification", () => {
  it("does not treat an organic 'trial' signup as isTrialing, even with a stale 0-days countdown", () => {
    const snap = toSnapshot({
      tier: "free",
      subscription_status: "trial",
      remaining_exports: 100,
      trial_days_remaining: 0, // pre-fix backend value for a 14-day-old organic signup
      trial_convert_pending: false,
    });

    expect(snap.isTrialing).toBe(false);
  });

  it("treats a real Whop 'trialing' status as isTrialing", () => {
    const snap = toSnapshot({
      tier: "free",
      subscription_status: "trialing",
      remaining_exports: 100,
      trial_days_remaining: 4,
      trial_convert_pending: false,
    });

    expect(snap.isTrialing).toBe(true);
    expect(snap.daysRemaining).toBe(4);
  });

  it("hides the pill entirely for a paid active user", () => {
    const snap = toSnapshot({
      tier: "solo",
      subscription_status: "active",
      remaining_exports: null,
      trial_days_remaining: null,
      trial_convert_pending: false,
    });

    expect(snap.isTrialing).toBe(false);
    expect(snap.isPaidActive).toBe(true);
  });
});
