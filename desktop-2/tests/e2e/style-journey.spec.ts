/**
 * Style Journey · USER-LENS AUTOMATION GATE · BUG-037
 *
 * Style module is honest-stub. The harness asserts:
 *   - Brand preset chips toggle settings persistently, but a visible
 *     COMING SOON badge tells the customer the export doesn't carry them.
 *   - Accent chips same shape.
 *   - NO standalone Watermark toggle in the Style tab (BUG-036 single
 *     source of truth: Publish owns it).
 *   - Style readout's Watermark row reflects the EFFECTIVE decision —
 *     never disagrees with the Publish toggle or the preview badge.
 *   - Settings persist across clip switch (Patch A round-trip).
 *
 * The honesty pattern mirrors BUG-035's caption letter-spacing assertion:
 * a future regression that flips this to a fake "applied" badge gets
 * caught at gate-time.
 */
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { seedAuthenticatedShell } from "./_auth-harness";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");
const JOURNEY = "Style Journey";
const FIXTURE_SLUG = "uncle-daniel-clip-squad-2026";

interface StepRecord { step: number; name: string; status: "PASS" | "FAIL"; screenshot?: string; }

class JourneyRecorder {
  private consoleErrors: string[] = [];
  private domAssertions: Record<string, unknown> = {};
  private currentStep = 0;
  constructor(private page: Page, private info: TestInfo) {
    page.on("pageerror", (e) => this.consoleErrors.push(`pageerror: ${e.message}`));
    page.on("console", (msg) => {
      const t = msg.type();
      if (t === "error" || t === "warning") this.consoleErrors.push(`console.${t}: ${msg.text()}`);
    });
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
  async step<T>(name: string, body: () => Promise<T>): Promise<T> {
    this.currentStep += 1;
    const n = this.currentStep;
    const label = `style-${String(n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const screenshotPath = path.join(SCREENSHOT_DIR, `${label}.png`);
    let status: "PASS" | "FAIL" = "PASS";
    try {
      const result = await body();
      try { await this.page.screenshot({ path: screenshotPath, fullPage: false }); } catch {}
      const rec: StepRecord = { step: n, name, status, screenshot: screenshotPath };
      await this.info.attach(`lc:step:${n}`, { body: Buffer.from(JSON.stringify(rec)), contentType: "application/json" });
      await this.info.attach(`${label}.png`, { path: screenshotPath, contentType: "image/png" }).catch(() => {});
      return result;
    } catch (e) {
      status = "FAIL";
      try { await this.page.screenshot({ path: screenshotPath, fullPage: false }); } catch {}
      const rec: StepRecord = { step: n, name, status, screenshot: screenshotPath };
      await this.info.attach(`lc:step:${n}`, { body: Buffer.from(JSON.stringify(rec)), contentType: "application/json" });
      await this.info.attach(`${label}.png`, { path: screenshotPath, contentType: "image/png" }).catch(() => {});
      throw e;
    }
  }
  assert(k: string, v: unknown) { this.domAssertions[k] = v; }
  async finalize() {
    await this.info.attach("lc:journey", { body: Buffer.from(JOURNEY), contentType: "text/plain" });
    await this.info.attach("lc:console-errors", { body: Buffer.from(JSON.stringify(this.consoleErrors)), contentType: "application/json" });
    await this.info.attach("lc:assertions", { body: Buffer.from(JSON.stringify(this.domAssertions)), contentType: "application/json" });
  }
}

async function interceptBackend(page: Page) {
  const me = { user: { id: "harness", email: "harness@test", tier: "solo" }, tier: "solo" };
  const sync = { tier: "solo", caps: { watermarkLocked: false } };
  await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(me) }));
  await page.route(/api\.liquidclips\.app\/sync(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sync) }));
  await page.route(/api\.liquidclips\.app\//, (route) => {
    if (route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    return route.continue();
  });
}

async function seedCompletedSession(page: Page) {
  /* D1 (2026-07-12) · canonical auth harness seed. Spec's own
   * `interceptBackend` re-mocks /me + /sync AFTER this. */
  await seedAuthenticatedShell(page, { tier: "solo" });
  await page.addInitScript((slug) => {
    try {
      const now = new Date().toISOString();
      window.localStorage.setItem("lc:engine:session:v1", JSON.stringify({
        source: "style-journey.test.mp4", slug, status: "complete", percent: 1, stage: "thumbs",
        runtimeMode: "mock", startedAt: now, updatedAt: now,
      }));
      window.localStorage.setItem("lc.dock.open", "1");
      const stale: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(`lc.clip.${slug}:`)) stale.push(k);
      }
      for (const k of stale) window.localStorage.removeItem(k);
    } catch {}
  }, FIXTURE_SLUG);
}

test.describe("Style Journey", () => {
  test(`${JOURNEY} · preset+accent persist; coming-soon honesty; watermark single source`, async ({ page }, testInfo) => {
    const rec = new JourneyRecorder(page, testInfo);
    try {
      await rec.step("Launch + seed session", async () => {
        await interceptBackend(page);
        await seedCompletedSession(page);
        await page.goto("/?skipIntro=1#/workstation", { waitUntil: "domcontentloaded" });
        await page.waitForSelector('[data-testid="clip-card"]', { timeout: 20_000 });
      });

      await rec.step("Click Edit on first clip", async () => {
        await page.locator('[data-testid="clip-card"][data-clip-idx="0"]').locator('button.lc-clip-cta', { hasText: /^Open clip$/ }).first().click();
        await expect(page.locator('.lc-cockpit-dock[data-open="1"]')).toBeVisible({ timeout: 4_000 });
      });

      await rec.step("Switch dock to Style tab", async () => {
        await page.locator('.lc-cockpit-dock .lc-cd-pill', { hasText: /^Style$/i }).click();
        await expect(page.locator('.lc-cockpit-dock[data-module="style"]')).toBeVisible({ timeout: 4_000 });
      });

      await rec.step("Brand preset · COMING SOON badge visible", async () => {
        const badge = page.locator('[data-testid="style-preset-coming-soon"]');
        await expect(badge).toBeVisible();
        const copy = await badge.textContent();
        rec.assert("preset_coming_soon_copy", copy);
        expect(copy?.toLowerCase()).toMatch(/coming soon/);
        expect(copy?.toLowerCase()).toContain("not exported");
      });

      await rec.step("Accent · COMING SOON badge visible", async () => {
        const badge = page.locator('[data-testid="style-accent-coming-soon"]');
        await expect(badge).toBeVisible();
        const copy = await badge.textContent();
        rec.assert("accent_coming_soon_copy", copy);
        expect(copy?.toLowerCase()).toMatch(/coming soon/);
      });

      await rec.step("NO standalone Style watermark toggle (single source per BUG-036)", async () => {
        // Style tab must not own a watermark toggle. The Publish tab owns it.
        // A regression that re-adds a toggle here gets caught by this assertion.
        await expect(page.locator('.lc-cockpit-dock[data-module="style"] [data-testid="watermark-toggle"]')).toHaveCount(0);
        // The pointer to Publish must exist instead.
        const pointer = page.locator('[data-testid="style-watermark-pointer"]');
        await expect(pointer).toBeVisible();
        const text = await pointer.textContent();
        rec.assert("style_watermark_pointer_copy", text);
        expect(text?.toLowerCase()).toContain("publish");
      });

      await rec.step("Customer picks Mono preset + Cyan accent", async () => {
        await page.locator('[data-testid="style-preset-mono"]').click();
        await page.locator('[data-testid="style-accent-cyan"]').click();
        await expect.poll(async () => page.locator('[data-testid="style-readout-preset"]').textContent()).toContain("Mono");
        await expect.poll(async () => page.locator('[data-testid="style-readout-accent"]').textContent()).toContain("Cyan");
      });

      await rec.step("Switch to clip #2 then back to #1", async () => {
        await page.locator('[data-testid="clip-card"][data-clip-idx="1"] [data-testid="clip-shell"]').click();
        await page.locator('.lc-cd-clip-num', { hasText: "#2" }).waitFor({ timeout: 4_000 });
        await page.locator('[data-testid="clip-card"][data-clip-idx="0"] [data-testid="clip-shell"]').click();
        await page.locator('.lc-cd-clip-num', { hasText: "#1" }).waitFor({ timeout: 4_000 });
      });

      await rec.step("Preset + Accent persisted on returned clip", async () => {
        // Style tab may have been replaced by a different module on clip switch;
        // re-open it.
        await page.locator('.lc-cockpit-dock .lc-cd-pill', { hasText: /^Style$/i }).click();
        await expect(page.locator('.lc-cockpit-dock[data-module="style"]')).toBeVisible({ timeout: 4_000 });
        const persistedPreset = await page.locator('[data-testid="style-readout-preset"]').textContent();
        const persistedAccent = await page.locator('[data-testid="style-readout-accent"]').textContent();
        rec.assert("persisted_preset", persistedPreset);
        rec.assert("persisted_accent", persistedAccent);
        expect(persistedPreset).toContain("Mono");
        expect(persistedAccent).toContain("Cyan");
      });

      await rec.step("Style readout 'Watermark' matches Publish promise (single source)", async () => {
        const styleWmRow = page.locator('[data-testid="style-readout-watermark"]');
        const styleEffective = await styleWmRow.getAttribute("data-effective");
        rec.assert("style_readout_watermark_effective", styleEffective);
        // Open Publish tab and read the canonical effective decision.
        await page.locator('.lc-cockpit-dock .lc-cd-pill', { hasText: /publish/i }).click();
        await expect(page.locator('.lc-cockpit-dock[data-module="publish"]')).toBeVisible({ timeout: 4_000 });
        const publishEffective = await page.locator('[data-testid="watermark-block"]').getAttribute("data-watermark-effective");
        rec.assert("publish_watermark_effective", publishEffective);
        expect(styleEffective).toBe(publishEffective);
      });

      await rec.step("Emit verdict attachments", async () => {
        rec.assert("final", "ok");
      });
    } finally {
      await rec.finalize();
    }
  });
});
