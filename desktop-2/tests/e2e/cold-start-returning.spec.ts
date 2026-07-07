/**
 * Cold-Start · Returning user · SPRINT_FINAL §1H P12 · 2026-07-07 (Max)
 *
 * Locks the "JWT + whop_authorized_at both present → skip LoginScreen
 * → app shell mounts within 2000ms" contract. Every returning user's
 * launch should feel instant.
 */
import { test, expect } from "@playwright/test";

const HARNESS_JWT = "harness-jwt-e2e-not-real";

test.describe("Cold-Start · Returning user", () => {
  test("JWT + whop_authorized_at present · app shell mounts within 2000ms", async ({
    page,
    baseURL,
  }) => {
    /* Seed keychain BEFORE navigation. Namespace matches AuthStorage
     * `app.liquidclips.auth.v1.*` and the whop_authorized_at flag
     * (backend-signed date · frontend only checks presence). */
    await page.addInitScript((jwt: string) => {
      try {
        window.localStorage.setItem("app.liquidclips.auth.v1.jwt", jwt);
        window.localStorage.setItem("app.liquidclips.auth.v1.whop_authorized_at", new Date().toISOString());
        window.localStorage.setItem("lc:welcome-acked", "1");
      } catch {
        /* non-fatal */
      }
    }, HARNESS_JWT);

    /* Mock /sync + /me so useMe hydrates without a real backend hit. */
    await page.route("**/sync**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          tier: "agency",
          founder: false,
          subscription_status: "active",
          paid_until: "2099-01-01T00:00:00Z",
          whop_authorized_at: new Date().toISOString(),
          new_license_jwt: null,
          onboarding_status: {},
        }),
      }),
    );
    await page.route("**/me**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          backend_user_id: "harness",
          email: "returning@liquidclips.app",
          effective_tier: "agency",
          raw_tier: "agency",
          subscription_status: "active",
        }),
      }),
    );

    const start = Date.now();
    await page.goto(baseURL ?? "/");

    /* WelcomeRoute MUST NOT mount. */
    await expect(page.getByTestId("welcome-route-root")).toHaveCount(0);

    /* App shell should mount instead. */
    const shell = page.getByTestId("app-shell");
    await expect(shell).toBeVisible({ timeout: 2000 });

    const elapsed = Date.now() - start;
    expect.soft(elapsed).toBeLessThan(2000);
  });
});
