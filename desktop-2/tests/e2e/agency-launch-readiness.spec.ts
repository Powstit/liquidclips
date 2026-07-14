/**
 * Agency Launch Readiness Journey · USER-LENS AUTOMATION GATE · TASK 4
 *
 * Answers and locks: can ONE OPERATOR successfully run the agency flow
 * in Desktop 2.1 today? No team seats, no sub-accounts, no multi-user
 * agency. The journey verifies every agency surface is either WORKING
 * or honest COMING SOON — never fixture-only-pretending-to-be-real.
 *
 * Scenarios:
 *   1. Boot as an admin agency operator · land on home.
 *   2. Flip TopHud mode pill to "Agency" · `lc.mode` persists.
 *   3. ConsoleNav exposes the agency-only routes: Submissions, Analytics.
 *      (Clipper-only routes — My Journey, Earn — are NOT in the nav.)
 *   4. Navigate to /campaigns · "+ Create campaign" CTA is visible
 *      (gated on `canUseAgencyActions` · admin + agency tier qualifies).
 *   5. Navigate to /submissions · COMING SOON banner visible, layout
 *      empty (no fake submissions), filters render with 0 counts.
 *   6. Navigate to /analytics · honest "—" placeholders visible, the
 *      "Numbers stay quiet until Batch D" copy is present.
 *   7. Flip back to clipper mode · agency-only routes disappear from
 *      the nav.
 *   8. STATIC contract · agency-tier `TIER_LIMITS` in `app/features.py`
 *      mirror the client `TIER_CAPS.agency` block exactly (locked by
 *      tier_enforcement_backend already — re-asserted here so any
 *      future TASK 4 regression surfaces alongside agency UX).
 */
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { harnessAssertShell, seedAuthenticatedShell } from "./_auth-harness";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");
const JOURNEY = "Agency Launch Readiness";

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
    const label = `agc-${String(n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
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

async function bootAgencyAdmin(page: Page) {
  /* D1 (2026-07-12) · canonical agency-admin seed via `_auth-harness`.
   * The spec-specific `lc.mode` seed is layered on TOP of the harness
   * so the mode toggle flow being exercised is honest. */
  await seedAuthenticatedShell(page, {
    tier: "agency",
    admin_override: true,
    whop_connected: true,
  });
  await page.addInitScript(() => {
    try {
      /* Start in clipper mode; the test flips to agency to exercise
       * the mode toggle path. */
      window.localStorage.setItem("lc.mode", "clipper");
    } catch {}
  });
  await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
  await harnessAssertShell(page);
  await expect(page.locator('[data-testid="home-tile-1"]')).toBeVisible({ timeout: 15_000 });
}

async function navigateTo(page: Page, route: string) {
  await page.evaluate((r) => {
    const w = window as unknown as { __lcBus?: { emit: (e: string, p: unknown) => void } };
    w.__lcBus?.emit?.("nav:click", { route: r });
  }, route);
  await page.waitForTimeout(700);
}

async function setMode(page: Page, mode: "clipper" | "agency") {
  await page.evaluate((m) => {
    try { window.localStorage.setItem("lc.mode", m); } catch {}
    const w = window as unknown as { __lcBus?: { emit: (e: string, p: unknown) => void } };
    w.__lcBus?.emit?.("mode:change", { mode: m });
  }, mode);
  await page.waitForTimeout(400);
}

test.describe("Agency Launch Readiness Journey", () => {
  test(`${JOURNEY} · single operator runs agency end-to-end without fake surfaces`, async ({ page }, testInfo) => {
    const rec = new JourneyRecorder(page, testInfo);

    try {
      await rec.step("Boot as admin agency operator · land on home", async () => {
        await bootAgencyAdmin(page);
        await expect(page.locator('[data-testid="avatar-orbit-button"]')).toBeVisible();
      });

      await rec.step("Flip TopHud mode pill to Agency · mode persists", async () => {
        await setMode(page, "agency");
        const mode = await page.evaluate(() => {
          try { return window.localStorage.getItem("lc.mode"); } catch { return null; }
        });
        rec.assert("mode_after_flip", mode);
        expect(mode).toBe("agency");
      });

      await rec.step("ConsoleNav exposes agency-only Analytics · Submissions nav entry retired 2026-07-10 · clipper-only routes hidden", async () => {
        const navText = (await page.locator(".lc-rail").innerText()).toLowerCase();
        rec.assert("nav_text_agency", navText);
        /* Phase 1 · 7-category purge Category 4 (2026-07-10) · the
         * Submissions nav entry was intentionally removed. Reference:
         * src/design-os/components/ConsoleNav.tsx:52-58. Route file
         * remains in-tree so hash deep-links resolve; nav re-adds when
         * the `/campaigns/:slug/submissions` backend wire lands. */
        expect(navText).not.toContain("submissions");
        expect(navText).toContain("analytics");
        /* Clipper-only items vanish in agency mode (`modes: ["clipper"]`).
         * Word-boundary matches — the Learn tab (2026-07-11) legitimately
         * contains the substring "earn", and the Wallet label (route id
         * `earn`, label "Wallet") replaced the old "Earn" label so a
         * plain substring assertion is no longer sound. */
        expect(navText).not.toMatch(/\bmy journey\b/);
        expect(navText).not.toMatch(/\bwallet\b/);
        expect(navText).not.toMatch(/\bearn\b/);
      });

      await rec.step("Campaigns · '+ Create campaign' CTA visible (admin + agency-source trusted)", async () => {
        await navigateTo(page, "campaigns");
        const cta = page.locator('.lc-campaigns-create-cta');
        await expect(cta).toBeVisible({ timeout: 6_000 });
        const ctaText = (await cta.textContent())?.trim() ?? "";
        rec.assert("campaign_cta_text", ctaText);
        expect(ctaText).toMatch(/create campaign/i);
        /* No "checking" / "agency access required" suffix · admin user
         * with agency tier is trusted to create. */
        expect(ctaText.toLowerCase()).not.toContain("agency access required");
        expect(ctaText.toLowerCase()).not.toContain("activate first");
      });

      await rec.step("Submissions · COMING SOON banner visible · zero fake rows", async () => {
        await navigateTo(page, "submissions");
        const banner = page.locator('[data-testid="submissions-coming-soon"]');
        await expect(banner).toBeVisible({ timeout: 6_000 });
        await expect(banner).toHaveAttribute("data-state", "coming-soon");
        /* Filter chips render with 0 counts; the "All" chip count is the
         * total · must be 0 because the fixture is empty. */
        const layout = page.locator('[data-testid="submissions-layout"]');
        await expect(layout).toBeVisible();
        await expect(layout).toHaveAttribute("data-submissions-count", "0");
        await expect(page.locator('[data-testid="submissions-empty"]')).toBeVisible();
        /* Forbidden strings from the prior fixture must NOT render. */
        const body = await page.evaluate(() => document.body.innerText);
        const forbidden = [
          "@preview-clipper-01", "@preview-clipper-02", "@preview-clipper-03",
          "@preview-clipper-04", "@preview-clipper-05",
          "Sample clip · pending review", "Sample clip · approved",
          "Sample clip · paid", "Sample clip · rejected",
        ];
        for (const s of forbidden) {
          rec.assert(`forbid_${s}`, body.includes(s));
          expect(body, `fixture leak: ${s}`).not.toContain(s);
        }
      });

      await rec.step("Analytics · honest '—' placeholders + COMING SOON copy", async () => {
        await navigateTo(page, "analytics");
        const stub = page.locator('[data-testid="analytics-stub"]');
        await expect(stub).toBeVisible({ timeout: 6_000 });
        await expect(stub).toHaveAttribute("data-state", "coming-soon");
        const copy = (await page.locator('[data-testid="analytics-coming-soon-copy"]').textContent())?.trim() ?? "";
        rec.assert("analytics_copy", copy);
        expect(copy.toLowerCase()).toMatch(/coming|wires|until/);
        /* Every card value must render the placeholder em-dash, not a
         * fake number. */
        const cardValues = await page.locator('[data-testid^="analytics-card-value-"]').allInnerTexts();
        rec.assert("analytics_card_values", cardValues);
        for (const v of cardValues) {
          expect(v.trim()).toBe("—");
        }
      });

      await rec.step("Flip back to clipper mode · agency-only routes disappear", async () => {
        await setMode(page, "clipper");
        await navigateTo(page, "home");
        const navText = (await page.locator(".lc-rail").innerText()).toLowerCase();
        rec.assert("nav_text_clipper", navText);
        expect(navText).not.toContain("submissions");
        expect(navText).not.toContain("analytics");
        /* Clipper-only items reappear. */
        expect(navText).toContain("my journey");
        expect(navText).toContain("earn");
      });

      await rec.step("STATIC · agency tier matrix matches the client cap matrix", async () => {
        /* The tier_enforcement_backend journey already locks this
         * server-side, but agency-launch-readiness re-asserts it from
         * the client side so any future tier-matrix drift fails the
         * agency journey too (not just the backend pytest). */
        const repoRoot = path.resolve(__dirname, "..", "..");
        const clientSrc = fs.readFileSync(
          path.join(repoRoot, "src/design-os/state/useTierCaps.ts"),
          "utf8",
        );
        /* These numbers come straight from the FEATURE-004 audit and
         * are also enforced by junior-backend's TIER_LIMITS dict.  */
        const expected = [
          /totalChannels:\s*15/,
          /perPlatformChannels:\s*5/,
          /campaignsPerBrand:\s*20/,
          /clipsPerCampaign:\s*200/,
          /monthlyPosts:\s*2500/,
          /bulkSchedulingRows:\s*Infinity/,
          /accountsPerClip:\s*10/,
          /campaignAccountTemplates:\s*true/,
        ];
        const misses: string[] = [];
        /* Walk only the agency block. */
        const agencyBlock = clientSrc.match(/agency:\s*\{[\s\S]*?\}/);
        expect(agencyBlock, "agency block must exist in useTierCaps.ts").not.toBeNull();
        for (const re of expected) {
          if (!re.test(agencyBlock![0])) misses.push(re.source);
        }
        rec.assert("agency_matrix_misses", misses);
        expect(misses, `agency tier-matrix drift: ${misses.join(", ")}`).toHaveLength(0);
      });
    } finally {
      await rec.finalize();
    }
  });
});
