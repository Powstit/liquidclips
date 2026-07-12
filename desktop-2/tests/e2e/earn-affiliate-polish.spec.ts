import { expect, test, type Page, type Route } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

import { seedAuthenticatedShell } from "./_auth-harness";

interface AffiliateHarness {
  handle: string;
  referralUrl: string;
}

const wallet = {
  pipeline: {
    in_review_usd_cents: 3500,
    approved_usd_cents: 7500,
    paid_usd_cents: 24800,
    rejected_usd_cents: 0,
    total_pipeline_usd_cents: 35800,
  },
  stats: {
    lifetime_views: 4000,
    total_submissions: 2,
    approval_rate_pct: 100,
    affiliate_revenue_usd_cents: 24800,
  },
  campaigns: [{
    slug: "campaign-live",
    title: "Launch reaction clips",
    brand: "Liquid Clips",
    banner_url: null,
    views: 4000,
    submissions: 2,
    approved: 2,
    earned_usd_cents: 1200,
    status: "active",
  }],
  recent_activity: [{
    at: "2026-07-02T09:00:00Z",
    kind: "paid",
    label: "Affiliate payout cleared",
    campaign_slug: null,
    amount_usd_cents: 24800,
  }],
  withdraw: {
    is_live: true,
    min_withdrawal_usd: 10,
    lc_fee_pct: 5,
    currency: "USDC",
    setup_available: true,
    payout_ready: true,
    payout_status: "ready",
    available_usd_cents: 24800,
    pending_usd_cents: 7500,
    reserve_usd_cents: 0,
    destination_wallet: "0xabc",
  },
};

const rewardClips = {
  reward_clips: [
    {
      id: "reward-1",
      whop_reward_id: "wr-1",
      whop_reward_title: "Launch reaction clips",
      clip_idx: 0,
      platform: "tiktok",
      account_label: "@clean-cuts",
      campaign_id: "campaign-live",
      whop_submission_id: "submission-1",
      status: "approved",
      tracking_link: {
        id: "track-1",
        short_url: "https://liquidclips.app/r/track-1",
        destination_url: "https://example.test/one",
        affiliate_id: "aff-1",
        platform: "tiktok",
        account_label: "@clean-cuts",
        campaign_id: "campaign-live",
        label: "Launch one",
        disabled: false,
        click_count: 2500,
      },
      created_at: "2026-07-01T09:00:00Z",
      updated_at: "2026-07-02T09:00:00Z",
    },
    {
      id: "reward-2",
      whop_reward_id: "wr-2",
      whop_reward_title: "Launch reaction clips",
      clip_idx: 1,
      platform: "youtube",
      account_label: "@clean-cuts",
      campaign_id: "campaign-live",
      whop_submission_id: "submission-2",
      status: "paid",
      tracking_link: {
        id: "track-2",
        short_url: "https://liquidclips.app/r/track-2",
        destination_url: "https://example.test/two",
        affiliate_id: "aff-1",
        platform: "youtube",
        account_label: "@clean-cuts",
        campaign_id: "campaign-live",
        label: "Launch two",
        disabled: false,
        click_count: 1500,
      },
      created_at: "2026-06-30T09:00:00Z",
      updated_at: "2026-07-02T09:00:00Z",
    },
  ],
};

async function seed(page: Page): Promise<void> {
  /* D1 (2026-07-12) · canonical auth harness seed. `interceptEarn`
   * registers spec-specific /me + /affiliate/me + /me/wallet/summary
   * mocks AFTER this call, so Playwright reverse-registration priority
   * lets the spec-specific bodies win where they overlap. */
  await seedAuthenticatedShell(page, { tier: "pro" });
  await page.addInitScript(() => {
    window.localStorage.setItem("lc.mode", "clipper");
    window.localStorage.setItem("lc.dev.force-http.v1", "1");
  });
}

async function interceptEarn(
  page: Page,
  affiliate: AffiliateHarness,
  options: { offline?: boolean } = {},
): Promise<void> {
  await page.route(/api\.liquidclips\.app\/.*/, async (route: Route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (options.offline && [
      "/me",
      "/affiliate/me",
      "/me/wallet/summary",
    ].includes(pathname)) {
      return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    }
    if (pathname === "/me") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          backend_user_id: "earn-harness",
          email: "clipper@liquidclips.test",
          raw_tier: "pro",
          effective_tier: "pro",
          billing_provider: "whop",
          subscription_status: "active",
          user: {
            id: "earn-harness",
            email: "clipper@liquidclips.test",
            handle: affiliate.handle,
          },
        }),
      });
    }
    if (pathname === "/affiliate/me") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          affiliate: {
            connected: true,
            affiliate_code: "aff-earn",
            referral_url: affiliate.referralUrl,
            active_members_count: 4,
            total_referrals_count: 7,
            monthly_recurring_revenue_usd: "80.00",
            total_referral_earnings_usd: "248.00",
          },
        }),
      });
    }
    if (pathname === "/me/handle" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { handle: string };
      affiliate.handle = body.handle;
      affiliate.referralUrl = `https://liquidclips.app/join/${body.handle}`;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          handle: affiliate.handle,
          share_url: affiliate.referralUrl,
        }),
      });
    }
    if (pathname === "/me/reward-clips") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(rewardClips),
      });
    }
    if (pathname === "/me/wallet/summary") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(wallet),
      });
    }
    if (pathname === "/sync") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ tier: "pro", caps: {} }),
      });
    }
    if (pathname === "/me/carrot") {
      return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

test.describe("Earn affiliate polish", () => {
  test("Settings and Earn share one real URL and handle changes stay consistent", async ({ page }) => {
    const affiliate = {
      handle: "clean-cuts",
      referralUrl: "https://liquidclips.app/join/clean-cuts",
    };
    await seed(page);
    await interceptEarn(page, affiliate);

    await page.goto("/?skipIntro=1#/settings", { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Referrals & QR", exact: true }).click();
    const settingsWidget = page.getByTestId("lc-affiliate-widget");
    await expect(settingsWidget).toHaveAttribute("data-referral-url", affiliate.referralUrl);

    await page.goto("/?skipIntro=1#/earn", { waitUntil: "domcontentloaded" });
    const earnWidget = page.getByTestId("lc-affiliate-widget");
    await expect(earnWidget).toHaveAttribute("data-referral-url", affiliate.referralUrl);
    await expect(page.locator('[data-testid="earn-stage"]')).toHaveAttribute(
      "data-earn-lifetime-earned",
      "12",
    );
    await expect(page.getByTestId("wallet-panel")).toHaveAttribute("data-state", "loaded");
    await expect(page.getByTestId("wallet-hero-amount")).toHaveText("$248.00");
    await expect(page.getByText("Launch reaction clips").first()).toBeVisible();
    await expect(page.getByText("Affiliate payout cleared")).toBeVisible();
    await expect(page.getByText(/USDC/i).first()).toBeVisible();

    await earnWidget.getByRole("button", { name: "Rename" }).click();
    await earnWidget.getByRole("textbox").fill("fresh-cuts");
    await earnWidget.getByRole("button", { name: "Save" }).click();
    await expect(earnWidget).toHaveAttribute(
      "data-referral-url",
      "https://liquidclips.app/join/fresh-cuts",
    );

    const evidenceDir = path.resolve(
      process.cwd(),
      "docs/ui-master/evidence/stage-6/1440x900",
    );
    fs.mkdirSync(evidenceDir, { recursive: true });
    await page.screenshot({
      path: path.join(evidenceDir, "earn-affiliate-live.png"),
      fullPage: false,
    });

    await page.goto("/?skipIntro=1#/settings", { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Referrals & QR", exact: true }).click();
    await expect(page.getByTestId("lc-affiliate-widget")).toHaveAttribute(
      "data-referral-url",
      "https://liquidclips.app/join/fresh-cuts",
    );
  });

  test("affiliate and wallet failures render honest retryable states", async ({ page }) => {
    const affiliate = {
      handle: "clean-cuts",
      referralUrl: "https://liquidclips.app/join/clean-cuts",
    };
    await seed(page);
    await interceptEarn(page, affiliate, { offline: true });
    await page.goto("/?skipIntro=1#/earn", { waitUntil: "domcontentloaded" });

    const widget = page.getByTestId("lc-affiliate-widget");
    await expect(widget).toHaveAttribute("data-source-state", "unavailable");
    await expect(widget.getByText("Affiliate data unavailable")).toBeVisible();
    await expect(widget.locator("svg")).toHaveCount(0);
    await expect(page.getByTestId("wallet-panel")).toHaveAttribute("data-state", "offline");
    await expect(page.getByTestId("wallet-offline-retry")).toBeVisible();
  });

  test("Earn remains horizontally contained at 1040×680", async ({ page }) => {
    await page.setViewportSize({ width: 1040, height: 680 });
    const affiliate = {
      handle: "clean-cuts",
      referralUrl: "https://liquidclips.app/join/clean-cuts",
    };
    await seed(page);
    await interceptEarn(page, affiliate);
    await page.goto("/?skipIntro=1#/earn", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("lc-affiliate-widget")).toBeVisible();
    const geometry = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      bodyScrollWidth: document.documentElement.scrollWidth,
      pageOverflow: getComputedStyle(
        document.querySelector(".lc-app") as HTMLElement,
      ).overflowY,
    }));
    expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.pageOverflow).toMatch(/auto|scroll/);
  });
});
