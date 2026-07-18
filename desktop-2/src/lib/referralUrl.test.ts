/**
 * IG-COMPOSER-R regression guard · Referral URL contract.
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class C row C3.
 *
 * Enforces:
 *   1. The IG-COMPOSER-R sentinel stays in place.
 *   2. REFERRAL_URL_PREFIX is locked at https://liquidclips.app/r/.
 *   3. getReferralUrl returns null for empty / null / whitespace handles.
 *   4. getReferralUrl strips a leading '@' before building the URL.
 *   5. getReferralUrl percent-encodes handles that need it.
 *   6. parseReferralUrl round-trips getReferralUrl output.
 *   7. parseReferralUrl returns null for non-referral URLs.
 *   8. The module NEVER fetches the URL from a backend endpoint.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { REFERRAL_URL_PREFIX, getReferralUrl, parseReferralUrl } from "./referralUrl";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = readFileSync(resolve(__dirname, "referralUrl.ts"), "utf-8");

describe("IG-COMPOSER-R · Referral URL contract", () => {
  it("referralUrl.ts contains the IG-COMPOSER-R sentinel", () => {
    expect(SRC).toMatch(/IRON GATE IG-COMPOSER-R/);
  });

  it("REFERRAL_URL_PREFIX is locked at https://liquidclips.app/r/", () => {
    expect(REFERRAL_URL_PREFIX).toBe("https://liquidclips.app/r/");
  });

  it("returns null when the handle is null, undefined, empty, or whitespace", () => {
    expect(getReferralUrl(null)).toBeNull();
    expect(getReferralUrl(undefined)).toBeNull();
    expect(getReferralUrl("")).toBeNull();
    expect(getReferralUrl("   ")).toBeNull();
    expect(getReferralUrl("@")).toBeNull();
    expect(getReferralUrl("@@@")).toBeNull();
  });

  it("strips a leading '@' before building the URL", () => {
    expect(getReferralUrl("@danielx")).toBe("https://liquidclips.app/r/danielx");
    expect(getReferralUrl("danielx")).toBe("https://liquidclips.app/r/danielx");
    expect(getReferralUrl("@@danielx")).toBe("https://liquidclips.app/r/danielx");
  });

  it("percent-encodes handles that contain URL-hostile characters", () => {
    // A real handle would never look like this, but the API surface
    // must stay safe against garbage in.
    expect(getReferralUrl("clip & post")).toContain("clip%20%26%20post");
  });

  it("parseReferralUrl round-trips getReferralUrl", () => {
    const url = getReferralUrl("danielx");
    expect(url).not.toBeNull();
    expect(parseReferralUrl(url)).toBe("danielx");
  });

  it("parseReferralUrl returns null for non-liquidclips.app URLs", () => {
    expect(parseReferralUrl(null)).toBeNull();
    expect(parseReferralUrl("")).toBeNull();
    expect(parseReferralUrl("https://example.com/r/danielx")).toBeNull();
    expect(parseReferralUrl(REFERRAL_URL_PREFIX)).toBeNull(); // prefix alone, no handle
  });

  it("the module NEVER fetches from a backend endpoint (no fetch / axios / authedFetch)", () => {
    // C3 is deterministic. Any network call inside referralUrl.ts is a
    // regression back to the abandoned /me/referral-url endpoint plan.
    expect(SRC).not.toMatch(/\bfetch\s*\(/);
    expect(SRC).not.toMatch(/authedFetch/);
    expect(SRC).not.toMatch(/axios/);
  });
});
