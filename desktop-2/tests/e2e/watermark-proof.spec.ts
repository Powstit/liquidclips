/**
 * Watermark Proof Journey · USER-LENS AUTOMATION GATE · BUG-036
 *
 * Verifies the watermark contract between UI preview and export behavior
 * — NOT billing, NOT payouts, NOT Whop. Just exported-asset truth.
 *
 *   Phase A · Free tier (clipper)
 *     - preview MUST show watermark badge
 *     - toggle MUST be locked
 *     - export payload MUST carry watermark=true
 *     - success affordance MUST say "watermarked"
 *
 *   Phase B · Paid tier (pro)
 *     - toggle MUST be unlocked
 *     - user toggles "Watermark off"
 *     - preview badge MUST disappear
 *     - export payload MUST carry watermark=false
 *     - success affordance MUST say "clean"
 *
 *   Phase C · Unknown / unauthenticated tier
 *     - toggle MUST be locked
 *     - honest copy MUST mention unknown/checking/not-confirmed
 *     - preview badge MUST be shown (safe default)
 *     - export payload MUST carry watermark=true (no clean-export leak)
 *
 * One test, one verdict, three sequential phases. Tier is driven via
 * `window.__lcDebugSetTier(...)` (paid scenario) and via /me intercept
 * choice (free + unknown scenarios). DOM `data-*` attributes are the
 * verdict — no pixel detection.
 */
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { seedAuthenticatedShell } from "./_auth-harness";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");
const JOURNEY = "Watermark Proof";
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
    const label = `wm-${String(n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
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

type InterceptMode = "ok" | "blocked";

async function applyBackendIntercept(page: Page, mode: InterceptMode, meTier?: string) {
  // Clear any prior routes from previous phases.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  if (mode === "blocked") {
    await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }),
    );
    await page.route(/api\.liquidclips\.app\/sync(\?.*)?$/, (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }),
    );
  } else {
    const successMe = {
      user: { id: "harness", email: "harness@liquidclips.test", tier: meTier ?? "solo" },
      tier: meTier ?? "solo",
    };
    const successSync = { tier: meTier ?? "solo", caps: { watermarkLocked: meTier === "free" } };
    await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(successMe) }),
    );
    await page.route(/api\.liquidclips\.app\/sync(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(successSync) }),
    );
  }
  await page.route(/api\.liquidclips\.app\//, (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    return route.continue();
  });
}

async function seedCompletedSession(page: Page) {
  /* D1 (2026-07-12) · canonical auth harness seed. */
  await seedAuthenticatedShell(page, { tier: "solo" });
  await page.addInitScript((slug) => {
    try {
      const now = new Date().toISOString();
      window.localStorage.setItem(
        "lc:engine:session:v1",
        JSON.stringify({
          source: "watermark-proof.test.mp4",
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
      // BUG-036 step-15 fix · collect-then-remove. The naive forward
      // iterator with removeItem skips entries because length shrinks.
      // Phase B's lc.clip.<slug>:0 (watermark=false) would otherwise
      // bleed into Phase C and the unknown-tier safe-default assertion
      // would fail. Collect all matching keys first, then remove.
      const stale: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(`lc.clip.${slug}:`)) stale.push(k);
      }
      for (const k of stale) window.localStorage.removeItem(k);
    } catch { /* private mode / quota — degrade silently */ }
  }, FIXTURE_SLUG);
}

async function openWorkstationOnPublishTab(page: Page) {
  await page.goto("/?skipIntro=1#/workstation", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="clip-card"]', { timeout: 20_000 });
  const firstCard = page.locator('[data-testid="clip-card"][data-clip-idx="0"]');
  await firstCard.locator('button.lc-clip-cta', { hasText: /^Edit$/ }).first().click();
  await expect(page.locator('.lc-cockpit-dock[data-open="1"]')).toBeVisible({ timeout: 4_000 });
  await page.locator('.lc-cockpit-dock .lc-cd-pill', { hasText: /publish/i }).click();
  await expect(page.locator('.lc-cockpit-dock[data-module="publish"]')).toBeVisible({ timeout: 4_000 });
}

async function setTierViaDebugHook(page: Page, tier: "clipper" | "pro" | "agency" | null) {
  await page.evaluate((t) => {
    const w = window as Window & { __lcDebugSetTier?: (t: string | null) => void };
    if (typeof w.__lcDebugSetTier === "function") w.__lcDebugSetTier(t);
  }, tier);
}

test.describe("Watermark Proof", () => {
  test(`${JOURNEY} · preview promise matches export across Free / Paid / Unknown`, async ({ page }, testInfo) => {
    // This is three complete export journeys plus per-step evidence
    // capture. Production preview routinely needs more than the global
    // 90-second single-journey budget under full-suite load.
    testInfo.setTimeout(180_000);
    const rec = new JourneyRecorder(page, testInfo);

    try {
      // ════════════════════════════════════════════════════════════════
      // PHASE A · FREE TIER
      // ════════════════════════════════════════════════════════════════
      await rec.step("Phase A · Seed Free-tier session", async () => {
        await applyBackendIntercept(page, "ok", "free");
        await seedCompletedSession(page);
      });

      await rec.step("Phase A · Open Workstation → Publish tab", async () => {
        await openWorkstationOnPublishTab(page);
        await setTierViaDebugHook(page, "clipper");
        await expect.poll(async () =>
          page.locator('[data-testid="watermark-block"]').getAttribute("data-watermark-tier")
        , { timeout: 4_000 }).toBe("clipper");
      });

      await rec.step("Phase A · Preview shows watermark badge", async () => {
        const stage = page.locator('[data-testid="preview-stage"]');
        await expect(page.locator('[data-testid="preview-watermark-badge"]')).toBeVisible();
        const v = await stage.getAttribute("data-watermark-visible");
        rec.assert("free_preview_visible", v);
        expect(v).toBe("true");
      });

      await rec.step("Phase A · Toggle is locked + 'free-locked' state + copy says Free", async () => {
        const block = page.locator('[data-testid="watermark-block"]');
        const toggle = page.locator('[data-testid="watermark-toggle"]');
        const copy = page.locator('[data-testid="watermark-copy"]');
        await expect(toggle).toBeDisabled();
        rec.assert("free_locked",    await block.getAttribute("data-watermark-locked"));
        rec.assert("free_effective", await block.getAttribute("data-watermark-effective"));
        rec.assert("free_state",     await block.getAttribute("data-watermark-state"));
        rec.assert("free_copy",      await copy.textContent());
        expect(await block.getAttribute("data-watermark-locked")).toBe("true");
        expect(await block.getAttribute("data-watermark-effective")).toBe("true");
        expect(await block.getAttribute("data-watermark-state")).toBe("free-locked");
        expect((await copy.textContent())?.toLowerCase()).toMatch(/free tier/);
      });

      await rec.step("Phase A · Export carries watermark=true", async () => {
        await page.locator('[data-testid="publish-now"]').click();
        const btn = page.locator('[data-testid="publish-now"]');
        await expect.poll(async () => btn.getAttribute("data-export-state"), {
          timeout: 12_000,
          intervals: [200, 400, 800, 1200],
        }).toBe("done");
        const success = page.locator('[data-testid="export-success"]');
        await expect(success).toBeVisible();
        const exportedWm = await success.getAttribute("data-export-watermark");
        const successText = await success.textContent();
        rec.assert("free_export_watermark", exportedWm);
        rec.assert("free_export_success_text", successText);
        expect(exportedWm).toBe("true");
        expect(successText?.toLowerCase()).toContain("watermarked");
      });

      // ════════════════════════════════════════════════════════════════
      // PHASE B · PAID TIER
      // ════════════════════════════════════════════════════════════════
      await rec.step("Phase B · Re-seed Paid-tier session + fresh context", async () => {
        await page.context().clearCookies();
        // Wipe persisted dock+clip state so phase B starts deterministic.
        await page.evaluate((slug) => {
          for (let i = window.localStorage.length - 1; i >= 0; i--) {
            const k = window.localStorage.key(i);
            if (k && k.startsWith(`lc.clip.${slug}:`)) window.localStorage.removeItem(k);
          }
        }, FIXTURE_SLUG);
        await applyBackendIntercept(page, "ok", "solo");
        await seedCompletedSession(page);
      });

      await rec.step("Phase B · Open Workstation → Publish tab", async () => {
        await openWorkstationOnPublishTab(page);
        await setTierViaDebugHook(page, "pro");
        await expect.poll(async () =>
          page.locator('[data-testid="watermark-block"]').getAttribute("data-watermark-tier")
        , { timeout: 4_000 }).toBe("pro");
      });

      await rec.step("Phase B · Toggle is unlocked (Paid)", async () => {
        const block = page.locator('[data-testid="watermark-block"]');
        await expect(page.locator('[data-testid="watermark-toggle"]')).toBeEnabled();
        rec.assert("paid_locked", await block.getAttribute("data-watermark-locked"));
        expect(await block.getAttribute("data-watermark-locked")).toBe("false");
      });

      await rec.step("Phase B · Customer flips watermark OFF", async () => {
        await page.locator('[data-testid="watermark-toggle"]').click();
        const block = page.locator('[data-testid="watermark-block"]');
        await expect.poll(async () => block.getAttribute("data-watermark-effective"), {
          timeout: 2_000, intervals: [50, 100, 200],
        }).toBe("false");
        rec.assert("paid_state_after_off", await block.getAttribute("data-watermark-state"));
        const copy = await page.locator('[data-testid="watermark-copy"]').textContent();
        rec.assert("paid_copy_after_off", copy);
        expect(copy?.toLowerCase()).toMatch(/clean/);
      });

      await rec.step("Phase B · Preview badge disappears", async () => {
        const stage = page.locator('[data-testid="preview-stage"]');
        rec.assert("paid_preview_after_off", await stage.getAttribute("data-watermark-visible"));
        expect(await stage.getAttribute("data-watermark-visible")).toBe("false");
        await expect(page.locator('[data-testid="preview-watermark-badge"]')).toHaveCount(0);
      });

      await rec.step("Phase B · Export carries watermark=false (clean)", async () => {
        await page.locator('[data-testid="publish-now"]').click();
        const btn = page.locator('[data-testid="publish-now"]');
        await expect.poll(async () => btn.getAttribute("data-export-state"), {
          timeout: 12_000, intervals: [200, 400, 800, 1200],
        }).toBe("done");
        const success = page.locator('[data-testid="export-success"]');
        await expect(success).toBeVisible();
        const exportedWm = await success.getAttribute("data-export-watermark");
        const successText = await success.textContent();
        rec.assert("paid_export_watermark", exportedWm);
        rec.assert("paid_export_success_text", successText);
        expect(exportedWm).toBe("false");
        expect(successText?.toLowerCase()).toContain("clean");
      });

      // ════════════════════════════════════════════════════════════════
      // PHASE C · UNKNOWN / SYNC-FAILED TIER
      // ════════════════════════════════════════════════════════════════
      await rec.step("Phase C · Block /me + /sync (unknown tier)", async () => {
        await page.evaluate((slug) => {
          for (let i = window.localStorage.length - 1; i >= 0; i--) {
            const k = window.localStorage.key(i);
            if (k && k.startsWith(`lc.clip.${slug}:`)) window.localStorage.removeItem(k);
          }
        }, FIXTURE_SLUG);
        await applyBackendIntercept(page, "blocked");
        await seedCompletedSession(page);
      });

      await rec.step("Phase C · Open Workstation → Publish tab + clear debug-override", async () => {
        await openWorkstationOnPublishTab(page);
        // BUG-036 harness · explicitly clear any debug-override left over
        // from Phase B. The harness probe (see verdict assertions for
        // phaseC_probe) confirmed the preview's useTierCaps could land
        // with debugOverride="pro" residue even after page.goto, while
        // the dock's instance saw "fixture-fallback" — the two diverged.
        // Clearing the override forces both to take the /me-driven path
        // for an honest "unknown / fixture-fallback" unknown-tier scenario.
        await setTierViaDebugHook(page, null);
        // Sanity: poll until both surfaces agree on a fallback source.
        await expect.poll(async () => ({
          dock: await page.locator('[data-testid="watermark-block"]').getAttribute("data-watermark-tier-source"),
          preview: await page.locator('[data-testid="preview-stage"]').getAttribute("data-watermark-tier-source"),
        }), {
          timeout: 4_000,
          intervals: [100, 200, 400, 800],
          message: "preview tier-source must agree with dock after debug-override clear",
        }).toEqual({ dock: "fixture-fallback", preview: "fixture-fallback" });
      });

      await rec.step("Phase C · Toggle is locked + honest copy mentions unknown/checking", async () => {
        const block = page.locator('[data-testid="watermark-block"]');
        await expect(page.locator('[data-testid="watermark-toggle"]')).toBeDisabled();
        const locked    = await block.getAttribute("data-watermark-locked");
        const effective = await block.getAttribute("data-watermark-effective");
        const state     = await block.getAttribute("data-watermark-state");
        const source    = await block.getAttribute("data-watermark-tier-source");
        const copy      = await page.locator('[data-testid="watermark-copy"]').textContent();
        rec.assert("unknown_locked", locked);
        rec.assert("unknown_effective", effective);
        rec.assert("unknown_state", state);
        rec.assert("unknown_source", source);
        rec.assert("unknown_copy", copy);
        expect(locked).toBe("true");
        expect(effective).toBe("true");
        expect(state).toMatch(/unknown|loading/);
        expect(source).toMatch(/unknown|fixture-fallback/);
        expect(copy?.toLowerCase()).toMatch(/(unknown|checking|not confirmed)/);
      });

      await rec.step("Phase C · Preview badge shown (safe default)", async () => {
        const stage = page.locator('[data-testid="preview-stage"]');
        const visible = await stage.getAttribute("data-watermark-visible");
        const stageTier = await stage.getAttribute("data-watermark-tier");
        const stageSource = await stage.getAttribute("data-watermark-tier-source");
        rec.assert("unknown_preview_visible", visible);
        rec.assert("unknown_preview_stage_tier", stageTier);
        rec.assert("unknown_preview_stage_source", stageSource);
        // Causal probe: surface the preview's view of tier vs the dock's view
        // so any divergence (the bug we're checking for!) is in the verdict.
        expect(visible).toBe("true");
        await expect(page.locator('[data-testid="preview-watermark-badge"]')).toBeVisible();
      });

      await rec.step("Phase C · Export carries watermark=true (no clean-export leak)", async () => {
        await page.locator('[data-testid="publish-now"]').click();
        const btn = page.locator('[data-testid="publish-now"]');
        await expect.poll(async () => btn.getAttribute("data-export-state"), {
          timeout: 12_000, intervals: [200, 400, 800, 1200],
        }).toBe("done");
        const success = page.locator('[data-testid="export-success"]');
        await expect(success).toBeVisible();
        const exportedWm = await success.getAttribute("data-export-watermark");
        const successText = await success.textContent();
        rec.assert("unknown_export_watermark", exportedWm);
        rec.assert("unknown_export_success_text", successText);
        expect(exportedWm).toBe("true");
        expect(successText?.toLowerCase()).toContain("watermarked");
      });

      await rec.step("Emit verdict attachments", async () => {
        const final = path.join(SCREENSHOT_DIR, "watermark-final-state.png");
        await page.screenshot({ path: final, fullPage: true });
        rec.assert("final_screenshot", final);
      });
    } finally {
      await rec.finalize();
    }
  });
});
