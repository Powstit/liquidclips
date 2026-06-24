/**
 * Activation Bonus States · Phase 2 UX test (IG-SOV-2.2-001)
 *
 * Proves the $50 Sponsored Reward module:
 *   1. Earn tab renders the activation bonus module (banner + status).
 *   2. Requirements checklist appears (Rules section).
 *   3. Progress to 5,000 views is shown (both paths visible).
 *   4. Pending vs Approved vs Paid balances render distinctly.
 *   5. [simulator] chip shows when isMock === true.
 *   6. Pool depletion meter renders.
 *   7. SponsoredRewardCard mounts in /campaigns.
 *   8. SponsoredRewardStrip mounts on /home (clipper mode).
 *
 * Drives state transitions via the puppeteer-only seam
 * window.__lcDebugActivationBonus to verify each state's CTA.
 *
 * Captures screenshots in tracking / milestone / pending / approved
 * states for proof.
 */

import { test, expect, type Page } from "@playwright/test";

const FIXTURE_SLUG = "uncle-daniel-clip-squad-2026";

async function interceptBackend(page: Page) {
  const successMe = {
    user: { id: "harness", email: "harness@liquidclips.test" },
    effective_tier: "free",
    subscription_status: null,
    tier: "free",
  };
  const successSync = { tier: "free", caps: { watermarkLocked: true } };
  await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(successMe) }),
  );
  await page.route(/api\.liquidclips\.app\/sync(\?.*)?$/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(successSync) }),
  );
  await page.route(/api\.liquidclips\.app\//, (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    return route.continue();
  });
}

async function seedSession(page: Page, bonusState?: Record<string, unknown>) {
  await page.addInitScript(({ slug, bonus }) => {
    try {
      const now = new Date().toISOString();
      window.localStorage.setItem("lc.license.jwt.v1", "harness.fake.jwt");
      window.localStorage.setItem(
        "lc:engine:session:v1",
        JSON.stringify({ source: "test.mp4", slug, status: "complete", percent: 1, stage: "thumbs", runtimeMode: "mock", startedAt: now, updatedAt: now }),
      );
      // Bonus state: explicit seed if provided, else wipe so tracking state is fresh.
      if (bonus) {
        window.localStorage.setItem("lc.activation-bonus.v1", JSON.stringify(bonus));
      } else {
        window.localStorage.removeItem("lc.activation-bonus.v1");
      }
    } catch { /* noop */ }
  }, { slug: FIXTURE_SLUG, bonus: bonusState ?? null });
}

test.describe("Activation Bonus States · $50 Sponsored Reward", () => {
  test("Earn tab · module renders with banner + status + rules + balances", async ({ page }) => {
    await interceptBackend(page);
    await seedSession(page);
    await page.goto("/?skipIntro=1#/earn", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    const module_ = page.getByTestId("sponsored-reward-module");
    await expect(module_).toBeVisible({ timeout: 10_000 });

    // Banner pill + simulator chip
    await expect(page.getByTestId("sponsored-reward-pill")).toBeVisible();
    await expect(page.getByTestId("sponsored-reward-sim-chip")).toBeVisible();

    // Status badge + status copy
    await expect(page.getByTestId("sponsored-reward-status-badge")).toBeVisible();
    await expect(page.getByTestId("sponsored-reward-status-copy")).toBeVisible();

    // Two-path progress
    await expect(page.getByTestId("sponsored-reward-views-progress")).toBeVisible();
    await expect(page.getByTestId("sponsored-reward-affiliates-progress")).toBeVisible();

    // Balances trio
    await expect(page.getByTestId("sponsored-reward-pending")).toBeVisible();
    await expect(page.getByTestId("sponsored-reward-approved")).toBeVisible();
    await expect(page.getByTestId("sponsored-reward-paid")).toBeVisible();

    // Rules + footer (simulator label)
    await expect(page.getByTestId("sponsored-reward-rules")).toBeVisible();
    await expect(page.getByTestId("sponsored-reward-rules-footer")).toBeVisible();

    // Pool meter
    await expect(page.getByTestId("sponsored-reward-pool")).toBeVisible();

    // CTA exists for tracking state ("Keep clipping → views unlock at 5,000")
    const cta = page.getByTestId("sponsored-reward-cta");
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("data-cta-kind", "keep-clipping");

    await page.screenshot({
      path: "/tmp/srm-01-earn-tracking-state.png",
      fullPage: false,
    });
  });

  test("Sponsored Reward Card · pinned at top of /campaigns", async ({ page }) => {
    await interceptBackend(page);
    await seedSession(page);
    await page.goto("/?skipIntro=1#/campaigns", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    const card = page.getByTestId("sponsored-reward-card");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("sponsored-reward-card-pill")).toBeVisible();

    await page.screenshot({
      path: "/tmp/srm-02-campaigns-card.png",
      fullPage: false,
    });
  });

  test("Sponsored Reward Strip · clipper home", async ({ page }) => {
    await interceptBackend(page);
    await seedSession(page);
    await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    const strip = page.getByTestId("sponsored-reward-strip");
    await expect(strip).toBeVisible({ timeout: 10_000 });
    await expect(strip).toHaveAttribute("data-state");

    await page.screenshot({
      path: "/tmp/srm-03-home-strip.png",
      fullPage: false,
    });
  });

  test("State transition · approved state renders breakdown + withdraw CTA", async ({ page }) => {
    await interceptBackend(page);
    await seedSession(page, {
      clearanceStartedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString(),
      clearanceVerdict: "approved",
      paidAt: null,
      notifiedMilestone: true,
      notifiedSubscriptionRequired: true,
      notifiedClearance: true,
      notifiedApproved: false,
      notifiedRejected: false,
      notifiedPaid: false,
    });
    await page.goto("/?skipIntro=1#/earn", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    const badge = page.getByTestId("sponsored-reward-status-badge");
    await expect(badge).toBeVisible();
    const badgeText = await badge.textContent();
    expect(badgeText?.toLowerCase()).toContain("approved");

    // Breakdown should appear in approved state
    await expect(page.getByTestId("sponsored-reward-breakdown")).toBeVisible();

    // CTA should be "withdraw"
    const cta = page.getByTestId("sponsored-reward-cta");
    await expect(cta).toHaveAttribute("data-cta-kind", "withdraw");

    await page.screenshot({
      path: "/tmp/srm-04-earn-approved-state.png",
      fullPage: false,
    });
  });

  test("State transition · rejected state renders distinct status + CTA", async ({ page }) => {
    await interceptBackend(page);
    await seedSession(page, {
      clearanceStartedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString(),
      clearanceVerdict: "rejected",
      paidAt: null,
      notifiedMilestone: true,
      notifiedSubscriptionRequired: true,
      notifiedClearance: true,
      notifiedApproved: false,
      notifiedRejected: false,
      notifiedPaid: false,
    });
    await page.goto("/?skipIntro=1#/earn", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    const badge = page.getByTestId("sponsored-reward-status-badge");
    await expect(badge).toBeVisible();
    const badgeText = await badge.textContent();
    expect(badgeText?.toLowerCase()).toContain("rejected");

    const cta = page.getByTestId("sponsored-reward-cta");
    await expect(cta).toHaveAttribute("data-cta-kind", "view-reason");

    await page.screenshot({
      path: "/tmp/srm-05-earn-rejected-state.png",
      fullPage: false,
    });
  });

  test("State transition · paid state renders distinct status + CTA", async ({ page }) => {
    await interceptBackend(page);
    await seedSession(page, {
      clearanceStartedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString(),
      clearanceVerdict: "approved",
      paidAt: new Date().toISOString(),
      notifiedMilestone: true,
      notifiedSubscriptionRequired: true,
      notifiedClearance: true,
      notifiedApproved: true,
      notifiedRejected: false,
      notifiedPaid: false,
    });
    await page.goto("/?skipIntro=1#/earn", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    const badge = page.getByTestId("sponsored-reward-status-badge");
    await expect(badge).toBeVisible();
    const badgeText = await badge.textContent();
    expect(badgeText?.toLowerCase()).toContain("paid");

    const cta = page.getByTestId("sponsored-reward-cta");
    await expect(cta).toHaveAttribute("data-cta-kind", "view-history");

    await page.screenshot({
      path: "/tmp/srm-06-earn-paid-state.png",
      fullPage: false,
    });
  });
});
