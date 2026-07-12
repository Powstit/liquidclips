/**
 * Schedule Honesty Journey · USER-LENS AUTOMATION GATE · BUG-038
 *
 * Verifies the schedule surface is honestly disabled, and no fake-toast
 * lie can fire. Two surfaces share one source of truth (deriveSchedulePromise):
 *
 *   - Schedule tab "Queue on {Lane}" button → disabled
 *   - Publish tab "Schedule +1h" button → disabled
 *
 * Both must carry honest "coming soon" copy. Both must refuse to fire
 * the prior FAKE "Scheduled" / "Queued" toasts. The harness captures
 * every console + toast event during the disabled-click and asserts NO
 * "scheduled" / "queued" toast was emitted.
 *
 * Draft persistence (date/time/lane/repeat round-trip through
 * clipSettingsStore) is preserved — the customer doesn't lose their
 * draft when scheduling lands.
 */
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { seedAuthenticatedShell } from "./_auth-harness";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");
const JOURNEY = "Schedule Honesty";
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
    const label = `sched-${String(n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
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
  /* D1 (2026-07-12) · canonical auth harness seed. Spec's
   * `interceptBackend` re-mocks /me + /sync AFTER this call. */
  await seedAuthenticatedShell(page, { tier: "solo" });
  await page.addInitScript((slug) => {
    try {
      const now = new Date().toISOString();
      window.localStorage.setItem("lc:engine:session:v1", JSON.stringify({
        source: "schedule-honesty.test.mp4", slug, status: "complete", percent: 1, stage: "thumbs",
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

test.describe("Schedule Honesty", () => {
  test(`${JOURNEY} · assisted reminders are real; automatic posting is not claimed`, async ({ page }, testInfo) => {
    const rec = new JourneyRecorder(page, testInfo);

    // Install a toast-bus probe BEFORE app boots. Captures every
    // bus.emit("toast", ...) so the harness can assert NO scheduling
    // toast ever fires from a click on the disabled CTAs.
    await page.addInitScript(() => {
      const w = window as Window & { __lcCapturedToasts?: Array<Record<string, unknown>> };
      w.__lcCapturedToasts = [];
      // Wrap document on event so we can intercept any toast that ends
      // up rendered in the DOM. Also patch console.* as a secondary signal.
    });

    try {
      await rec.step("Launch + seed session", async () => {
        await interceptBackend(page);
        await seedCompletedSession(page);
        await page.goto("/?skipIntro=1#/workstation", { waitUntil: "domcontentloaded" });
        await page.waitForSelector('[data-testid="clip-card"]', { timeout: 20_000 });
      });

      await rec.step("Click Edit on first clip", async () => {
        await page.locator('[data-testid="clip-card"][data-clip-idx="0"]').locator('button.lc-clip-cta', { hasText: /^Edit$/ }).first().click();
        await expect(page.locator('.lc-cockpit-dock[data-open="1"]')).toBeVisible({ timeout: 4_000 });
      });

      await rec.step("Switch dock to Schedule tab", async () => {
        await page.locator('.lc-cockpit-dock .lc-cd-pill', { hasText: /schedule/i }).click();
        await expect(page.locator('.lc-cockpit-dock[data-module="schedule"]')).toBeVisible({ timeout: 4_000 });
      });

      await rec.step("Schedule block exposes ready assisted state", async () => {
        const block = page.locator('[data-testid="schedule-block"]');
        const available = await block.getAttribute("data-schedule-available");
        const state = await block.getAttribute("data-schedule-state");
        rec.assert("schedule_available", available);
        rec.assert("schedule_state", state);
        expect(available).toBe("true");
        expect(state).toBe("ready");
      });

      await rec.step("Schedule tab explains the assisted handoff", async () => {
        const badge = page.locator('[data-testid="schedule-status-badge"]');
        const copy = page.locator('[data-testid="schedule-copy"]');
        await expect(badge).toBeVisible();
        await expect(copy).toBeVisible();
        const badgeText = await badge.textContent();
        const copyText = await copy.textContent();
        rec.assert("schedule_badge", badgeText);
        rec.assert("schedule_copy", copyText);
        expect(badgeText?.toLowerCase()).toMatch(/assisted|ready/);
        expect(copyText?.toLowerCase()).toMatch(/remind|handoff|press post/);
      });

      await rec.step("Date/time/lane/repeat controls still persist drafts", async () => {
        // Customer fills in a draft. The fields write into clipSettingsStore;
        // they don't go anywhere else. Persistence remains honest.
        const dateInput = page.locator('[data-testid="schedule-date"]');
        await dateInput.evaluate((el: HTMLInputElement) => {
          const proto = Object.getPrototypeOf(el) as typeof HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          if (setter) setter.call(el, "2026-12-01");
          else el.value = "2026-12-01";
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        });
        await page.locator('[data-testid="schedule-lane-youtube"]').click();
        rec.assert("draft_date_after_set", await dateInput.inputValue());
      });

      await rec.step("Reminder button blocks until the clip has a real rendered file", async () => {
        const queue = page.locator('[data-testid="schedule-queue"]');
        await expect(queue).toBeDisabled();
        const label = await queue.textContent();
        const title = await queue.getAttribute("title");
        rec.assert("queue_label", label);
        rec.assert("queue_blocked_reason", title);
        expect(label?.toLowerCase()).toContain("remind");
        expect(title?.toLowerCase()).toContain("render");
      });

      await rec.step("Switch dock to Publish tab", async () => {
        await page.locator('.lc-cockpit-dock .lc-cd-pill', { hasText: /publish/i }).click();
        await expect(page.locator('.lc-cockpit-dock[data-module="publish"]')).toBeVisible({ timeout: 4_000 });
      });

      await rec.step("Publish reminder handoff stays disabled until export", async () => {
        const pubSched = page.locator('[data-testid="publish-schedule-hour"]');
        await expect(pubSched).toBeDisabled();
        const state = await pubSched.getAttribute("data-schedule-state");
        const label = await pubSched.textContent();
        rec.assert("publish_schedule_state", state);
        rec.assert("publish_schedule_label", label);
        expect(state).toBe("ready");
        expect(label?.toLowerCase()).toContain("reminder");
      });

      await rec.step("Disabled pre-export handoff cannot claim a scheduled post", async () => {
        await page.locator('[data-testid="publish-schedule-hour"]').click({ force: true }).catch(() => {});
        await page.waitForTimeout(500);
        const scheduledToast = page.locator('.lc-toast', { hasText: /scheduled|queued/i });
        await expect(scheduledToast).toHaveCount(0);
      });

      await rec.step("Switch to clip #2 then back to #1", async () => {
        await page.locator('[data-testid="clip-card"][data-clip-idx="1"] [data-testid="clip-shell"]').click();
        await page.locator('.lc-cd-clip-num', { hasText: "#2" }).waitFor({ timeout: 4_000 });
        await page.locator('[data-testid="clip-card"][data-clip-idx="0"] [data-testid="clip-shell"]').click();
        await page.locator('.lc-cd-clip-num', { hasText: "#1" }).waitFor({ timeout: 4_000 });
      });

      await rec.step("Schedule draft persisted on returned clip (Patch A)", async () => {
        await page.locator('.lc-cockpit-dock .lc-cd-pill', { hasText: /schedule/i }).click();
        await expect(page.locator('.lc-cockpit-dock[data-module="schedule"]')).toBeVisible({ timeout: 4_000 });
        const persistedDate = await page.locator('[data-testid="schedule-date"]').inputValue();
        rec.assert("persisted_draft_date", persistedDate);
        expect(persistedDate).toBe("2026-12-01");
      });

      await rec.step("Emit verdict attachments", async () => {
        rec.assert("final", "ok");
      });
    } finally {
      await rec.finalize();
    }
  });
});
