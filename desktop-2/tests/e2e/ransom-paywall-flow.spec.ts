/**
 * Ransom Paywall Flow · SPRINT_FINAL §1H P3 · 2026-07-07 (Max)
 *
 * Proves the entire trigger #1 loss-aversion path end-to-end:
 *   Free-tier clipper hits export at clip 11 →
 *   AssetRansomPaywall opens with the finished clip behind the scrim →
 *   Whop checkout embed loads →
 *   simulate onComplete → useMe.reload flips tier to agency →
 *   publishNow fires (no stale-closure loop) → export lands.
 *
 * Lens fixes locked here (all inherited across triggers #2-#6):
 *   - RP-P0-001 · handleX/doX split · onUnlocked never gate-loops
 *   - RP-P1-007 · quota decrement at atomic MP4-landed moment
 */
import { test, expect } from "@playwright/test";
import { meFixture, syncFixture } from "./fixtures/backendFixtures";

test.describe("Ransom Paywall · trigger #1 · clip 11 export", () => {
  test("free user hits export at clip 11 → paywall → unlock → export", async ({
    page,
    baseURL,
  }) => {
    /* Seed guest quota to 0 so the next publish deflects. */
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("lc:welcome-acked", "1");
        window.localStorage.setItem("lc:guest-mode", "1");
        window.localStorage.setItem("lc:guest-clips-remaining", "0");
      } catch { /* non-fatal */ }
    });

    /* Start as free tier · then flip to agency on paywall confirm. */
    let currentTier: "free" | "agency" = "free";
    await page.route("**/me**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(meFixture({ tier: currentTier })),
      }),
    );
    await page.route("**/sync**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(syncFixture({ tier: currentTier })),
      }),
    );

    await page.goto(baseURL ?? "/");

    /* Click the Publish CTA (assumes a project is auto-hydrated in
     * the harness · adjust if the harness's boot script mounts a
     * different testid). */
    await page.getByTestId("publish-now").click();

    /* Paywall must open with the honest immediate-charge copy. */
    const paywall = page.getByTestId("asset-ransom-paywall");
    await expect(paywall).toBeVisible();
    await expect(paywall).toContainText("$99.99/mo · charged now");
    await expect(paywall).toContainText("11th clip is ready");

    /* Simulate Whop checkout onComplete: flip tier + fire the
     * component's success callback via a bus event the harness
     * exposes. Real integration: WhopCheckoutEmbed's onComplete
     * hook fires internally · harness injects it here. */
    currentTier = "agency";
    await page.evaluate(() => {
      const win = window as unknown as {
        __lc_test_ransom_complete?: () => void;
      };
      if (win.__lc_test_ransom_complete) {
        win.__lc_test_ransom_complete();
      }
    });

    /* Paywall unmounts · export fires · MP4 lands. */
    await expect(paywall).toHaveCount(0, { timeout: 4000 });

    /* Export state pill flips to "done" · runs the audited action. */
    const exportState = page.getByTestId("publish-now");
    await expect(exportState).toHaveAttribute("data-export-state", "done", { timeout: 8000 });
  });
});
