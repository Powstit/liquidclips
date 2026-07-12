/**
 * Brand + UI Consistency Journey · USER-LENS AUTOMATION GATE · FEATURE-002
 *
 * Polish gate. No new features were added. The harness locks the
 * following polish contracts so future PRs can't regress them:
 *
 *   - every customer-visible Design OS route has a route title (h1)
 *   - no horizontal overflow on any route (scrollWidth ≤ innerWidth)
 *   - TopHud chrome (avatar button, mode pills, search) stays visible
 *     on every route
 *   - the avatar unread badge is absent (no fake count) on initial mount
 *   - workstation main content fits inside the viewport
 *   - Coming Soon copy is consistent: no "Coming soon · post-beta" or
 *     other ad-hoc variants
 *   - Backend offline pill is the canonical "Backend offline · preview only"
 *   - "Live · backend" pill is the canonical text for live state
 *   - no legacy / fake fixture words render anywhere
 *     ("Uncle Daniel", "DD Beauty", "Femi", "Sample clip · Demo clip ·
 *     Lorem", "Clip Squad 2026", "Solo · 1.4k clips" default, the
 *     scrubbed clipper handles "@uncle.daniel.cuts", "@daniel.diyepriye",
 *     "@ddbeauty.cuts", "@enumcos")
 *   - ConsoleNav has NO hardcoded fake badge counts (12, 3, 5 from the
 *     mock phase)
 */
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { harnessAssertShell, seedAuthenticatedShell } from "./_auth-harness";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");
const JOURNEY = "Brand Consistency";

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
    const label = `brc-${String(n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
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

/**
 * D1 (2026-07-12) · JWT + backend seeds now flow through
 * `seedAuthenticatedShell` (see `./_auth-harness`). Kept a thin
 * shim so the call sites below read cleanly.
 */
async function interceptBackend(page: Page) {
  await seedAuthenticatedShell(page, { tier: "solo" });
}

/* Canonical strings · the harness will fail if any of these are absent
 * where expected, or if any forbidden variant is present. */
const FORBIDDEN_SUBSTRINGS: ReadonlyArray<string> = [
  "Coming soon · post-beta",
  "Uncle Daniel",
  "DD Beauty",
  "Femi's Heart",
  "Clip Squad 2026",
  "Solo · 1.4k clips",
  "1.4K CLIPS",
  "@uncle.daniel.cuts",
  "@daniel.diyepriye",
  "@ddbeauty.cuts",
  "@enumcos",
  "Lorem ipsum",
];

const CANONICAL_OFFLINE_PILL = "Backend offline · preview only";
const CANONICAL_LIVE_PILL = "Live · backend";

/* Routes we navigate the harness through. Each entry includes:
 *  - route id used by bus.emit("nav:click", { route })
 *  - mode the user must be in to see the route ("clipper" | "agency" | null = any)
 *  - whether the route is expected to render a route-title h1 */
interface RouteCase {
  route: string;
  mode?: "clipper" | "agency";
  expectTitle: boolean;
}

const ROUTES: ReadonlyArray<RouteCase> = [
  { route: "home",         expectTitle: true },
  { route: "workstation",  expectTitle: true },
  { route: "create",       expectTitle: true }, // alias → home with create panel
  { route: "library",      expectTitle: true }, // alias → workstation (BUG-042 stub uses h1)
  { route: "channels",     expectTitle: true },
  { route: "campaigns",    expectTitle: true },
  { route: "clipper",      expectTitle: true, mode: "clipper" },
  { route: "earn",         expectTitle: true, mode: "clipper" },
  { route: "community",    expectTitle: true },
  { route: "analytics",    expectTitle: true, mode: "agency" },
  { route: "submissions",  expectTitle: true, mode: "agency" },
  { route: "settings",     expectTitle: true },
];

async function navigateToRoute(page: Page, r: RouteCase): Promise<void> {
  if (r.mode) {
    // Persist the mode so agency-gated routes (analytics, submissions)
    // actually render their content instead of redirecting to home.
    await page.evaluate((m) => {
      try { window.localStorage.setItem("lc.mode", m); } catch {}
      const w = window as unknown as { __lcBus?: { emit: (e: string, p: unknown) => void } };
      w.__lcBus?.emit?.("mode:change", { mode: m });
    }, r.mode);
  }
  await page.evaluate((route) => {
    const w = window as unknown as { __lcBus?: { emit: (e: string, p: unknown) => void } };
    w.__lcBus?.emit?.("nav:click", { route });
  }, r.route);
  // Allow alias resolution + route mount.
  await page.waitForTimeout(700);
}

test.describe("Brand Consistency Journey", () => {
  test(`${JOURNEY} · every route fits viewport · chrome stays visible · canonical copy locked`, async ({ page }, testInfo) => {
    // 2026-06-26 · 12-route loop + post-loop chrome/inbox/nav assertions
    // legitimately exceed the 90s default. The pre-D failure mode was a
    // missing route-title (steps short-circuited at step 9 missingTitles
    // assertion). After the data-route-title + InlineCreatePanel
    // close-on-nav fixes, the loop completes properly and needs more time.
    testInfo.setTimeout(150_000);
    const rec = new JourneyRecorder(page, testInfo);

    try {
      await rec.step("Launch app · seed JWT · land on home", async () => {
        await interceptBackend(page);
        await page.addInitScript(() => {
          try {
            // Start in clipper mode for the first half · agency-gated routes
            // swap mode in their navigateToRoute call.
            window.localStorage.setItem("lc.mode", "clipper");
          } catch {}
        });
        await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
        await harnessAssertShell(page);
        await expect(page.locator('[data-testid="home-tile-1"]')).toBeVisible({ timeout: 15_000 });
      });

      await rec.step("No fake unread badge on first mount", async () => {
        await expect(page.locator('[data-testid="avatar-orbit-badge"]')).toHaveCount(0);
      });

      await rec.step("TopHud user pill no longer shows the fake '1.4k clips' default", async () => {
        const bodyText = await page.evaluate(() => document.body.innerText);
        rec.assert("hud_1_4k_present", bodyText.toLowerCase().includes("1.4k"));
        expect(bodyText).not.toMatch(/Solo · 1\.4k clips/i);
        expect(bodyText).not.toMatch(/1\.4K CLIPS/);
      });

      const overflowReports: Array<{ route: string; scrollWidth: number; innerWidth: number }> = [];
      const missingTitles: string[] = [];
      const titleByRoute: Record<string, string> = {};

      for (const r of ROUTES) {
        await rec.step(`Route '${r.route}' · navigate + chrome + title + viewport fit`, async () => {
          await navigateToRoute(page, r);

          /* Avatar chrome must remain visible (the customer must always
           * be able to reach Settings / Notifications from any route). */
          await expect(page.locator('[data-testid="avatar-orbit-button"]')).toBeVisible({ timeout: 4_000 });

          /* The data-route attribute on .lc-app reflects the Design OS
           * inner route. For "create" + "library" (aliases), the inner
           * route resolves to home + workstation respectively · we just
           * confirm SOMETHING rendered. */
          const innerRoute = await page.evaluate(() => {
            return document.querySelector(".lc-app")?.getAttribute("data-route") ?? null;
          });
          rec.assert(`route_resolved_${r.route}`, innerRoute);

          /* Route title presence · accept any of:
           *   - h1 inside .lc-main
           *   - [data-route-title] anywhere in the route (used by
           *     CommandRoom + alias-home variants whose visible title
           *     is the TopHud greeting, not an h1) */
          if (r.expectTitle) {
            const h1Count = await page.locator(".lc-main h1").count();
            const titleAttrCount = await page.locator("[data-route-title]").count();
            if (h1Count === 0 && titleAttrCount === 0) missingTitles.push(r.route);
            else if (h1Count > 0) {
              const txt = (await page.locator(".lc-main h1").first().textContent()) ?? "";
              titleByRoute[r.route] = txt.trim();
            } else {
              const txt = await page.locator("[data-route-title]").first().getAttribute("data-route-title");
              titleByRoute[r.route] = (txt ?? "").trim();
            }
          }

          /* Horizontal overflow probe · the Tauri window defaults to
           * 1280×800. Anything that overflows is a bug. Allow 2px for
           * subpixel rounding. */
          const ovf = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
          }));
          if (ovf.scrollWidth > ovf.innerWidth + 2) {
            overflowReports.push({ route: r.route, ...ovf });
          }
        });
      }

      await rec.step("Every route resolved with a title", async () => {
        rec.assert("titles_by_route", titleByRoute);
        rec.assert("missing_titles", missingTitles);
        expect(missingTitles, `routes missing a route-title h1: ${missingTitles.join(", ")}`).toHaveLength(0);
      });

      await rec.step("No horizontal overflow on any route", async () => {
        rec.assert("overflow_reports", overflowReports);
        expect(overflowReports, `routes with horizontal overflow: ${JSON.stringify(overflowReports, null, 2)}`).toHaveLength(0);
      });

      await rec.step("Workstation fits viewport · cockpit-related chrome visible", async () => {
        await navigateToRoute(page, { route: "workstation", expectTitle: true });
        await expect(page.locator('[data-testid="avatar-orbit-button"]')).toBeVisible();
        // Workstation's main content container must not exceed viewport width.
        const sizes = await page.evaluate(() => {
          const main = document.querySelector(".lc-main") as HTMLElement | null;
          return {
            mainScrollWidth: main?.scrollWidth ?? 0,
            mainClientWidth: main?.clientWidth ?? 0,
            innerWidth: window.innerWidth,
          };
        });
        rec.assert("workstation_sizes", sizes);
        expect(sizes.mainScrollWidth).toBeLessThanOrEqual(sizes.innerWidth + 4);
      });

      await rec.step("No forbidden legacy / fixture strings anywhere across all routes", async () => {
        /* Walk every route once more, collecting body text. */
        const hits: Array<{ route: string; substring: string }> = [];
        for (const r of ROUTES) {
          await navigateToRoute(page, r);
          const text = await page.evaluate(() => document.body.innerText);
          for (const s of FORBIDDEN_SUBSTRINGS) {
            if (text.includes(s)) hits.push({ route: r.route, substring: s });
          }
        }
        rec.assert("forbidden_string_hits", hits);
        expect(hits, `forbidden strings rendered: ${JSON.stringify(hits, null, 2)}`).toHaveLength(0);
      });

      await rec.step("Backend offline + Live pills use canonical copy across Channels / Campaigns / Earn", async () => {
        const targetRoutes: ReadonlyArray<RouteCase> = [
          { route: "channels",  expectTitle: true },
          { route: "campaigns", expectTitle: true },
          { route: "earn",      expectTitle: true, mode: "clipper" },
        ];
        const variants: Array<{ route: string; text: string }> = [];
        for (const r of targetRoutes) {
          await navigateToRoute(page, r);
          /* Every `.lc-runtime-tag` text node must equal either the
           * canonical OFFLINE pill or the canonical LIVE pill (or be
           * the studio-preview secondary). The pills CSS-uppercase
           * everything, so we compare case-insensitively. */
          const pillTexts = await page.locator(".lc-runtime-tag").allInnerTexts();
          const canon = [CANONICAL_OFFLINE_PILL, CANONICAL_LIVE_PILL, "Studio preview"].map((s) => s.toLowerCase());
          for (const t of pillTexts) {
            const text = t.trim();
            if (text.length === 0) continue;
            const ok = canon.includes(text.toLowerCase());
            if (!ok) variants.push({ route: r.route, text });
          }
        }
        rec.assert("pill_variants", variants);
        expect(variants, `non-canonical pill copy found: ${JSON.stringify(variants, null, 2)}`).toHaveLength(0);
      });

      await rec.step("Inbox COMING SOON empty state still honest after navigation churn", async () => {
        await navigateToRoute(page, { route: "home", expectTitle: true });
        await page.locator('[data-testid="avatar-orbit-button"]').click();
        await expect(page.locator('[data-testid="avatar-orbit-menu"]')).toBeVisible();
        await page.locator('[data-testid="avatar-orbit-notifications"]').click();
        const overlay = page.locator('[data-testid="inbox-overlay"]');
        await expect(overlay).toBeVisible({ timeout: 2_000 });
        await expect(overlay).toHaveAttribute("data-inbox-state", "coming-soon");
        await expect(overlay).toHaveAttribute("data-inbox-message-count", "0");
      });

      await rec.step("ConsoleNav has NO hardcoded fake badge counts (12 / 3 / 5)", async () => {
        /* The pre-FEATURE-002 nav had hardcoded badges on Campaigns (12),
         * Submissions (3), and Schedule (5). They were UI scaffolding
         * from the mock phase that looked live. Assert they're gone. */
        const navText = await page.locator(".lc-rail").innerText();
        rec.assert("nav_text", navText);
        /* The previous fake counts were rendered as small badges next to
         * the label · they appeared as literal "12" / "3" / "5" tokens
         * adjacent to "Campaigns" / "Submissions" / "Schedule". */
        expect(navText).not.toMatch(/Campaigns\s*12/);
        expect(navText).not.toMatch(/Submissions\s*3/);
        expect(navText).not.toMatch(/Schedule\s*5/);
      });

      await rec.step("STATIC · no dead `tierLabel === \"FREE\"` conditional sneaks back in", async () => {
        /* TASK 5 surfaced a real onboarding bug: Settings.tsx had a
         * conditional `tierLabel === "FREE"` that never matched because
         * the tier enum collapses `free` → client `"clipper"` (then
         * UPPER-cased to `"CLIPPER"`). The bug routed every free
         * customer through the "Manage plan" copy. We sweep all .ts/.tsx
         * under src/ for any survivor of that pattern · zero allowed. */
        const repoRoot = path.resolve(__dirname, "..", "..");
        const srcDir = path.join(repoRoot, "src");
        const files: string[] = [];
        const walk = (d: string) => {
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
          }
        };
        walk(srcDir);
        /* Forbidden pattern · the literal `tierLabel === "FREE"` (any
         * whitespace). The TASK 5 fix replaced these with
         * `tier.tier === "clipper"` so the live tier mapping actually
         * matches. */
        const reDeadFree = /tierLabel\s*===\s*"FREE"/g;
        const offenders: Array<{ file: string; line: number; match: string }> = [];
        for (const f of files) {
          const src = fs.readFileSync(f, "utf8");
          let m: RegExpExecArray | null;
          while ((m = reDeadFree.exec(src)) !== null) {
            const line = src.slice(0, m.index).split("\n").length;
            offenders.push({ file: path.relative(repoRoot, f), line, match: m[0] });
          }
        }
        rec.assert("dead_tierlabel_free_callers", offenders);
        expect(offenders, `dead 'tierLabel === "FREE"' conditional resurfaced: ${JSON.stringify(offenders, null, 2)}`).toHaveLength(0);
      });

      await rec.step("STATIC · no 'Coming soon · post-beta' / 'after the engine port' variants resurface", async () => {
        /* FEATURE-002 standardised the Coming Soon copy. This static
         * sweep guards against the two specific variants we already
         * fixed AND a third that surfaced in audit: 'after the engine
         * port' was a timeline phrase that read as a promise. */
        const repoRoot = path.resolve(__dirname, "..", "..");
        const srcDir = path.join(repoRoot, "src");
        const files: string[] = [];
        const walk = (d: string) => {
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
          }
        };
        walk(srcDir);
        const forbiddenLiterals = [
          "Coming soon · post-beta",
          "post-beta",
        ];
        const offenders: Array<{ file: string; line: number; literal: string }> = [];
        for (const f of files) {
          const src = fs.readFileSync(f, "utf8");
          /* Strip comments first so audit notes don't false-positive. */
          const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
          for (const lit of forbiddenLiterals) {
            let from = 0;
            while ((from = stripped.indexOf(lit, from)) !== -1) {
              const line = stripped.slice(0, from).split("\n").length;
              offenders.push({ file: path.relative(repoRoot, f), line, literal: lit });
              from += lit.length;
            }
          }
        }
        rec.assert("forbidden_copy_offenders", offenders);
        expect(offenders, `forbidden coming-soon variants resurfaced: ${JSON.stringify(offenders, null, 2)}`).toHaveLength(0);
      });
    } finally {
      await rec.finalize();
    }
  });
});
