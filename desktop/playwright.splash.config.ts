import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 1432;

export default defineConfig({
  testDir: "./tests",
  testMatch: /splash-stage\.spec\.ts/,
  outputDir: join(tmpdir(), "liquidclips-splash-stage-results"),
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `vite --config playwright.splash.vite.config.ts --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/tests/splash-stage-harness.html`,
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_SPLASH_STAGE_TEST: "1",
    },
    timeout: 120_000,
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: "mobile",
      use: {
        channel: "chrome",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
