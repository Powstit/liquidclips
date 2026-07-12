# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e/agency-launch-readiness.spec.ts >> Agency Launch Readiness Journey >> Agency Launch Readiness · single operator runs agency end-to-end without fake surfaces
- Location: tests/e2e/agency-launch-readiness.spec.ts:120:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-testid="avatar-orbit-button"]')
Expected: visible
Timeout: 120000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 120000ms
  - waiting for locator('[data-testid="avatar-orbit-button"]')

```

```yaml
- img "Liquid Clips"
- heading "Sign in to Liquid Clips" [level=1]
- text: Email
- textbox "Email":
  - /placeholder: you@example.com
- button "Send code"
- region "Recent clips from Liquid Clips users":
  - text: $618 🔇 @featured $424 🔇 @clipper-02 $331 🔇 @clipper-03 $273 🔇 @clipper-04 $512 🔇 @clipper-05 $189 🔇 @clipper-06 $475 🔇 @clipper-07 $246 🔇 @clipper-08 $394 🔇 @clipper-09 $556 🔇 @clipper-10 $618 🔇 @featured $424 🔇 @clipper-02 $331 🔇 @clipper-03 $273 🔇 @clipper-04 $512 🔇 @clipper-05 $189 🔇 @clipper-06 $475 🔇 @clipper-07 $246 🔇 @clipper-08 $394 🔇 @clipper-09 $556 🔇 @clipper-10
  - paragraph: 870 clippers · $4018 paid last week
```

# Test source

```ts
  26  |  */
  27  | import { test, expect, type Page, type TestInfo } from "@playwright/test";
  28  | import * as fs from "node:fs";
  29  | import * as path from "node:path";
  30  | import { fileURLToPath } from "node:url";
  31  | 
  32  | const __filename = fileURLToPath(import.meta.url);
  33  | const __dirname = path.dirname(__filename);
  34  | 
  35  | const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");
  36  | const JOURNEY = "Agency Launch Readiness";
  37  | 
  38  | interface StepRecord { step: number; name: string; status: "PASS" | "FAIL"; }
  39  | 
  40  | class JourneyRecorder {
  41  |   private consoleErrors: string[] = [];
  42  |   private domAssertions: Record<string, unknown> = {};
  43  |   private currentStep = 0;
  44  |   constructor(private page: Page, private info: TestInfo) {
  45  |     page.on("pageerror", (e) => this.consoleErrors.push(`pageerror: ${e.message}`));
  46  |     page.on("console", (msg) => {
  47  |       const t = msg.type();
  48  |       if (t === "error" || t === "warning") this.consoleErrors.push(`console.${t}: ${msg.text()}`);
  49  |     });
  50  |     fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  51  |   }
  52  |   async step<T>(name: string, body: () => Promise<T>): Promise<T> {
  53  |     this.currentStep += 1;
  54  |     const n = this.currentStep;
  55  |     const label = `agc-${String(n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  56  |     const screenshotPath = path.join(SCREENSHOT_DIR, `${label}.png`);
  57  |     try {
  58  |       const result = await body();
  59  |       try { await this.page.screenshot({ path: screenshotPath, fullPage: false }); } catch {}
  60  |       const rec: StepRecord = { step: n, name, status: "PASS" };
  61  |       await this.info.attach(`lc:step:${n}`, { body: Buffer.from(JSON.stringify(rec)), contentType: "application/json" });
  62  |       return result;
  63  |     } catch (e) {
  64  |       try { await this.page.screenshot({ path: screenshotPath, fullPage: false }); } catch {}
  65  |       const rec: StepRecord = { step: n, name, status: "FAIL" };
  66  |       await this.info.attach(`lc:step:${n}`, { body: Buffer.from(JSON.stringify(rec)), contentType: "application/json" });
  67  |       throw e;
  68  |     }
  69  |   }
  70  |   assert(k: string, v: unknown) { this.domAssertions[k] = v; }
  71  |   async finalize() {
  72  |     await this.info.attach("lc:journey", { body: Buffer.from(JOURNEY), contentType: "text/plain" });
  73  |     await this.info.attach("lc:console-errors", { body: Buffer.from(JSON.stringify(this.consoleErrors)), contentType: "application/json" });
  74  |     await this.info.attach("lc:assertions", { body: Buffer.from(JSON.stringify(this.domAssertions)), contentType: "application/json" });
  75  |   }
  76  | }
  77  | 
  78  | async function bootAgencyAdmin(page: Page) {
  79  |   const me = {
  80  |     user: { id: "harness", email: "harness@liquidclips.app", tier: "agency" },
  81  |     tier: "agency", effective_tier: "agency", raw_tier: "agency", admin_override: true,
  82  |   };
  83  |   const sync = { tier: "agency", caps: { watermarkLocked: false } };
  84  |   await page.route(/api\.liquidclips\.app\//, (r) => {
  85  |     if (r.request().method() === "GET") return r.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  86  |     return r.continue();
  87  |   });
  88  |   await page.route(/api\.liquidclips\.app\/sync(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sync) }));
  89  |   await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(me) }));
  90  |   await page.addInitScript(() => {
  91  |     try {
  92  |       window.localStorage.setItem("lc.license.jwt.v1", "harness.fake.jwt");
  93  |       /* Start in clipper mode; the test flips to agency to exercise
  94  |        * the mode toggle path. */
  95  |       window.localStorage.setItem("lc.mode", "clipper");
  96  |     } catch {}
  97  |   });
  98  |   await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
  99  |   await expect(page.locator('[data-testid="home-tile-1"]')).toBeVisible({ timeout: 15_000 });
  100 | }
  101 | 
  102 | async function navigateTo(page: Page, route: string) {
  103 |   await page.evaluate((r) => {
  104 |     const w = window as unknown as { __lcBus?: { emit: (e: string, p: unknown) => void } };
  105 |     w.__lcBus?.emit?.("nav:click", { route: r });
  106 |   }, route);
  107 |   await page.waitForTimeout(700);
  108 | }
  109 | 
  110 | async function setMode(page: Page, mode: "clipper" | "agency") {
  111 |   await page.evaluate((m) => {
  112 |     try { window.localStorage.setItem("lc.mode", m); } catch {}
  113 |     const w = window as unknown as { __lcBus?: { emit: (e: string, p: unknown) => void } };
  114 |     w.__lcBus?.emit?.("mode:change", { mode: m });
  115 |   }, mode);
  116 |   await page.waitForTimeout(400);
  117 | }
  118 | 
  119 | test.describe("Agency Launch Readiness Journey", () => {
  120 |   test(`${JOURNEY} · single operator runs agency end-to-end without fake surfaces`, async ({ page }, testInfo) => {
  121 |     const rec = new JourneyRecorder(page, testInfo);
  122 | 
  123 |     try {
  124 |       await rec.step("Boot as admin agency operator · land on home", async () => {
  125 |         await bootAgencyAdmin(page);
> 126 |         await expect(page.locator('[data-testid="avatar-orbit-button"]')).toBeVisible();
      |                                                                           ^ Error: expect(locator).toBeVisible() failed
  127 |       });
  128 | 
  129 |       await rec.step("Flip TopHud mode pill to Agency · mode persists", async () => {
  130 |         await setMode(page, "agency");
  131 |         const mode = await page.evaluate(() => {
  132 |           try { return window.localStorage.getItem("lc.mode"); } catch { return null; }
  133 |         });
  134 |         rec.assert("mode_after_flip", mode);
  135 |         expect(mode).toBe("agency");
  136 |       });
  137 | 
  138 |       await rec.step("ConsoleNav exposes agency-only routes (Submissions + Analytics) · clipper-only routes hidden", async () => {
  139 |         const navText = (await page.locator(".lc-rail").innerText()).toLowerCase();
  140 |         rec.assert("nav_text_agency", navText);
  141 |         expect(navText).toContain("submissions");
  142 |         expect(navText).toContain("analytics");
  143 |         /* Clipper-only items vanish in agency mode (`modes: ["clipper"]`). */
  144 |         expect(navText).not.toContain("my journey");
  145 |         expect(navText).not.toContain("earn");
  146 |       });
  147 | 
  148 |       await rec.step("Campaigns · '+ Create campaign' CTA visible (admin + agency-source trusted)", async () => {
  149 |         await navigateTo(page, "campaigns");
  150 |         const cta = page.locator('.lc-campaigns-create-cta');
  151 |         await expect(cta).toBeVisible({ timeout: 6_000 });
  152 |         const ctaText = (await cta.textContent())?.trim() ?? "";
  153 |         rec.assert("campaign_cta_text", ctaText);
  154 |         expect(ctaText).toMatch(/create campaign/i);
  155 |         /* No "checking" / "agency access required" suffix · admin user
  156 |          * with agency tier is trusted to create. */
  157 |         expect(ctaText.toLowerCase()).not.toContain("agency access required");
  158 |         expect(ctaText.toLowerCase()).not.toContain("activate first");
  159 |       });
  160 | 
  161 |       await rec.step("Submissions · COMING SOON banner visible · zero fake rows", async () => {
  162 |         await navigateTo(page, "submissions");
  163 |         const banner = page.locator('[data-testid="submissions-coming-soon"]');
  164 |         await expect(banner).toBeVisible({ timeout: 6_000 });
  165 |         await expect(banner).toHaveAttribute("data-state", "coming-soon");
  166 |         /* Filter chips render with 0 counts; the "All" chip count is the
  167 |          * total · must be 0 because the fixture is empty. */
  168 |         const layout = page.locator('[data-testid="submissions-layout"]');
  169 |         await expect(layout).toBeVisible();
  170 |         await expect(layout).toHaveAttribute("data-submissions-count", "0");
  171 |         await expect(page.locator('[data-testid="submissions-empty"]')).toBeVisible();
  172 |         /* Forbidden strings from the prior fixture must NOT render. */
  173 |         const body = await page.evaluate(() => document.body.innerText);
  174 |         const forbidden = [
  175 |           "@preview-clipper-01", "@preview-clipper-02", "@preview-clipper-03",
  176 |           "@preview-clipper-04", "@preview-clipper-05",
  177 |           "Sample clip · pending review", "Sample clip · approved",
  178 |           "Sample clip · paid", "Sample clip · rejected",
  179 |         ];
  180 |         for (const s of forbidden) {
  181 |           rec.assert(`forbid_${s}`, body.includes(s));
  182 |           expect(body, `fixture leak: ${s}`).not.toContain(s);
  183 |         }
  184 |       });
  185 | 
  186 |       await rec.step("Analytics · honest '—' placeholders + COMING SOON copy", async () => {
  187 |         await navigateTo(page, "analytics");
  188 |         const stub = page.locator('[data-testid="analytics-stub"]');
  189 |         await expect(stub).toBeVisible({ timeout: 6_000 });
  190 |         await expect(stub).toHaveAttribute("data-state", "coming-soon");
  191 |         const copy = (await page.locator('[data-testid="analytics-coming-soon-copy"]').textContent())?.trim() ?? "";
  192 |         rec.assert("analytics_copy", copy);
  193 |         expect(copy.toLowerCase()).toMatch(/coming|wires|until/);
  194 |         /* Every card value must render the placeholder em-dash, not a
  195 |          * fake number. */
  196 |         const cardValues = await page.locator('[data-testid^="analytics-card-value-"]').allInnerTexts();
  197 |         rec.assert("analytics_card_values", cardValues);
  198 |         for (const v of cardValues) {
  199 |           expect(v.trim()).toBe("—");
  200 |         }
  201 |       });
  202 | 
  203 |       await rec.step("Flip back to clipper mode · agency-only routes disappear", async () => {
  204 |         await setMode(page, "clipper");
  205 |         await navigateTo(page, "home");
  206 |         const navText = (await page.locator(".lc-rail").innerText()).toLowerCase();
  207 |         rec.assert("nav_text_clipper", navText);
  208 |         expect(navText).not.toContain("submissions");
  209 |         expect(navText).not.toContain("analytics");
  210 |         /* Clipper-only items reappear. */
  211 |         expect(navText).toContain("my journey");
  212 |         expect(navText).toContain("earn");
  213 |       });
  214 | 
  215 |       await rec.step("STATIC · agency tier matrix matches the client cap matrix", async () => {
  216 |         /* The tier_enforcement_backend journey already locks this
  217 |          * server-side, but agency-launch-readiness re-asserts it from
  218 |          * the client side so any future tier-matrix drift fails the
  219 |          * agency journey too (not just the backend pytest). */
  220 |         const repoRoot = path.resolve(__dirname, "..", "..");
  221 |         const clientSrc = fs.readFileSync(
  222 |           path.join(repoRoot, "src/design-os/state/useTierCaps.ts"),
  223 |           "utf8",
  224 |         );
  225 |         /* These numbers come straight from the FEATURE-004 audit and
  226 |          * are also enforced by junior-backend's TIER_LIMITS dict.  */
```