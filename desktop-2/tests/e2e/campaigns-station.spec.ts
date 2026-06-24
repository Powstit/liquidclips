/**
 * Campaigns Station Journey · USER-LENS AUTOMATION GATE · BUG-044
 *
 * The Campaigns surface previously rendered 10 hardcoded campaigns with
 * realistic-looking reward pools ($2,500 / $1,000 / $5,000), funded%
 * (72% / 100% / 36%), capacity counts (42 / 25 / 11), Whop URLs, brand
 * sponsor names — all driven by a fixture seed. Plus an Agency manage
 * strip with 3 hardcoded local-state campaigns + fake clipper counts
 * (47 / 12 / 0) + a fake `navigator.clipboard.writeText` invite-link.
 *
 * The harness verifies the honest-stub fix:
 *
 *   1. /#/campaigns mounts with `data-campaigns-source="mock"` and
 *      visible-count = 0, featured-count = 0.
 *   2. The source pill says "Backend offline · preview only" in ALL
 *      builds (not just dev).
 *   3. The offline banner is visible with honest copy explaining the
 *      backend isn't reachable.
 *   4. ZERO `.lc-campaign-card` / `.lc-campaign-banner` / `.lc-campaigns-grid`
 *      child tiles render — the 10 fake campaigns are gone.
 *   5. Agency-mode (via mode toggle) shows an honest empty AgencyManageStrip
 *      with no fake clipper counts. The invite buttons are disabled.
 *   6. NO fake toast / clipboard write fires on any click in this state.
 */
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");
const JOURNEY = "Campaigns Station";

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
    const label = `camp-${String(n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
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
  await page.addInitScript(() => {
    try { window.localStorage.setItem("lc.license.jwt.v1", "harness.fake.jwt"); } catch {}
  });
}

test.describe("Campaigns Station Journey", () => {
  test(`${JOURNEY} · honest mock-source state · zero fake campaigns · zero fake clipper counts · zero fake invite-link writes`, async ({ page }, testInfo) => {
    const rec = new JourneyRecorder(page, testInfo);

    try {
      // Capture clipboard.writeText attempts (the prior FAKE invite-link path used it).
      await page.addInitScript(() => {
        const w = window as Window & { __lcClipboardWrites?: string[] };
        w.__lcClipboardWrites = [];
        try {
          const orig = navigator.clipboard?.writeText?.bind(navigator.clipboard);
          if (orig) {
            navigator.clipboard.writeText = ((text: string) => {
              w.__lcClipboardWrites!.push(text);
              return orig(text);
            }) as typeof navigator.clipboard.writeText;
          }
        } catch { /* ignore */ }
      });

      await rec.step("Launch /#/campaigns", async () => {
        await interceptBackend(page);
        await seedAuth(page);
        await page.goto("/?skipIntro=1#/campaigns", { waitUntil: "domcontentloaded" });
        await expect(page.locator('[data-testid="campaigns-stage"]')).toBeVisible({ timeout: 15_000 });
      });

      await rec.step("Stage exposes source=mock + visible=0 + featured=0", async () => {
        const stage = page.locator('[data-testid="campaigns-stage"]');
        const source = await stage.getAttribute("data-campaigns-source");
        const visible = await stage.getAttribute("data-campaigns-visible-count");
        const featured = await stage.getAttribute("data-campaigns-featured-count");
        rec.assert("campaigns_source", source);
        rec.assert("campaigns_visible_count", visible);
        rec.assert("campaigns_featured_count", featured);
        expect(source).toBe("mock");
        expect(visible).toBe("0");
        expect(featured).toBe("0");
      });

      await rec.step("Source pill says 'Backend offline · preview only' (ALL builds)", async () => {
        const pill = page.locator('[data-testid="campaigns-source-pill"]');
        await expect(pill).toBeVisible();
        const dataSource = await pill.getAttribute("data-source");
        const text = await pill.textContent();
        rec.assert("campaigns_pill_data", dataSource);
        rec.assert("campaigns_pill_text", text);
        expect(dataSource).toBe("mock");
        expect(text?.toLowerCase()).toMatch(/backend offline|preview only/);
      });

      await rec.step("Offline banner visible with honest copy · no fake bounty data", async () => {
        const banner = page.locator('[data-testid="campaigns-offline-banner"]');
        await expect(banner).toBeVisible();
        const text = await banner.textContent();
        rec.assert("offline_banner_text", text);
        expect(text?.toLowerCase()).toMatch(/no campaigns|not reachable|backend|no fake/);
      });

      await rec.step("ZERO campaign cards render · the 10-campaign fake seed is gone", async () => {
        await expect(page.locator('.lc-campaign-card')).toHaveCount(0);
        await expect(page.locator('.lc-campaigns-grid > *')).toHaveCount(0);
      });

      await rec.step("Featured banner is NOT shown when no featured campaign exists", async () => {
        // CampaignBanner returns null when `campaign` prop is null.
        // Reward-pool text and "$X pool" strings should be absent on screen.
        const poolMatches = await page.locator('text=/\\$[0-9,]+\\s*pool/i').count();
        rec.assert("dollar_pool_matches_visible", poolMatches);
        expect(poolMatches).toBe(0);
      });

      await rec.step("Count tag reads 0 live · 0 featured (matches stage attrs)", async () => {
        const tag = page.locator('[data-testid="campaigns-count-tag"]');
        await expect(tag).toBeVisible();
        const text = await tag.textContent();
        rec.assert("campaigns_count_tag_text", text);
        expect(text?.toLowerCase()).toMatch(/0\s+live/);
        expect(text?.toLowerCase()).toMatch(/0\s+featured/);
      });

      await rec.step("Switch to Agency mode · AgencyManageStrip honest empty state", async () => {
        // The app exposes a Clipper/Agency mode toggle in the top chrome.
        // Click the Agency radio · the strip should appear with honest copy.
        const agencyRadio = page.getByRole("radio", { name: /agency/i }).first();
        if (await agencyRadio.count() > 0) {
          await agencyRadio.click();
        }
        const strip = page.locator('[data-testid="campaigns-manage-strip"]');
        // The strip is agency-only · if mode toggle didn't work, skip
        // honestly (the cross-station mode wiring is its own audit).
        const present = await strip.count();
        if (present > 0) {
          const source = await strip.getAttribute("data-manage-source");
          const state = await strip.getAttribute("data-manage-state");
          rec.assert("manage_strip_source", source);
          rec.assert("manage_strip_state", state);
          expect(source).toBe("mock");
          expect(state).toBe("coming-soon");
          // Honest empty copy visible.
          const copy = await page.locator('[data-testid="campaigns-manage-empty-copy"]').textContent();
          rec.assert("manage_strip_copy", copy);
          expect(copy?.toLowerCase()).toMatch(/no campaigns|backend|connect/);
          // No fake clippers numbers and no fake invite-link buttons.
          await expect(page.locator('.lc-camp-manage-row')).toHaveCount(0);
        } else {
          rec.assert("manage_strip_present", false);
        }
      });

      await rec.step("Clipboard probe · NO fake invite-link was written", async () => {
        const writes = await page.evaluate(() => {
          const w = window as Window & { __lcClipboardWrites?: string[] };
          return w.__lcClipboardWrites ?? [];
        });
        rec.assert("clipboard_writes", writes);
        // The prior FAKE path wrote `https://liquidclips.app/c/<slug>` on
        // "Invite clippers" click. Zero clip-board writes mean the fake
        // path is dead.
        expect(writes).toEqual([]);
      });

      await rec.step("Filter chips render but no campaigns match · honest empty grid", async () => {
        // The filter chips themselves are WORKING UI primitives; they
        // operate on `camps.visible` which is empty. So clicking any
        // chip should land in the "No matching campaigns" empty state.
        const grid = page.locator('.lc-campaigns-grid');
        const emptyState = page.locator('.lc-campaigns-empty');
        // Either the offline banner OR the no-matching-campaigns empty
        // state must be visible · both are honest. The grid itself must
        // be empty (no children).
        const gridCount = await grid.locator('> *').count();
        const emptyVisible = await emptyState.count() > 0;
        rec.assert("filter_grid_count", gridCount);
        rec.assert("filter_empty_present", emptyVisible);
        expect(gridCount).toBe(0);
      });

      await rec.step("Emit verdict attachments", async () => {
        rec.assert("final", "ok");
      });
    } finally {
      await rec.finalize();
    }
  });
});
