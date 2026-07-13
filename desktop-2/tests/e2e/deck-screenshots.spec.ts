/**
 * deck-screenshots · Agency deck asset capture · 2026-07-08
 *
 * Captures polished UI shots of the shipped desktop-2 app for the
 * Agency deck. Seeded with the same agency + whopCompanyId fixture
 * pattern the P10 syndicate spec locked. Output goes straight to
 * ~/Desktop/agecy deck/ so the deck author can drop them in.
 *
 * Viewport is 1600×1000 · matches the deck's target 16:10 canvas
 * without the Playwright default 1440×900 letterboxing.
 */
import { test, expect, type Page } from "@playwright/test";
import * as path from "node:path";
import * as os from "node:os";
import { meFixture, syncFixture } from "./fixtures/backendFixtures";

const OUT = path.join(os.homedir(), "Desktop", "agecy deck");
const AGENCY_COMPANY_ID = "biz_agecy_deck";

test.use({ viewport: { width: 1600, height: 1000 } });

async function seedAgencyAuth(page: Page, jwt: string) {
  await page.addInitScript((j: string) => {
    try {
      window.localStorage.setItem("lc.license.jwt.v1", j);
      window.localStorage.setItem("app.liquidclips.auth.v1.jwt", j);
      window.localStorage.setItem(
        "app.liquidclips.auth.v1.whop_authorized_at",
        new Date().toISOString(),
      );
      window.localStorage.setItem("lc:welcome-acked", "1");
      window.localStorage.setItem("lc.onboarding.agency-welcome.seen.v1", "1");
      window.localStorage.setItem("lc.dev.force-http.v1", "1");
      /* 2026-07-13 D1 residual · Pre-dismiss the ActivateFounderPanel
       * nudge (Agency Access) so it doesn't overlay the deck shots. */
      window.localStorage.setItem(
        "lc.membership.activate-nudge-dismissed-at",
        String(Date.now()),
      );
    } catch {
      /* non-fatal */
    }
    /* 2026-07-13 D1 residual · Set the E2E transport gate so
     * diagnosticLogger + loginTelemetry + audit-tick keepalive senders
     * no-op. Without this flag, the Campaigns Agency route emitted 3000+
     * `/lcos/events/ingest` keepalive POSTs during hydration (each one
     * failing with CORS against the real prod origin). The flood kept
     * the browser main thread busy servicing failed fetches and caused
     * `page.screenshot()` to never return within the 240s test timeout.
     *
     * The keepalive fetches slip past `page.route` because the browser
     * dispatches them on a separate keepalive pool outside CDP routing.
     * Setting `__LCOS_E2E__` at init makes the sender code path skip the
     * fetch entirely (see `src/lib/diagnosticLogger.ts:72` +
     * `src/lib/useAuditableAction.ts:98` + `src/lib/loginTelemetry.ts:79`
     * + `src/design-os/components/TopHud.tsx:455`). Production is
     * unaffected — the flag is never set outside the harness. */
    (window as unknown as { __LCOS_E2E__?: boolean }).__LCOS_E2E__ = true;
  }, jwt);
}

async function stubMe(page: Page, tier: "agency" | "free") {
  await page.route("**/me**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...meFixture({ tier }),
        whop_company_id: AGENCY_COMPANY_ID,
      }),
    }),
  );
  await page.route("**/sync", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(syncFixture({ tier })),
    }),
  );
}

test.describe("Agency deck screenshots", () => {
  test("07 · Campaigns dashboard (Agency)", async ({ page, baseURL }) => {
    await seedAgencyAuth(page, "deck-jwt-agency");
    await stubMe(page, "agency");
    await page.goto((baseURL ?? "") + "/#/campaigns");
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await page.waitForTimeout(1200);
    await page.screenshot({
      path: path.join(OUT, "07-app-campaigns-dashboard.png"),
      fullPage: false,
    });
  });

  test("08 · Create campaign drawer", async ({ page, baseURL }) => {
    await seedAgencyAuth(page, "deck-jwt-agency-create");
    await stubMe(page, "agency");
    await page.goto((baseURL ?? "") + "/#/campaigns");
    await expect(page.getByTestId("app-shell")).toBeVisible();
    /* Open the agency creation flow (Campaigns.tsx onOpenCreation). */
    await page.evaluate(() => {
      const w = window as unknown as {
        __lcBus?: { emit: (e: string, p: Record<string, unknown>) => void };
      };
      w.__lcBus?.emit("nav:click", { route: "campaign-builder" });
    });
    await page.waitForTimeout(800);
    /* Fallback · click any visible "Create" / "New campaign" affordance
     * if the bus event didn't route. */
    const createBtn = page.getByRole("button", {
      name: /(new|create)\s+campaign/i,
    });
    if (await createBtn.count()) {
      await createBtn.first().click().catch(() => {});
    }
    await page.waitForTimeout(1200);
    await page.screenshot({
      path: path.join(OUT, "08-app-create-campaign.png"),
      fullPage: false,
    });
  });

  test("09 · Clipper bounties (Free tier view)", async ({ page, baseURL }) => {
    await seedAgencyAuth(page, "deck-jwt-clipper");
    await stubMe(page, "free");
    await page.goto((baseURL ?? "") + "/#/campaigns");
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await page.waitForTimeout(1200);
    await page.screenshot({
      path: path.join(OUT, "09-app-clipper-bounties.png"),
      fullPage: false,
    });
  });

  test("10 · Earnings / payout (Earn tab)", async ({ page, baseURL }) => {
    await seedAgencyAuth(page, "deck-jwt-earn");
    await stubMe(page, "agency");
    /* Seed a couple reward-clip rows so the surface isn't empty. */
    await page.route("**/me/reward-clips**", (r) => {
      const now = new Date().toISOString();
      const row = (id: string, title: string, status: string) => ({
        id, whop_reward_id: `wr_${id}`, whop_reward_title: title,
        clip_idx: 0, platform: "tiktok", account_label: "@deck-demo",
        campaign_id: null, whop_submission_id: null, status,
        tracking_link: null, created_at: now, updated_at: now,
      });
      return r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          reward_clips: [
            row("rc_deck_1", "Summer Drop · verse 1 hook", "approved"),
            row("rc_deck_2", "Cold open · morning routine", "submitted"),
            row("rc_deck_3", "Skit collab · duet edit", "paid"),
          ],
        }),
      });
    });
    await page.goto((baseURL ?? "") + "/#/earn");
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: path.join(OUT, "10-app-earnings.png"),
      fullPage: false,
    });
  });

  test("11 · Analytics (Wallet detail)", async ({ page, baseURL }) => {
    await seedAgencyAuth(page, "deck-jwt-analytics");
    await stubMe(page, "agency");
    await page.goto((baseURL ?? "") + "/#/wallet");
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: path.join(OUT, "11-app-analytics.png"),
      fullPage: false,
    });
  });

  test("12 · Login / Welcome (no auth)", async ({ page, baseURL }) => {
    /* No auth seed · WelcomeRoute + LoginScreen surface. */
    await page.addInitScript(() => {
      try {
        window.localStorage.removeItem("lc.license.jwt.v1");
        window.localStorage.removeItem("app.liquidclips.auth.v1.jwt");
        window.localStorage.removeItem("lc:welcome-acked");
      } catch { /* non-fatal */ }
    });
    await stubMe(page, "free");
    await page.goto((baseURL ?? "") + "/");
    await page.waitForTimeout(2500);
    await page.screenshot({
      path: path.join(OUT, "12-app-login-welcome.png"),
      fullPage: false,
    });
  });

  test("13 · Login / lane picker (welcome acked · sign-in state)", async ({
    page,
    baseURL,
  }) => {
    /* welcome-acked but no JWT · shows the TopHud sign-in pill state
     * against the actual app shell. */
    await page.addInitScript(() => {
      try {
        window.localStorage.removeItem("lc.license.jwt.v1");
        window.localStorage.setItem("lc:welcome-acked", "1");
        window.localStorage.setItem("lc.onboarding.agency-welcome.seen.v1", "1");
      } catch { /* non-fatal */ }
    });
    await stubMe(page, "free");
    await page.goto((baseURL ?? "") + "/");
    await expect(page.getByTestId("app-shell")).toBeVisible();
    await page.waitForTimeout(1200);
    await page.screenshot({
      path: path.join(OUT, "13-app-signed-out-home.png"),
      fullPage: false,
    });
  });
});
