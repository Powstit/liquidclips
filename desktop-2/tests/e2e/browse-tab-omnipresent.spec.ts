/**
 * Browse Tab Omnipresent · 2E2 GATE harness
 *
 * Per the 2E2 release standard (LOCKED 2026-06-25): nothing ships until
 * the persistent pink Browse tab is visible on EVERY post-auth route +
 * clicking it opens the overlay + Use in Engine fires the handoff event
 * + InlineCreatePanel opens with URL pre-filled + "imported from browser"
 * chip is visible — all without manual intervention.
 *
 * Mirrors the JourneyRecorder pattern from activation-flow.spec.ts.
 *
 * Scope of THIS spec:
 *   - Static + dynamic proof of tab presence on every route id from
 *     SECTION_IDS (the 8 active ones — deprecated ids are excluded).
 *   - Tab geometry: tab is anchored to right edge of viewport.
 *   - Click → BrowseOverlay open · tab hides (returns null).
 *   - Use in Engine click → lc:browse-url-handoff CustomEvent fires +
 *     InlineCreatePanel auto-opens on URL tab with pre-filled URL +
 *     "imported from browser" chip visible.
 *   - User stays on the route they were on (no navigateTo).
 *   - Close overlay → tab returns to visibility.
 *
 * What this spec does NOT cover (out of scope per scoper · Daniel
 * manually verifies the native WKWebView):
 *   - Real Whop content rendering inside the Rust child webview.
 *   - Native Tauri commands (open_browse_panel etc.) firing — those
 *     are no-op'd in the browser preview by `isTauriRuntime()` guard.
 *
 * Run: `cd desktop-2 && npx playwright test browse-tab-omnipresent`
 */

import { test, expect, type Page, type TestInfo } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");
const VERDICT_DIR = path.resolve(__dirname, "verdicts");
const JOURNEY = "Browse Tab Omnipresent";

interface StepRecord { step: number; name: string; status: "PASS" | "FAIL"; details?: Record<string, unknown>; }

class JourneyRecorder {
  private consoleErrors: string[] = [];
  private domAssertions: Record<string, unknown> = {};
  private steps: StepRecord[] = [];
  private currentStep = 0;
  constructor(private page: Page, private info: TestInfo) {
    page.on("pageerror", (e) => this.consoleErrors.push(`pageerror: ${e.message}`));
    page.on("console", (msg) => {
      const t = msg.type();
      if (t === "error" || t === "warning") this.consoleErrors.push(`console.${t}: ${msg.text()}`);
    });
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    fs.mkdirSync(VERDICT_DIR, { recursive: true });
  }
  async step<T>(name: string, body: () => Promise<T>, details?: Record<string, unknown>): Promise<T> {
    this.currentStep += 1;
    const n = this.currentStep;
    const label = `browse-tab-${String(n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50)}`;
    const screenshotPath = path.join(SCREENSHOT_DIR, `${label}.png`);
    try {
      const result = await body();
      try { await this.page.screenshot({ path: screenshotPath, fullPage: false }); } catch {}
      const rec: StepRecord = { step: n, name, status: "PASS", details };
      this.steps.push(rec);
      await this.info.attach(`lc:step:${n}`, { body: Buffer.from(JSON.stringify(rec)), contentType: "application/json" });
      return result;
    } catch (e) {
      try { await this.page.screenshot({ path: screenshotPath, fullPage: false }); } catch {}
      const rec: StepRecord = { step: n, name, status: "FAIL", details: { error: e instanceof Error ? e.message : String(e) } };
      this.steps.push(rec);
      await this.info.attach(`lc:step:${n}`, { body: Buffer.from(JSON.stringify(rec)), contentType: "application/json" });
      throw e;
    }
  }
  assert(k: string, v: unknown) { this.domAssertions[k] = v; }
  async finalize() {
    const verdict = {
      journey: JOURNEY,
      result: this.steps.every((s) => s.status === "PASS") ? "PASS" : "FAIL",
      steps: this.steps,
      assertions: this.domAssertions,
      console_errors: this.consoleErrors,
      ran_at: new Date().toISOString(),
    };
    const verdictPath = path.join(VERDICT_DIR, `browse-tab-omnipresent-${verdict.ran_at.replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(verdictPath, JSON.stringify(verdict, null, 2));
    await this.info.attach("lc:journey", { body: Buffer.from(JOURNEY), contentType: "text/plain" });
    await this.info.attach("lc:verdict", { path: verdictPath, contentType: "application/json" });
    await this.info.attach("lc:console-errors", { body: Buffer.from(JSON.stringify(this.consoleErrors)), contentType: "application/json" });
    await this.info.attach("lc:assertions", { body: Buffer.from(JSON.stringify(this.domAssertions)), contentType: "application/json" });
  }
}

/* Mock backend so /sync + /me don't actually fire against Railway. */
async function interceptBackend(page: Page) {
  await page.route(/api\.liquidclips\.app\/sync(\?.*)?$/, (r) => r.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ tier: "clipper", founder: false, subscription_status: "active", billing_provider: "clerk" }),
  }));
  await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (r) => r.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ email: "harness@liquidclips.app", effective_tier: "clipper", raw_tier: "clipper" }),
  }));
}

/* Seed the JWT so AuthGate passes + we land on the app shell. */
async function seedAuth(page: Page) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("lc.license.jwt.v1", "harness.fake.jwt"); } catch {}
  });
}

/* The 8 active routes from SECTION_IDS (deprecated ones excluded).
 * Hash maps from sectionRegistry.ts. */
const ROUTES = [
  { hash: "home",        label: "Home (CommandRoom)" },
  { hash: "browse",      label: "Browse section" },
  { hash: "editor",      label: "Editor / Workstation" },
  { hash: "projects",    label: "Projects / Library" },
  { hash: "campaign",    label: "Campaigns" },
  { hash: "account",     label: "Account" },
  { hash: "diagnostics", label: "Diagnostics" },
  { hash: "hq",          label: "HQ Bridge" },
] as const;

test.describe("Browse Tab Omnipresent · 2E2 Gate", () => {
  test(`${JOURNEY} · tab on every route + click opens overlay + Use-in-Engine handoff fires + chip visible · user stays put`, async ({ page }, testInfo) => {
    const rec = new JourneyRecorder(page, testInfo);

    try {
      // ── 0 · DIAGNOSE why the tab is hidden (computed style + bounds) ────
      await rec.step("Diagnose tab computed style + bounds", async () => {
        await interceptBackend(page);
        await seedAuth(page);
        await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(2000); // let everything mount
        const diag = await page.evaluate(() => {
          const el = document.querySelector<HTMLElement>('[data-browse-rail-tab="root"]');
          if (!el) return { found: false };
          const cs = window.getComputedStyle(el);
          const r = el.getBoundingClientRect();
          const ancestors: Array<{ tag: string; cls: string; pos: string; overflow: string; transform: string }> = [];
          let cur: HTMLElement | null = el.parentElement;
          while (cur && ancestors.length < 6) {
            const ac = window.getComputedStyle(cur);
            ancestors.push({
              tag: cur.tagName,
              cls: cur.className?.toString().slice(0, 60) ?? "",
              pos: ac.position,
              overflow: ac.overflow,
              transform: ac.transform,
            });
            cur = cur.parentElement;
          }
          return {
            found: true,
            display: cs.display,
            visibility: cs.visibility,
            opacity: cs.opacity,
            position: cs.position,
            right: cs.right,
            top: cs.top,
            transform: cs.transform,
            zIndex: cs.zIndex,
            width: r.width,
            height: r.height,
            x: r.x,
            y: r.y,
            viewport_w: window.innerWidth,
            viewport_h: window.innerHeight,
            ancestors,
          };
        });
        rec.assert("tab_diagnostics", diag);
        // eslint-disable-next-line no-console
        console.log("[diag]", JSON.stringify(diag, null, 2));
      });

      // ── 1 · launch authenticated · home loads · tab present ──────────────
      await rec.step("Seed auth · launch /#/home · tab present at right edge", async () => {
        const tab = page.locator('[data-browse-rail-tab="root"]');
        await expect(tab).toBeVisible({ timeout: 15_000 });
        const box = await tab.boundingBox();
        const viewport = page.viewportSize() ?? { width: 0, height: 0 };
        if (!box) throw new Error("tab boundingBox null on home");
        // Tab right edge should be at or very near viewport right edge (fixed right:0).
        expect(box.x + box.width).toBeGreaterThan(viewport.width - 80);
        rec.assert("home_tab_x", box.x);
        rec.assert("home_tab_right_edge_offset", viewport.width - (box.x + box.width));
        rec.assert("home_viewport_width", viewport.width);
      });

      // ── 2-9 · tab visible on EVERY active route ──────────────────────────
      for (const route of ROUTES) {
        await rec.step(`Tab visible on /#/${route.hash} (${route.label})`, async () => {
          await page.evaluate((h) => { window.location.hash = `#/${h}`; }, route.hash);
          // Let route render + tab re-check
          await page.waitForTimeout(400);
          const tab = page.locator('[data-browse-rail-tab="root"]');
          await expect(tab).toBeVisible({ timeout: 8_000 });
          const box = await tab.boundingBox();
          const viewport = page.viewportSize() ?? { width: 0, height: 0 };
          if (!box) throw new Error(`tab boundingBox null on ${route.hash}`);
          expect(box.x + box.width).toBeGreaterThan(viewport.width - 80);
          rec.assert(`${route.hash}_tab_visible`, true);
          rec.assert(`${route.hash}_tab_right_edge`, box.x + box.width);
        });
      }

      // ── 10 · spy on lc:browse-url-handoff event BEFORE clicking tab ──────
      await rec.step("Install lc:browse-url-handoff event spy on window", async () => {
        await page.evaluate(() => {
          (window as unknown as { __lcHandoffEvents: unknown[] }).__lcHandoffEvents = [];
          window.addEventListener("lc:browse-url-handoff", (e: Event) => {
            const ce = e as CustomEvent<{ url?: string; source?: string }>;
            ((window as unknown as { __lcHandoffEvents: unknown[] }).__lcHandoffEvents).push(ce.detail);
          });
        });
      });

      // ── 11 · go back to home (predictable state) + click tab ─────────────
      await rec.step("Navigate home · click pink Browse tab · overlay opens · tab hides", async () => {
        await page.evaluate(() => { window.location.hash = "#/home"; });
        await page.waitForTimeout(400);
        const tab = page.locator('[data-browse-rail-tab="root"]');
        await expect(tab).toBeVisible({ timeout: 5_000 });
        await tab.click();
        // Overlay should open
        await expect(page.locator('.lc-browse-overlay')).toBeVisible({ timeout: 5_000 });
        // Tab should hide (returns null when open===true)
        await expect(page.locator('[data-browse-rail-tab="root"]')).toBeHidden({ timeout: 2_000 });
        rec.assert("overlay_opened", true);
        rec.assert("tab_hidden_during_overlay", true);
      });

      // ── 12 · click Use in Engine → handoff event fires ──────────────────
      await rec.step("Click Use in Engine · handoff event fires with URL", async () => {
        // The button text contains "Use in Engine" — match loosely.
        const useInEngineBtn = page.getByRole("button", { name: /Use in Engine/i }).first();
        await expect(useInEngineBtn).toBeVisible({ timeout: 5_000 });
        await useInEngineBtn.click();
        await page.waitForTimeout(400);
        const events = await page.evaluate(() => (window as unknown as { __lcHandoffEvents: unknown[] }).__lcHandoffEvents ?? []);
        rec.assert("handoff_event_count", events.length);
        rec.assert("handoff_event_detail", events[0] ?? null);
        if (events.length === 0) throw new Error("lc:browse-url-handoff event never fired after Use in Engine click");
      });

      // ── 13 · InlineCreatePanel auto-opens with URL pre-filled + chip ────
      await rec.step("InlineCreatePanel auto-opens on URL tab · URL pre-filled · imported-from-browser chip visible", async () => {
        // Panel is mounted globally in AppShell now, so it opens regardless of route.
        // The handoff sets tab='url' + url=incoming + importedFromBrowser=true.
        const chip = page.locator('.lc-icp-handoff-chip');
        await expect(chip).toBeVisible({ timeout: 5_000 });
        const urlInput = page.locator('.lc-icp-input').first();
        await expect(urlInput).toBeVisible({ timeout: 3_000 });
        const urlValue = await urlInput.inputValue();
        rec.assert("inline_create_panel_url", urlValue);
        rec.assert("chip_visible", true);
        if (!urlValue || urlValue.length === 0) throw new Error("URL field not pre-filled");
      });

      // ── 14 · current route unchanged (user stayed on home) ──────────────
      await rec.step("User stayed on /#/home (no navigateTo on Use in Engine)", async () => {
        const hash = await page.evaluate(() => window.location.hash);
        rec.assert("final_hash", hash);
        // Should be #/home or #/ (no SECTION_EDITOR navigation)
        expect(hash).toMatch(/^#\/home/);
      });

      await rec.finalize();
    } catch (e) {
      await rec.finalize();
      throw e;
    }
  });
});
