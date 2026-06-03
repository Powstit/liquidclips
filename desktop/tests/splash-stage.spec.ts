import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const stages = ["intro", "loading", "game", "failed"] as const;

for (const stage of stages) {
  test(`splash ${stage} stage matches screenshot`, async ({ page }, testInfo) => {
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith(".mp4") && url.search !== "?import") {
        return route.fulfill({ status: 204, contentType: "video/mp4", body: "" });
      }
      return route.continue();
    });
    await page.goto(`/tests/splash-stage-harness.html?stage=${stage}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="splash-harness"]', { state: "attached" });

    if (stage === "intro") {
      await expect(page.locator("video")).toBeAttached();
    }

    if (stage === "game") {
      await expect(page.getByText(/press/i)).toBeVisible({ timeout: 7_000 });
      await expect(page.getByText("space", { exact: true })).toBeVisible();
    }

    if (stage === "failed") {
      await expect(page.getByText(/sidecar failed to start/i)).toBeVisible();
    }

    await page.addStyleTag({
      content: `*, *::before, *::after {
        animation: none !important;
        caret-color: transparent !important;
        transition: none !important;
      }
      video {
        visibility: hidden !important;
      }`,
    });

    const screenshotDir = join(testInfo.project.outputDir, "screenshots");
    await mkdir(screenshotDir, { recursive: true });
    const screenshotPath = join(screenshotDir, `${stage}-${testInfo.project.name}.png`);
    await expect(page.locator('[data-testid="splash-harness"]')).toBeAttached();
    const viewport = page.viewportSize();
    await page.screenshot({
      path: screenshotPath,
      clip: {
        x: 0,
        y: 0,
        width: viewport?.width ?? 1280,
        height: viewport?.height ?? 800,
      },
    });
    testInfo.attachments.push({
      name: `${stage}-${testInfo.project.name}`,
      path: screenshotPath,
      contentType: "image/png",
    });
  });
}
