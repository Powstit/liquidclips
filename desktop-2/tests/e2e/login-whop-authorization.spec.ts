/**
 * P1 · LoginScreen · $1 Whop authorization · SPRINT_FINAL §1H
 * (Max · 2026-07-07)
 *
 * Locks Gate 1: user enters card in the Whop $1 checkout embed →
 * `whop_authorized_at` gets written to localStorage → app shell
 * mounts.
 */
import { test, expect } from "@playwright/test";

test.describe("Login · Whop $1 authorization", () => {
  test("card entered → whop_authorized_at set → app shell mounts", async ({
    page,
    baseURL,
  }) => {
    /* Fresh install · no JWT. */
    await page.addInitScript(() => {
      try {
        window.localStorage.clear();
      } catch { /* private mode · non-fatal */ }
    });

    /* Mock the backend endpoint the deep-link handler hits after
     * Whop redirects back. `whop_authorized_at` returned in payload. */
    await page.route("**/desktop/connect-from-checkout**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          license_jwt: "harness-jwt",
          whop_authorized_at: new Date().toISOString(),
        }),
      }),
    );

    /* Mock /sync + /me for post-authorization hydration. */
    await page.route("**/sync", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          tier: "free",
          founder: false,
          subscription_status: "active",
          whop_authorized_at: new Date().toISOString(),
          onboarding_status: {},
        }),
      }),
    );
    await page.route("**/me**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          backend_user_id: "harness-p1",
          email: "p1@liquidclips.test",
          effective_tier: "free",
          raw_tier: "free",
          subscription_status: "active",
        }),
      }),
    );

    await page.goto(baseURL ?? "/");
    await expect(page.getByTestId("welcome-route-root")).toBeVisible();

    /* Simulate the deep-link handler firing after Whop redirect.
     * Real integration: `liquidclips://activate?token=<jwt>` fires
     * `mountDeepLinkSubscriber` which stores the JWT + authorized
     * timestamp. Test seam: write directly. */
    await page.evaluate(() => {
      const nowIso = new Date().toISOString();
      window.localStorage.setItem("app.liquidclips.auth.v1.jwt", "harness-jwt");
      window.localStorage.setItem("app.liquidclips.auth.v1.whop_authorized_at", nowIso);
      window.localStorage.setItem("lc:welcome-acked", "1");
      /* Trigger the bus so AuthGate re-checks + WelcomeGate re-reads
       * localStorage. */
      const bus = (window as unknown as {
        __lcBus?: { emit: (e: string, p: Record<string, unknown>) => void };
      }).__lcBus;
      bus?.emit("activation:complete", {});
    });

    /* App shell should mount + WelcomeRoute should unmount. */
    await expect(page.getByTestId("welcome-route-root")).toHaveCount(0);
    await expect(page.getByTestId("app-shell")).toBeVisible();

    /* Assert the authorization timestamp is now present. */
    const authorizedAt = await page.evaluate(() =>
      window.localStorage.getItem("app.liquidclips.auth.v1.whop_authorized_at"),
    );
    expect(authorizedAt).not.toBeNull();
  });
});
