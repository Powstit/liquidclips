/**
 * billingRefusalRouter regression guard · 2026-07-19
 *
 * Locks two invariants:
 *
 *   1. kadeIntentClient translates a 402 (quota exhausted) into a
 *      `billing:reserve-refused` bus event with `code: "allowance_exceeded"`
 *      so `useBillingRefusalRouter` can route it, not a raw
 *      `kade_intent.status_402` error string in Kade's dialogue stream.
 *      Same rule for 403 → `code: "free_bundle_used"`.
 *
 *   2. `useBillingRefusalRouter` handles the Agency-tier `allowance_exceeded`
 *      case with a manual-outreach message + `agency_quota_maxed` telemetry
 *      diag, NOT a `trial:upgrade-request` to the same $99.99 checkout
 *      the user already paid for.
 *
 * Runs under vitest with the default node environment. The tests are
 * source-invariant style (grep the built code) so they survive React /
 * hook internals evolving.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const KADE_INTENT_SRC = readFileSync(
  resolve(__dirname, "kadeIntentClient.ts"),
  "utf-8",
);
const ROUTER_SRC = readFileSync(
  resolve(__dirname, "billingRefusalRouter.tsx"),
  "utf-8",
);

describe("kadeIntentClient · billing wire (2026-07-19)", () => {
  it("emits billing:reserve-refused with allowance_exceeded on 402", () => {
    expect(KADE_INTENT_SRC).toMatch(/resp\.status === 402/);
    expect(KADE_INTENT_SRC).toMatch(/allowance_exceeded/);
    expect(KADE_INTENT_SRC).toMatch(/http_status:\s*402/);
    expect(KADE_INTENT_SRC).toMatch(/source:\s*"kade_intent"/);
  });

  it("emits billing:reserve-refused with free_bundle_used on 403", () => {
    expect(KADE_INTENT_SRC).toMatch(/resp\.status === 403/);
    expect(KADE_INTENT_SRC).toMatch(/free_bundle_used/);
    expect(KADE_INTENT_SRC).toMatch(/http_status:\s*403/);
  });

  it("still throws so callers can fall back to local routeIntent", () => {
    // The upstream contract per file docstring: caller falls back on
    // network / auth / quota failure. Bus emit must NOT swallow the
    // throw.
    expect(KADE_INTENT_SRC).toMatch(/throw new Error\(`kade_intent\.status_/);
  });
});

describe("useBillingRefusalRouter · Agency dead-end fix (2026-07-19)", () => {
  it("reads the caller's tier via useTierCaps", () => {
    expect(ROUTER_SRC).toMatch(/useTierCaps\(\)/);
    expect(ROUTER_SRC).toMatch(/tierCaps\.tier/);
  });

  it("Agency + allowance_exceeded emits agency_quota_maxed telemetry", () => {
    expect(ROUTER_SRC).toMatch(/currentTier === "agency"/);
    expect(ROUTER_SRC).toMatch(/lcDiag\("agency_quota_maxed"/);
  });

  it("Agency + allowance_exceeded routes to engine:error, NOT trial:upgrade-request", () => {
    // The Agency branch must not send the user back to their own
    // checkout. Find the "agency" comparison, take the block that
    // follows, and confirm it does not emit trial:upgrade-request
    // before `break;`.
    const agencyIdx = ROUTER_SRC.indexOf('currentTier === "agency"');
    expect(agencyIdx).toBeGreaterThan(-1);
    const nextBreak = ROUTER_SRC.indexOf("break;", agencyIdx);
    const agencyBlock = ROUTER_SRC.slice(agencyIdx, nextBreak);
    // engine:error emission required in the block.
    expect(agencyBlock).toMatch(/bus\.emit\("engine:error"/);
    // trial:upgrade-request must NOT appear in the Agency block.
    expect(agencyBlock).not.toMatch(/bus\.emit\("trial:upgrade-request"/);
  });

  it("Free / other tiers still route to trial:upgrade-request on allowance_exceeded", () => {
    // The `allowance_exceeded` case's fallback (outside the Agency
    // branch) must preserve the existing paywall wire.
    const allowanceIdx = ROUTER_SRC.indexOf('case "allowance_exceeded"');
    expect(allowanceIdx).toBeGreaterThan(-1);
    // The block should contain a `trial:upgrade-request` emit after
    // the Agency branch's break.
    const allowanceBlock = ROUTER_SRC.slice(
      allowanceIdx,
      allowanceIdx + 2000,
    );
    expect(allowanceBlock).toMatch(/bus\.emit\("trial:upgrade-request"/);
  });

  it("useEffect deps include currentTier for hot-swap on tier change", () => {
    // A mid-session tier flip (upgrade / renewal) must re-subscribe
    // with the new tier so the Agency branch fires against the new
    // state, not a stale closure.
    expect(ROUTER_SRC).toMatch(/\},\s*\[currentTier\]\)/);
  });
});
