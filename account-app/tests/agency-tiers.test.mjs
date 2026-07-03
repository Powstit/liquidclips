import assert from "node:assert/strict";
import test from "node:test";

import {
  isAgencyTier,
  normalizeAccountTier,
} from "../src/lib/agency-tiers.ts";

for (const tier of [
  "agency_solo",
  "agency",
  "agency_whitelabel",
  "autopilot",
]) {
  test(`allows exact agency entitlement: ${tier}`, () => {
    assert.equal(isAgencyTier(tier), true);
  });
}

for (const tier of [
  "free",
  "solo",
  "pro",
  "growth",
  "channel",
  "agency_expired",
  "agency_bogus",
  "agency_trial_revoked",
  "",
  null,
  undefined,
]) {
  test(`rejects non-agency entitlement: ${String(tier)}`, () => {
    assert.equal(isAgencyTier(tier), false);
  });
}

test("normalizes only documented legacy aliases", () => {
  assert.equal(normalizeAccountTier("autopilot"), "agency");
  assert.equal(normalizeAccountTier("channel"), "pro");
  assert.equal(normalizeAccountTier("growth"), "pro");
  assert.equal(normalizeAccountTier("agency_bogus"), "agency_bogus");
});
