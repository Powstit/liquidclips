/**
 * Channels Station Journey · USER-LENS AUTOMATION GATE · BUG-043
 *
 * The Channels surface previously rendered 10 hardcoded fake-connected
 * channels (@uncle.daniel / @ddbeauty / etc.) AND a fake-OAuth-after-3s
 * path that toasted "Linked" without any real backend. The harness
 * verifies the honest-stub fix:
 *
 *   1. /#/channels renders with source-pill = "mock" backend-offline.
 *   2. NO fake-connected channel rows exist in the grid (zero ChannelTiles).
 *   3. Honest "Backend offline" banner visible with no-fake-state copy.
 *   4. AddAccountTile per platform is DISABLED with COMING SOON state.
 *   5. Force-clicking AddAccount tiles fires NO fake-toast lies
 *      (no "Linking…" or "Linked" success message).
 *   6. PublishModule's target-accounts chip group (cross-station) shows
 *      the empty-state "No accounts yet — connect from Channels" copy
 *      AND the export still reaches done · the export wire doesn't lie
 *      about delivering to fake-connected accounts.
 *
 * Mandatory: no real OAuth wired. No fake follower metrics. No fake
 * publish-target promises. Channels station is COMING SOON in mock mode
 * with one source of truth (`channels.source`).
 */
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CANONICAL_HARNESS_JWT,
  harnessAssertShell,
  seedAuthenticatedShell,
} from "./_auth-harness";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");
const JOURNEY = "Channels Station";
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
    const label = `chan-${String(n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
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

/**
 * D1 (2026-07-12) · JWT + /me + /sync + /me/money-rollup +
 * /affiliate/me seeds now flow through the canonical `_auth-harness`.
 * Kept the two wrappers so step names in the describe block below
 * still read cleanly.
 */
async function interceptBackend(page: Page) {
  await seedAuthenticatedShell(page, { tier: "solo" });
}

async function seedAuth(_page: Page) {
  /* JWT + welcome-acked already handled inside seedAuthenticatedShell. */
}

async function seedCompletedSession(page: Page) {
  await page.addInitScript((slug) => {
    try {
      const now = new Date().toISOString();
      window.localStorage.setItem("lc:engine:session:v1", JSON.stringify({
        source: "channels-station.test.mp4", slug, status: "complete", percent: 1, stage: "thumbs",
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

const PLATFORMS = ["tiktok", "instagram", "youtube", "facebook", "x", "linkedin"] as const;

test.describe("Channels Station Journey", () => {
  test(`${JOURNEY} · honest mock-source state · zero fake channels · zero fake OAuth toasts`, async ({ page }, testInfo) => {
    const rec = new JourneyRecorder(page, testInfo);

    try {
      // ───────────────────────────────────────────────────────────────
      // PART A · Channels surface in mock-source mode
      // ───────────────────────────────────────────────────────────────
      await rec.step("Launch /#/channels", async () => {
        await interceptBackend(page);
        await seedAuth(page);
        await page.goto("/?skipIntro=1#/channels", { waitUntil: "domcontentloaded" });
        await harnessAssertShell(page);
        await expect(page.locator('[data-testid="channels-stage"]')).toBeVisible({ timeout: 15_000 });
      });

      await rec.step("Channels stage exposes source=mock + connectedCount=0", async () => {
        const stage = page.locator('[data-testid="channels-stage"]');
        const source = await stage.getAttribute("data-channels-source");
        const count = await stage.getAttribute("data-channels-connected-count");
        rec.assert("channels_source", source);
        rec.assert("channels_connected_count", count);
        expect(source).toBe("mock");
        expect(count).toBe("0");
      });

      await rec.step("Source pill says 'Backend offline · preview only' (honest in ALL builds)", async () => {
        const pill = page.locator('[data-testid="channels-source-pill"]');
        await expect(pill).toBeVisible();
        const dataSource = await pill.getAttribute("data-source");
        const text = await pill.textContent();
        rec.assert("source_pill_data", dataSource);
        rec.assert("source_pill_text", text);
        expect(dataSource).toBe("mock");
        expect(text?.toLowerCase()).toMatch(/backend offline|preview only/);
      });

      await rec.step("Offline banner is visible + honest copy", async () => {
        const banner = page.locator('[data-testid="channels-offline-banner"]');
        await expect(banner).toBeVisible();
        const text = await banner.textContent();
        rec.assert("offline_banner_text", text);
        expect(text?.toLowerCase()).toMatch(/no connected channels|not reachable|backend/);
      });

      await rec.step("Zero fake channel tiles render · the 10-fixture lie is gone", async () => {
        // ChannelTile is the rendering primitive for real connected accounts.
        // None should be present in mock-source mode.
        const tiles = page.locator('.lc-cg-tile, .lc-channel-tile');
        await expect(tiles).toHaveCount(0);
      });

      await rec.step("Each platform's AddAccount tile is disabled with COMING SOON state", async () => {
        const states: Record<string, string | null> = {};
        for (const platform of PLATFORMS) {
          const btn = page.locator(`[data-testid="channels-add-${platform}"]`);
          // Some platforms may render the "Upgrade to connect" empty tile
          // (tier-gated) instead of an AddAccount tile. Check for the
          // AddAccount tile if present; if absent it's the tier-locked
          // empty state — also honest.
          const present = await btn.count();
          if (present > 0) {
            await expect(btn).toBeDisabled();
            states[platform] = await btn.getAttribute("data-channels-add-state");
            expect(states[platform]).toBe("coming-soon");
          } else {
            states[platform] = "tier-locked-empty";
          }
        }
        rec.assert("platform_add_states", states);
      });

      await rec.step("Force-click first AddAccount tile · NO fake-toast lies fire", async () => {
        // The previous FAKE path emitted a "Linking…" toast + a "Linked"
        // toast 3s later. Both must be silent.
        const toastsBefore = await page.locator('.lc-toast').count();
        for (const platform of PLATFORMS) {
          const btn = page.locator(`[data-testid="channels-add-${platform}"]`);
          if (await btn.count() > 0) {
            await btn.click({ force: true }).catch(() => {});
          }
        }
        // Give the prior fake-OAuth setTimeout 3.5s to NOT fire.
        await page.waitForTimeout(3_500);
        const toastsAfter = await page.locator('.lc-toast').count();
        rec.assert("connect_toasts_before", toastsBefore);
        rec.assert("connect_toasts_after_force_click", toastsAfter);
        // No new toasts.
        expect(toastsAfter).toBeLessThanOrEqual(toastsBefore);
        // And specifically: no "Linking…" or "Linked" or "OAuth simulation" lies.
        await expect(page.locator('.lc-toast', { hasText: /linking|linked|oauth|webhook simulation/i })).toHaveCount(0);
      });

      await rec.step("STILL zero fake channels after the click-spam (no fake row persisted)", async () => {
        // The prior FAKE path would persist pending-link rows into the
        // mock cache even when the user clicked. With the honest throw,
        // no rows should exist.
        const tiles = page.locator('.lc-cg-tile, .lc-channel-tile');
        await expect(tiles).toHaveCount(0);
        // Connected-count still 0.
        const count = await page.locator('[data-testid="channels-stage"]').getAttribute("data-channels-connected-count");
        rec.assert("channels_connected_count_after_clicks", count);
        expect(count).toBe("0");
      });

      // ───────────────────────────────────────────────────────────────
      // PART B · Cross-station alignment · Publish target chips
      // ───────────────────────────────────────────────────────────────
      await rec.step("Navigate to Workstation Publish · target chips reflect empty channels", async () => {
        // Write localStorage DIRECTLY before navigation · addInitScript
        // queue ordering interacts unpredictably with prior steps in
        // long specs, so seed deterministically here. seedCompletedSession
        // ALSO adds a queued init script to harden it against the
        // subsequent navigation in step 11.
        await page.evaluate(({ slug, jwt }) => {
          try {
            const now = new Date().toISOString();
            /* Keep the canonical harness JWT identical across the whole
             * suite so all backend route mocks in `_auth-harness.ts`
             * treat this like a returning user. */
            window.localStorage.setItem("lc.license.jwt.v1", jwt);
            window.localStorage.setItem("lc:engine:session:v1", JSON.stringify({
              source: "channels-station.test.mp4", slug, status: "complete", percent: 1, stage: "thumbs",
              runtimeMode: "mock", startedAt: now, updatedAt: now,
            }));
            window.localStorage.setItem("lc.dock.open", "1");
          } catch {}
        }, { slug: FIXTURE_SLUG, jwt: CANONICAL_HARNESS_JWT });
        await seedCompletedSession(page);
        await page.goto("/?skipIntro=1#/workstation", { waitUntil: "domcontentloaded" });
        await page.waitForSelector('[data-testid="clip-card"]', { timeout: 20_000 });
        /* 2026-07-13 · D1 cluster 2 · CTA renamed "Edit" → "Open clip"
         * per Cluster B rename (commit 92ff686d · shell-contracts). */
        await page.locator('[data-testid="clip-card"][data-clip-idx="0"]').locator('button.lc-clip-cta', { hasText: /^Open clip$/ }).first().click();
        await expect(page.locator('.lc-cockpit-dock[data-open="1"]')).toBeVisible({ timeout: 4_000 });
        await page.locator('.lc-cockpit-dock .lc-cd-pill', { hasText: /publish/i }).click();
        await expect(page.locator('.lc-cockpit-dock[data-module="publish"]')).toBeVisible({ timeout: 4_000 });
      });

      await rec.step("Publish target-chips section shows 'No accounts yet' (cross-station honesty)", async () => {
        // The chip group renders an honest empty-state when no channels
        // are connected. We assert that copy is visible — the customer's
        // promise on Channels (no accounts) matches the customer's
        // promise on Publish (no targets).
        const targetSubcopy = page.locator('.lc-cockpit-dock[data-module="publish"]', { hasText: /no accounts yet|connect from channels/i });
        await expect(targetSubcopy.first()).toBeVisible({ timeout: 4_000 });
      });

      await rec.step("Export still reaches done · the export wire doesn't lie about delivering to fake-targets", async () => {
        // Even with zero target accounts, exportApi.exportClip still resolves
        // (mock returns a synthetic outputPath). The point: no fake-delivery
        // promise is made to channels that don't exist.
        await page.locator('[data-testid="publish-now"]').click();
        const btn = page.locator('[data-testid="publish-now"]');
        await expect.poll(async () => btn.getAttribute("data-export-state"), {
          timeout: 12_000, intervals: [200, 400, 800, 1200],
        }).toBe("done");
        const success = page.locator('[data-testid="export-success"]');
        await expect(success).toBeVisible();
        const outputPath = await success.getAttribute("data-output-path");
        rec.assert("export_output_path_with_no_channels", outputPath);
        expect(outputPath).toBeTruthy();
      });

      await rec.step("Emit verdict attachments", async () => {
        rec.assert("final", "ok");
      });
    } finally {
      await rec.finalize();
    }
  });
});
