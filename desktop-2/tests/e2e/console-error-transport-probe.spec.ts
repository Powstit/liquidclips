/**
 * console-error transport probe · 2026-07-13.
 *
 * Companion guard for the button-audit console-error filter. The audit
 * ignores the browser-level "Failed to load resource: 503" log ONLY when
 * cross-referenced against a known-mock harness endpoint response, and
 * ignores keepalive telemetry noise via the `__LCOS_E2E__` gate wired in
 * `diagnosticLogger.ts`. Both scopes are narrow by design.
 *
 * This probe proves the scope is honest: a REAL unrelated network error
 * (unresolvable host, an unmocked URL, or an explicit console.error) MUST
 * still reach the audit's console-error stream. If any assertion here
 * fails, the audit's filter has widened past the exact-endpoint /
 * exact-signature guarantees documented in
 * `tests/e2e/button-audit.spec.ts:272-324`.
 *
 * Do NOT delete this probe. It is the safety net for the
 * `harnessMock503Count` counter and the `isE2ETransportDisabled()` gate.
 */
import { test, expect } from "@playwright/test";
import { installBackendStubs } from "./fixtures/backendFixtures";
import { harnessAssertShell, seedAuthenticatedShell } from "./_auth-harness";

test.describe.configure({ mode: "serial", retries: 0 });

test("probe · unmocked network error still surfaces as console error", async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000);
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") {
      const txt = m.text();
      /* Same noise filter the button-audit uses. */
      if (/tauri-adapter|favicon|sourcemap/i.test(txt)) return;
      consoleErrors.push(txt.slice(0, 200));
    }
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await seedAuthenticatedShell(page, { tier: "pro" });
  await installBackendStubs(page, { tier: "pro" });
  await page.addInitScript(() => {
    try { window.localStorage.setItem("lc.mode", "clipper"); } catch { /* noop */ }
  });
  await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
  await harnessAssertShell(page);
  await page.waitForSelector(".lc-app", { timeout: 30_000 });
  /* Let a few flush intervals pass so any latent telemetry activity
   * would have surfaced before we count. Diagnostic logger's 2s flush
   * interval times two, plus safety. */
  await page.waitForTimeout(5_000);

  const errorsBeforeProbe = consoleErrors.length;

  /* Probe 1 · unresolvable hostname · triggers Chrome's "Failed to load
   * resource: net::ERR_NAME_NOT_RESOLVED" log which the audit MUST count. */
  await page.evaluate(async () => {
    try {
      await fetch("https://unmocked-host-does-not-exist.example.invalid/probe", {
        method: "GET",
      });
    } catch (e) {
      console.error("PROBE_1_FETCH_FAILED:", (e as Error).message);
    }
  });
  await page.waitForTimeout(500);

  /* Probe 2 · explicit console.error with a signature outside every
   * ignore-list regex. Proves the audit doesn't accidentally swallow
   * arbitrary developer-flagged errors. */
  await page.evaluate(() => {
    console.error("PROBE_2_UNEXPECTED_STATE:", "arbitrary developer-flagged error");
  });
  await page.waitForTimeout(200);

  const errorsAfterProbe = consoleErrors.length;
  const newErrors = consoleErrors.slice(errorsBeforeProbe);

  const foundProbe1Fetch = newErrors.some((e) => /ERR_NAME_NOT_RESOLVED/.test(e));
  const foundProbe1Explicit = newErrors.some((e) => e.includes("PROBE_1_FETCH_FAILED"));
  const foundProbe2 = newErrors.some((e) => e.includes("PROBE_2_UNEXPECTED_STATE"));

  expect(
    foundProbe1Fetch,
    "browser-level ERR_NAME_NOT_RESOLVED from a genuine unresolvable host must reach the audit stream (unrelated to the harness-mocked 503 filter)",
  ).toBe(true);
  expect(
    foundProbe1Explicit,
    "explicit console.error from the probe fetch's catch block must reach the audit stream",
  ).toBe(true);
  expect(
    foundProbe2,
    "arbitrary console.error must reach the audit stream (proves neither __LCOS_E2E__ nor the 503 counter accidentally swallows unrelated errors)",
  ).toBe(true);
});
