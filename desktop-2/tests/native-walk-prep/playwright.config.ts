/**
 * Native Walk Prep · Playwright config.
 *
 * Runs the five native-walk-prep spec files against a Vite dev server that
 * is ALREADY running externally on port 5173 (started by the walk harness
 * OR `pnpm dev` in desktop-2/). No webServer block · we reuse the running
 * process so the spec sees the same env the harness booted.
 *
 * Capture artifacts land under `lcos/reports/golden-path/capture/<journey>/`
 * per the golden-path convention.
 *
 * These specs are DOCS+SCRIPTS + `test.skip` blocks. They do NOT modify
 * production code · they exist to codify the manual walk into a repeatable
 * pass/skip receipt.
 *
 * Usage:
 *   cd desktop-2
 *   npx playwright test --config=tests/native-walk-prep/playwright.config.ts
 */
import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const HERE = dirname(__filename);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: HERE,
  testMatch: /j0(04|05|06|07|15)-.*\.spec\.ts$/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    trace: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "native-walk-prep-chromium",
      use: { browserName: "chromium" },
    },
  ],
});
