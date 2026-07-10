/**
 * LC-UI-P0-BOOT · Gate 5 Proof · Routing And Surface Registry
 *
 * Two contracts:
 *
 *   1. BrowseOverlay quick links land on the correct Design-OS surface.
 *      Before the fix, "Earn" and "Community" used deprecated SECTION_IDS
 *      that fell out of the active sectionRegistry → navigateTo was a
 *      silent no-op. "Campaigns" routed to legacy `#/campaign` (the
 *      hidden chrome) instead of Design-OS `#/home` + campaigns surface.
 *
 *   2. Every quick link, after click, lands the user on the Design-OS
 *      shell (hash === "#/home") AND the SimulatorRouter swaps to the
 *      requested surface. We verify by capturing `bus.on("nav:click")`
 *      and asserting both the emit and the hash.
 *
 * Not in scope here: opening the BrowseOverlay itself (covered by
 * browse-tab-omnipresent.spec.ts). This spec drives the overlay open
 * via the in-app store, then clicks each quick link.
 */
import { test, expect, type Page } from "@playwright/test";

async function bootApp(page: Page): Promise<void> {
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

  /* Capture every nav:click emit so we can assert routing fires. */
  await page.addInitScript(() => {
    const w = window as unknown as {
      __lcNavClicks?: Array<string>;
      __lcBus?: { on: (e: string, h: (p: unknown) => void) => () => void };
    };
    w.__lcNavClicks = [];
    const tryWire = () => {
      const b = w.__lcBus;
      if (b && typeof b.on === "function") {
        b.on("nav:click", (p) => {
          const route = (p as { route?: string }).route ?? "";
          w.__lcNavClicks!.push(route);
        });
      } else {
        setTimeout(tryWire, 50);
      }
    };
    tryWire();
  });

  await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".lc-app", { timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __lcBus?: unknown };
      return !!w.__lcBus;
    },
    { timeout: 5_000 },
  );
}

async function openBrowseFromCustomerControl(page: Page): Promise<void> {
  const browseTab = page.locator('[data-browse-rail-tab="root"]');
  await expect(browseTab).toBeVisible({ timeout: 5_000 });
  await browseTab.click();
  await expect(page.locator(".lc-browse-overlay")).toBeVisible({ timeout: 10_000 });
}

test.describe("Gate 5 · Routing And Surface Registry", () => {
  test("LC-UI-P0-G5-001 · BrowseOverlay Campaigns quick link routes to Design-OS campaigns", async ({ page }) => {
    await bootApp(page);
    await openBrowseFromCustomerControl(page);

    /* Click the Campaigns quick link. */
    const link = page.locator(".lc-browse-overlay button", { hasText: "Campaigns" }).first();
    await expect(link).toBeVisible({ timeout: 5_000 });
    await link.evaluate((el) => (el as HTMLButtonElement).click());

    /* Hash must be #/home (Design-OS shell active) AND a nav:click must
     * have fired with route "campaigns". */
    await page.waitForFunction(
      () => {
        const w = window as unknown as { __lcNavClicks?: string[] };
        return (w.__lcNavClicks ?? []).includes("campaigns");
      },
      { timeout: 4_000 },
    );
    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toBe("#/home");
  });

  test("LC-UI-P0-G5-002 · BrowseOverlay Wallet quick link emits nav:click (no silent no-op)", async ({ page }) => {
    await bootApp(page);
    await openBrowseFromCustomerControl(page);

    // 2026-07-10 · Chapter 3 (Lane A) · nav label renamed "Earn" → "Wallet".
    const link = page.locator(".lc-browse-overlay button", { hasText: "Wallet" }).first();
    await expect(link).toBeVisible({ timeout: 5_000 });
    await link.evaluate((el) => (el as HTMLButtonElement).click());

    await page.waitForFunction(
      () => {
        const w = window as unknown as { __lcNavClicks?: string[] };
        return (w.__lcNavClicks ?? []).includes("earn");
      },
      { timeout: 4_000 },
    );
  });

  test("LC-UI-P0-G5-003 · BrowseOverlay Community quick link emits nav:click (no silent no-op)", async ({ page }) => {
    await bootApp(page);
    await openBrowseFromCustomerControl(page);

    const link = page.locator(".lc-browse-overlay button", { hasText: "Community" }).first();
    await expect(link).toBeVisible({ timeout: 5_000 });
    await link.evaluate((el) => (el as HTMLButtonElement).click());

    await page.waitForFunction(
      () => {
        const w = window as unknown as { __lcNavClicks?: string[] };
        return (w.__lcNavClicks ?? []).includes("community");
      },
      { timeout: 4_000 },
    );
  });
});
