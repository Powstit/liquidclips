/**
 * LC-UI-P0-BOOT · Gate 4 Proof · Agency Campaign Flow
 *
 * Before the fix in Campaigns.tsx the AgencyCreationFlow mount was
 * gated by `canWriteAgency`. Below-Agency users still saw the
 * "Draft campaign" CTA but clicking it flipped state with no drawer
 * in the tree — a silent no-op. The Gate 4 fix removes that mount
 * gate so every tier can open the drawer; publish remains paywalled
 * via PaywallGate at StepReviewPublish.
 *
 * This spec asserts:
 *   1. A non-Agency user (fixture-fallback "pro" tier in test env)
 *      sees the "Draft campaign" CTA on the Campaigns route.
 *   2. Clicking the CTA opens the AgencyCreationFlow drawer
 *      (rendered by Drawer with data-drawer-id="agency-creation-flow").
 *   3. The drawer's shell `.lc-acf` is visible.
 *   4. No console errors fire during the click.
 *
 * The publish-paywall coverage already lives in Gate 3 (PaywallGate
 * isMock short-circuit + outcome.ok handling). This spec proves only
 * the drawer-open contract.
 */
import { test, expect } from "@playwright/test";
import { installBackendStubs } from "./fixtures/backendFixtures";
import { seedAuthenticatedShell, isHarnessNoiseConsoleError } from "./_auth-harness";

test("LC-UI-P0-G4-001 · Campaigns · clipper/non-agency user · Draft campaign opens drawer", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") {
      const txt = m.text();
      if (isHarnessNoiseConsoleError(txt)) return;
      consoleErrors.push(`console.error: ${txt.slice(0, 200)}`);
    }
  });

  /* D1 (2026-07-12) · canonical auth harness seed BEFORE
   * installBackendStubs. Both agree on tier=pro so the harness /me +
   * /sync mocks stay consistent with the fixtures stub layer. */
  await seedAuthenticatedShell(page, { tier: "pro" });
  await installBackendStubs(page, { tier: "pro" });

  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("lc.mode", "clipper");
    } catch { /* noop */ }
  });

  await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
  /* Wait for the AppShell to mount · same pattern as agency-launch-readiness. */
  await page.waitForSelector(".lc-app", { timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __lcBus?: unknown };
      return !!w.__lcBus;
    },
    { timeout: 5_000 },
  );
  /* Nav via the bus so the route change actually fires through the
   * design-os router instead of fighting a JWT-rejection-induced
   * redirect to home. */
  await page.evaluate(() => {
    const w = window as unknown as { __lcBus?: { emit: (e: string, p: unknown) => void } };
    w.__lcBus?.emit?.("nav:click", { route: "campaigns" });
  });
  const cta = page.locator("button.lc-campaigns-create-cta");
  await expect(cta).toBeVisible({ timeout: 30_000 });

  /* Confirm this is the lower-tier "Draft" path, not the Agency
   * "Create" path · the gate distinction is the whole reason this
   * test exists. */
  const ariaLabel = (await cta.getAttribute("aria-label")) ?? "";
  expect(ariaLabel.toLowerCase()).toContain("draft campaign");
  const ctaText = (await cta.textContent()) ?? "";
  expect(ctaText.toLowerCase()).toContain("draft campaign");

  await cta.click();

  /* The drawer mounts inside <Drawer id="agency-creation-flow"> which
   * renders the wrapper with data-drawer-id. Before Gate 4 this never
   * appeared in the tree for non-Agency users. */
  const drawer = page.locator('[data-drawer-id="agency-creation-flow"]');
  await expect(drawer).toBeVisible({ timeout: 4_000 });
  await expect(drawer.locator(".lc-acf").first()).toBeVisible({ timeout: 1_000 });

  /* No fatal console errors during the click + drawer mount. */
  expect(consoleErrors).toEqual([]);
});
