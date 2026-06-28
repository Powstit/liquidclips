import { test, expect } from "@playwright/test";
import { installBackendStubs } from "./fixtures/backendFixtures";

test("Home My Clips command opens the workstation", async ({ page }) => {
  await installBackendStubs(page, { tier: "pro" });
  await page.addInitScript(() => {
    window.localStorage.setItem("lc.license.jwt.v1", "harness.fake.jwt");
    window.localStorage.setItem("lc.mode", "clipper");
  });

  await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
  const command = page.getByTestId("home-command-library");
  await expect(command).toBeVisible({ timeout: 15_000 });
  await command.click();
  await expect(page.locator('.lc-app[data-route="workstation"]')).toBeVisible();
});
