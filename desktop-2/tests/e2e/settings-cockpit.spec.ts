import { expect, test, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

async function seed(page: Page, mode: "clipper" | "agency"): Promise<void> {
  await page.addInitScript((seedMode) => {
    window.localStorage.setItem("lc.license.jwt.v1", "settings.harness.jwt");
    window.localStorage.setItem("lc.mode", seedMode);
  }, mode);
}

async function interceptSettings(page: Page, mode: "clipper" | "agency"): Promise<void> {
  const tier = mode === "agency" ? "agency" : "pro";
  await page.route(/api\.liquidclips\.app\/.*/, (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    if (pathname === "/me") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          backend_user_id: "settings-harness",
          email: mode === "agency" ? "studio@liquidclips.test" : "clipper@liquidclips.test",
          raw_tier: tier,
          effective_tier: tier,
          admin_override: false,
          billing_provider: "whop",
          subscription_status: "active",
          whop_user_id: "whop-settings",
          user: {
            id: "settings-harness",
            email: "clipper@liquidclips.test",
            handle: mode === "agency" ? "liquid-studio" : "clean-cuts",
          },
        }),
      });
    }
    if (pathname === "/sync") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ tier, caps: {} }),
      });
    }
    if (pathname === "/affiliate/me") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          affiliate: {
            connected: true,
            affiliate_code: "aff-settings",
            referral_url: `https://liquidclips.app/join/${mode === "agency" ? "liquid-studio" : "clean-cuts"}`,
            active_members_count: 4,
            total_referrals_count: 7,
            monthly_recurring_revenue_usd: "80.00",
            total_referral_earnings_usd: "248.00",
          },
        }),
      });
    }
    if (pathname === "/me/carrot") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          state: "tracking",
          is_live: true,
          is_mock: false,
          progress: {
            views: 1200,
            views_threshold: 5000,
            affiliates: 4,
            affiliates_threshold: 5,
            qualified: false,
            qualified_via: null,
          },
          economics: {
            gross_usd: 50,
            lc_protocol_fee_pct: 5,
            lc_protocol_fee_usd: 2.5,
            net_to_clipper_usd: 47.5,
            currency: "USDC",
            min_withdrawal_usd: 10,
          },
          wallet: {
            address: "0xabc",
            network: "ethereum",
            onboarded: true,
            capabilities_crypto_payout: "ready",
          },
          sub_merchant_id: "sub-settings",
          lifetime_paid_usd: 248,
          last_claim_at: null,
          status_copy: "Tracking",
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });
}

async function openSettings(page: Page, mode: "clipper" | "agency"): Promise<void> {
  await seed(page, mode);
  await interceptSettings(page, mode);
  await page.goto("/?skipIntro=1#/settings", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({
    timeout: 20_000,
  });
}

test.describe("Settings cockpit", () => {
  for (const viewport of [
    { width: 1040, height: 680 },
    { width: 1280, height: 820 },
  ]) {
    test(`clipper cockpit remains usable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openSettings(page, "clipper");
      await page.getByRole("tab", { name: "Referrals & QR", exact: true }).click();
      const affiliate = page.getByTestId("lc-affiliate-widget");
      await expect(affiliate).toBeVisible();
      await expect(affiliate.getByRole("button", { name: "Download QR" })).toBeVisible();

      const geometry = await page.evaluate(() => {
        const stage = document.querySelector(".lc-settings-stage") as HTMLElement;
        const pane = document.querySelector(".lc-settings") as HTMLElement;
        const tabs = document.querySelector(".lc-settings-tabs") as HTMLElement;
        const qr = document.querySelector(".lc-affiliate-widget-qr") as HTMLElement;
        return {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          bodyScrollWidth: document.documentElement.scrollWidth,
          stageBottom: stage.getBoundingClientRect().bottom,
          paneHeight: pane.getBoundingClientRect().height,
          tabsHeight: tabs.getBoundingClientRect().height,
          paneOverflow: getComputedStyle(pane).overflowY,
          qrRight: qr.getBoundingClientRect().right,
          paneRight: pane.getBoundingClientRect().right,
        };
      });
      expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.stageBottom).toBeLessThanOrEqual(geometry.viewportHeight);
      expect(geometry.stageBottom).toBeGreaterThan(geometry.viewportHeight - 40);
      expect(geometry.paneHeight).toBeGreaterThan(250);
      expect(geometry.tabsHeight).toBeGreaterThan(250);
      expect(geometry.paneOverflow).toMatch(/auto|scroll/);
      expect(geometry.qrRight).toBeLessThanOrEqual(geometry.paneRight);

      const evidenceDir = path.resolve(
        process.cwd(),
        `docs/ui-master/evidence/stage-5/${viewport.width}x${viewport.height}`,
      );
      fs.mkdirSync(evidenceDir, { recursive: true });
      await page.screenshot({
        path: path.join(evidenceDir, "settings-clipper-referrals.png"),
        fullPage: false,
      });
    });
  }

  test("clipper tabs remain bounded and referrals use the real shared QR", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSettings(page, "clipper");

    for (const tab of [
      "Account",
      "Payouts",
      "Devices",
      "Notifications",
      "Support",
      "Advanced",
      "Streaks",
      "Referrals & QR",
    ]) {
      const button = page.getByRole("tab", { name: tab, exact: true });
      await button.click();
      await expect(button).toHaveAttribute("aria-selected", "true");
    }

    const affiliate = page.getByTestId("lc-affiliate-widget");
    await expect(affiliate).toHaveAttribute("data-source-state", "ready");
    await expect(affiliate.getByText("https://liquidclips.app/join/clean-cuts")).toBeVisible();
    await expect(affiliate.locator("svg")).toHaveCount(1);

    await affiliate.getByRole("button", { name: "Rename" }).click();
    const handle = affiliate.getByRole("textbox");
    await handle.fill("bad handle");
    await expect(
      affiliate.getByText("Use 3-30 lowercase letters, numbers, dash, dot, or underscore."),
    ).toBeVisible();
    await expect(affiliate.getByRole("button", { name: "Save" })).toBeDisabled();
    await affiliate.getByRole("button", { name: "Cancel" }).click();

    const downloadPromise = page.waitForEvent("download");
    await affiliate.getByRole("button", { name: "Download QR" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("liquid-clips-clean-cuts-qr.png");

    const geometry = await page.evaluate(() => {
      const stage = document.querySelector(".lc-settings-stage") as HTMLElement;
      const pane = document.querySelector(".lc-settings") as HTMLElement;
      return {
        stageBottom: stage.getBoundingClientRect().bottom,
        viewportHeight: window.innerHeight,
        paneOverflow: getComputedStyle(pane).overflowY,
        bodyScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    expect(geometry.stageBottom).toBeLessThanOrEqual(geometry.viewportHeight);
    expect(geometry.stageBottom).toBeGreaterThan(geometry.viewportHeight - 40);
    expect(geometry.paneOverflow).toMatch(/auto|scroll/);
    expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth);

    const evidenceDir = path.resolve(
      process.cwd(),
      "docs/ui-master/evidence/stage-5/1440x900",
    );
    fs.mkdirSync(evidenceDir, { recursive: true });
    await page.screenshot({
      path: path.join(evidenceDir, "settings-clipper-referrals.png"),
      fullPage: false,
    });
  });

  test("agency tabs expose honest capability gates without fake roster controls", async ({ page }) => {
    await openSettings(page, "agency");

    for (const tab of ["Whop Sync", "Roster", "Payout split", "Rules"]) {
      await expect(page.getByRole("tab", { name: tab, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("tab", { name: "Referrals & QR" })).toHaveCount(0);

    await page.getByRole("tab", { name: "Roster", exact: true }).click();
    await expect(page.getByText("Members, invites, private-room access, and payout status are not exposed by the current backend. Add-clipper controls stay hidden until permission enforcement exists.")).toBeVisible();
    await expect(page.getByRole("button", { name: /add clipper/i })).toHaveCount(0);

    const evidenceDir = path.resolve(
      process.cwd(),
      "docs/ui-master/evidence/stage-5/1440x900",
    );
    fs.mkdirSync(evidenceDir, { recursive: true });
    await page.screenshot({
      path: path.join(evidenceDir, "settings-agency-roster-gate.png"),
      fullPage: false,
    });
  });

  test("presence preference is shared with Community and survives navigation", async ({ page }) => {
    await openSettings(page, "clipper");
    const presence = page.locator(".lc-settings-presence");
    await expect(presence).toHaveAttribute("data-online", "true");
    await presence.click();
    await expect(presence).toHaveAttribute("data-online", "false");

    await page.goto("/?skipIntro=1#/community", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("community-presence-toggle")).toHaveAttribute(
      "data-online",
      "0",
    );
  });

  test("legacy account, payout, connection, support, and advanced actions remain reachable", async ({ page }) => {
    await openSettings(page, "clipper");

    await expect(page.getByTestId("settings-upgrade-whop")).toBeVisible();
    await expect(page.getByTestId("settings-refresh-account")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Whop dashboard ↗" })).toBeVisible();

    await page.getByRole("tab", { name: "Payouts", exact: true }).click();
    await expect(page.getByRole("button", { name: "Refresh to verify" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Manage on Whop ↗" })).toBeVisible();
    await expect(page.getByTestId("settings-carrot-portal")).toBeVisible();

    await page.getByRole("tab", { name: "Devices", exact: true }).click();
    await expect(page.getByRole("button", { name: /Open Channels|Manage Channels/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Whop ↗" })).toBeVisible();

    await page.getByRole("tab", { name: "Support", exact: true }).click();
    await expect(page.getByRole("button", { name: "Copy support email" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open mail client ↗" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Read docs ↗" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Privacy ↗" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Terms ↗" })).toBeVisible();

    await page.getByRole("tab", { name: "Advanced", exact: true }).click();
    await expect(page.getByRole("button", { name: "Copy JWT storage key name" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear local activation" })).toBeVisible();
    await expect(page.getByText("Secure key storage is available in the desktop app")).toBeVisible();
  });
});
