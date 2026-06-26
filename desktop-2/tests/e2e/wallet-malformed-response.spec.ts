/**
 * LC-UI-P0-G9-001 · Wallet panel survives malformed /me/wallet/summary
 *
 * Discovered during the Gate-9 authenticated audit (2026-06-26): a 200
 * response with an empty body crashed WalletPanel on
 * `stats.total_submissions` because the destructure assumed every
 * top-level block exists. A real backend partial-deploy or schema
 * mistake would have shipped this crash to users.
 *
 * Fix: `getWalletSummary` validates the response shape and returns
 * null on malformed JSON; the panel renders the offline state. This
 * spec proves the guard holds.
 */
import { test, expect } from "@playwright/test";
import { installBackendStubs } from "./fixtures/backendFixtures";

test("LC-UI-P0-G9-001 · WalletPanel · 200 with malformed /me/wallet/summary · no crash · offline state visible", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") {
      const txt = m.text();
      /* tauri-adapter / favicon / sourcemap warnings are irrelevant to
       * this guard. Wallet's own "malformed shape" warn is EXPECTED. */
      if (/tauri-adapter|favicon|sourcemap|malformed shape/i.test(txt)) return;
      consoleErrors.push(`console.error: ${txt.slice(0, 200)}`);
    }
  });

  await installBackendStubs(page, { tier: "pro", walletMalformed: true });
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("lc.license.jwt.v1", "harness.fake.jwt");
      window.localStorage.setItem("lc.mode", "clipper");
    } catch { /* noop */ }
  });

  await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".lc-app", { timeout: 30_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { __lcBus?: unknown }).__lcBus,
    { timeout: 5_000 },
  );

  /* Navigate to Earn via the bus. */
  await page.evaluate(() => {
    const w = window as unknown as { __lcBus?: { emit: (e: string, p: unknown) => void } };
    w.__lcBus?.emit?.("nav:click", { route: "earn" });
  });

  /* The wallet-panel should mount in the offline data-state · NOT crash.
   * The offline state has data-testid="wallet-offline-state" inside
   * the panel. */
  const panel = page.locator('[data-testid="wallet-panel"]');
  await expect(panel).toBeVisible({ timeout: 8_000 });
  const state = await panel.getAttribute("data-state");
  /* Either "loading" (briefly) then "offline", or directly "offline".
   * If it's "loading" still, wait for the next state transition. */
  if (state === "loading") {
    await expect(panel).toHaveAttribute("data-state", "offline", { timeout: 8_000 });
  } else {
    expect(["offline", "loading"]).toContain(state ?? "");
  }
  await expect(panel).toHaveAttribute("data-state", "offline", { timeout: 8_000 });

  const offlineState = page.locator('[data-testid="wallet-offline-state"]');
  await expect(offlineState).toBeVisible({ timeout: 4_000 });

  /* No React render crash · the EngineErrorBoundary would have caught
   * the prior TypeError and surfaced "boundary caught" in console.error.
   * Belt + braces: assert no pageerror about total_submissions. */
  expect(pageErrors.filter((e) => /total_submissions|Cannot read properties of undefined/i.test(e))).toEqual([]);
  expect(consoleErrors.filter((e) => /boundary caught|WalletPanel/i.test(e))).toEqual([]);
});
