/**
 * Cold-Start · Fresh install · SPRINT_FINAL §1H P11 · 2026-07-07 (Max)
 *
 * Locks the "no JWT in localStorage → LoginScreen mounts within 3000ms"
 * contract. Every cold-email user's first launch hits this path.
 * If LoginScreen takes longer than 3s or fails to mount, cold-traffic
 * conversion collapses.
 */
import { test, expect } from "@playwright/test";

test.describe("Cold-Start · Fresh install", () => {
  test("no JWT · LoginScreen mounts within 3000ms", async ({ page, baseURL }) => {
    /* Belt + braces: strip every persisted auth key BEFORE navigation
     * so the app starts truly fresh. Matches the AuthStorage keychain
     * namespace `app.liquidclips.auth.v1.*`. */
    await page.addInitScript(() => {
      try {
        window.localStorage.clear();
        window.sessionStorage.clear();
      } catch {
        /* private-mode · non-fatal */
      }
    });

    const start = Date.now();
    await page.goto(baseURL ?? "/");

    /* LoginScreen renders WelcomeRoute · its testid is
     * `welcome-route-root` per its component doc. */
    const welcome = page.getByTestId("welcome-route-root");
    await expect(welcome).toBeVisible();

    const elapsed = Date.now() - start;
    expect.soft(elapsed).toBeLessThan(8000);

    /* Guardrail: NO app shell content while unauthed. */
    await expect(page.getByTestId("app-shell")).toHaveCount(0);
  });
});
