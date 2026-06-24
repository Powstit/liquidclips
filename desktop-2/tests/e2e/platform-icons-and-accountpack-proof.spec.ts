/**
 * Platform icons + accountpack CTA · screenshot proof
 *
 * Captures visual proof for the 2026-06-23 monetisation pass:
 *   1. PlatformBadgePicker visible in ClipPreviewShell right rail (editor)
 *   2. Picker toggle updates state + emits clip:platforms-change
 *   3. ClipCard grid chips render brand SVG glyphs (not text letters)
 *   4. Channels at-cap (clipper, 1/1) shows +$6/mo accountpack CTA
 *
 * Not in verify-app aggregator — fires on demand for review screenshots.
 */

import { test, expect, type Page } from "@playwright/test";

const FIXTURE_SLUG = "uncle-daniel-clip-squad-2026";

async function interceptBackend(page: Page) {
  // Match the real /me backend response shape (MeBackendResponse) so
  // useTierCaps resolves tier from `effective_tier` correctly.
  const successMe = {
    user: { id: "harness", email: "harness@liquidclips.test" },
    effective_tier: "free",
    subscription_status: null,
    tier: "free",
  };
  const successSync = { tier: "free", caps: { watermarkLocked: true } };
  await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(successMe) }),
  );
  await page.route(/api\.liquidclips\.app\/sync(\?.*)?$/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(successSync) }),
  );
  await page.route(/api\.liquidclips\.app\//, (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    return route.continue();
  });
}

async function seedCompletedSession(page: Page) {
  await page.addInitScript((slug) => {
    try {
      const now = new Date().toISOString();
      window.localStorage.setItem("lc.license.jwt.v1", "harness.fake.jwt");
      window.localStorage.setItem(
        "lc:engine:session:v1",
        JSON.stringify({
          source: "platform-icons-proof.test.mp4",
          slug,
          status: "complete",
          percent: 1,
          stage: "thumbs",
          runtimeMode: "mock",
          startedAt: now,
          updatedAt: now,
        }),
      );
      window.localStorage.setItem("lc.dock.open", "1");
    } catch { /* ignore quota */ }
  }, FIXTURE_SLUG);
}

test.describe("Platform icons + accountpack proof", () => {
  test("editor picker visible in ClipPreviewShell right rail", async ({ page }) => {
    await interceptBackend(page);
    await seedCompletedSession(page);
    await page.goto("/?skipIntro=1#/workstation", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="clip-card"]', { timeout: 20_000 });

    const picker = page.getByTestId("cps-platform-picker");
    await expect(picker).toBeVisible({ timeout: 10_000 });

    await page.screenshot({
      path: "/tmp/proof-01-editor-picker.png",
      fullPage: false,
    });
  });

  test("picker toggle (YouTube) flips data-active state", async ({ page }) => {
    await interceptBackend(page);
    await seedCompletedSession(page);
    await page.goto("/?skipIntro=1#/workstation", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="clip-card"]', { timeout: 20_000 });

    const picker = page.getByTestId("cps-platform-picker");
    await expect(picker).toBeVisible({ timeout: 10_000 });

    const ytChip = picker.locator('[data-platform="youtube"]');
    await expect(ytChip).toBeVisible();
    const before = await ytChip.getAttribute("data-active");
    await ytChip.click();
    await page.waitForTimeout(400);
    const after = await ytChip.getAttribute("data-active");
    expect(after).not.toBe(before);

    await page.screenshot({
      path: "/tmp/proof-02-picker-toggled.png",
      fullPage: false,
    });
  });

  test("ClipCard grid chips render brand SVG glyphs", async ({ page }) => {
    await interceptBackend(page);
    await seedCompletedSession(page);
    await page.goto("/?skipIntro=1#/workstation", { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="clip-card"]', { timeout: 20_000 });
    await page.waitForTimeout(500);

    // Grid chips should contain <svg> elements (brand glyphs), not text.
    const platformChipsWithSvg = await page.locator(".lc-clip-platform svg").count();
    // We expect AT LEAST one brand SVG in the grid (fixtures seed platforms).
    expect(platformChipsWithSvg).toBeGreaterThan(0);

    await page.screenshot({
      path: "/tmp/proof-03-grid-card-brand-glyphs.png",
      fullPage: false,
    });
  });

  test("Channels default · clipper 0 of 1 channel slots", async ({ page }) => {
    await interceptBackend(page);
    await seedCompletedSession(page);
    await page.goto("/?skipIntro=1#/channels", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    // Force tier to clipper via the test seam — useMe's fixture-fallback
    // defaults to "pro" in test mode which would mask the free-tier cap.
    await page.evaluate(() => {
      // @ts-expect-error window.__lcDebugSetTier added by useTierCaps
      window.__lcDebugSetTier?.("clipper");
    });
    await page.waitForTimeout(800);

    const stripHeader = page.locator(".lc-pls-h").first();
    await expect(stripHeader).toBeVisible();
    const txt = await stripHeader.textContent();
    expect(txt ?? "").toMatch(/of\s+1/);

    await page.screenshot({
      path: "/tmp/proof-04-channels-default.png",
      fullPage: false,
    });
  });

  test("Channels at-cap (1/1) shows +$6/mo accountpack CTA", async ({ page }) => {
    await interceptBackend(page);
    await seedCompletedSession(page);

    // Seed the channel state + tier override BEFORE useChannels.list()
    // fires for the first time. The seams are registered at module load;
    // a poller below waits for them, calls them, then disconnects.
    await page.addInitScript(() => {
      const TARGET_CHANNELS = [{
        id: "fake-1",
        platform: "youtube",
        label: "YouTube · @HarnessChannel",
        handle: "@HarnessChannel",
        status: "connected",
        brandId: "harness-brand",
        brandLabel: "Harness",
        tierRequirement: "clipper",
      }];
      let seededTier = false;
      let seededChannels = false;
      const poller = setInterval(() => {
        const w = window as unknown as {
          __lcDebugSeedChannels?: (chs: unknown[], src?: string) => void;
          __lcDebugSetTier?: (t: string) => void;
        };
        if (!seededTier && typeof w.__lcDebugSetTier === "function") {
          w.__lcDebugSetTier("clipper");
          seededTier = true;
        }
        if (!seededChannels && typeof w.__lcDebugSeedChannels === "function") {
          w.__lcDebugSeedChannels(TARGET_CHANNELS, "real-http");
          seededChannels = true;
        }
        if (seededTier && seededChannels) clearInterval(poller);
      }, 20);
      // Hard cap so this doesn't run forever if the seam never registers.
      setTimeout(() => clearInterval(poller), 5000);
    });

    await page.goto("/?skipIntro=1#/channels", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    // Re-assert tier + seed channels + trigger reload after initial mount.
    const debugState = await page.evaluate(async () => {
      const w = window as unknown as {
        __lcDebugSetTier?: (t: string) => void;
        __lcDebugSeedChannels?: (chs: unknown[], src?: string) => void;
        __lcDebugReloadChannels?: () => Promise<void>;
        __lcDebugChannelState?: { channels: unknown[]; forcedSource?: string };
      };
      w.__lcDebugSetTier?.("clipper");
      w.__lcDebugSeedChannels?.([{
        id: "fake-1",
        platform: "youtube",
        label: "YouTube · @HarnessChannel",
        handle: "@HarnessChannel",
        status: "connected",
        brandId: "harness-brand",
        brandLabel: "Harness",
        tierRequirement: "clipper",
      }], "real-http");
      const stateAfterSeed = {
        channelCount: w.__lcDebugChannelState?.channels?.length ?? -1,
        forcedSource: w.__lcDebugChannelState?.forcedSource ?? null,
      };
      if (w.__lcDebugReloadChannels) await w.__lcDebugReloadChannels();
      return stateAfterSeed;
    });
    console.log("[proof spec] channelState after seed:", JSON.stringify(debugState));
    await page.waitForTimeout(1500);

    const cta = page.getByTestId("accountpack-cta");
    const ctaCount = await cta.count();

    await page.screenshot({
      path: "/tmp/proof-05-channels-accountpack-cta.png",
      fullPage: false,
    });

    expect(ctaCount).toBeGreaterThan(0);
    await expect(cta).toBeVisible();
  });
});
