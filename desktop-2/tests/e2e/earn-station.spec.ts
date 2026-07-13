/**
 * Earn Station Journey · USER-LENS AUTOMATION GATE · BUG-045
 *
 * The Earn surface previously sourced 8 hardcoded RewardClips with real-
 * istic click counts (1420 / 980 / 420 / 280 / 12) that derived a
 * visible $9.34 lifetime / $2.10 pending — surfaced on BOTH the Earn
 * route AND the Home earn strip via BUG-040's single-source. Plus a
 * leaderboard seed with 5 fake users showing $12,420 lifetime earnings
 * and 88 paidReferrals, with `isCaller: true` pretending the customer
 * was @uncle.daniel at rank #2.
 *
 * The harness verifies the honest-stub fix:
 *
 *   1. /#/earn renders with source=mock, clip count = 0, lifetime $0,
 *      pending $0.
 *   2. Source pill says "Backend offline · preview only" in ALL builds.
 *   3. Offline banner visible with honest copy explaining no fake balance.
 *   4. ZERO RewardClipRows render.
 *   5. ZERO leaderboard rows (no fake $12,420 / @maya.clips).
 *   6. Home earn strip (BUG-040 single-source) reads the SAME zeros.
 *   7. Lifetime-earned tag shows $0.00 (real-computed, not faked).
 */
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { seedAuthenticatedShell } from "./_auth-harness";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");
const JOURNEY = "Earn Station";

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
    const label = `earn-${String(n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
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
  await page.route(/api\.liquidclips\.app\//, (route) => {
    if (route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    return route.continue();
  });
  await page.route(/api\.liquidclips\.app\/sync(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sync) }));
  await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(me) }));
}

async function seedAuth(page: Page) {
  /* D1 (2026-07-12) · canonical auth harness seed. The spec's
   * `interceptBackend` re-mocks /me + /sync with a solo-tier body AFTER
   * this call; Playwright reverse-registration priority lets those wins
   * for the specific endpoints. */
  await seedAuthenticatedShell(page, { tier: "solo" });
}

test.describe("Earn Station Journey", () => {
  test(`${JOURNEY} · honest zeros · zero fake balances · zero fake leaderboard · single-source matches Home`, async ({ page }, testInfo) => {
    test.fixme(
      true,
      "D1 residual (2026-07-13) · WalletDetail parity gap · money-surface rule 2026-07-10 " +
        "retired Design-OS EarnRoute and its data attribute contract (data-earn-source, " +
        "data-earn-clip-count, data-earn-lifetime-earned, data-earn-pending, " +
        "earn-source-pill, earn-offline-banner, earn-lifetime-tag). `#/earn` now resolves to " +
        "Section-pipeline WalletDetail; the offline+empty+zero contract lives on wallet-panel " +
        "data-state='offline'|'empty' + wallet-hero-amount + wallet-offline-retry. Re-author " +
        "as a WalletDetail-native honest-zeros walk when the Section pipeline surfaces an " +
        "earn-summary data-attr set with parity to the retired EarnRoute contract.",
    );
    const rec = new JourneyRecorder(page, testInfo);

    try {
      await rec.step("Launch /#/earn", async () => {
        await interceptBackend(page);
        await seedAuth(page);
        await page.goto("/?skipIntro=1#/earn", { waitUntil: "domcontentloaded" });
        await expect(page.locator('[data-testid="earn-stage"]')).toBeVisible({ timeout: 15_000 });
      });

      await rec.step("Stage exposes source=mock · zero clips · zero earnings", async () => {
        const stage = page.locator('[data-testid="earn-stage"]');
        const source = await stage.getAttribute("data-earn-source");
        const clipCount = await stage.getAttribute("data-earn-clip-count");
        const lifetime = await stage.getAttribute("data-earn-lifetime-earned");
        const pending = await stage.getAttribute("data-earn-pending");
        rec.assert("earn_source", source);
        rec.assert("earn_clip_count", clipCount);
        rec.assert("earn_lifetime", lifetime);
        rec.assert("earn_pending", pending);
        expect(source).toBe("mock");
        expect(clipCount).toBe("0");
        // Real-computed zero, not a faked dollar amount.
        expect(Number(lifetime)).toBe(0);
        expect(Number(pending)).toBe(0);
      });

      await rec.step("Source pill says 'Backend offline · preview only'", async () => {
        const pill = page.locator('[data-testid="earn-source-pill"]');
        await expect(pill).toBeVisible();
        const dataSource = await pill.getAttribute("data-source");
        const text = await pill.textContent();
        rec.assert("earn_pill_data", dataSource);
        rec.assert("earn_pill_text", text);
        expect(dataSource).toBe("mock");
        expect(text?.toLowerCase()).toMatch(/backend offline|preview only/);
      });

      await rec.step("Offline banner visible with honest 'no balance' copy", async () => {
        const banner = page.locator('[data-testid="earn-offline-banner"]');
        await expect(banner).toBeVisible();
        const text = await banner.textContent();
        rec.assert("earn_banner_text", text);
        expect(text?.toLowerCase()).toMatch(/no earnings|no fake balance|not reachable/);
      });

      await rec.step("Lifetime-earned tag shows $0.00 (real-computed, not faked)", async () => {
        const tag = page.locator('[data-testid="earn-lifetime-tag"]');
        await expect(tag).toBeVisible();
        const text = await tag.textContent();
        rec.assert("earn_lifetime_tag_text", text);
        expect(text).toContain("$0.00");
        // Specifically: NOT the prior fake $9.34 value.
        expect(text).not.toContain("$9.34");
      });

      await rec.step("ZERO RewardClipRows render · the 8-clip fake seed is gone", async () => {
        // RewardClipRow renders one row per clip. Check for the row primitive.
        const rows = page.locator('.lc-rcr, .lc-reward-clip-row, .lc-rcl-row, [data-testid="reward-clip-row"]');
        const count = await rows.count();
        rec.assert("reward_clip_row_count", count);
        expect(count).toBe(0);
      });

      await rec.step("ZERO leaderboard rows · the 5-user fake seed is gone", async () => {
        // Leaderboard handles like @maya.clips / @uncle.daniel must not appear.
        // The list itself may or may not render an empty container — what
        // matters is no fake handles + no fake dollar amounts > $0.
        await expect(page.locator('text=@maya.clips')).toHaveCount(0);
        await expect(page.locator('text=@dropcut.studio')).toHaveCount(0);
        await expect(page.locator('text=@vidhustle')).toHaveCount(0);
        await expect(page.locator('text=@scrollcraft')).toHaveCount(0);
        // No "$12,420" / "$9,870" etc. visible.
        const fakeDollars = await page.locator('text=/\\$1[02],?\\d{3}/').count();
        rec.assert("fake_leaderboard_dollar_matches", fakeDollars);
        expect(fakeDollars).toBe(0);
      });

      await rec.step("Filter chips render but no clips match · honest empty list", async () => {
        // EarnFilters chip counts derive from useRewardClips.byFilter.
        // With zero clips, all chip counts should read 0 (or absent).
        // Just confirm no fake row appears under any chip click.
        const chips = page.locator('.lc-earn-filter, .lc-ef-chip').first();
        // Don't fail if no chips render · just probe.
        const chipCount = await page.locator('.lc-earn-filter, .lc-ef-chip').count();
        rec.assert("earn_filter_chip_count", chipCount);
        if (chipCount > 0) {
          // Click the first chip and re-confirm zero rows.
          await chips.click();
          const rows = await page.locator('.lc-rcr, .lc-reward-clip-row, .lc-rcl-row, [data-testid="reward-clip-row"]').count();
          rec.assert("rows_after_first_chip_click", rows);
          expect(rows).toBe(0);
        }
      });

      await rec.step("Cross-station single-source · Home earn strip reads the SAME $0.00", async () => {
        // Navigate to Home · BUG-040 wired the earn strip to useEarnSummary.
        // Same hook · same number on both surfaces.
        await page.evaluate(() => { window.location.hash = "#/home"; });
        await expect(page.locator('[data-testid="home-tile-1"]')).toBeVisible({ timeout: 8_000 });
        const strip = page.locator('[data-testid="home-earn-strip"]');
        await expect(strip).toBeVisible();
        const earned = await strip.getAttribute("data-earn-earned");
        const pending = await strip.getAttribute("data-earn-pending");
        rec.assert("home_earn_earned", earned);
        rec.assert("home_earn_pending", pending);
        // Real-computed zero · matches the Earn route.
        expect(Number(earned)).toBe(0);
        expect(Number(pending)).toBe(0);
        // Visible text must reflect the same number (no shadow lie).
        const earnedText = await page.locator('[data-testid="home-earn-earned"]').textContent();
        rec.assert("home_earn_earned_text", earnedText);
        expect(earnedText).toContain("$0.00");
        expect(earnedText).not.toContain("$9.34");
      });

      await rec.step("Emit verdict attachments", async () => {
        rec.assert("final", "ok");
      });
    } finally {
      await rec.finalize();
    }
  });
});
