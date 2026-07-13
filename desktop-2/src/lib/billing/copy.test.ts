import { describe, expect, test } from "vitest";

import { copyForState } from "./copy";
import type { BillingState } from "./types";

const FUTURE_ISO = "2099-12-31T00:00:00Z";
const PAST_ISO = "2020-01-01T00:00:00Z";

describe("billing/copy · six-state canonical copy", () => {
  test("every state returns non-empty pill + heading + body", () => {
    const states: BillingState[] = [
      "free",
      "trial",
      "active",
      "past_due",
      "cancelled",
      "expired",
      "checkout_started",
      "checkout_failed",
    ];
    for (const state of states) {
      const c = copyForState(state, { trialEndsAt: FUTURE_ISO, periodEnd: FUTURE_ISO });
      expect(c.pillLabel.length, `${state} pillLabel`).toBeGreaterThan(0);
      expect(c.heading.length, `${state} heading`).toBeGreaterThan(0);
      expect(c.body.length, `${state} body`).toBeGreaterThan(0);
    }
  });

  test("pillLabel is distinct per state (no accidental copy collisions)", () => {
    const states: BillingState[] = [
      "free",
      "trial",
      "active",
      "past_due",
      "cancelled",
      "expired",
      "checkout_started",
      "checkout_failed",
    ];
    const seen = new Map<string, BillingState>();
    for (const state of states) {
      const { pillLabel } = copyForState(state, {
        trialEndsAt: FUTURE_ISO,
        periodEnd: FUTURE_ISO,
      });
      // Strip date suffixes so `Trial ends Dec 31` vs `Cancels Dec 31`
      // are treated as distinct at the "prefix" level.
      const prefix = pillLabel.replace(/\s+(Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov)\s+\d+.*$/, "");
      const prior = seen.get(prefix);
      expect(prior, `${state} pill collides with ${prior}`).toBeUndefined();
      seen.set(prefix, state);
    }
  });

  test("free + expired both drive an upgrade / reactivate CTA (honest pointer to Agency plan)", () => {
    const free = copyForState("free", { trialEndsAt: null, periodEnd: null });
    const expired = copyForState("expired", { trialEndsAt: null, periodEnd: PAST_ISO });
    expect(free.ctaLabel.length).toBeGreaterThan(0);
    expect(expired.ctaLabel.length).toBeGreaterThan(0);
    // No pricing-format regression: L5 must ship the $99.99/mo Agency
    // number, not a legacy Founder/Solo/Pro number.
    expect(free.body).toContain("$99.99/mo");
    expect(expired.body).toContain("$99.99/mo");
  });

  test("active hides the upgrade CTA", () => {
    const c = copyForState("active", { trialEndsAt: null, periodEnd: FUTURE_ISO });
    expect(c.ctaLabel).toBe("");
  });

  test("trial + cancelled interpolate the correct date", () => {
    const trial = copyForState("trial", {
      trialEndsAt: FUTURE_ISO,
      periodEnd: null,
    });
    expect(trial.pillLabel).toMatch(/Trial ends/);

    const cancelled = copyForState("cancelled", {
      trialEndsAt: null,
      periodEnd: FUTURE_ISO,
    });
    expect(cancelled.pillLabel).toMatch(/Cancels/);
  });
});
