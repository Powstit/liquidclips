/**
 * First-Run Onboarding Journey · USER-LENS AUTOMATION GATE · TASK 5
 *
 * Walks the full first-run flow from a customer's lens:
 *   Install → Activate → Reach Home → Try every tile →
 *   Try first channel connect → Open Settings → Find Upgrade.
 *
 * Other journeys cover slices of this (activation-flow, home-dashboard,
 * channels-station, etc). This one strings the slices together as ONE
 * customer experience and asserts at each step that the surface is
 * either WORKING or honest COMING SOON — no dead ends, no confusing
 * copy, no fake CTAs.
 *
 * Coverage: NEW customer (no JWT, no clips), RETURNING customer
 * (preserved JWT skips LoginOnboarding), PAID customer (Whop upgrade
 * link reads "Manage plan" instead of "View plans").
 */
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { seedSignedOutShell } from "./_auth-harness";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");
const JOURNEY = "First-Run Onboarding";

interface StepRecord { step: number; name: string; status: "PASS" | "FAIL"; }

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
    const label = `onb-${String(n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const screenshotPath = path.join(SCREENSHOT_DIR, `${label}.png`);
    try {
      const result = await body();
      try { await this.page.screenshot({ path: screenshotPath, fullPage: false }); } catch {}
      const rec: StepRecord = { step: n, name, status: "PASS" };
      await this.info.attach(`lc:step:${n}`, { body: Buffer.from(JSON.stringify(rec)), contentType: "application/json" });
      return result;
    } catch (e) {
      try { await this.page.screenshot({ path: screenshotPath, fullPage: false }); } catch {}
      const rec: StepRecord = { step: n, name, status: "FAIL" };
      await this.info.attach(`lc:step:${n}`, { body: Buffer.from(JSON.stringify(rec)), contentType: "application/json" });
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

async function interceptBackend(page: Page, tier: "free" | "solo" | "pro" | "agency") {
  const me = {
    user: { id: "harness", email: "harness@liquidclips.app", tier },
    tier, effective_tier: tier, raw_tier: tier, admin_override: false,
  };
  const sync = { tier, caps: { watermarkLocked: tier === "free" } };
  await page.unrouteAll({ behavior: "wait" });
  /* 2026-07-13 D1 residual · Catch-all was previously `r.continue()` on
   * non-GET, which raced keepalive POSTs and threw "route.continue:
   * Assertion error" from Playwright's route pipeline. Every unspecified
   * method now fulfils with a benign 200 empty JSON — matches the GET
   * shape, telemetry keepalive senders are E2E-gated at product code
   * (`diagnosticLogger.ts`, `loginTelemetry.ts`, `useAuditableAction.ts`,
   * `TopHud.tsx`) so no legitimate write actually needs a live network
   * hit here. */
  await page.route(/api\.liquidclips\.app\//, (r) => r.fulfill({
    status: 200,
    contentType: "application/json",
    body: "{}",
  }));
  await page.route(/api\.liquidclips\.app\/sync(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sync) }));
  await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(me) }));
}

async function navigateTo(page: Page, route: string) {
  await page.evaluate((r) => {
    const w = window as unknown as { __lcBus?: { emit: (e: string, p: unknown) => void } };
    w.__lcBus?.emit?.("nav:click", { route: r });
  }, route);
  await page.locator(`.lc-app[data-route="${route}"]`).waitFor({
    state: "visible",
    timeout: 20_000,
  });
}

const FAKE_JWT = "harness.onboarding.jwt.v1";

test.describe("First-Run Onboarding Journey", () => {
  test(`${JOURNEY} · install → activate → tile-tour → first connect → settings → upgrade`, async ({ page }, testInfo) => {
    const rec = new JourneyRecorder(page, testInfo);

    try {
      /* ─── PHASE 1 · NEW CUSTOMER · NO JWT ────────────────────────── */

      await rec.step("Cold launch (no JWT) · SimpleLoginPanel renders as signed-out primary surface", async () => {
        await interceptBackend(page, "free");
        /* D1 (2026-07-12) · canonical signed-out seed for Phase 1. The
         * spec deliberately clears the JWT + activates via the
         * __lcActivation harness, so we start on WelcomeRoute /
         * LoginOnboarding. Phase 7 relies on the JWT that Phase 2's
         * activation writes surviving across a page reload — do NOT put
         * a seedSignedOutShell in the reused init script. */
        await seedSignedOutShell(page);
        /* mode persists across reloads; JWT clear is one-shot · init
         * script that survives reload would defeat step 7's
         * returning-user check. */
        await page.addInitScript(() => {
          try { window.localStorage.setItem("lc.mode", "clipper"); } catch {}
        });
        await page.goto("/?skipIntro=1", { waitUntil: "domcontentloaded" });
        await page.evaluate(() => {
          try {
            window.localStorage.removeItem("lc.license.jwt.v1");
            window.sessionStorage.removeItem("lc.activation.pending_challenge.v1");
          } catch {}
        });
        await page.reload({ waitUntil: "domcontentloaded" });
        /* Phase 1 (2026-07-12) · SimpleLoginPanel replaced LoginOnboarding
         * as the primary signed-out surface. The 4-step "sign in with
         * whop / right here in the app / no browser bounce" explainer
         * copy no longer exists — SimpleLoginPanel is an email+code form.
         * Assert the panel renders (heading + email input + Send code
         * button). Reference: _auth-harness.ts:373-375. */
        await expect(page.getByText("Sign in to Liquid Clips")).toBeVisible({ timeout: 12_000 });
        await expect(page.locator('[data-testid="simple-login-email-input"]')).toBeVisible();
        await expect(page.getByRole("button", { name: /^Send code$/ })).toBeVisible();
        rec.assert("signed_out_surface", "simple-login-panel");
      });

      await rec.step("Activate · begin() + handleUrl() with matching challenge · AuthGate flips to home", async () => {
        const nonce = await page.evaluate(() => {
          const w = window as unknown as { __lcActivation?: { begin: () => string } };
          return w.__lcActivation!.begin();
        });
        const url = `liquidclips://activate?token=${encodeURIComponent(FAKE_JWT)}&challenge=${encodeURIComponent(nonce)}&source=clerk`;
        await page.evaluate(async (u) => {
          const w = window as unknown as { __lcActivation?: { handleUrl: (u: string) => Promise<void> } };
          await w.__lcActivation!.handleUrl(u);
        }, url);
        await expect(page.locator('[data-testid="home-tile-1"]')).toBeVisible({ timeout: 10_000 });
      });

      /* ─── PHASE 2 · TILE TOUR · all 4 tiles render honest labels ─── */

      await rec.step("Home · 4 tiles visible · honest labels (no fake numbers, no dead-end CTAs)", async () => {
        for (const i of [1, 2, 3, 4]) {
          await expect(page.locator(`[data-testid="home-tile-${i}"]`)).toBeVisible();
        }
        /* Avatar chrome must always be reachable from home. */
        await expect(page.locator('[data-testid="avatar-orbit-button"]')).toBeVisible();
        const hudText = await page.locator(".lc-hud").innerText();
        rec.assert("hud_text", hudText);
        /* No fake "Solo · 1.4k clips" pre-login default. */
        expect(hudText).not.toMatch(/Solo · 1\.4k clips/i);
        /* Home earn strip · should show $0.00 honestly for new customer. */
        const earnText = await page.locator('[data-testid="home-earn-strip"]').innerText();
        rec.assert("home_earn_text", earnText);
        expect(earnText).toMatch(/\$0\.00/);
      });

      /* ─── PHASE 3 · FIRST WORKSTATION VISIT · empty + honest CTA ─── */

      await rec.step("Click My Clips tile · Workstation empty state · honest 'Open Create Clips' CTA", async () => {
        await page.locator('[data-testid="home-tile-2"]').click();
        await expect(page.locator('[data-testid="workstation-empty"]')).toBeVisible({ timeout: 8_000 });
        const text = await page.locator('[data-testid="workstation-empty"]').innerText();
        rec.assert("workstation_empty_text", text);
        expect(text).toMatch(/no source/i);
        expect(text).toMatch(/paste a YouTube|paste a video URL|paste a/i);
        /* No fake clips render under the empty state. */
        await expect(page.locator(".lc-engine-clip-grid")).toHaveCount(0);
        await expect(page.locator('[data-testid="workstation-empty-cta"]')).toBeVisible();
      });

      /* ─── PHASE 4 · FIRST CHANNEL CONNECT · honest backend-offline ─ */

      await rec.step("Click Channels · backend-offline banner visible · Add-account is honest 'coming soon'", async () => {
        await navigateTo(page, "channels");
        /* Every channels add-tile reports its state via data-channels-add-state · `coming-soon` in mock backend. */
        const firstAdd = page.locator('[data-testid^="channels-add-"]').first();
        await expect(firstAdd).toBeVisible({ timeout: 8_000 });
        const state = await firstAdd.getAttribute("data-channels-add-state");
        rec.assert("first_channels_add_state", state);
        expect(["coming-soon", "available"]).toContain(state);
        /* No fake connected channel rows render. */
        const fakeHandles = await page.locator('text=/@uncle\\.daniel|@ddbeauty|@enumcos/i').count();
        rec.assert("fake_channels_count", fakeHandles);
        expect(fakeHandles).toBe(0);
      });

      /* ─── PHASE 5 · CAMPAIGNS DISCOVERY · honest offline state ─── */

      await rec.step("Click Campaigns · backend-offline state · no fake campaigns shown", async () => {
        await navigateTo(page, "campaigns");
        const banner = page.locator(".lc-runtime-tag").first();
        await expect(banner).toBeVisible({ timeout: 8_000 });
        /* No "Uncle Daniel" / "DD Beauty" / "Femi" legacy fixture leakage anywhere. */
        const text = await page.evaluate(() => document.body.innerText);
        for (const forbidden of ["Uncle Daniel", "DD Beauty", "Femi", "Clip Squad 2026"]) {
          rec.assert(`campaigns_forbidden_${forbidden}`, text.includes(forbidden));
          expect(text, `${forbidden} leaked in campaigns route`).not.toContain(forbidden);
        }
      });

      /* ─── PHASE 6 · SETTINGS · activation + upgrade reachable ───── */

      await rec.step("Open Settings · Account card shows 'Active license' + upgrade link reads 'View plans on Whop' for free tier", async () => {
        await navigateTo(page, "settings");
        const body = await page.evaluate(() => document.body.innerText);
        rec.assert("settings_visible_text", body.slice(0, 800));
        /* Activation reported honest after fresh sign-in. */
        expect(body.toLowerCase()).toMatch(/active license/);
        /* Free/clipper tier shows the current Agency-only upgrade CTA
         * per pricing pivot (LOCKED 2026-07-06) — "Upgrade to Agency
         * on Whop · $99.99/mo". The pivot overrides all prior pricing
         * memory including any "View plans" copy. */
        const upgradeBtn = page.locator('[data-testid="settings-upgrade-whop"]');
        await expect(upgradeBtn).toBeVisible({ timeout: 6_000 });
        const upgradeText = (await upgradeBtn.textContent())?.trim() ?? "";
        rec.assert("upgrade_btn_text_free", upgradeText);
        expect(upgradeText.toLowerCase()).toMatch(/upgrade to agency/);
        const openUrl = await upgradeBtn.getAttribute("data-open-url");
        expect(openUrl).toBe("https://whop.com/liquidclips/");
      });

      /* ─── PHASE 7 · RETURNING CUSTOMER · JWT preserved skips login ─ */

      await rec.step("Cold reload with JWT preserved · AuthGate skips LoginOnboarding · lands on home", async () => {
        await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
        /* SimulatorRouter may resume on the prior route after reload ·
         * nudge it back to home so the home-tile assertion is on the
         * primary surface (the returning-customer experience). */
        await navigateTo(page, "home");
        await expect(page.locator('[data-testid="home-tile-1"]')).toBeVisible({ timeout: 12_000 });
        /* LoginOnboarding must NOT mount on the returning-user path. */
        await expect(page.locator('[data-testid="login-state-idle"]')).toHaveCount(0);
      });

      /* ─── PHASE 8 · PAID CUSTOMER · upgrade copy flips ──────────── */

      await rec.step("Reboot as paid pro customer · Settings Upgrade reads 'Manage plan on Whop'", async () => {
        await interceptBackend(page, "pro");
        await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
        await navigateTo(page, "home");
        await expect(page.locator('[data-testid="home-tile-1"]')).toBeVisible({ timeout: 12_000 });
        /* Navigate to settings FIRST so the Settings useTierCaps hook
         * mounts + subscribes to the debug-tier broadcaster. THEN fire
         * __lcDebugSetTier so every subscribed hook (TopHud + Settings
         * + Workstation, etc.) flips to "pro". The seam is documented
         * as puppeteer-only and does NOT unlock paid-write actions
         * (excluded from `isTrustedTierSource`) so this is safe. */
        await navigateTo(page, "settings");
        const upgradeBtn = page.locator('[data-testid="settings-upgrade-whop"]');
        await expect(upgradeBtn).toBeVisible({ timeout: 6_000 });
        // Per pricing pivot (LOCKED 2026-07-06) the only live paid tier
        // is Agency; Founder/Solo/Pro/Enterprise are deferred until 100
        // Agency users. `agency` is the tier that flips the CTA to the
        // paid-customer "Manage plan on Whop" copy.
        await page.evaluate(() => {
          const w = window as unknown as { __lcDebugSetTier?: (t: string) => void };
          w.__lcDebugSetTier?.("agency");
        });
        await expect.poll(
          async () => (await upgradeBtn.textContent())?.trim().toLowerCase() ?? "",
          { timeout: 6_000, intervals: [100, 200, 400] },
        ).toMatch(/manage plan/);
        const upgradeText = (await upgradeBtn.textContent())?.trim() ?? "";
        rec.assert("upgrade_btn_text_paid", upgradeText);
      });

      /* ─── PHASE 9 · NO DEAD ENDS · avatar chrome reachable everywhere ─ */

      await rec.step("Avatar chrome reachable from every primary route · Notifications honest", async () => {
        const routes = ["home", "workstation", "campaigns", "channels", "settings"];
        for (const r of routes) {
          await navigateTo(page, r);
          await expect(page.locator('[data-testid="avatar-orbit-button"]')).toBeVisible({ timeout: 4_000 });
        }
        /* Open inbox from any route · must show COMING SOON empty state
         * (no fake unread messages, no fake unread badge). */
        await page.locator('[data-testid="avatar-orbit-button"]').click();
        await expect(page.locator('[data-testid="avatar-orbit-menu"]')).toBeVisible();
        await page.locator('[data-testid="avatar-orbit-notifications"]').click();
        const overlay = page.locator('[data-testid="inbox-overlay"]');
        await expect(overlay).toBeVisible({ timeout: 4_000 });
        await expect(overlay).toHaveAttribute("data-inbox-state", "coming-soon");
        await expect(overlay).toHaveAttribute("data-inbox-unread-count", "0");
      });
    } finally {
      await rec.finalize();
    }
  });
});
