/**
 * Settings + Avatar Menu Journey · USER-LENS AUTOMATION GATE · BUG-046
 *
 * Verifies:
 *   1. Top-right Avatar button is visible and opens a real dropdown menu.
 *   2. Menu items: Settings (real), Notifications (real), Sign out (real when hasJwt).
 *   3. Clicking Settings reaches the Design OS Settings route.
 *   4. Clicking Notifications opens InboxSheet with honest COMING SOON state.
 *   5. NO fake unread badge (avatar badge = 0; the prior hardcoded "3" is gone).
 *   6. NO fake inbox messages render (the 5-fixture seed is empty).
 *   7. Top-bar "Upgrade" is disabled with honest "coming soon" label
 *      (no fake-toast on click).
 *   8. Settings route surfaces billing/subscription rows honestly · sign-out
 *      affordance present.
 *
 * Mandatory rules per BUG-046:
 *   - No fake billing. No fake inbox. No fake notification count.
 *   - No fake sign-out. No fake subscription state.
 */
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");
const JOURNEY = "Settings Avatar";

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
    const label = `set-${String(n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
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

test.describe("Settings Avatar Journey", () => {
  test(`${JOURNEY} · avatar menu reaches Settings · honest inbox · zero fake unread · sign-out real`, async ({ page }, testInfo) => {
    const rec = new JourneyRecorder(page, testInfo);

    try {
      await rec.step("Launch app · seed JWT so sign-out is shown", async () => {
        await interceptBackend(page);
        await seedAuth(page);
        await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
        await expect(page.locator('[data-testid="home-tile-1"]')).toBeVisible({ timeout: 15_000 });
      });

      await rec.step("Top-right Avatar button is visible", async () => {
        const avatar = page.locator('[data-testid="avatar-orbit-button"]');
        await expect(avatar).toBeVisible();
      });

      await rec.step("Avatar badge shows ZERO unread (no fake count)", async () => {
        // The prior hardcoded count={3} is gone · badge derives from
        // unreadCount() of the now-empty fakeInbox.
        await expect(page.locator('[data-testid="avatar-orbit-badge"]')).toHaveCount(0);
      });

      await rec.step("No Upgrade CTA in chrome (honest · billing lives in Settings)", async () => {
        // BUG-046 honest stance: no Upgrade affordance in app chrome.
        // Billing/upgrade lives only in Settings → Plan & access card.
        await expect(page.locator('[data-testid="topbar-upgrade"]')).toHaveCount(0);
        rec.assert("no_chrome_upgrade_cta", true);
      });

      await rec.step("Click avatar · dropdown menu opens", async () => {
        await page.locator('[data-testid="avatar-orbit-button"]').click();
        const menu = page.locator('[data-testid="avatar-orbit-menu"]');
        await expect(menu).toBeVisible({ timeout: 2_000 });
        const root = page.locator('[data-testid="avatar-orbit-root"]');
        const open = await root.getAttribute("data-menu-open");
        rec.assert("menu_open", open);
        expect(open).toBe("1");
      });

      await rec.step("Menu has Settings · Notifications · Sign out items", async () => {
        await expect(page.locator('[data-testid="avatar-orbit-settings"]')).toBeVisible();
        await expect(page.locator('[data-testid="avatar-orbit-notifications"]')).toBeVisible();
        // Sign out only shown when hasJwt() → we seeded a JWT, so it must be present.
        await expect(page.locator('[data-testid="avatar-orbit-signout"]')).toBeVisible();
      });

      await rec.step("Click Notifications · inbox opens in honest COMING SOON state", async () => {
        await page.locator('[data-testid="avatar-orbit-notifications"]').click();
        const overlay = page.locator('[data-testid="inbox-overlay"]');
        await expect(overlay).toBeVisible({ timeout: 4_000 });
        const state = await overlay.getAttribute("data-inbox-state");
        const msgCount = await overlay.getAttribute("data-inbox-message-count");
        const unread = await overlay.getAttribute("data-inbox-unread-count");
        rec.assert("inbox_state", state);
        rec.assert("inbox_msg_count", msgCount);
        rec.assert("inbox_unread_count", unread);
        expect(state).toBe("coming-soon");
        expect(msgCount).toBe("0");
        expect(unread).toBe("0");
        // Coming-soon body copy is visible · no fake messages.
        const copy = await page.locator('[data-testid="inbox-coming-soon-copy"]').textContent();
        rec.assert("inbox_copy", copy);
        expect(copy?.toLowerCase()).toMatch(/coming soon|not wired|no fake/);
        // Specifically: no prior fixture titles appear anywhere.
        await expect(page.locator('text=/Welcome to the Liquid Clips beta/i')).toHaveCount(0);
        await expect(page.locator('text=/Beta build · 0\\.8\\.0/i')).toHaveCount(0);
        await expect(page.locator('text=/Uncle Daniel Audience Zero/i')).toHaveCount(0);
        // Close inbox sheet.
        await page.locator('.lc-inbox-close').click();
        await expect(overlay).toHaveCount(0);
      });

      await rec.step("Re-open avatar menu and click Settings", async () => {
        await page.locator('[data-testid="avatar-orbit-button"]').click();
        await expect(page.locator('[data-testid="avatar-orbit-menu"]')).toBeVisible({ timeout: 2_000 });
        await page.locator('[data-testid="avatar-orbit-settings"]').click();
      });

      await rec.step("Settings route renders · billing/subscription rows present", async () => {
        // The Design OS settings route shows "Plan & access" with billing
        // owner + subscription status rows. Check for the section card.
        const planCard = page.locator('text=/Plan & access/i').first();
        await expect(planCard).toBeVisible({ timeout: 8_000 });
        // The "Billing owner" row should read honest value (Whop / Clerk /
        // Unknown · /me did not return billing_provider). Our /me intercept
        // returned `{ tier: "solo" }` with no billing_provider field, so
        // the honest "Unknown · /me did not return billing_provider" must
        // appear OR the row is absent. Either is honest.
        const billingHonestMatch = page.locator('text=/billing_provider|no subscription on file|Unknown/i');
        const matchCount = await billingHonestMatch.count();
        rec.assert("settings_honest_billing_matches", matchCount);
        expect(matchCount).toBeGreaterThan(0);
      });

      await rec.step("Re-open avatar · Sign out · JWT cleared (real)", async () => {
        // Re-open avatar from Settings route.
        await page.locator('[data-testid="avatar-orbit-button"]').click();
        await expect(page.locator('[data-testid="avatar-orbit-menu"]')).toBeVisible({ timeout: 2_000 });
        await page.locator('[data-testid="avatar-orbit-signout"]').click();
        // Probe localStorage to confirm JWT was cleared.
        const jwtAfter = await page.evaluate(() => {
          try {
            return window.localStorage.getItem("lc.license.jwt.v1");
          } catch {
            return null;
          }
        });
        rec.assert("jwt_after_signout", jwtAfter);
        expect(jwtAfter).toBeNull();
      });

      await rec.step("Emit verdict attachments", async () => {
        rec.assert("final", "ok");
      });
    } finally {
      await rec.finalize();
    }
  });
});
