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

test("LC-UI-P0-G4-001 · Campaigns · clipper/non-agency user · Draft campaign opens drawer", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") {
      const txt = m.text();
      if (/tauri-adapter|favicon|sourcemap/i.test(txt)) return;
      consoleErrors.push(`console.error: ${txt.slice(0, 200)}`);
    }
  });

  /* Stub /me + /sync so the JWT doesn't get rejected and the AuthGate
   * lets us land inside the real AppShell. The user's effective_tier
   * is "pro" — below Agency — which is exactly the case where the
   * Draft-campaign-button-but-no-drawer silent-success bug fired. */
  const me = {
    user: { id: "harness", email: "harness@liquidclips.app", tier: "pro" },
    tier: "pro", effective_tier: "pro", raw_tier: "pro",
  };
  const sync = { tier: "pro", caps: {} };
  await page.route(/api\.liquidclips\.app\//, (r) => {
    if (r.request().method() === "GET") return r.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    return r.continue();
  });
  await page.route(/api\.liquidclips\.app\/sync(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sync) }));
  await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(me) }));

  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("lc.license.jwt.v1", "harness.fake.jwt");
      window.localStorage.setItem("lc.mode", "clipper");
    } catch { /* noop */ }
  });

  await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
  /* Wait for the AppShell to mount · same pattern as agency-launch-readiness. */
  await page.waitForSelector(".lc-app", { timeout: 15_000 });
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
  await page.waitForSelector('[data-testid="campaigns-stage"]', { timeout: 15_000 });

  const cta = page.locator("button.lc-campaigns-create-cta");
  await expect(cta).toBeVisible({ timeout: 5_000 });

  /* Confirm this is the lower-tier "Draft" path, not the Agency
   * "Create" path · the gate distinction is the whole reason this
   * test exists. */
  const ariaLabel = (await cta.getAttribute("aria-label")) ?? "";
  expect(ariaLabel.toLowerCase()).toContain("draft campaign");
  const ctaText = (await cta.textContent()) ?? "";
  expect(ctaText.toLowerCase()).toContain("draft campaign");

  /* Dispatch the click directly on the element · the design-os mounts
   * a transparent overlay layer (BrowserScrim/InvadersOverlay) that can
   * intercept pointer events during boot. Synthetic click bypasses
   * pointer-events without lying about the handler firing — React's
   * onClick still runs. */
  await cta.evaluate((el) => (el as HTMLButtonElement).click());

  /* The drawer mounts inside <Drawer id="agency-creation-flow"> which
   * renders the wrapper with data-drawer-id. Before Gate 4 this never
   * appeared in the tree for non-Agency users. */
  const drawer = page.locator('[data-drawer-id="agency-creation-flow"]');
  await expect(drawer).toBeVisible({ timeout: 4_000 });
  await expect(drawer.locator(".lc-acf").first()).toBeVisible({ timeout: 1_000 });

  /* No fatal console errors during the click + drawer mount. */
  expect(consoleErrors).toEqual([]);
});
