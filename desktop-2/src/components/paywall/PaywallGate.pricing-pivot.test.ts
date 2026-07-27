/**
 * PaywallGate.pricing-pivot · IG-PAYWALL-AGENCY-ONLY · BUG-004
 *
 * Tracker BUG-004 (P1 · devteam/09_CURRENT_BUGS_AND_INSTABILITY.md):
 *   > Solo/Pro/Growth legacy tiers still visible in code/UI copy after
 *   > the 2026-07-06 pricing pivot to Agency-only.
 *
 * Fix scope (per tracker):
 *   > Backend: keep tier definitions in place BUT the paywall / checkout
 *   > / display should only offer Agency ($99.99). Legacy tiers remain
 *   > resolvable to preserve any existing users' entitlements, but new
 *   > signups only see Agency.
 *   > Frontend: audit PaywallGate.tsx, Settings.tsx, AgencyPreviewBanner.tsx
 *   > for Solo/Pro copy and replace with "Upgrade to Agency".
 *
 * This test locks the contract at the source level:
 *
 *   1. PaywallGate.tsx pins `requiredPlan = PLAN_CATALOG.agency`
 *      and `checkoutPlan: PlanKey = "agency"`.
 *   2. AgencyPreviewBanner.tsx routes checkout through `startCheckout("agency")`.
 *   3. Settings.tsx upgrade CTA copy always ends in "Agency on Whop · $99.99/mo"
 *      for both first-time and pre-pivot legacy users.
 *
 * If a future refactor reintroduces a Solo/Pro/Growth CTA path, one of
 * these assertions fails and the commit is blocked.
 *
 * 2026-07-24
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const READ = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf-8");

describe("IG-PAYWALL-AGENCY-ONLY · BUG-004 pricing pivot", () => {
  it("PaywallGate pins requiredPlan and checkoutPlan to Agency", () => {
    const src = READ("src/components/paywall/PaywallGate.tsx");
    // requiredPlan is the display plan the paywall card renders.
    expect(
      /const\s+requiredPlan\s*=\s*PLAN_CATALOG\.agency\b/.test(src),
      "PaywallGate must pin requiredPlan to PLAN_CATALOG.agency (Agency-only pricing pivot).",
    ).toBe(true);
    // checkoutPlan is the plan passed to billing.adapter.startCheckout.
    expect(
      /const\s+checkoutPlan\s*:\s*PlanKey\s*=\s*["']agency["']/.test(src),
      "PaywallGate must pin checkoutPlan to \"agency\" (only paid plan today).",
    ).toBe(true);
  });

  it("PaywallGate does NOT surface a Pro/Growth/Solo/Autopilot checkout CTA", () => {
    const src = READ("src/components/paywall/PaywallGate.tsx");
    // startCheckout must never be called with a legacy tier from this file.
    for (const legacy of ["pro", "growth", "solo", "autopilot"]) {
      const bad = new RegExp(`startCheckout\\s*\\(\\s*["']${legacy}["']`);
      expect(
        bad.test(src),
        `PaywallGate must not call startCheckout("${legacy}") — legacy tier CTAs were retired by pricing pivot LOCKED 2026-07-06.`,
      ).toBe(false);
    }
  });

  it("AgencyPreviewBanner routes checkout through startCheckout(\"agency\")", () => {
    const src = READ("src/components/paywall/AgencyPreviewBanner.tsx");
    expect(
      /startCheckout\s*\(\s*["']agency["']/.test(src),
      "AgencyPreviewBanner must call startCheckout(\"agency\") — the only paid plan surfaced today.",
    ).toBe(true);
    // Symmetric negative check.
    for (const legacy of ["pro", "growth", "solo", "autopilot"]) {
      const bad = new RegExp(`startCheckout\\s*\\(\\s*["']${legacy}["']`);
      expect(bad.test(src), `AgencyPreviewBanner must not call startCheckout("${legacy}").`).toBe(false);
    }
  });

  it("Settings upgrade CTA always ends in \"Agency on Whop · $99.99/mo\" for non-agency tiers", () => {
    const src = READ("src/design-os/routes/Settings.tsx");
    // The Free / clipper path AND the legacy-tier fallback path both must
    // route to the Agency upsell string. Search for the two occurrences.
    const agencyUpsell = /Upgrade to Agency on Whop\s*·\s*\$99\.99\/mo/g;
    const hits = src.match(agencyUpsell);
    expect(
      (hits?.length ?? 0) >= 2,
      "Settings must render \"Upgrade to Agency on Whop · $99.99/mo\" at least twice — once for the " +
        "clipper (Free) tier CTA and once for the legacy Pro/Growth fallback per BUG-004 fix scope.",
    ).toBe(true);
  });

  it("Settings does not present a Pro or Growth upgrade CTA to users", () => {
    const src = READ("src/design-os/routes/Settings.tsx");
    // JSX text nodes referencing "Upgrade to Pro" or "Upgrade to Growth" would
    // resurface the deferred ladder to users. Comments are excluded — this test
    // scans lines that don't start with * or //.
    const offending = src
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("*") || trimmed.startsWith("//")) return false;
        return /Upgrade to (Pro|Growth|Solo|Autopilot)\b/.test(line);
      });
    expect(
      offending.length,
      `Settings must not render "Upgrade to Pro/Growth/Solo/Autopilot" in JSX. Offending lines: ${JSON.stringify(offending)}`,
    ).toBe(0);
  });
});
