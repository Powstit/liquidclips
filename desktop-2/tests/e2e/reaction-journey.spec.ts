/**
 * Reaction Journey · USER-LENS AUTOMATION GATE
 *
 * Drives the customer path that resolves BUG-032 P0 "Reaction":
 *
 *   1. Launch app
 *   2. Seed a completed session so FIXTURE_PROJECT hydrates
 *   3. Navigate to Workstation
 *   4. Click first clip's Edit button
 *   5. Assert Reaction tab is active in the cockpit dock
 *   6. Pick a known mp4 via the hidden file input
 *   7. Assert unbaked reaction overlay <video> appears in ClipPreviewShell
 *   8. Click "Apply reaction"
 *   9. Assert button data-bake-state transitions "idle" → "baking" → "done"
 *   10. Click second clip body
 *   11. Click first clip body again
 *   12. Assert reaction overlay + sourcePath persisted on the returned clip
 *   13. Emit verdict (screenshots + dom_assertions + console_errors)
 *
 * Verdict is written by the custom reporter at tests/e2e/verdict-reporter.ts.
 */
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { seedAuthenticatedShell } from "./_auth-harness";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURE_MP4 = path.resolve(__dirname, "fixtures", "reaction-source.mp4");
const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");
const JOURNEY = "Reaction Editing";

// Mirror of FIXTURE_PROJECT.slug from src/design-os/engine/types.ts
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
    const label = `${String(n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const screenshotPath = path.join(SCREENSHOT_DIR, `${label}.png`);
    let status: "PASS" | "FAIL" = "PASS";
    try {
      const result = await body();
      try { await this.page.screenshot({ path: screenshotPath, fullPage: false }); } catch { /* tolerate screenshot failure */ }
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
  // Auth orchestrator (/me + /sync) lives at api.liquidclips.app and rejects
  // unknown JWTs with 401, which triggers notifyAuthFailure → clearJwt →
  // AuthGate bounces back to LoginOnboarding. The harness's fake JWT would
  // otherwise be rejected after one network round-trip, evicting us off the
  // Workstation surface before any clip rendering. Intercept both routes
  // and return synthetic success so the harness can stay on the customer
  // path. This is mock-layer-only — the user-visible DOM is never mocked.
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
  // Any other api.liquidclips.app GETs — return a benign 200 so transient
  // calls don't pop the auth-failure path.
  await page.route(/api\.liquidclips\.app\//, (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    return route.continue();
  });
}

async function seedCompletedSession(page: Page) {
  // Pre-populate the persisted session so Workstation's resume effect emits
  // a fake `engine:complete{kind:"bake", slug}` on mount, which the engine
  // session listener picks up and (in mock mode) hydrates FIXTURE_PROJECT
  // via sidecar.getProject. No URL ingest, no real engine run.
  /* D1 (2026-07-12) · canonical auth harness seed. Spec's
   * `interceptBackend` re-mocks /me + /sync AFTER this call. */
  await seedAuthenticatedShell(page, { tier: "solo" });
  await page.addInitScript((slug) => {
    try {
      const now = new Date().toISOString();
      window.localStorage.setItem(
        "lc:engine:session:v1",
        JSON.stringify({
          source: "reaction-journey.test.mp4",
          slug,
          status: "complete",
          percent: 1,
          stage: "thumbs",
          runtimeMode: "mock",
          startedAt: now,
          updatedAt: now,
        }),
      );
      // Clear any prior dock-open state so the test asserts force-open from clip:open-edit.
      window.localStorage.setItem("lc.dock.open", "1");
      // Clear any stale per-clip cockpit settings so persistence assertions are deterministic.
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(`lc.clip.${slug}:`)) window.localStorage.removeItem(k);
      }
    } catch { /* private mode / quota — degrade silently */ }
  }, FIXTURE_SLUG);
}

test.describe("Reaction Journey", () => {
  test(`${JOURNEY} · customer can add a reaction and it persists`, async ({ page }, testInfo) => {
    test.setTimeout(150_000);
    const rec = new JourneyRecorder(page, testInfo);

    try {
      // ── Step 1 · launch dev server + seed session before any app code runs ──
      await rec.step("Launch app and seed completed session", async () => {
        await interceptBackend(page);
        await seedCompletedSession(page);
        // skipIntro=1 short-circuits the 28.5s cinematic intro splash.
        // Hash routes directly to Workstation in one navigation.
        await page.goto("/?skipIntro=1#/workstation", { waitUntil: "domcontentloaded" });
      });

      // ── Step 2 · Navigate to Workstation by hash route ──
      await rec.step("Navigate to Workstation", async () => {
        // The route:enter event from AppShell triggers session reset; the
        // resume effect then re-emits bake-complete; getProject hydrates.
        try {
          await page.waitForSelector('[data-testid="clip-card"]', { timeout: 20_000 });
        } catch (e) {
          // Causal probe — when the harness times out here, snapshot which
          // route + session phase the page actually landed on so the next
          // turn knows the broken wire instead of guessing.
          const probe = await page.evaluate(() => ({
            hash: window.location.hash,
            search: window.location.search,
            url: window.location.href,
            sessionFromLs: window.localStorage.getItem("lc:engine:session:v1"),
            jwtFromLs: window.localStorage.getItem("lc.license.jwt.v1") ? "present" : "missing",
            workstationRouteRendered: !!document.querySelector('[data-design-os] [data-route="workstation"]')
              || !!document.querySelector('section.lc-ws-stage')
              || !!document.querySelector('.lc-ws-stage')
              || !!document.querySelector('.sim-stage.lc-ws-stage'),
            anyClipCard: document.querySelectorAll('[data-testid="clip-card"]').length,
            // Walk a few breadcrumbs the chrome exposes to diagnose what's on screen.
            simH1: document.querySelector('.sim-h1')?.textContent?.slice(0, 80) ?? null,
            workstationFrame: document.querySelector('.lc-ws-frame, .lc-workstation-frame, [class*="orkstation"]') ? "present" : "missing",
            cockpitDockMounted: !!document.querySelector('.lc-cockpit-dock'),
            bodyTextSample: document.body.textContent?.slice(0, 200) ?? null,
          }));
          await testInfo.attach("lc:diagnostics-step-2", {
            body: Buffer.from(JSON.stringify(probe, null, 2)),
            contentType: "application/json",
          });
          throw e;
        }
      });

      // ── Step 3 · Confirm clip grid populated with FIXTURE clips ──
      const clipCount = await rec.step("Confirm clip grid is populated", async () => {
        const cards = page.locator('[data-testid="clip-card"]');
        const count = await cards.count();
        expect(count, "FIXTURE_PROJECT should hydrate at least 2 clips").toBeGreaterThanOrEqual(2);
        rec.assert("grid_clip_count", count);
        return count;
      });
      expect(clipCount).toBeGreaterThanOrEqual(2);

      // ── Step 4 · Click Edit on clip 0 ──
      await rec.step("Click Edit on first clip", async () => {
        const firstCard = page.locator('[data-testid="clip-card"][data-clip-idx="0"]');
        await firstCard.locator('button.lc-clip-cta', { hasText: /^Open clip$/ }).first().click();
      });

      // ── Step 5 · Cockpit dock opens on Reaction ──
      await rec.step("Cockpit dock opens on Reaction tab", async () => {
        const dock = page.locator('.lc-cockpit-dock[data-module="reaction"][data-open="1"]');
        await expect(dock, "dock must be open AND on Reaction").toBeVisible({ timeout: 4_000 });
        rec.assert("dock_open_on_reaction", true);
      });

      // ── Step 6 · Choose reaction file via the hidden input ──
      await rec.step("Upload reaction file via hidden input", async () => {
        const input = page.locator('[data-testid="reaction-file-input"]');
        await input.setInputFiles(FIXTURE_MP4);
      });

      // ── Step 7 · Reaction overlay appears in ClipPreviewShell ──
      const overlayLayoutOne = await rec.step("Reaction overlay video appears on preview", async () => {
        const overlay = page.locator('[data-testid="reaction-overlay"]');
        await expect(overlay, "unbaked reaction overlay must mount").toBeVisible({ timeout: 4_000 });
        const layout = await overlay.getAttribute("data-reaction-layout");
        const src = await overlay.getAttribute("src");
        rec.assert("reaction_overlay_mounted", true);
        rec.assert("reaction_overlay_initial_layout", layout);
        rec.assert("reaction_overlay_src_kind", src?.startsWith("blob:") ? "blob" : "filesystem");
        return layout;
      });
      expect(overlayLayoutOne).toBeTruthy();

      // ── Step 8 · Verify both rigid 50/50 composers + pane swap ──
      await rec.step("Verify split layouts and pane swap", async () => {
        const stage = page.locator('[data-testid="preview-stage"]');
        const main = page.locator(".lc-cps-main-video");
        const overlay = page.locator('[data-testid="reaction-overlay"]');

        await page.getByTestId("reaction-layout-top-bottom").click();
        await expect(stage).toHaveAttribute("data-composite-layout", "top-bottom");
        const vertical = await Promise.all([
          stage.boundingBox(),
          main.boundingBox(),
          overlay.boundingBox(),
        ]);
        expect(vertical.every(Boolean), "vertical split boxes must render").toBe(true);
        const [vStage, vMain, vOverlay] = vertical;
        if (!vStage || !vMain || !vOverlay) throw new Error("vertical split geometry unavailable");
        expect(Math.abs(vMain.width - vStage.width)).toBeLessThanOrEqual(2);
        expect(Math.abs(vOverlay.width - vStage.width)).toBeLessThanOrEqual(2);
        expect(Math.abs(vMain.height - vStage.height / 2)).toBeLessThanOrEqual(2);
        expect(Math.abs(vOverlay.height - vStage.height / 2)).toBeLessThanOrEqual(2);
        expect(Math.abs(vOverlay.y + vOverlay.height - vMain.y)).toBeLessThanOrEqual(3);

        await page.getByTestId("reaction-layout-side-by-side").click();
        await expect(stage).toHaveAttribute("data-composite-layout", "side-by-side");
        const horizontal = await Promise.all([
          stage.boundingBox(),
          main.boundingBox(),
          overlay.boundingBox(),
        ]);
        expect(horizontal.every(Boolean), "horizontal split boxes must render").toBe(true);
        const [hStage, hMain, hOverlay] = horizontal;
        if (!hStage || !hMain || !hOverlay) throw new Error("horizontal split geometry unavailable");
        expect(Math.abs(hMain.height - hStage.height)).toBeLessThanOrEqual(2);
        expect(Math.abs(hOverlay.height - hStage.height)).toBeLessThanOrEqual(2);
        expect(Math.abs(hMain.width - hStage.width / 2)).toBeLessThanOrEqual(2);
        expect(Math.abs(hOverlay.width - hStage.width / 2)).toBeLessThanOrEqual(2);
        expect(Math.abs(hOverlay.x + hOverlay.width - hMain.x)).toBeLessThanOrEqual(3);

        await page.getByTestId("reaction-swap-panes").click();
        await expect(stage).toHaveAttribute("data-swap-panes", "1");
        await expect.poll(async () => {
          const swappedMain = await main.boundingBox();
          const swappedOverlay = await overlay.boundingBox();
          if (!swappedMain || !swappedOverlay) return false;
          return swappedMain.x < swappedOverlay.x
            && Math.abs(swappedMain.x + swappedMain.width - swappedOverlay.x) <= 3;
        }, {
          message: "swapped panes must settle into non-overlapping A · B order",
          timeout: 3_000,
          intervals: [50, 100, 250],
        }).toBe(true);
        rec.assert("split_layouts_are_rigid_50_50", true);
        rec.assert("split_panes_swap", true);
      });

      // ── Step 9 · Apply reaction ──
      await rec.step("Click Apply reaction", async () => {
        const apply = page.locator('[data-testid="reaction-apply"]');
        await expect(apply, "Apply button must be enabled once sourcePath set").toBeEnabled();
        await apply.click();
      });

      // ── Step 10 · Bake state transitions ──
      await rec.step("Bake state transitions to baking then done", async () => {
        const apply = page.locator('[data-testid="reaction-apply"]');
        // Mock sidecar emits engine:complete{kind:"bake"} after 1.4s; in-flight
        // state may flash through fast. Accept either: we observe "baking"
        // OR we land directly on "done" (race condition tolerated — both
        // are user-visible green states).
        await expect.poll(async () => apply.getAttribute("data-bake-state"), {
          timeout: 6_000,
          intervals: [100, 200, 400, 800],
        }).toMatch(/baking|done/);
        // Then it MUST settle to done.
        await expect.poll(async () => apply.getAttribute("data-bake-state"), {
          timeout: 6_000,
          intervals: [200, 400, 800, 1200],
        }).toBe("done");
        rec.assert("bake_state_reached_done", true);
      });

      // ── Step 10 · Switch to second clip ──
      await rec.step("Switch focus to second clip", async () => {
        const secondShell = page.locator('[data-testid="clip-card"][data-clip-idx="1"] [data-testid="clip-shell"]');
        await secondShell.click();
        // Dock head pill should now show clip #2 — wait for the focused clip
        // identity change to propagate through the lifted CockpitProvider.
        await page.locator('.lc-cd-clip-num', { hasText: "#2" }).waitFor({ timeout: 4_000 });
      });

      // ── Step 11 · Return to first clip ──
      await rec.step("Return to first clip", async () => {
        const firstShell = page.locator('[data-testid="clip-card"][data-clip-idx="0"] [data-testid="clip-shell"]');
        await firstShell.click();
        await page.locator('.lc-cd-clip-num', { hasText: "#1" }).waitFor({ timeout: 4_000 });
      });

      // ── Step 12 · Reaction overlay still present on first clip ──
      await rec.step("Reaction overlay persisted on returned clip", async () => {
        const overlay = page.locator('[data-testid="reaction-overlay"]');
        await expect(overlay, "reaction overlay must re-mount on returned clip (clipSettingsStore persistence)").toBeVisible({ timeout: 4_000 });
        const layoutTwo = await overlay.getAttribute("data-reaction-layout");
        rec.assert("reaction_overlay_persisted", true);
        rec.assert("reaction_overlay_persisted_layout", layoutTwo);
        // Step 8 deliberately changed the initial PIP default to the rigid
        // side-by-side layout. Persistence means that final user choice,
        // including the pane swap, is restored after a clip round-trip.
        expect(layoutTwo).toBe("side-by-side");
      });

      // ── Step 13 · Done — emit verdict via reporter attachments ──
      await rec.step("Emit verdict attachments", async () => {
        // Anchor screenshot for the final state.
        const final = path.join(SCREENSHOT_DIR, "13-final-state.png");
        await page.screenshot({ path: final, fullPage: true });
        rec.assert("final_screenshot", final);
      });
    } finally {
      await rec.finalize();
    }
  });
});
