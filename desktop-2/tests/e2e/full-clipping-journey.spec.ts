/**
 * Full Clipping Journey · USER-LENS AUTOMATION GATE · BUG-039
 *
 * The clipping-suite benchmark. One customer, one sequential walk:
 *
 *   Generate clips → Edit → Reaction → Caption → Trim → Watermark verify
 *   → Style verify → Schedule honesty → Publish + Export → outcome check
 *
 * If any prior surface regresses, this test catches it BEFORE the
 * per-feature specs (faster signal). Reads the same data-* attributes
 * and uses the same seed pattern as the individual journeys — no
 * additional production-code surface required.
 *
 * Single-source-of-truth assertions:
 *   - Watermark badge in preview == Style readout == Publish toggle
 *     == export payload (deriveWatermarkPromise — BUG-036)
 *   - Schedule CTAs on Schedule tab AND Publish tab both disabled
 *     and read the same deriveSchedulePromise — BUG-038
 */
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");
const JOURNEY = "Full Clipping";
const FIXTURE_SLUG = "uncle-daniel-clip-squad-2026";
const REACTION_FIXTURE = path.resolve(__dirname, "fixtures", "reaction-source.mp4");

const NEW_CAPTION_TEXT = "Stop scrolling. Watch this.";
const NEW_CAPTION_STYLE = "cyan-bold";
const NEW_CAPTION_POSITION = "top";

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
    const label = `full-${String(n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
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
  // BUG-039 causal-proof fix 1 · adaptMe reads `effective_tier`
  // (snake_case), not `tier`. Without this field, mapBackendTier returns
  // null and useTierCaps falls through to "fixture-fallback" → watermark
  // forced ON. The full-journey harness re-mounts PublishModule between
  // Style and the export step, which catches this gap.
  //
  // BUG-039 causal-proof fix 2 · Playwright's page.route priority is
  // REVERSE registration order — the most recently added route wins.
  // The catch-all MUST be registered FIRST so specific routes (added
  // later) take priority. The other specs got lucky because they used
  // __lcDebugSetTier to force tier resolution, masking the /me payload
  // being clobbered.
  const me = {
    user: { id: "harness", email: "harness@test", tier: "solo" },
    tier: "solo",
    effective_tier: "solo",
    raw_tier: "solo",
  };
  const sync = { tier: "solo", caps: { watermarkLocked: false } };
  // 1. Catch-all FIRST (lowest priority).
  await page.route(/api\.liquidclips\.app\//, (route) => {
    if (route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    return route.continue();
  });
  // 2. Specific routes LAST (highest priority — win for their patterns).
  await page.route(/api\.liquidclips\.app\/sync(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sync) }));
  await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(me) }));
}

async function seedCompletedSession(page: Page) {
  await page.addInitScript((slug) => {
    try {
      const now = new Date().toISOString();
      window.localStorage.setItem("lc.license.jwt.v1", "harness.fake.jwt");
      window.localStorage.setItem("lc:engine:session:v1", JSON.stringify({
        source: "full-clipping.test.mp4", slug, status: "complete", percent: 1, stage: "thumbs",
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

async function tab(page: Page, name: string) {
  await page.locator('.lc-cockpit-dock .lc-cd-pill', { hasText: new RegExp(`^${name}$`, "i") }).click();
  const moduleKey = name.toLowerCase();
  await expect(page.locator(`.lc-cockpit-dock[data-module="${moduleKey}"]`)).toBeVisible({ timeout: 4_000 });
}

test.describe("Full Clipping Journey", () => {
  test(`${JOURNEY} · customer walks generate→edit→reaction→caption→trim→watermark→style→schedule honesty→export`, async ({ page }, testInfo) => {
    const rec = new JourneyRecorder(page, testInfo);

    try {
      // ── 1. Generate (seeded FIXTURE_PROJECT) ──
      await rec.step("Generate clips · seed completed session", async () => {
        await interceptBackend(page);
        await seedCompletedSession(page);
        await page.goto("/?skipIntro=1#/workstation", { waitUntil: "domcontentloaded" });
        await page.waitForSelector('[data-testid="clip-card"]', { timeout: 20_000 });
        const count = await page.locator('[data-testid="clip-card"]').count();
        rec.assert("generated_clip_count", count);
        expect(count).toBeGreaterThanOrEqual(2);
      });

      // ── 2. Edit · click first clip ──
      await rec.step("Click Edit on first clip · dock opens on Reaction", async () => {
        await page.locator('[data-testid="clip-card"][data-clip-idx="0"]').locator('button.lc-clip-cta', { hasText: /^Edit$/ }).first().click();
        await expect(page.locator('.lc-cockpit-dock[data-module="reaction"][data-open="1"]')).toBeVisible({ timeout: 4_000 });
      });

      // ── 3. Reaction · upload + Apply ──
      await rec.step("Reaction · upload mp4 + Apply bake", async () => {
        await page.locator('[data-testid="reaction-file-input"]').setInputFiles(REACTION_FIXTURE);
        await expect(page.locator('[data-testid="reaction-overlay"]')).toBeVisible({ timeout: 4_000 });
        const layout = await page.locator('[data-testid="reaction-overlay"]').getAttribute("data-reaction-layout");
        rec.assert("reaction_overlay_layout", layout);
        await page.locator('[data-testid="reaction-apply"]').click();
        const apply = page.locator('[data-testid="reaction-apply"]');
        await expect.poll(async () => apply.getAttribute("data-bake-state"), {
          timeout: 8_000, intervals: [200, 400, 800, 1200],
        }).toBe("done");
      });

      // ── 4. Caption · edit text+style+position · Apply ──
      await rec.step("Caption · change text/style/position + Apply", async () => {
        await tab(page, "caption");
        await page.locator('[data-testid="caption-text"]').fill(NEW_CAPTION_TEXT);
        await page.locator(`[data-testid="caption-style-${NEW_CAPTION_STYLE}"]`).click();
        await page.locator(`[data-testid="caption-position-${NEW_CAPTION_POSITION}"]`).click();
        await expect.poll(async () => page.locator('[data-testid="caption-preview"]').getAttribute("data-style")).toBe(NEW_CAPTION_STYLE);
        await page.locator('[data-testid="caption-apply"]').click();
        await expect.poll(async () => page.locator('[data-testid="caption-apply"]').getAttribute("data-caption-state"), {
          timeout: 6_000, intervals: [100, 200, 400, 800, 1200],
        }).toBe("done");
      });

      // ── 5. Trim · set range + Apply ──
      await rec.step("Trim · set 0:05 → 0:22 + Apply regenerate", async () => {
        await tab(page, "trim");
        const setRange = (el: HTMLInputElement, value: string) => {
          const proto = Object.getPrototypeOf(el) as typeof HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          if (setter) setter.call(el, value); else el.value = value;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        };
        await page.locator('[data-testid="trim-in"]').evaluate(setRange, "5");
        await page.locator('[data-testid="trim-out"]').evaluate(setRange, "22");
        await expect.poll(async () => page.locator('[data-testid="trim-in-val"]').textContent()).toMatch(/0:05/);
        await page.locator('[data-testid="trim-apply"]').click();
        await expect.poll(async () => page.locator('[data-testid="trim-apply"]').getAttribute("data-trim-state"), {
          timeout: 6_000, intervals: [200, 400, 800, 1200],
        }).toBe("done");
      });

      // ── 6. Watermark verify · Paid customer choosing OFF ──
      // The full journey runs in Paid mode (tier solo → "pro"). We flip
      // the tier via the debug hook to make this deterministic, then
      // verify the customer can turn watermark off and the badge hides.
      await rec.step("Watermark · flip to Paid + toggle OFF + badge hides", async () => {
        await tab(page, "publish");
        await page.evaluate(() => {
          const w = window as Window & { __lcDebugSetTier?: (t: string | null) => void };
          if (typeof w.__lcDebugSetTier === "function") w.__lcDebugSetTier("pro");
        });
        await expect.poll(async () =>
          page.locator('[data-testid="watermark-block"]').getAttribute("data-watermark-tier")
        , { timeout: 4_000 }).toBe("pro");

        const toggle = page.locator('[data-testid="watermark-toggle"]');
        await expect(toggle).toBeEnabled();
        await toggle.click();
        const block = page.locator('[data-testid="watermark-block"]');
        await expect.poll(async () => block.getAttribute("data-watermark-effective"), {
          timeout: 2_000, intervals: [50, 100, 200],
        }).toBe("false");
        const previewVisible = await page.locator('[data-testid="preview-stage"]').getAttribute("data-watermark-visible");
        rec.assert("watermark_preview_visible_after_off", previewVisible);
        expect(previewVisible).toBe("false");
        await expect(page.locator('[data-testid="preview-watermark-badge"]')).toHaveCount(0);
      });

      // ── 7. Style · honest stub + single-source readout matches Publish ──
      await rec.step("Style · pick preset+accent · COMING SOON honesty · readout matches Publish", async () => {
        await tab(page, "style");
        await expect(page.locator('[data-testid="style-preset-coming-soon"]')).toBeVisible();
        await expect(page.locator('[data-testid="style-accent-coming-soon"]')).toBeVisible();
        // NO standalone watermark toggle in Style.
        await expect(page.locator('.lc-cockpit-dock[data-module="style"] [data-testid="watermark-toggle"]')).toHaveCount(0);
        // Pick preset+accent.
        await page.locator('[data-testid="style-preset-mono"]').click();
        await page.locator('[data-testid="style-accent-cyan"]').click();
        // Causal probe: capture EVERYTHING the two surfaces see right now.
        const styleEff = await page.locator('[data-testid="style-readout-watermark"]').getAttribute("data-effective");
        const styleProbe = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="style-readout-watermark"]');
          return {
            effective: el?.getAttribute("data-effective"),
          };
        });
        rec.assert("step7_style_probe", styleProbe);
        await tab(page, "publish");
        const publishEff = await page.locator('[data-testid="watermark-block"]').getAttribute("data-watermark-effective");
        const publishProbe = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="watermark-block"]');
          return {
            effective: el?.getAttribute("data-watermark-effective"),
            state: el?.getAttribute("data-watermark-state"),
            locked: el?.getAttribute("data-watermark-locked"),
            tier: el?.getAttribute("data-watermark-tier"),
            source: el?.getAttribute("data-watermark-tier-source"),
          };
        });
        rec.assert("step7_publish_probe", publishProbe);
        rec.assert("watermark_single_source_style", styleEff);
        rec.assert("watermark_single_source_publish", publishEff);
        expect(styleEff).toBe(publishEff);
        expect(publishEff).toBe("false");
      });

      // ── 8. Schedule honesty · CTAs disabled on both surfaces ──
      await rec.step("Schedule honesty · CTAs disabled on Publish + Schedule (single deriveSchedulePromise)", async () => {
        // Capture publish-side BEFORE leaving the publish tab — once we
        // tab away, PublishModule unmounts and the element is gone.
        await expect(page.locator('[data-testid="publish-schedule-hour"]')).toBeDisabled();
        const statePubSched = await page.locator('[data-testid="publish-schedule-hour"]').getAttribute("data-schedule-state");
        rec.assert("schedule_state_in_publish_tab", statePubSched);
        expect(statePubSched).toBe("coming-soon");

        // Now tab to schedule and capture its side.
        await tab(page, "schedule");
        await expect(page.locator('[data-testid="schedule-queue"]')).toBeDisabled();
        const stateSched = await page.locator('[data-testid="schedule-block"]').getAttribute("data-schedule-state");
        rec.assert("schedule_state_in_schedule_tab", stateSched);
        expect(stateSched).toBe("coming-soon");
        // Both surfaces read the SAME deriveSchedulePromise (BUG-038 single source).
        expect(stateSched).toBe(statePubSched);
      });

      // ── 9. Export · Publish now ──
      await rec.step("Export · click Publish now · export reaches done", async () => {
        await tab(page, "publish");
        await page.locator('[data-testid="publish-now"]').click();
        const btn = page.locator('[data-testid="publish-now"]');
        await expect.poll(async () => btn.getAttribute("data-export-state"), {
          timeout: 12_000, intervals: [200, 400, 800, 1200],
        }).toBe("done");
      });

      // ── 10. Verify exported outcome · watermark matches customer's choice ──
      await rec.step("Verify exported outcome · payload watermark matches UI promise (clean)", async () => {
        const success = page.locator('[data-testid="export-success"]');
        await expect(success).toBeVisible({ timeout: 4_000 });
        const exportedWm = await success.getAttribute("data-export-watermark");
        const outputPath = await success.getAttribute("data-output-path");
        const successText = await success.textContent();
        rec.assert("export_watermark", exportedWm);
        rec.assert("export_output_path", outputPath);
        rec.assert("export_success_text", successText);
        // Customer flipped watermark OFF in step 6. Exporter must agree.
        expect(exportedWm).toBe("false");
        expect(outputPath).toContain(FIXTURE_SLUG);
        expect(successText?.toLowerCase()).toContain("clean");
      });

      // ── 11. Cross-clip persistence check ──
      await rec.step("Cross-clip persistence · settings survive clip switch", async () => {
        // Switch to clip #2 and back.
        await page.locator('[data-testid="clip-card"][data-clip-idx="1"] [data-testid="clip-shell"]').click();
        await page.locator('.lc-cd-clip-num', { hasText: "#2" }).waitFor({ timeout: 4_000 });
        await page.locator('[data-testid="clip-card"][data-clip-idx="0"] [data-testid="clip-shell"]').click();
        await page.locator('.lc-cd-clip-num', { hasText: "#1" }).waitFor({ timeout: 4_000 });
        // Re-open Caption tab; text must be the customer's value.
        await tab(page, "caption");
        const persistedText = await page.locator('[data-testid="caption-text"]').inputValue();
        const persistedStyle = await page.locator('[data-testid="caption-preview"]').getAttribute("data-style");
        rec.assert("persisted_caption_text", persistedText);
        rec.assert("persisted_caption_style", persistedStyle);
        expect(persistedText).toBe(NEW_CAPTION_TEXT);
        expect(persistedStyle).toBe(NEW_CAPTION_STYLE);
        // Re-open Trim tab; range must be the customer's values.
        await tab(page, "trim");
        const persistedIn = await page.locator('[data-testid="trim-in-val"]').textContent();
        rec.assert("persisted_trim_in", persistedIn);
        expect(persistedIn).toMatch(/0:05/);
      });

      await rec.step("Emit verdict attachments", async () => {
        rec.assert("final", "ok");
      });
    } finally {
      await rec.finalize();
    }
  });
});
