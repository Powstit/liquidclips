/**
 * AffiliateWidget · earnings preview · regression · 2026-07-22.
 *
 * Daniel's "K-factor" growth ask: show existing users what inviting a
 * friend is worth. Deliberately uses the ONE guaranteed number (the flat
 * 50% commission rate on the current live Agency price) instead of a
 * fabricated conversion-rate projection — the platform doesn't yet track
 * enough click→signup→paid volume to trust a "typical conversion rate"
 * estimate, and an invented one risks the exact overpromising trap that
 * erodes trust once real numbers come in lower than hoped.
 *
 * Source-contract test (mirrors Settings.youtubeCookies.test.ts's
 * approach) rather than a full mount: AffiliateWidget pulls in
 * clipboard/canvas/QR-rasterisation browser APIs unrelated to this specific
 * addition, so asserting the math + copy directly in the source is a more
 * reliable regression guard than mocking all of that just to read two
 * numbers off the rendered DOM.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = readFileSync(resolve(__dirname, "AffiliateWidget.tsx"), "utf-8");

describe("AffiliateWidget · earnings preview", () => {
  it("derives the per-referral amount from the live Agency price and the flat commission rate, not a hardcoded dollar figure", () => {
    expect(SRC).toMatch(/AGENCY_MONTHLY_PRICE_CENTS\s*=\s*9999/);
    expect(SRC).toMatch(/AFFILIATE_COMMISSION_PERCENT\s*=\s*50/);
    expect(SRC).toMatch(
      /PER_REFERRAL_MONTHLY_EARNINGS_USD\s*=\s*\n?\s*Math\.round\(AGENCY_MONTHLY_PRICE_CENTS \* \(AFFILIATE_COMMISSION_PERCENT \/ 100\)\) \/ 100/,
    );
  });

  it("computes to exactly $50.00 using integer-cents math (avoids the 49.995 float-rounding trap)", () => {
    const AGENCY_MONTHLY_PRICE_CENTS = 9999;
    const AFFILIATE_COMMISSION_PERCENT = 50;
    const perReferral =
      Math.round(AGENCY_MONTHLY_PRICE_CENTS * (AFFILIATE_COMMISSION_PERCENT / 100)) / 100;
    expect(perReferral).toBe(50);
    expect(perReferral.toFixed(2)).toBe("50.00");
  });

  it("renders the guaranteed-earnings copy, not a speculative 'you could make' projection", () => {
    expect(SRC).toMatch(/Every friend who joins Agency pays you/);
    expect(SRC).toMatch(/PER_REFERRAL_MONTHLY_EARNINGS_USD\.toFixed\(2\)/);
    expect(SRC).toMatch(/forever, for as long as they stay subscribed/);
    // Must not promise a total based on invite count — no data backs that yet.
    expect(SRC).not.toMatch(/you could (make|earn) \$/i);
  });

  it("is mounted between the share/QR section and the historical stats block", () => {
    const earnPreviewIdx = SRC.indexOf("lc-affiliate-widget-earn-preview");
    const statsIdx = SRC.indexOf("lc-affiliate-widget-stats");
    expect(earnPreviewIdx).toBeGreaterThan(-1);
    expect(statsIdx).toBeGreaterThan(earnPreviewIdx);
  });
});
