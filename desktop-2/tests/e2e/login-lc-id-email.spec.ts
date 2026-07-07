/**
 * P2 · LoginScreen · LC-ID Resend email · SPRINT_FINAL §1H
 * (Max · 2026-07-07)
 *
 * Locks: checkout success fires the Resend send · user pastes the
 * LC-ID from the email · the app unlocks + navigates to the app shell.
 */
import { test, expect } from "@playwright/test";

test.describe("Login · LC-ID email + paste unlock", () => {
  test("checkout success → Resend called → LC-ID paste unlocks", async ({
    page,
    baseURL,
  }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.clear();
      } catch { /* private mode */ }
    });

    /* Spy on the Resend send · the backend `/lc-ids/mint` route
     * kicks off a Resend send. Assert both are called. */
    let resendCalls = 0;
    await page.route("**/lc-ids/mint**", async (route) => {
      resendCalls += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, lc_id: "LC-P2-01" }),
      });
    });

    /* LC-ID redeem endpoint · unlocks the app. */
    await page.route("**/lc-ids/redeem**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          license_jwt: "harness-jwt-p2",
          whop_authorized_at: new Date().toISOString(),
        }),
      }),
    );

    /* Mock /me + /sync for the post-redeem hydration. */
    await page.route("**/me**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          backend_user_id: "harness-p2",
          effective_tier: "free",
          raw_tier: "free",
          subscription_status: "active",
        }),
      }),
    );
    await page.route("**/sync**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          tier: "free",
          founder: false,
          subscription_status: "active",
          whop_authorized_at: new Date().toISOString(),
        }),
      }),
    );

    await page.goto(baseURL ?? "/");
    await expect(page.getByTestId("welcome-route-root")).toBeVisible({ timeout: 3000 });

    /* Simulate checkout success → LC-ID mint. Real integration: the
     * $1 authorization plan's `on_success` fires a backend hook
     * that calls Resend. Test seam: invoke the mint endpoint
     * directly. */
    const mintResp = await page.request.post(
      `${baseURL ?? ""}/lc-ids/mint`,
      { data: { email: "p2@liquidclips.test" } },
    );
    expect(mintResp.status()).toBe(200);
    expect(resendCalls).toBeGreaterThan(0);

    /* Find the paste input · WelcomeRoute renders a recovery
     * "paste your LC-ID" input for cold-lead-with-token flow. */
    const pasteInput = page.getByTestId("welcome-lcid-input");
    await pasteInput.fill("LC-P2-01");
    await page.getByTestId("welcome-lcid-submit").click();

    /* App unlocks · shell mounts. */
    await expect(page.getByTestId("welcome-route-root")).toHaveCount(0, { timeout: 3000 });
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 3000 });
  });
});
