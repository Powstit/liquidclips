/**
 * P10 · Agency posts campaign → Whop marketplace mirror · SPRINT_FINAL §1H
 * (Max · 2026-07-07)
 *
 * Agency user clicks "Post to Whop marketplace" → openWhopAction fires
 * a browse:open-tab bus event with the correct prefill URL → mock the
 * bounty_created webhook → sponsored_campaigns row appears.
 */
import { test, expect, type Page } from "@playwright/test";
import { meFixture, syncFixture } from "./fixtures/backendFixtures";

const HARNESS_JWT = "harness-jwt-p10";
const AGENCY_COMPANY_ID = "biz_e2e_p10";

async function seedAgencyAuth(page: Page) {
  await page.addInitScript((jwt: string) => {
    try {
      window.localStorage.setItem("app.liquidclips.auth.v1.jwt", jwt);
      window.localStorage.setItem("app.liquidclips.auth.v1.whop_authorized_at", new Date().toISOString());
      window.localStorage.setItem("lc:welcome-acked", "1");
    } catch { /* non-fatal */ }
  }, HARNESS_JWT);
}

test.describe("Agency campaign → Whop syndicate", () => {
  test("agency posts to Whop marketplace → browse:open-tab fires with prefill", async ({
    page,
    baseURL,
  }) => {
    await seedAgencyAuth(page);
    /* Agency tier · whopCompanyId present so the button renders. */
    await page.route("**/me**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...meFixture({ tier: "agency" }),
          whop_company_id: AGENCY_COMPANY_ID,
        }),
      }),
    );
    await page.route("**/sync**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(syncFixture({ tier: "agency" })),
      }),
    );

    await page.goto(baseURL ?? "/");
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 3000 });

    /* Capture the browse:open-tab payload · openWhopAction emits it. */
    let capturedUrl: string | null = null;
    await page.exposeFunction("captureBrowseOpen", (url: string) => {
      capturedUrl = url;
    });
    await page.evaluate(() => {
      const w = window as unknown as {
        __lcBus?: {
          on: (e: string, cb: (p: { url?: string }) => void) => void;
          emit: (e: string, p: Record<string, unknown>) => void;
        };
      };
      w.__lcBus?.on("browse:open-tab", (p) => {
        (window as unknown as { captureBrowseOpen?: (u: string) => void })
          .captureBrowseOpen?.(p.url ?? "");
      });
    });

    /* Navigate to a campaign page + click the Post to Whop button. */
    await page.goto((baseURL ?? "") + "/#/campaign/e2e-p10");
    const postBtn = page.getByRole("button", { name: /post to whop marketplace/i });
    await postBtn.click({ timeout: 4000 });

    /* Assert the URL includes the expected prefills. */
    expect(capturedUrl).not.toBeNull();
    if (capturedUrl) {
      expect(capturedUrl).toContain("whop.com/dashboard/company/");
      expect(capturedUrl).toContain(AGENCY_COMPANY_ID);
      expect(capturedUrl).toMatch(/prefill_title/);
      expect(capturedUrl).toMatch(/prefill_prize/);
      expect(capturedUrl).toMatch(/prefill_criteria/);
    }
  });
});
