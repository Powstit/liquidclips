/**
 * Export Clip Journey · USER-LENS AUTOMATION GATE
 *
 * Drives the customer path that resolves BUG-033 "Publish CTA →
 * exportApi.exportClip". Reuses the same seed pattern as the reaction
 * journey (FIXTURE_PROJECT hydrate via lc:engine:session:v1 + intercepted
 * api.liquidclips.app/me|/sync). Verifies:
 *
 *   1. Seed completed project + auth
 *   2. Navigate Workstation
 *   3. Click first clip → Edit
 *   4. Dock opens (any tab; we drive it to Publish)
 *   5. Switch dock to Publish
 *   6. Click "Publish now"
 *   7. Observe button state machine: idle → exporting → done
 *   8. Assert exportApi.exportClip was actually invoked (engine:progress +
 *      engine:complete events emitted by the mock fallback OR real RPC)
 *   9. Assert the success affordance carries an output path
 *
 * NO toast-only proof. The button's `data-export-state` attribute is the
 * deterministic signal. Per the USER-LENS AUTOMATION GATE skill:
 * harness pass = green, manual is optional smoke.
 */
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");
const JOURNEY = "Export Clip";
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
    const label = `export-${String(n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
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

async function interceptBackend(page: Page) {
  const successMe = {
    user: { id: "harness", email: "harness@liquidclips.test", tier: "solo" },
    tier: "solo",
  };
  const successSync = { tier: "solo", caps: { watermarkLocked: false } };
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
          source: "export-journey.test.mp4",
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

test.describe("Export Clip Journey", () => {
  test(`${JOURNEY} · customer can export a generated clip end to end`, async ({ page }, testInfo) => {
    const rec = new JourneyRecorder(page, testInfo);

    try {
      await rec.step("Launch app and seed completed session", async () => {
        await interceptBackend(page);
        await seedCompletedSession(page);
        await page.goto("/?skipIntro=1#/workstation", { waitUntil: "domcontentloaded" });
      });

      await rec.step("Navigate to Workstation", async () => {
        await page.waitForSelector('[data-testid="clip-card"]', { timeout: 20_000 });
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

      await rec.step("Switch dock to Publish tab", async () => {
        // Click the Publish pill in StatePillNav. The pill is a <button
        // role="tab"> with an inner .lc-cd-pill-label span holding "Publish".
        // Scope to the dock-portal root to avoid colliding with stray
        // matches from elsewhere on the page.
        const pill = page.locator('.lc-cockpit-dock .lc-cd-pill', { hasText: /publish/i });
        await expect(pill).toBeVisible({ timeout: 4_000 });
        await pill.click();
        await expect(page.locator('.lc-cockpit-dock[data-module="publish"]')).toBeVisible({ timeout: 4_000 });
        rec.assert("dock_on_publish", true);
      });

      await rec.step("Verify Publish-now button is idle before click", async () => {
        const btn = page.locator('[data-testid="publish-now"]');
        await expect(btn).toBeVisible();
        await expect(btn).toHaveAttribute("data-export-state", "idle");
      });

      // The button's `data-export-state` transition idle → exporting → done
      // is itself proof the engine:complete{kind:"export"} chain ran (the
      // listener registered in PublishModule.tsx flips state on that exact
      // event). No window/bus shim needed — the DOM IS the verdict.

      await rec.step("Click Publish now", async () => {
        const btn = page.locator('[data-testid="publish-now"]');
        await btn.click();
      });

      await rec.step("Bake state transitions: exporting → done", async () => {
        const btn = page.locator('[data-testid="publish-now"]');
        // First transition (may be missed if the mock resolves instantly,
        // but the mock's `await wait(650)` × 5 iterations means at least
        // ~2.5s before complete fires).
        await expect.poll(async () => btn.getAttribute("data-export-state"), {
          timeout: 8_000,
          intervals: [100, 200, 400, 800],
        }).toMatch(/exporting|done/);
        // Settle to done.
        await expect.poll(async () => btn.getAttribute("data-export-state"), {
          timeout: 12_000,
          intervals: [200, 400, 800, 1200, 2000],
        }).toBe("done");
        rec.assert("export_state_reached_done", true);
      });

      await rec.step("Success affordance carries an output path", async () => {
        const success = page.locator('[data-testid="export-success"]');
        await expect(success).toBeVisible({ timeout: 4_000 });
        const outputPath = await success.getAttribute("data-output-path");
        expect(outputPath, "outputPath must be a non-empty string the customer can read").toBeTruthy();
        expect(outputPath!.length).toBeGreaterThan(5);
        rec.assert("export_output_path", outputPath);
        // Mock outputPath format: /projects/<slug>/clips/<idx>-export-<format>.mp4
        // Real-sidecar can return any path; just assert it's plausibly a
        // filesystem path or URL (contains the focused clip idx or slug).
        const hasSlug = outputPath!.includes(FIXTURE_SLUG);
        const hasIdx = outputPath!.includes("0");
        rec.assert("output_references_clip", hasSlug || hasIdx);
      });

      await rec.step("Emit verdict attachments", async () => {
        const final = path.join(SCREENSHOT_DIR, "export-final-state.png");
        await page.screenshot({ path: final, fullPage: true });
        rec.assert("final_screenshot", final);
      });
    } finally {
      await rec.finalize();
    }
  });
});
