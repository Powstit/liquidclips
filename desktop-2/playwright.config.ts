/**
 * Playwright config · USER-LENS AUTOMATION GATE (BUG-032 P0)
 *
 * Drives the Vite dev server (port 1420) — the Tauri webview path is
 * heavier and platform-fragile for fast feedback. Production Tauri APIs
 * (plugin-fs, convertFileSrc, etc.) are runtime-detected in the app code
 * and degrade to web equivalents in this test context.
 *
 * Verdicts are emitted to `tests/e2e/verdicts/` by the custom reporter.
 */
import { defineConfig } from "@playwright/test";

// Worktree-safe: parallel local agents must not silently reuse another
// checkout's Vite server on 1420. Set PW_PORT per worktree (for example
// PW_PORT=1431) so screenshots and assertions always exercise the code
// under test rather than whichever server happened to bind first.
const PORT = Number(process.env.PW_PORT ?? 1420);
const BASE_URL = `http://localhost:${PORT}`;
const USE_PRODUCTION_PREVIEW = process.env.PW_USE_PREVIEW === "1";

// 2026-07-07 · Cal.com pattern (calcom/cal.com playwright.config.ts).
// Vite dev cold-compile of the full AppShell chunk tree can take 10-30s
// on first hit per test. Tight local budgets caused sprint-final specs
// to flake against Vite dev even when the product worked. Follow the
// proven pattern: generous local timeouts (dev-server realistic),
// tight CI timeouts (packaged build fast). Cal.com's exact numbers:
// 120s local action, 240s local test, 10s CI everything.
const CI = !!process.env.CI;
const DEFAULT_NAVIGATION_TIMEOUT = CI ? 10_000 : 120_000;
const DEFAULT_EXPECT_TIMEOUT = CI ? 10_000 : 120_000;
const DEFAULT_ACTION_TIMEOUT = CI ? 10_000 : 120_000;
const DEFAULT_TEST_TIMEOUT = CI ? 60_000 : 240_000;

export default defineConfig({
  // 2026-06-30 · widened from ./tests/e2e so the new tests/visual/
  // baseline suite is also discovered by the same `npx playwright test`
  // invocation. testMatch (recursive .spec.ts) does the rest. The e2e +
  // visual suites still share the same Vite dev server.
  testDir: "./tests",
  testMatch: /.*\.spec\.ts$/,
  // 2026-06-30 · centralise toHaveScreenshot baselines under tests/visual/
  // baselines/ regardless of which spec creates them, so the visual
  // anchor folder Daniel asked for is the single discoverable source
  // of truth. Only tests/visual/workstation.spec.ts uses toHaveScreenshot
  // today; existing e2e suites take explicit page.screenshot() paths.
  snapshotPathTemplate: "{testDir}/visual/baselines/{arg}{ext}",
  timeout: DEFAULT_TEST_TIMEOUT,
  expect: { timeout: DEFAULT_EXPECT_TIMEOUT },
  fullyParallel: false,
  forbidOnly: CI,
  // Cal.com retries 2 on CI (packaged-build flake), 0 local (fast fail
  // for real regressions).
  retries: CI ? 2 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["./tests/e2e/verdict-reporter.ts"],
  ],
  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    actionTimeout: DEFAULT_ACTION_TIMEOUT,
    navigationTimeout: DEFAULT_NAVIGATION_TIMEOUT,
  },
  webServer: {
    command: USE_PRODUCTION_PREVIEW
      ? `npm run preview -- --host 127.0.0.1 --port ${PORT}`
      : `VITE_DEV_PORT=${PORT} npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
    // 2026-07-12 · Phase-2 env override. `.env.local` (Path 1 crew proof,
    // 2026-07-10) sets VITE_BACKEND_URL=http://localhost:8000 for local
    // dev + crew testing. Every Playwright spec's auth harness mocks the
    // canonical api.liquidclips.app URL — so any local .env.local
    // override causes the mocks to miss and floods the console with
    // CORS + connection-refused errors, corrupting the D1 baseline.
    //
    // This webServer.env forces the canonical URL for the Playwright-
    // owned Vite instance only. `.env.local` stays unchanged so daily
    // dev + crew proof workflow keep working outside Playwright.
    env: {
      VITE_BACKEND_URL: "https://api.liquidclips.app",
    },
  },
  projects: [
    {
      name: "user-lens-chromium",
      use: {
        // Use the headless shell channel (smaller download, faster).
        browserName: "chromium",
      },
    },
  ],
});
