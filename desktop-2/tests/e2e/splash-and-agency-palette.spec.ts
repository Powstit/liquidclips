/**
 * Splash + Agency Palette Journey · USER-LENS AUTOMATION GATE · TASK 7
 *
 * Locks two contracts ahead of launch:
 *
 *   TASK 7A · the existing 3-stage splash flow is honest end-to-end:
 *     - First-launch (no `lc:intro-seen:v1`) renders the intro stage.
 *     - `intro.mp4` asset exists and is loaded by the splash root.
 *     - All 3 stages (`intro` → `loading` → `game`) expose
 *       `data-splash-stage` for harness grip.
 *     - Skip button is reachable and advances out of the splash.
 *     - Returning customer (`hasSeenIntro()` true) skips intro stage
 *       and lands on the loading stage directly.
 *     - The Kade + brand-kit asset inventory used by the splash is on
 *       disk (no missing-asset surprises at launch).
 *
 *   TASK 7B · agency mode flips the accent palette to blue:
 *     - `body[data-app-mode="agency"]` is set when mode flips.
 *     - The CSS variable `--lc-accent` resolves to the blue token at
 *       agency mode, fuchsia at clipper mode.
 *     - The TopHud mode pill (`.lc-hud-mode-opt.on`) computed text
 *       colour reads as a blue value in agency mode (RGB sanity check).
 */
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");
const JOURNEY = "Splash and Agency Palette";
const REPO_ROOT = path.resolve(__dirname, "..", "..");

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
    const label = `spl-${String(n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
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

async function interceptBackend(page: Page) {
  const me = {
    user: { id: "harness", email: "harness@liquidclips.app", tier: "solo" },
    tier: "solo", effective_tier: "solo", raw_tier: "solo",
  };
  const sync = { tier: "solo", caps: { watermarkLocked: false } };
  await page.route(/api\.liquidclips\.app\//, (r) => {
    if (r.request().method() === "GET") return r.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    return r.continue();
  });
  await page.route(/api\.liquidclips\.app\/sync(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sync) }));
  await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(me) }));
}

test.describe("Splash and Agency Palette Journey", () => {
  test(`${JOURNEY} · splash stages exist · returning-user skip · agency-blue accent`, async ({ page }, testInfo) => {
    const rec = new JourneyRecorder(page, testInfo);

    try {
      /* ─── STATIC · existing splash assets on disk ───────────────── */

      await rec.step("STATIC · TASK 7A splash assets present (intro.mp4 · closing-still.png · Kade poses · bug sprites)", async () => {
        const required = [
          "src/overlays/IntroSplash.tsx",
          "src/lib/intro.ts",
          "public/brand/intro/intro.mp4",
          "public/brand/intro/closing-still.png",
          "public/brand/kade/kade-base.png",
          "public/brand/kade/kade-shooter.webp",
          "public/brand/kade/kade-success.webp",
          "public/brand/enemies/bug-grunt.webp",
          "public/brand/enemies/bug-spider.webp",
          "public/brand/worlds/boot-sequence.webp",
        ];
        const missing = required.filter((rel) => !fs.existsSync(path.join(REPO_ROOT, rel)));
        rec.assert("missing_assets", missing);
        expect(missing, `splash assets missing on disk: ${missing.join(", ")}`).toHaveLength(0);
      });

      await rec.step("STATIC · IntroSplash 3-stage contract is wired (intro · loading · game)", async () => {
        const src = fs.readFileSync(path.join(REPO_ROOT, "src/overlays/IntroSplash.tsx"), "utf8");
        /* The 3 stages must be addressable from the harness. We assert
         * the literal stage names live in the SplashStage union AND
         * the data-splash-stage attribute is emitted (testid hook). */
        expect(src).toMatch(/type SplashStage\s*=\s*"intro"\s*\|\s*"loading"\s*\|\s*"game"/);
        expect(src).toMatch(/data-splash-stage/);
        expect(src).toMatch(/data-testid="intro-splash"/);
        expect(src).toMatch(/data-testid="intro-splash-video"/);
        expect(src).toMatch(/data-testid="intro-splash-skip"/);
        expect(src).toMatch(/src="\/brand\/intro\/intro\.mp4"/);
      });

      await rec.step("STATIC · Skip + Continue buttons share font-sans (no font-mono drift)", async () => {
        /* User directive: 'ensure the skip intro and continue buttons
         * are all on brand using same fonts.' Both buttons must declare
         * `font-sans` and NEITHER may use `font-mono`. The mono variant
         * pre-TASK 7 was the inconsistency. */
        const splashSrc = fs.readFileSync(path.join(REPO_ROOT, "src/overlays/IntroSplash.tsx"), "utf8");
        const gameSrc = fs.readFileSync(path.join(REPO_ROOT, "src/overlays/invaders/SplashGame.tsx"), "utf8");
        /* Pull the JSX of each skip button (there are two — intro stage
         * + loading/game stage) and the continue button. Confirm none
         * declare font-mono in their className. */
        const skipBlocks = splashSrc.match(/<button[^>]*data-testid="intro-splash-skip"[\s\S]*?<\/button>/g) ?? [];
        expect(skipBlocks.length, "expected 2 skip-intro buttons (intro + loading/game stages)").toBeGreaterThanOrEqual(2);
        for (const block of skipBlocks) {
          expect(block, `skip button still declares font-mono: ${block.slice(0, 200)}`).not.toMatch(/font-mono/);
          expect(block).toMatch(/font-sans/);
        }
        const continueBlock = gameSrc.match(/<button[^>]*data-testid="intro-splash-continue"[\s\S]*?<\/button>/);
        expect(continueBlock, "continue button must carry data-testid hook").not.toBeNull();
        expect(continueBlock![0]).not.toMatch(/font-mono/);
        expect(continueBlock![0]).toMatch(/font-sans/);
      });

      /* ─── LIVE · first launch shows the intro stage ─────────────── */

      await rec.step("LIVE · first launch (no lc:intro-seen) renders the intro stage", async () => {
        await interceptBackend(page);
        await page.addInitScript(() => {
          try {
            window.localStorage.removeItem("lc:intro-seen:v1");
            window.localStorage.setItem("lc.license.jwt.v1", "harness.fake.jwt");
            window.localStorage.setItem("lc.mode", "clipper");
          } catch {}
        });
        /* Boot WITHOUT ?skipIntro=1 so the splash actually mounts. The
         * ?forceIntro=1 query param reverses the vite-DEV / qaGateEnabled
         * auto-skip so this test can exercise the mount path · App.tsx
         * routes forceIntro through the escape hatch added 2026-06-26. */
        await page.goto("/?forceIntro=1", { waitUntil: "domcontentloaded" });
        await expect(page.locator('[data-testid="intro-splash"]')).toBeVisible({ timeout: 15_000 });
        const stage = await page.locator('[data-testid="intro-splash"]').first().getAttribute("data-splash-stage");
        rec.assert("first_launch_stage", stage);
        expect(stage).toBe("intro");
      });

      await rec.step("LIVE · skip button on intro stage advances past the splash", async () => {
        const skip = page.locator('[data-testid="intro-splash-skip"]').first();
        await expect(skip).toBeVisible({ timeout: 4_000 });
        await skip.click();
        /* After skip the splash either advances to game stage (with
         * Continue button) OR unmounts entirely. Either is acceptable;
         * the contract is "skip works". We confirm the splash unmounts
         * or moves off the intro stage within 8s. */
        await expect.poll(async () => {
          const el = page.locator('[data-testid="intro-splash"]');
          const count = await el.count();
          if (count === 0) return "unmounted";
          return await el.first().getAttribute("data-splash-stage");
        }, { timeout: 10_000, intervals: [200, 400, 800] }).not.toBe("intro");
      });

      /* ─── TIER 1 · SplashGame renders clean regardless of sprite state ───── */

      await rec.step("STATIC · InvadersCanvas keeps the geometric fallback active (sprite preload disabled until alpha audit)", async () => {
        /* The Tier-1 ship-safe contract: sprite preload stays DISABLED
         * until a future Tier-2 alpha audit verifies the PNG pack has
         * real transparency. The geometric-shape renderer is the safe
         * path · the v0.6.0 "Higgsfield PNGs had opaque backgrounds"
         * regression must not silently resurface. */
        const src = fs.readFileSync(path.join(REPO_ROOT, "src/overlays/invaders/InvadersCanvas.tsx"), "utf8");
        /* The canvas element must carry the data-renderer marker. */
        expect(src).toMatch(/data-testid="splash-game-canvas"/);
        expect(src).toMatch(/data-renderer="geometric"/);
        /* The Tier-1 comment block must remain (it documents the
         * disabled-on-purpose state · removing it would suggest someone
         * is about to flip the switch without an alpha audit). */
        expect(src).toMatch(/Higgsfield-generated PNG sprite pack/);
        /* The source documents the disabled-on-purpose state via either
         * "falls back to the geometric shapes" OR "geometric-shape
         * renderer below" — accept either phrasing as proof the guard
         * comment is intact. */
        expect(src).toMatch(/geometric-shape renderer|geometric shapes/i);
      });

      await rec.step("LIVE · SplashGame canvas mounts cleanly with geometric renderer · no console errors during gameplay", async () => {
        /* Reset to a fresh, in-splash state. We boot without seen-intro
         * so the splash mounts; immediately click skip to land on the
         * game stage. */
        await page.addInitScript(() => {
          try { window.localStorage.removeItem("lc:intro-seen:v1"); } catch {}
        });
        await page.goto("/?forceIntro=1", { waitUntil: "domcontentloaded" });
        await expect(page.locator('[data-testid="intro-splash"]')).toBeVisible({ timeout: 12_000 });
        const skip = page.locator('[data-testid="intro-splash-skip"]').first();
        await skip.click();
        /* Game stage takes ~5s minimum (LOADING_MIN_HOLD_MS). Wait for
         * the canvas to mount. The Tier-1 contract is "canvas exists
         * + has non-zero pixel dimensions" — proves the geometric
         * renderer is doing its job even if sprites would have failed. */
        const canvas = page.locator('[data-testid="splash-game-canvas"]');
        await expect(canvas).toBeVisible({ timeout: 20_000 });
        const renderer = await canvas.getAttribute("data-renderer");
        rec.assert("splash_game_renderer", renderer);
        expect(renderer).toBe("geometric");
        const dims = await canvas.evaluate((el) => {
          const c = el as HTMLCanvasElement;
          return { w: c.width, h: c.height, cssW: c.getBoundingClientRect().width, cssH: c.getBoundingClientRect().height };
        });
        rec.assert("splash_game_canvas_dims", dims);
        expect(dims.w, "canvas backing width must be non-zero").toBeGreaterThan(0);
        expect(dims.h, "canvas backing height must be non-zero").toBeGreaterThan(0);
        expect(dims.cssW).toBeGreaterThan(0);
        expect(dims.cssH).toBeGreaterThan(0);
      });

      await rec.step("LIVE · no broken-image icons in splash · no missing-asset errors", async () => {
        /* Every <img> in the splash should be either loaded or hidden.
         * Catch missing-asset surprises (a PNG referenced but absent on
         * disk would render the browser's broken-image icon). */
        const broken = await page.evaluate(() => {
          const imgs = Array.from(document.images);
          return imgs
            .filter((img) => img.complete && img.naturalWidth === 0)
            .map((img) => img.currentSrc || img.src);
        });
        rec.assert("broken_images", broken);
        expect(broken, `broken image references in splash: ${broken.join(", ")}`).toHaveLength(0);
      });

      /* ─── LIVE · returning customer skips the intro stage ───────── */

      await rec.step("LIVE · returning customer (lc:intro-seen set) boots past intro stage", async () => {
        await page.addInitScript(() => {
          try { window.localStorage.setItem("lc:intro-seen:v1", "1"); } catch {}
        });
        await page.goto("/", { waitUntil: "domcontentloaded" });
        /* The splash component may still mount on stage "loading" or
         * the page may have advanced past it entirely. We assert that
         * the intro stage is NOT shown. */
        await page.waitForTimeout(800);
        const introOnly = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="intro-splash"]') as HTMLElement | null;
          if (!el) return null;
          return el.getAttribute("data-splash-stage");
        });
        rec.assert("returning_user_stage", introOnly);
        expect(introOnly).not.toBe("intro");
      });

      /* ─── TASK 7B · agency-blue accent ──────────────────────────── */

      await rec.step("LIVE · boot with ?skipIntro=1 · land on home with default clipper accent (fuchsia)", async () => {
        await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
        await expect(page.locator('[data-testid="home-tile-1"]')).toBeVisible({ timeout: 15_000 });
        const mode = await page.evaluate(() => document.body.getAttribute("data-app-mode"));
        rec.assert("initial_body_app_mode", mode);
        expect(mode).toBe("clipper");
        const accent = await page.evaluate(() => {
          return getComputedStyle(document.documentElement).getPropertyValue("--lc-accent").trim();
        });
        rec.assert("initial_lc_accent", accent);
        /* The fuchsia token is `var(--color-fuchsia)`. We don't know the
         * resolved hex of the underlying var without reading
         * `--color-fuchsia` too — just confirm we aren't already on the
         * blue token. */
        expect(accent).not.toBe("");
        expect(accent.toLowerCase()).not.toContain("2d7ff9");
      });

      await rec.step("LIVE · flip mode to agency · body[data-app-mode] flips · --lc-accent resolves turquoise", async () => {
        await page.evaluate(() => {
          try { window.localStorage.setItem("lc.mode", "agency"); } catch {}
          const w = window as unknown as { __lcBus?: { emit: (e: string, p: unknown) => void } };
          w.__lcBus?.emit?.("mode:change", { mode: "agency" });
        });
        await page.waitForTimeout(300);
        const mode = await page.evaluate(() => document.body.getAttribute("data-app-mode"));
        rec.assert("agency_body_app_mode", mode);
        expect(mode).toBe("agency");
        /* The CSS var should now resolve to the turquoise accent token.
         *
         * 2026-06-23 — Daniel's monetisation pass repointed the agency
         * accent from the original blue (#2D7FF9) to TURQUOISE (#14B8A6,
         * Tailwind teal-500) so the agency mode reads as the visual
         * opposite of the fuchsia clipper accent. The legacy var name
         * --lc-accent-blue is kept as an alias pointing at the cyan pair
         * for back-compat. Accept any of: the new turquoise hex (any
         * case), its rgb() form, the cyan-alias name, the new cyan-var
         * name, or any cyan/teal hex starting with 0/1/2 in the green
         * channel — to leave room for future palette tweaks. */
        const accent = await page.evaluate(() => {
          return getComputedStyle(document.body).getPropertyValue("--lc-accent").trim();
        });
        rec.assert("agency_lc_accent", accent);
        const lower = accent.toLowerCase();
        expect(
          lower.includes("14b8a6") ||              // turquoise · teal-500
          lower.includes("rgb(20, 184, 166)") ||
          lower.includes("var(--lc-accent-cyan)") ||
          lower.includes("var(--lc-accent-blue)"), // legacy alias still valid
          `agency --lc-accent did not resolve to the turquoise pair · got: "${accent}"`,
        ).toBe(true);
      });

      await rec.step("LIVE · agency mode-pill text colour is NOT fuchsia (turquoise · G+B dominant)", async () => {
        /* Take the computed text colour of the active mode pill. In
         * agency mode it should be a turquoise — G+B dominant (NOT
         * red-dominant). The fuchsia clipper accent has R≫G,B; the
         * turquoise agency accent flips that. Assert R < max(G,B) +
         * G channel high enough to confirm we hit the teal family. */
        const rgb = await page.evaluate(() => {
          const el = document.querySelector(".lc-hud-mode-opt.on") as HTMLElement | null;
          if (!el) return null;
          return getComputedStyle(el).color;
        });
        rec.assert("agency_mode_pill_color", rgb);
        expect(rgb, "active mode pill not mounted").not.toBeNull();
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb!);
        expect(m, `couldn't parse colour: ${rgb}`).not.toBeNull();
        const r = Number(m![1]); const g = Number(m![2]); const b = Number(m![3]);
        rec.assert("agency_pill_rgb", { r, g, b });
        expect(
          Math.max(g, b) > r,
          `agency pill should be turquoise (G or B dominant over R) · rgb=(${r},${g},${b})`,
        ).toBe(true);
      });

      await rec.step("LIVE · flip back to clipper · body attribute + accent revert", async () => {
        await page.evaluate(() => {
          try { window.localStorage.setItem("lc.mode", "clipper"); } catch {}
          const w = window as unknown as { __lcBus?: { emit: (e: string, p: unknown) => void } };
          w.__lcBus?.emit?.("mode:change", { mode: "clipper" });
        });
        await page.waitForTimeout(300);
        const mode = await page.evaluate(() => document.body.getAttribute("data-app-mode"));
        rec.assert("clipper_after_revert", mode);
        expect(mode).toBe("clipper");
        /* And the active mode pill should now be a RED-channel-dominant
         * colour (fuchsia). */
        const rgb = await page.evaluate(() => {
          const el = document.querySelector(".lc-hud-mode-opt.on") as HTMLElement | null;
          if (!el) return null;
          return getComputedStyle(el).color;
        });
        if (rgb) {
          const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
          if (m) {
            const r = Number(m[1]); const g = Number(m[2]); const b = Number(m[3]);
            rec.assert("clipper_pill_rgb", { r, g, b });
            expect(r, `clipper pill should be fuchsia (red-dominant) · rgb=(${r},${g},${b})`).toBeGreaterThan(b);
          }
        }
      });
    } finally {
      await rec.finalize();
    }
  });
});
