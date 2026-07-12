# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e/campaigns-station.spec.ts >> Campaigns Station Journey >> Campaigns Station · honest mock-source state · zero fake campaigns · zero fake clipper counts · zero fake invite-link writes
- Location: tests/e2e/campaigns-station.spec.ts:101:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-testid="campaigns-stage"]')
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for locator('[data-testid="campaigns-stage"]')

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
  24  |  */
  25  | import { test, expect, type Page, type TestInfo } from "@playwright/test";
  26  | import * as fs from "node:fs";
  27  | import * as path from "node:path";
  28  | import { fileURLToPath } from "node:url";
  29  | 
  30  | const __filename = fileURLToPath(import.meta.url);
  31  | const __dirname = path.dirname(__filename);
  32  | 
  33  | const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");
  34  | const JOURNEY = "Campaigns Station";
  35  | 
  36  | interface StepRecord { step: number; name: string; status: "PASS" | "FAIL"; screenshot?: string; }
  37  | 
  38  | class JourneyRecorder {
  39  |   private consoleErrors: string[] = [];
  40  |   private domAssertions: Record<string, unknown> = {};
  41  |   private currentStep = 0;
  42  |   constructor(private page: Page, private info: TestInfo) {
  43  |     page.on("pageerror", (e) => this.consoleErrors.push(`pageerror: ${e.message}`));
  44  |     page.on("console", (msg) => {
  45  |       const t = msg.type();
  46  |       if (t === "error" || t === "warning") this.consoleErrors.push(`console.${t}: ${msg.text()}`);
  47  |     });
  48  |     fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  49  |   }
  50  |   async step<T>(name: string, body: () => Promise<T>): Promise<T> {
  51  |     this.currentStep += 1;
  52  |     const n = this.currentStep;
  53  |     const label = `camp-${String(n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  54  |     const screenshotPath = path.join(SCREENSHOT_DIR, `${label}.png`);
  55  |     let status: "PASS" | "FAIL" = "PASS";
  56  |     try {
  57  |       const result = await body();
  58  |       try { await this.page.screenshot({ path: screenshotPath, fullPage: false }); } catch {}
  59  |       const rec: StepRecord = { step: n, name, status, screenshot: screenshotPath };
  60  |       await this.info.attach(`lc:step:${n}`, { body: Buffer.from(JSON.stringify(rec)), contentType: "application/json" });
  61  |       await this.info.attach(`${label}.png`, { path: screenshotPath, contentType: "image/png" }).catch(() => {});
  62  |       return result;
  63  |     } catch (e) {
  64  |       status = "FAIL";
  65  |       try { await this.page.screenshot({ path: screenshotPath, fullPage: false }); } catch {}
  66  |       const rec: StepRecord = { step: n, name, status, screenshot: screenshotPath };
  67  |       await this.info.attach(`lc:step:${n}`, { body: Buffer.from(JSON.stringify(rec)), contentType: "application/json" });
  68  |       await this.info.attach(`${label}.png`, { path: screenshotPath, contentType: "image/png" }).catch(() => {});
  69  |       throw e;
  70  |     }
  71  |   }
  72  |   assert(k: string, v: unknown) { this.domAssertions[k] = v; }
  73  |   async finalize() {
  74  |     await this.info.attach("lc:journey", { body: Buffer.from(JOURNEY), contentType: "text/plain" });
  75  |     await this.info.attach("lc:console-errors", { body: Buffer.from(JSON.stringify(this.consoleErrors)), contentType: "application/json" });
  76  |     await this.info.attach("lc:assertions", { body: Buffer.from(JSON.stringify(this.domAssertions)), contentType: "application/json" });
  77  |   }
  78  | }
  79  | 
  80  | async function interceptBackend(page: Page) {
  81  |   const me = {
  82  |     user: { id: "harness", email: "harness@test", tier: "solo" },
  83  |     tier: "solo", effective_tier: "solo", raw_tier: "solo",
  84  |   };
  85  |   const sync = { tier: "solo", caps: { watermarkLocked: false } };
  86  |   await page.route(/api\.liquidclips\.app\//, (route) => {
  87  |     if (route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  88  |     return route.continue();
  89  |   });
  90  |   await page.route(/api\.liquidclips\.app\/sync(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sync) }));
  91  |   await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(me) }));
  92  | }
  93  | 
  94  | async function seedAuth(page: Page) {
  95  |   await page.addInitScript(() => {
  96  |     try { window.localStorage.setItem("lc.license.jwt.v1", "harness.fake.jwt"); } catch {}
  97  |   });
  98  | }
  99  | 
  100 | test.describe("Campaigns Station Journey", () => {
  101 |   test(`${JOURNEY} · honest mock-source state · zero fake campaigns · zero fake clipper counts · zero fake invite-link writes`, async ({ page }, testInfo) => {
  102 |     const rec = new JourneyRecorder(page, testInfo);
  103 | 
  104 |     try {
  105 |       // Capture clipboard.writeText attempts (the prior FAKE invite-link path used it).
  106 |       await page.addInitScript(() => {
  107 |         const w = window as Window & { __lcClipboardWrites?: string[] };
  108 |         w.__lcClipboardWrites = [];
  109 |         try {
  110 |           const orig = navigator.clipboard?.writeText?.bind(navigator.clipboard);
  111 |           if (orig) {
  112 |             navigator.clipboard.writeText = ((text: string) => {
  113 |               w.__lcClipboardWrites!.push(text);
  114 |               return orig(text);
  115 |             }) as typeof navigator.clipboard.writeText;
  116 |           }
  117 |         } catch { /* ignore */ }
  118 |       });
  119 | 
  120 |       await rec.step("Launch /#/campaigns", async () => {
  121 |         await interceptBackend(page);
  122 |         await seedAuth(page);
  123 |         await page.goto("/?skipIntro=1#/campaigns", { waitUntil: "domcontentloaded" });
> 124 |         await expect(page.locator('[data-testid="campaigns-stage"]')).toBeVisible({ timeout: 15_000 });
      |                                                                       ^ Error: expect(locator).toBeVisible() failed
  125 |       });
  126 | 
  127 |       await rec.step("Stage exposes source=mock + visible=0 + featured=0", async () => {
  128 |         const stage = page.locator('[data-testid="campaigns-stage"]');
  129 |         const source = await stage.getAttribute("data-campaigns-source");
  130 |         const visible = await stage.getAttribute("data-campaigns-visible-count");
  131 |         const featured = await stage.getAttribute("data-campaigns-featured-count");
  132 |         rec.assert("campaigns_source", source);
  133 |         rec.assert("campaigns_visible_count", visible);
  134 |         rec.assert("campaigns_featured_count", featured);
  135 |         expect(source).toBe("mock");
  136 |         expect(visible).toBe("0");
  137 |         expect(featured).toBe("0");
  138 |       });
  139 | 
  140 |       await rec.step("Source pill says 'Backend offline · preview only' (ALL builds)", async () => {
  141 |         const pill = page.locator('[data-testid="campaigns-source-pill"]');
  142 |         await expect(pill).toBeVisible();
  143 |         const dataSource = await pill.getAttribute("data-source");
  144 |         const text = await pill.textContent();
  145 |         rec.assert("campaigns_pill_data", dataSource);
  146 |         rec.assert("campaigns_pill_text", text);
  147 |         expect(dataSource).toBe("mock");
  148 |         expect(text?.toLowerCase()).toMatch(/backend offline|preview only/);
  149 |       });
  150 | 
  151 |       await rec.step("Offline banner visible with honest copy · no fake bounty data", async () => {
  152 |         const banner = page.locator('[data-testid="campaigns-offline-banner"]');
  153 |         await expect(banner).toBeVisible();
  154 |         const text = await banner.textContent();
  155 |         rec.assert("offline_banner_text", text);
  156 |         expect(text?.toLowerCase()).toMatch(/no campaigns|not reachable|backend|no fake/);
  157 |       });
  158 | 
  159 |       await rec.step("ZERO campaign cards render · the 10-campaign fake seed is gone", async () => {
  160 |         await expect(page.locator('.lc-campaign-card')).toHaveCount(0);
  161 |         await expect(page.locator('.lc-campaigns-grid > *')).toHaveCount(0);
  162 |       });
  163 | 
  164 |       await rec.step("Featured banner is NOT shown when no featured campaign exists", async () => {
  165 |         // CampaignBanner returns null when `campaign` prop is null.
  166 |         // Reward-pool text and "$X pool" strings should be absent on screen.
  167 |         const poolMatches = await page.locator('text=/\\$[0-9,]+\\s*pool/i').count();
  168 |         rec.assert("dollar_pool_matches_visible", poolMatches);
  169 |         expect(poolMatches).toBe(0);
  170 |       });
  171 | 
  172 |       await rec.step("Count tag reads 0 live · 0 featured (matches stage attrs)", async () => {
  173 |         const tag = page.locator('[data-testid="campaigns-count-tag"]');
  174 |         await expect(tag).toBeVisible();
  175 |         const text = await tag.textContent();
  176 |         rec.assert("campaigns_count_tag_text", text);
  177 |         expect(text?.toLowerCase()).toMatch(/0\s+live/);
  178 |         expect(text?.toLowerCase()).toMatch(/0\s+featured/);
  179 |       });
  180 | 
  181 |       await rec.step("Switch to Agency mode · AgencyManageStrip honest empty state", async () => {
  182 |         // The app exposes a Clipper/Agency mode toggle in the top chrome.
  183 |         // Click the Agency radio · the strip should appear with honest copy.
  184 |         const agencyRadio = page.getByRole("radio", { name: /agency/i }).first();
  185 |         if (await agencyRadio.count() > 0) {
  186 |           await agencyRadio.click();
  187 |         }
  188 |         const strip = page.locator('[data-testid="campaigns-manage-strip"]');
  189 |         // The strip is agency-only · if mode toggle didn't work, skip
  190 |         // honestly (the cross-station mode wiring is its own audit).
  191 |         const present = await strip.count();
  192 |         if (present > 0) {
  193 |           const source = await strip.getAttribute("data-manage-source");
  194 |           const state = await strip.getAttribute("data-manage-state");
  195 |           rec.assert("manage_strip_source", source);
  196 |           rec.assert("manage_strip_state", state);
  197 |           expect(source).toBe("mock");
  198 |           expect(state).toBe("coming-soon");
  199 |           // Honest empty copy visible.
  200 |           const copy = await page.locator('[data-testid="campaigns-manage-empty-copy"]').textContent();
  201 |           rec.assert("manage_strip_copy", copy);
  202 |           expect(copy?.toLowerCase()).toMatch(/no campaigns|backend|connect/);
  203 |           // No fake clippers numbers and no fake invite-link buttons.
  204 |           await expect(page.locator('.lc-camp-manage-row')).toHaveCount(0);
  205 |         } else {
  206 |           rec.assert("manage_strip_present", false);
  207 |         }
  208 |       });
  209 | 
  210 |       await rec.step("Clipboard probe · NO fake invite-link was written", async () => {
  211 |         const writes = await page.evaluate(() => {
  212 |           const w = window as Window & { __lcClipboardWrites?: string[] };
  213 |           return w.__lcClipboardWrites ?? [];
  214 |         });
  215 |         rec.assert("clipboard_writes", writes);
  216 |         // The prior FAKE path wrote `https://liquidclips.app/c/<slug>` on
  217 |         // "Invite clippers" click. Zero clip-board writes mean the fake
  218 |         // path is dead.
  219 |         expect(writes).toEqual([]);
  220 |       });
  221 | 
  222 |       await rec.step("Filter chips render but no campaigns match · honest empty grid", async () => {
  223 |         // The filter chips themselves are WORKING UI primitives; they
  224 |         // operate on `camps.visible` which is empty. So clicking any
```