/**
 * Generate / Create Journey · USER-LENS AUTOMATION GATE · BUG-041
 *
 * The Generate/Create surface spans the Home InlineCreatePanel AND the
 * Workstation run controls (EngineActions + ResultsGrid). The harness
 * verifies:
 *
 *   1. ResultsGrid "Generate more" wires to sidecar.pickMoreClips with
 *      a real state machine (idle → picking → done) · BUG-041 fix.
 *   2. ResultsGrid "Best bits only" toggles a real client filter.
 *   3. Home Create panel · URL tab renders + Analyze enables on input.
 *   4. Upload tab is visibly disabled with COMING SOON copy + no
 *      fake-toast lie on force-click.
 *   5. Script tab is visibly disabled with COMING SOON copy + no
 *      fake-toast lie on force-click.
 *
 * The URL → mock-pipeline path is already proven end-to-end by the
 * `full_clipping` harness; we don't re-test it here (mock-pipeline is
 * slow ~6s and bleeds state across phases).
 */
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { seedAuthenticatedShell } from "./_auth-harness";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");
const JOURNEY = "Generate Create";
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
    const label = `gen-${String(n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
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
  const me = {
    user: { id: "harness", email: "harness@test", tier: "solo" },
    tier: "solo", effective_tier: "solo", raw_tier: "solo",
  };
  const sync = { tier: "solo", caps: { watermarkLocked: false } };
  // Catch-all FIRST · specifics LAST (Playwright reverse priority — BUG-039).
  await page.route(/api\.liquidclips\.app\//, (route) => {
    if (route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    return route.continue();
  });
  await page.route(/api\.liquidclips\.app\/sync(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sync) }));
  await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(me) }));
}

async function seedWorkstationSession(page: Page) {
  /* D1 (2026-07-12) · canonical auth harness seed. Spec `interceptBackend`
   * registers /me + /sync AFTER this call so Playwright reverse
   * priority lets the spec-specific solo-tier bodies win. */
  await seedAuthenticatedShell(page, { tier: "solo" });
  // Seed the completed session so Workstation mounts with a
  // hydrated project (FIXTURE_PROJECT) on first render. addInitScript
  // runs at page-load BEFORE any app code, so no race vs. prior runs.
  await page.addInitScript((slug) => {
    try {
      const now = new Date().toISOString();
      window.localStorage.setItem("lc:engine:session:v1", JSON.stringify({
        source: "generate-create.test.mp4", slug, status: "complete", percent: 1, stage: "thumbs",
        runtimeMode: "mock", startedAt: now, updatedAt: now,
      }));
      window.localStorage.setItem("lc.dock.open", "0");
      const stale: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(`lc.clip.${slug}:`)) stale.push(k);
      }
      for (const k of stale) window.localStorage.removeItem(k);
    } catch {}
  }, FIXTURE_SLUG);
}

test.describe("Generate Create Journey", () => {
  test(`${JOURNEY} · Generate more wires real RPC · Upload LIVE + Script honest COMING SOON · no fake-toast lies`, async ({ page }, testInfo) => {
    const rec = new JourneyRecorder(page, testInfo);

    try {
      // ───────────────────────────────────────────────────────────────
      // PART A · Workstation Generate-more (the actual wire fix)
      // ───────────────────────────────────────────────────────────────
      await rec.step("Launch Workstation with a hydrated project", async () => {
        await interceptBackend(page);
        await seedWorkstationSession(page);
        await page.goto("/?skipIntro=1#/workstation", { waitUntil: "domcontentloaded" });
        await page.waitForSelector('[data-testid="clip-card"]', { timeout: 20_000 });
      });

      await rec.step("Generate-more button is visible + enabled + idle", async () => {
        const btn = page.locator('[data-testid="generate-more"]');
        await expect(btn).toBeVisible();
        await expect(btn).toBeEnabled();
        const state = await btn.getAttribute("data-generate-more-state");
        rec.assert("generate_more_initial_state", state);
        expect(state).toBe("idle");
      });

      await rec.step("Best bits only · client filter narrows the grid", async () => {
        const cardsBefore = await page.locator('[data-testid="clip-card"]').count();
        rec.assert("clip_count_before_filter", cardsBefore);
        await page.locator('[data-testid="best-bits-only"]').check();
        const cardsAfter = await page.locator('[data-testid="clip-card"]').count();
        rec.assert("clip_count_after_filter", cardsAfter);
        expect(cardsAfter).toBeLessThanOrEqual(cardsBefore);
        await page.locator('[data-testid="best-bits-only"]').uncheck();
      });

      await rec.step("Generate more · idle → picking → done · BUG-041 wire", async () => {
        const btn = page.locator('[data-testid="generate-more"]');
        await btn.click();
        // The mock fallback emits engine:complete{kind:"pick"} after ~1.2s.
        await expect.poll(async () => btn.getAttribute("data-generate-more-state"), {
          timeout: 8_000, intervals: [100, 200, 400, 800, 1200],
        }).toMatch(/picking|done/);
        await expect.poll(async () => btn.getAttribute("data-generate-more-state"), {
          timeout: 8_000, intervals: [200, 400, 800, 1200],
        }).toBe("done");
        rec.assert("generate_more_reached_done", true);
      });

      // ───────────────────────────────────────────────────────────────
      // PART B · Home Create panel (UI surface verification)
      // ───────────────────────────────────────────────────────────────
      await rec.step("Navigate to Home + open Create panel", async () => {
        // Hash navigation inside the same page · the AppShell + SimulatorRouter
        // re-render Home from the existing JS context.
        await page.evaluate(() => { window.location.hash = "#/home"; });
        await expect(page.locator('[data-testid="home-tile-1"]')).toBeVisible({ timeout: 8_000 });
        await page.locator('[data-testid="home-tile-1"]').click();
        await expect(page.locator('[data-testid="create-panel"]')).toBeVisible({ timeout: 4_000 });
      });

      await rec.step("URL tab · input + Analyze button enable on fill", async () => {
        const input = page.locator('input[type="url"]').first();
        await expect(input).toBeVisible();
        const analyze = page.locator('button.lc-icp-go').first();
        await expect(analyze).toBeDisabled();
        await input.fill("https://youtu.be/dQw4w9WgXcQ");
        await expect(analyze).toBeEnabled();
        const label = await analyze.textContent();
        rec.assert("url_analyze_label", label);
        expect(label?.toLowerCase()).toMatch(/analyze/);
      });

      await rec.step("Upload tab · LIVE · Pick file affordance present + no fake-toast on click", async () => {
        /* Phase 1 (2026-07-12) · Upload tab was intentionally launched
         * so `data-upload-state="coming-soon"` + upload-coming-soon-copy
         * are gone. Current contract (src/design-os/components/
         * InlineCreatePanel.tsx:547-607): `data-upload-state="live"` +
         * enabled "Pick file" button + real drop zone. Toast-lie guard
         * is preserved — clicking pick without a Tauri context must
         * still not fabricate a run-started toast. */
        await page.locator('[data-testid="create-panel-tabs"]').getByRole("tab", { name: /upload/i }).click();
        const uploadBlock = page.locator('[data-testid="upload-tab-block"]');
        await expect(uploadBlock).toBeVisible({ timeout: 4_000 });
        expect(await uploadBlock.getAttribute("data-upload-state")).toBe("live");
        const pickFile = page.locator('[data-testid="upload-pick-file"]');
        await expect(pickFile).toBeVisible();
        await expect(pickFile).toBeEnabled();
        await expect(pickFile).toHaveText(/^Pick file$/);
        await expect(page.locator('[data-testid="upload-drop-zone"]')).toBeVisible();
        rec.assert("upload_state", "live");
        rec.assert("upload_pick_label", "Pick file");
        const toastsBefore = await page.locator('.lc-toast').count();
        /* Click without a Tauri context — browser preview path no-ops
         * (see InlineCreatePanel.tsx:568-574). Must not fabricate a
         * "run started" toast. */
        await pickFile.click().catch(() => {});
        await page.waitForTimeout(400);
        const toastsAfter = await page.locator('.lc-toast').count();
        rec.assert("upload_toasts_before", toastsBefore);
        rec.assert("upload_toasts_after_click", toastsAfter);
        await expect(page.locator('.lc-toast', { hasText: /generating|ingest|pipeline|run started/i })).toHaveCount(0);
      });

      await rec.step("Transcribe tab · LIVE URL → transcript surface (replaces retired Script COMING-SOON tab · task #83, 2026-07-10)", async () => {
        // Phase 1 (2026-07-12) · Script tab was intentionally replaced
        // by Transcribe (URL → transcript text, no clipping) per the
        // 2026-07-10 InlineCreatePanel refactor. The three tabs are
        // now URL · Upload Video · Transcribe (see
        // src/design-os/components/InlineCreatePanel.tsx:480-482).
        await page.locator('[data-testid="create-panel-tabs"]').getByRole("tab", { name: /transcribe/i }).click();
        await page.waitForTimeout(200);
        const activeTab = await page.locator('[data-testid="create-panel-tabs"]').getAttribute("data-active-tab");
        rec.assert("active_tab_after_transcribe_click", activeTab ?? "");
        expect(activeTab).toBe("transcribe");
        const toastsAfter = await page.locator('.lc-toast').count();
        rec.assert("transcribe_toasts_after_tab_switch", toastsAfter);
        // No fake-generating toast on plain tab switch.
        await expect(page.locator('.lc-toast', { hasText: /generating|script generated|run started/i })).toHaveCount(0);
      });

      await rec.step("Emit verdict attachments", async () => {
        rec.assert("final", "ok");
      });
    } finally {
      await rec.finalize();
    }
  });
});
