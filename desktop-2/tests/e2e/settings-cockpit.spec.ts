import { expect, test, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

import { seedAuthenticatedShell } from "./_auth-harness";

async function seed(
  page: Page,
  mode: "clipper" | "agency",
  welcomeSeen = true,
): Promise<void> {
  /* D1 (2026-07-12) · canonical auth harness seed. `interceptSettings`
   * registers its own /me + /sync (+ agency roster/rules routes) AFTER
   * this call; Playwright reverse-registration priority lets those win. */
  await seedAuthenticatedShell(page, { tier: mode === "agency" ? "agency" : "pro" });
  await page.addInitScript(({ seedMode, markWelcomeSeen }) => {
    window.localStorage.setItem("lc.mode", seedMode);
    if (markWelcomeSeen) {
      window.localStorage.setItem(
        "lc.onboarding.agency-welcome.seen.v1",
        "1",
      );
    }
  }, { seedMode: mode, markWelcomeSeen: welcomeSeen });
}

async function interceptSettings(
  page: Page,
  mode: "clipper" | "agency",
  rosterState: "ready" | "forbidden" | "offline" | "malformed" = "ready",
): Promise<void> {
  const tier = mode === "agency" ? "agency" : "pro";
  const roster = {
    members: [
      {
        id: 1,
        agency_id: "settings-harness",
        user_id: "member-1",
        email: "clipper@liquidclips.test",
        handle: "clean-cuts",
        role: "member",
        status: "active",
        joined_at: "2026-07-01T12:00:00Z",
        invited_by_user_id: "settings-harness",
      },
    ],
    pending_invites: [
      {
        id: "invite-1",
        agency_id: "settings-harness",
        email: "pending@liquidclips.test",
        role: "member",
        status: "pending",
        expires_at: "2026-07-16T12:00:00Z",
        created_at: "2026-07-02T12:00:00Z",
      },
    ],
  };
  await page.route(/api\.liquidclips\.app\/.*/, (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    const method = route.request().method();
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
    if (
      pathname === "/agency/settings-harness/roster" &&
      method === "GET"
    ) {
      if (rosterState === "forbidden") {
        return route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Owner access required." }),
        });
      }
      if (rosterState === "offline") {
        return route.abort("failed");
      }
      if (rosterState === "malformed") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "{}",
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(roster),
      });
    }
    if (
      pathname === "/agency/settings-harness/roster/invite" &&
      method === "POST"
    ) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...roster.pending_invites[0],
          id: "invite-new",
          email: "new@liquidclips.test",
        }),
      });
    }
    if (
      pathname === "/agency/settings-harness/roster/member-1/role" &&
      method === "POST"
    ) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...roster.members[0], role: "mod" }),
      });
    }
    if (
      pathname === "/agency/settings-harness/roster/member-1" &&
      method === "DELETE"
    ) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...roster.members[0], status: "disabled" }),
      });
    }
    if (
      pathname === "/agency/settings-harness/payout-splits" &&
      method === "GET"
    ) {
      if (rosterState === "malformed") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "{}",
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          splits: [
            {
              member_user_id: "member-1",
              percent_bps: 10000,
              updated_at: "2026-07-02T12:00:00Z",
              updated_by_user_id: "settings-harness",
            },
          ],
          total_bps: 10000,
          sums_to_100: true,
        }),
      });
    }
    if (
      pathname === "/agency/settings-harness/payout-splits" &&
      method === "PUT"
    ) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          splits: [
            {
              member_user_id: "member-1",
              percent_bps: 10000,
              updated_at: "2026-07-02T12:01:00Z",
              updated_by_user_id: "settings-harness",
            },
          ],
          total_bps: 10000,
          sums_to_100: true,
        }),
      });
    }
    if (
      pathname === "/agency/settings-harness/rules" &&
      method === "GET"
    ) {
      if (rosterState === "malformed") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "{}",
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          rules: [
            {
              key: "min_lc_score",
              value: 75,
              updated_at: "2026-07-02T12:00:00Z",
              updated_by_user_id: "settings-harness",
            },
          ],
        }),
      });
    }
    if (
      pathname.startsWith("/agency/settings-harness/rules/") &&
      method === "PUT"
    ) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          key: pathname.split("/").at(-1),
          value: true,
          updated_at: "2026-07-02T12:01:00Z",
          updated_by_user_id: "settings-harness",
        }),
      });
    }
    if (
      pathname === "/agency/settings-harness/whop-sync" &&
      method === "POST"
    ) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          checked: 1,
          changed: 0,
          items: [],
        }),
      });
    }
    if (pathname === "/agency/campaigns" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });
}

async function openSettings(
  page: Page,
  mode: "clipper" | "agency",
  welcomeSeen = true,
  rosterState: "ready" | "forbidden" | "offline" | "malformed" = "ready",
): Promise<void> {
  await seed(page, mode, welcomeSeen);
  await interceptSettings(page, mode, rosterState);
  await page.goto("/?skipIntro=1#/settings", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({
    timeout: 40_000,
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

  test("agency tabs expose live owner controls backed by real endpoint contracts", async ({ page }) => {
    await openSettings(page, "agency");

    for (const tab of ["Whop Sync", "Roster", "Payout split", "Rules"]) {
      await expect(page.getByRole("tab", { name: tab, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("tab", { name: "Referrals & QR" })).toHaveCount(0);

    await page.getByRole("tab", { name: "Roster", exact: true }).click();
    const roster = page.locator('[data-tab="roster"]');
    await expect(roster).toBeVisible();
    await expect(roster.getByText("clipper@liquidclips.test")).toBeVisible();
    await expect(roster.getByText("pending@liquidclips.test")).toBeVisible();

    const roleRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname.endsWith("/roster/member-1/role"),
    );
    await roster.getByRole("combobox").first().selectOption("mod");
    expect((await roleRequest).postDataJSON()).toEqual({ role: "mod" });

    const inviteRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname.endsWith("/roster/invite"),
    );
    await roster.getByPlaceholder("clipper@example.com").fill("new@liquidclips.test");
    await roster.getByRole("button", { name: "Send invite" }).click();
    expect((await inviteRequest).postDataJSON()).toEqual({
      email: "new@liquidclips.test",
      role: "member",
    });

    await page.getByRole("tab", { name: "Payout split", exact: true }).click();
    const splits = page.locator('[data-tab="payout-split"]');
    await expect(splits.getByText("clipper@liquidclips.test")).toBeVisible();
    const splitRequest = page.waitForRequest(
      (request) =>
        request.method() === "PUT" &&
        new URL(request.url()).pathname.endsWith("/payout-splits"),
    );
    await splits.getByRole("button", { name: "Save splits" }).click();
    expect((await splitRequest).postDataJSON()).toEqual({
      splits: [{ member_user_id: "member-1", percent_bps: 10000 }],
    });

    await page.getByRole("tab", { name: "Rules", exact: true }).click();
    const rules = page.locator('[data-tab="rules"]');
    await expect(rules.getByText("min_lc_score")).toBeVisible();
    const ruleRequest = page.waitForRequest(
      (request) =>
        request.method() === "PUT" &&
        new URL(request.url()).pathname.endsWith("/rules/watermark_required"),
    );
    await rules.getByPlaceholder("rule_key").fill("watermark_required");
    await rules
      .getByPlaceholder('JSON value · e.g. {"min_lc_score": 75}')
      .fill("true");
    await rules.getByRole("button", { name: "Add rule" }).click();
    expect((await ruleRequest).postDataJSON()).toEqual({ value: true });

    await page.getByRole("tab", { name: "Whop Sync", exact: true }).click();
    const syncRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname.endsWith("/whop-sync"),
    );
    await page.getByRole("button", { name: "Sync roster with Whop" }).click();
    await syncRequest;
    await expect(page.getByText("Sync complete · 0 members processed.")).toBeVisible();
  });

  test("agency roster renders forbidden and offline states honestly", async ({ page }) => {
    await openSettings(page, "agency", true, "forbidden");
    await page.getByRole("tab", { name: "Roster", exact: true }).click();
    await expect(page.getByText("Owner access required.").first()).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    // Replace the fixture with an offline route in a fresh document.
    await page.unrouteAll({ behavior: "wait" });
    await openSettings(page, "agency", true, "offline");
    await page.getByRole("tab", { name: "Roster", exact: true }).click();
    await expect(page.getByText("Roster offline.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" }).first()).toBeVisible();
  });

  test("malformed agency list responses fail safely without crashing Settings", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await openSettings(page, "agency", true, "malformed");

    await page.getByRole("tab", { name: "Roster", exact: true }).click();
    await expect(page.getByText("Roster couldn’t load.")).toBeVisible();

    await page.getByRole("tab", { name: "Payout split", exact: true }).click();
    await expect(page.getByText("Payout splits couldn’t load.")).toBeVisible();

    await page.getByRole("tab", { name: "Rules", exact: true }).click();
    await expect(page.getByText("Rules couldn’t load.")).toBeVisible();

    await expect(page.getByText("Reload brick")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test("agency welcome CTAs navigate to real product surfaces", async ({ page }) => {
    await openSettings(page, "agency", false);
    const welcome = page.getByRole("dialog", {
      name: /your agency is live/i,
    });
    await expect(welcome).toBeVisible();
    await expect(
      welcome.getByRole("button", { name: /open campaign builder/i }),
    ).toBeVisible();
    await expect(
      welcome.getByRole("button", { name: /open roster/i }),
    ).toBeVisible();
    await expect(
      welcome.getByRole("button", { name: /read the brief/i }),
    ).toBeVisible();

    await welcome.getByRole("button", { name: /open roster/i }).click();
    await expect(welcome).toBeHidden();
    await expect(
      page.getByRole("tab", { name: "Roster", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-tab="roster"]')).toBeVisible();
  });

  test("agency welcome brief opens inside BrowseOverlay", async ({ page }) => {
    await openSettings(page, "agency", false);
    await page
      .getByRole("dialog", { name: /your agency is live/i })
      .getByRole("button", { name: /read the brief/i })
      .click();
    const browser = page.getByRole("dialog", { name: "Browser overlay" });
    await expect(browser).toBeVisible();
    await expect(browser.getByRole("textbox", { name: "URL bar" })).toHaveValue(
      "https://liquidclips.app/agencies",
    );
  });

  test("agency welcome create CTA opens the campaign builder", async ({ page }) => {
    await openSettings(page, "agency", false);
    await page
      .getByRole("dialog", { name: /your agency is live/i })
      .getByRole("button", { name: /open campaign builder/i })
      .click();
    await expect(
      page.getByRole("heading", { name: "Campaigns", exact: true }),
    ).toBeVisible();
  });

  test("campaign builder blocks writes from an untrusted tier source", async ({ page }) => {
    await openSettings(page, "agency");
    await page.evaluate(() => {
      const appWindow = window as unknown as {
        __lcBus?: { emit: (event: string, payload: unknown) => void };
      };
      appWindow.__lcBus?.emit("nav:click", { route: "campaign-builder" });
    });
    await expect(
      page.getByRole("heading", { name: "Campaigns", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => {
      window.__lcDebugSetTier?.("agency");
    });
    await page.getByRole("button", { name: "+ New", exact: true }).click();
    await page.getByPlaceholder("Q3 launch clip bounty").fill("Blocked draft");
    await expect(
      page.getByText(/agency-tier verification pending/i),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create draft" }),
    ).toBeDisabled();
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
