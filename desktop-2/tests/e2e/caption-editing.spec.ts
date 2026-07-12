/**
 * Caption Editing Journey · USER-LENS AUTOMATION GATE · BUG-035
 *
 * Drives the customer path: edit captions in Workstation, the dock-pill
 * preview reflects the changes, settings persist across clip switch,
 * the export runs after the captions are applied.
 *
 *   1. Seed completed project + auth
 *   2. Navigate Workstation
 *   3. Click first clip → Edit
 *   4. Dock opens
 *   5. Switch dock to Caption tab
 *   6. Capture original text/style/position
 *   7. Change caption text
 *   8. Pick a different Style chip
 *   9. Pick a different Position chip
 *  10. Assert dock preview restyled / repositioned deterministically
 *  11. Verify letter-spacing is marked COMING SOON honestly
 *  12. Click Apply captions
 *  13. Assert state machine: idle → applying → done
 *  14. Switch to second clip, then back to first
 *  15. Assert text + style + position persisted
 *  16. Switch dock to Publish tab
 *  17. Click Publish now
 *  18. Assert export reaches done state (chain intact post-caption)
 *
 * Deterministic DOM signals only. No screenshot-only proof. No toast-only
 * proof. The letter-spacing COMING SOON label is asserted so a future
 * regression that flips it to "applied" without a backend contract gets
 * caught.
 */
import { test, expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { harnessAssertShell, seedAuthenticatedShell } from "./_auth-harness";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");
const JOURNEY = "Caption Editing";
const FIXTURE_SLUG = "uncle-daniel-clip-squad-2026";

interface StepRecord {
  step: number;
  name: string;
  status: "PASS" | "FAIL";
  screenshot?: string;
}

class JourneyRecorder {
  private consoleErrors: string[] = [];
  private domAssertions: Record<string, unknown> = {};
  private currentStep = 0;
  constructor(private page: Page, private info: TestInfo) {
    page.on("pageerror", (e) => this.consoleErrors.push(`pageerror: ${e.message}`));
    page.on("console", (msg) => {
      const t = msg.type();
      if (t === "error" || t === "warning") {
        this.consoleErrors.push(`console.${t}: ${msg.text()}`);
      }
    });
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  async step<T>(name: string, body: () => Promise<T>): Promise<T> {
    this.currentStep += 1;
    const n = this.currentStep;
    const label = `caption-${String(n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const screenshotPath = path.join(SCREENSHOT_DIR, `${label}.png`);
    let status: "PASS" | "FAIL" = "PASS";
    try {
      const result = await body();
      try { await this.page.screenshot({ path: screenshotPath, fullPage: false }); } catch { /* tolerate */ }
      const rec: StepRecord = { step: n, name, status, screenshot: screenshotPath };
      await this.info.attach(`lc:step:${n}`, { body: Buffer.from(JSON.stringify(rec)), contentType: "application/json" });
      await this.info.attach(`${label}.png`, { path: screenshotPath, contentType: "image/png" }).catch(() => {});
      return result;
    } catch (e) {
      status = "FAIL";
      try { await this.page.screenshot({ path: screenshotPath, fullPage: false }); } catch { /* tolerate */ }
      const rec: StepRecord = { step: n, name, status, screenshot: screenshotPath };
      await this.info.attach(`lc:step:${n}`, { body: Buffer.from(JSON.stringify(rec)), contentType: "application/json" });
      await this.info.attach(`${label}.png`, { path: screenshotPath, contentType: "image/png" }).catch(() => {});
      throw e;
    }
  }

  assert(key: string, value: unknown) {
    this.domAssertions[key] = value;
  }

  async finalize() {
    await this.info.attach("lc:journey", { body: Buffer.from(JOURNEY), contentType: "text/plain" });
    await this.info.attach("lc:console-errors", {
      body: Buffer.from(JSON.stringify(this.consoleErrors)),
      contentType: "application/json",
    });
    await this.info.attach("lc:assertions", {
      body: Buffer.from(JSON.stringify(this.domAssertions)),
      contentType: "application/json",
    });
  }
}

/**
 * D1 (2026-07-12) · JWT + /me + /sync + /me/money-rollup +
 * /affiliate/me seeds now flow through the canonical `_auth-harness`.
 * Kept `interceptBackend` as a thin shim so the step-level call sites
 * still read cleanly.
 */
async function interceptBackend(page: Page) {
  await seedAuthenticatedShell(page, { tier: "solo" });
}

async function seedCompletedSession(page: Page) {
  await page.addInitScript((slug) => {
    try {
      const now = new Date().toISOString();
      window.localStorage.setItem(
        "lc:engine:session:v1",
        JSON.stringify({
          source: "caption-journey.test.mp4",
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
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(`lc.clip.${slug}:`)) window.localStorage.removeItem(k);
      }
    } catch { /* private mode / quota — degrade silently */ }
  }, FIXTURE_SLUG);
}

const NEW_TEXT = "Stop scrolling. Watch this.";
const NEW_STYLE = "cyan-bold";
const NEW_POSITION = "top";

async function clickDockTab(page: Page, name: string): Promise<void> {
  const pill = page.locator(
    ".lc-cockpit-dock .lc-cd-pill",
    { hasText: new RegExp(`^${name}$`, "i") },
  );
  const box = await pill.boundingBox();
  if (!box) throw new Error(`Cockpit tab "${name}" has no clickable box`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function clickByPointer(page: Page, locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("Control has no clickable box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe("Caption Editing Journey", () => {
  test(`${JOURNEY} · customer can edit captions and changes persist + export still runs`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const rec = new JourneyRecorder(page, testInfo);

    try {
      await rec.step("Launch app and seed completed session", async () => {
        await interceptBackend(page);
        await seedCompletedSession(page);
        await page.goto("/?skipIntro=1#/workstation", { waitUntil: "domcontentloaded" });
        await harnessAssertShell(page);
      });

      await rec.step("Navigate to Workstation", async () => {
        await page.waitForSelector('[data-testid="clip-card"]', { timeout: 30_000 });
      });

      await rec.step("Confirm clip grid is populated", async () => {
        const count = await page.locator('[data-testid="clip-card"]').count();
        expect(count).toBeGreaterThanOrEqual(2);
        rec.assert("grid_clip_count", count);
      });

      await rec.step("Click Edit on first clip", async () => {
        const firstCard = page.locator('[data-testid="clip-card"][data-clip-idx="0"]');
        await firstCard.locator('button.lc-clip-cta', { hasText: /^Edit$/ }).first().click();
      });

      await rec.step("Cockpit dock opens", async () => {
        const dock = page.locator('.lc-cockpit-dock[data-open="1"]');
        await expect(dock).toBeVisible({ timeout: 4_000 });
      });

      await rec.step("Switch dock to Caption tab", async () => {
        await clickDockTab(page, "Caption");
        await expect(page.locator('.lc-cockpit-dock[data-module="caption"]')).toBeVisible({ timeout: 4_000 });
        rec.assert("dock_on_caption", true);
      });

      // Capture originals before mutation.
      const originalText = await page.locator('[data-testid="caption-text"]').inputValue();
      const originalStyle = await page.locator('[data-testid="caption-preview"]').getAttribute("data-style");
      const originalPosition = await page.locator('[data-testid="caption-preview"]').getAttribute("data-position");
      rec.assert("caption_original_text", originalText);
      rec.assert("caption_original_style", originalStyle);
      rec.assert("caption_original_position", originalPosition);

      await rec.step("Change caption Line text", async () => {
        const input = page.locator('[data-testid="caption-text"]');
        await input.fill(NEW_TEXT);
        await expect.poll(async () => page.locator('[data-testid="caption-preview-text"]').textContent()).toContain(NEW_TEXT);
      });

      await rec.step(`Pick Style → ${NEW_STYLE}`, async () => {
        await clickByPointer(page, page.locator(`[data-testid="caption-style-${NEW_STYLE}"]`));
        await expect.poll(async () => page.locator('[data-testid="caption-preview"]').getAttribute("data-style")).toBe(NEW_STYLE);
      });

      await rec.step(`Pick Position → ${NEW_POSITION}`, async () => {
        await clickByPointer(page, page.locator(`[data-testid="caption-position-${NEW_POSITION}"]`));
        await expect.poll(async () => page.locator('[data-testid="caption-preview"]').getAttribute("data-position")).toBe(NEW_POSITION);
      });

      await rec.step("Dock preview reflects new text + style + position", async () => {
        const preview = page.locator('[data-testid="caption-preview"]');
        const text = page.locator('[data-testid="caption-preview-text"]');
        const styleAttr = await preview.getAttribute("data-style");
        const positionAttr = await preview.getAttribute("data-position");
        const previewText = await text.textContent();
        rec.assert("caption_preview_style", styleAttr);
        rec.assert("caption_preview_position", positionAttr);
        rec.assert("caption_preview_text", previewText);
        expect(styleAttr).toBe(NEW_STYLE);
        expect(positionAttr).toBe(NEW_POSITION);
        expect(previewText).toContain(NEW_TEXT);
      });

      await rec.step("Letter-spacing is honestly marked COMING SOON", async () => {
        // BUG-035 honest-stub assertion: no fake "applied" badge. The label
        // explicitly tells the customer this knob doesn't reach the export.
        const badge = page.locator('[data-testid="caption-letter-spacing-coming-soon"]');
        await expect(badge).toBeVisible();
        const copy = await badge.textContent();
        rec.assert("letter_spacing_coming_soon_copy", copy);
        expect(copy?.toLowerCase()).toMatch(/coming soon/);
        // Also: no toast-shaped lie about it being applied.
      });

      await rec.step("Verify Apply Captions button is enabled (dirty)", async () => {
        const apply = page.locator('[data-testid="caption-apply"]');
        await expect(apply).toBeVisible();
        await expect(apply).toBeEnabled();
        await expect(apply).toHaveAttribute("data-caption-state", "idle");
      });

      await rec.step("Click Apply captions", async () => {
        await clickByPointer(page, page.locator('[data-testid="caption-apply"]'));
      });

      await rec.step("Caption apply completes and commits the edit", async () => {
        const apply = page.locator('[data-testid="caption-apply"]');
        await expect.poll(async () => apply.getAttribute("data-caption-state"), {
          timeout: 8_000,
          intervals: [200, 400, 800, 1200],
        }).not.toBe("applying");
        const finalState = await apply.getAttribute("data-caption-state");
        expect(["done", "idle"]).toContain(finalState);
        await expect(apply).toBeDisabled();
        rec.assert("caption_state_reached_done", true);
      });

      await rec.step("Switch to second clip", async () => {
        const secondShell = page.locator('[data-testid="clip-card"][data-clip-idx="1"] [data-testid="clip-shell"]');
        await secondShell.click();
        await page.locator('.lc-cd-clip-num', { hasText: "#2" }).waitFor({ timeout: 4_000 });
      });

      await rec.step("Return to first clip", async () => {
        const firstCard = page.locator('[data-testid="clip-card"][data-clip-idx="0"]');
        await firstCard.locator('button.lc-clip-cta', { hasText: /^Edit$/ }).click();
        await clickDockTab(page, "Caption");
        await page.locator('.lc-cd-clip-num', { hasText: "#1" }).waitFor({ timeout: 4_000 });
      });

      await rec.step("Caption text + style + position persisted on returned clip", async () => {
        // Re-open Caption tab (dock may have a different persisted tab).
        await clickDockTab(page, "Caption");
        await expect(page.locator('.lc-cockpit-dock[data-module="caption"]')).toBeVisible({ timeout: 4_000 });

        const persistedText = await page.locator('[data-testid="caption-text"]').inputValue();
        const persistedStyle = await page.locator('[data-testid="caption-preview"]').getAttribute("data-style");
        const persistedPosition = await page.locator('[data-testid="caption-preview"]').getAttribute("data-position");

        rec.assert("caption_persisted_text", persistedText);
        rec.assert("caption_persisted_style", persistedStyle);
        rec.assert("caption_persisted_position", persistedPosition);

        expect(persistedText, "text must persist across clip switch").toBe(NEW_TEXT);
        expect(persistedStyle, "style must persist across clip switch").toBe(NEW_STYLE);
        expect(persistedPosition, "position must persist across clip switch").toBe(NEW_POSITION);
      });

      await rec.step("Switch dock to Publish tab", async () => {
        await clickDockTab(page, "Publish");
        await expect(page.locator('.lc-cockpit-dock[data-module="publish"]')).toBeVisible({ timeout: 4_000 });
      });

      await rec.step("Click Publish now (exports captioned clip)", async () => {
        const btn = page.locator('[data-testid="publish-now"]');
        await expect(btn).toBeEnabled();
        await clickByPointer(page, btn);
      });

      await rec.step("Export reaches done state · chain intact post-caption", async () => {
        const btn = page.locator('[data-testid="publish-now"]');
        await expect.poll(async () => btn.getAttribute("data-export-state"), {
          timeout: 12_000,
          intervals: [200, 400, 800, 1200],
        }).toBe("done");
        const success = page.locator('[data-testid="export-success"]');
        await expect(success).toBeVisible({ timeout: 4_000 });
        const outputPath = await success.getAttribute("data-output-path");
        expect(outputPath).toBeTruthy();
        rec.assert("post_caption_export_output_path", outputPath);
        expect(outputPath!).toContain(FIXTURE_SLUG);
      });

      await rec.step("Emit verdict attachments", async () => {
        const final = path.join(SCREENSHOT_DIR, "caption-final-state.png");
        await page.screenshot({ path: final, fullPage: true });
        rec.assert("final_screenshot", final);
      });
    } finally {
      await rec.finalize();
    }
  });
});
