/**
 * Golden Path Proof · Playwright config.
 *
 * Runs the walk.spec.ts against a Vite dev server that's ALREADY
 * running externally (started by the harness on port 5173). No
 * webServer block — we reuse the running process so the walk sees
 * the exact env the harness booted.
 */
import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const HERE = dirname(__filename);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: HERE,
  testMatch: /walk\.spec\.ts$/,
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
      name: "golden-path-chromium",
      use: { browserName: "chromium" },
    },
  ],
});
