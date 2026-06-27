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

const PORT = 1420;
const BASE_URL = `http://localhost:${PORT}`;
const USE_PRODUCTION_PREVIEW = process.env.PW_USE_PREVIEW === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts$/,
  // 2026-06-23 monetisation pass · bumped from 60s to 90s after several
  // multi-route walks (brand-consistency, watermark-proof) crept past
  // the prior limit. The new AgencyPreviewBanner adds modest per-route
  // mount overhead in clipper mode and slightly more in agency mode;
  // the aggregate is small per-route but pushes long walks (9+ routes)
  // close to the boundary. 90s leaves comfortable headroom without
  // masking real regressions — individual assertions still time out
  // at the default 8s if a locator never resolves.
  timeout: 90_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Launch gates must pass first try. Pointer interception and cold-route
  // timing are defects to fix, not failures to hide with retry.
  retries: 0,
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
    actionTimeout: 8_000,
  },
  webServer: {
    command: USE_PRODUCTION_PREVIEW
      ? `npm run preview -- --host 127.0.0.1 --port ${PORT}`
      : "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
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
