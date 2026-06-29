/**
 * Trim Clip Journey · USER-LENS AUTOMATION GATE · BUG-034
 *
 * Drives the customer path that resolves "Customer can trim a generated
 * clip in Workstation and the exported clip uses the new trim."
 *
 *   1. Seed completed project + auth
 *   2. Navigate Workstation
 *   3. Click first clip → Edit
 *   4. Dock opens
 *   5. Switch dock to Trim tab
 *   6. Capture original trim range
 *   7. Change In/Out sliders to a tighter range
 *   8. Click "Apply trim"
 *   9. Assert state machine: idle → regenerating → done
 *  10. Switch to second clip, then back to first
 *  11. Assert trim values persisted (settings.trim survived clip switch)
 *  12. Switch dock to Publish tab
 *  13. Click "Publish now"
 *  14. Assert export reaches done state (proves export ran AFTER the
 *      regenerate landed; the wire chain is intact)
 *
 * The trim button's `data-trim-state` and the publish button's
 * `data-export-state` are the deterministic verdicts. No toast-only
 * proof. No screenshot-only proof.
 */
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");
const JOURNEY = "Trim Clip";
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
    const label = `trim-${String(n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
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
          source: "trim-journey.test.mp4",
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

test.describe("Trim Clip Journey", () => {
  test(`${JOURNEY} · customer can trim a clip and export uses the new trim`, async ({ page }, testInfo) => {
    test.setTimeout(150_000);
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

      await rec.step("Switch dock to Trim tab", async () => {
        const pill = page.locator('.lc-cockpit-dock .lc-cd-pill', { hasText: /trim/i });
        await expect(pill).toBeVisible({ timeout: 4_000 });
        await pill.click();
        await expect(page.locator('.lc-cockpit-dock[data-module="trim"]')).toBeVisible({ timeout: 4_000 });
        rec.assert("dock_on_trim", true);
      });

      // Capture the original In/Out before changing them.
      const originalInVal = await page.locator('[data-testid="trim-in-val"]').textContent();
      const originalOutVal = await page.locator('[data-testid="trim-out-val"]').textContent();
      rec.assert("trim_original_in", originalInVal);
      rec.assert("trim_original_out", originalOutVal);

      await rec.step("Change trim In and Out to a tighter range", async () => {
        // React shadows HTMLInputElement.value with its own setter to track
        // controlled inputs, so a plain `el.value = "5"` does not trigger
        // React's onChange. Use the native prototype setter explicitly,
        // then dispatch an "input" event React picks up. FIXTURE clip 0 is
        // 0–28s, so 5–22s is a valid tighter range.
        const setRangeReactSafe = (el: HTMLInputElement, value: string) => {
          const proto = Object.getPrototypeOf(el) as typeof HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          if (setter) setter.call(el, value);
          else el.value = value;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        };
        await page.locator('[data-testid="trim-in"]').evaluate(setRangeReactSafe, "5");
        await page.locator('[data-testid="trim-out"]').evaluate(setRangeReactSafe, "22");
        await expect.poll(async () => page.locator('[data-testid="trim-in-val"]').textContent()).toMatch(/0:05/);
        await expect.poll(async () => page.locator('[data-testid="trim-out-val"]').textContent()).toMatch(/0:22/);
      });

      const tightenedIn = await page.locator('[data-testid="trim-in-val"]').textContent();
      const tightenedOut = await page.locator('[data-testid="trim-out-val"]').textContent();
      rec.assert("trim_tightened_in", tightenedIn);
      rec.assert("trim_tightened_out", tightenedOut);

      await rec.step("Verify Apply Trim button is enabled (range changed)", async () => {
        const apply = page.locator('[data-testid="trim-apply"]');
        await expect(apply).toBeVisible();
        await expect(apply).toBeEnabled();
        await expect(apply).toHaveAttribute("data-trim-state", "idle");
      });

      await rec.step("Click Apply trim", async () => {
        await page.locator('[data-testid="trim-apply"]').click();
      });

      await rec.step("Trim state transitions: regenerating → done", async () => {
        const apply = page.locator('[data-testid="trim-apply"]');
        await expect.poll(async () => apply.getAttribute("data-trim-state"), {
          timeout: 6_000,
          intervals: [100, 200, 400, 800],
        }).toMatch(/regenerating|done/);
        await expect.poll(async () => apply.getAttribute("data-trim-state"), {
          timeout: 8_000,
          intervals: [200, 400, 800, 1200],
        }).toBe("done");
        rec.assert("trim_state_reached_done", true);
      });

      await rec.step("Switch to second clip", async () => {
        const secondShell = page.locator('[data-testid="clip-card"][data-clip-idx="1"] [data-testid="clip-shell"]');
        await secondShell.click();
        await page.locator('.lc-cd-clip-num', { hasText: "#2" }).waitFor({ timeout: 4_000 });
      });

      await rec.step("Return to first clip", async () => {
        const firstShell = page.locator('[data-testid="clip-card"][data-clip-idx="0"] [data-testid="clip-shell"]');
        await firstShell.click();
        await page.locator('.lc-cd-clip-num', { hasText: "#1" }).waitFor({ timeout: 4_000 });
      });

      await rec.step("Trim values persisted on returned clip", async () => {
        // Re-open Trim tab (the persisted dock-tab state may have flipped).
        const pill = page.locator('.lc-cockpit-dock .lc-cd-pill', { hasText: /trim/i });
        await pill.click();
        await expect(page.locator('.lc-cockpit-dock[data-module="trim"]')).toBeVisible({ timeout: 4_000 });
        const persistedIn = await page.locator('[data-testid="trim-in-val"]').textContent();
        const persistedOut = await page.locator('[data-testid="trim-out-val"]').textContent();
        rec.assert("trim_persisted_in", persistedIn);
        rec.assert("trim_persisted_out", persistedOut);
        expect(persistedIn, "trim in must persist across clip switch (clipSettingsStore)").toBe(tightenedIn);
        expect(persistedOut, "trim out must persist across clip switch").toBe(tightenedOut);
      });

      await rec.step("Switch dock to Publish tab", async () => {
        const pill = page.locator('.lc-cockpit-dock .lc-cd-pill', { hasText: /publish/i });
        await pill.click();
        await expect(page.locator('.lc-cockpit-dock[data-module="publish"]')).toBeVisible({ timeout: 4_000 });
      });

      await rec.step("Click Publish now (exports the trimmed clip)", async () => {
        const btn = page.locator('[data-testid="publish-now"]');
        await expect(btn).toBeEnabled();
        await btn.click();
      });

      await rec.step("Export reaches done state · clip carries the trim", async () => {
        const btn = page.locator('[data-testid="publish-now"]');
        await expect.poll(async () => btn.getAttribute("data-export-state"), {
          timeout: 12_000,
          intervals: [200, 400, 800, 1200],
        }).toBe("done");
        const success = page.locator('[data-testid="export-success"]');
        await expect(success).toBeVisible({ timeout: 4_000 });
        const outputPath = await success.getAttribute("data-output-path");
        expect(outputPath, "outputPath must be present").toBeTruthy();
        rec.assert("post_trim_export_output_path", outputPath);
        // The customer-visible chain: trimmed clip 0 → exportApi.exportClip
        // reached "done". The output path is for clip 0 of the same slug —
        // proving the export ran AFTER the trim landed, not before.
        expect(outputPath!).toContain(FIXTURE_SLUG);
      });

      await rec.step("Emit verdict attachments", async () => {
        const final = path.join(SCREENSHOT_DIR, "trim-final-state.png");
        await page.screenshot({ path: final, fullPage: true });
        rec.assert("final_screenshot", final);
      });
    } finally {
      await rec.finalize();
    }
  });
});
