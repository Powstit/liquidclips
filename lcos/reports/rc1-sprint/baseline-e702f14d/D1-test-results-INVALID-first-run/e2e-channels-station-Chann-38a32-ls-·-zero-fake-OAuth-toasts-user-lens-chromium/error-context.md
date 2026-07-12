# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e/channels-station.spec.ts >> Channels Station Journey >> Channels Station · honest mock-source state · zero fake channels · zero fake OAuth toasts
- Location: tests/e2e/channels-station.spec.ts:124:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-testid="channels-stage"]')
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for locator('[data-testid="channels-stage"]')

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
  53  |     const label = `chan-${String(n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
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
  86  |   // Catch-all FIRST · specifics LAST (BUG-039 lesson).
  87  |   await page.route(/api\.liquidclips\.app\//, (route) => {
  88  |     if (route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  89  |     return route.continue();
  90  |   });
  91  |   await page.route(/api\.liquidclips\.app\/sync(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sync) }));
  92  |   await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(me) }));
  93  | }
  94  | 
  95  | async function seedAuth(page: Page) {
  96  |   await page.addInitScript(() => {
  97  |     try { window.localStorage.setItem("lc.license.jwt.v1", "harness.fake.jwt"); } catch {}
  98  |   });
  99  | }
  100 | 
  101 | async function seedCompletedSession(page: Page) {
  102 |   await page.addInitScript((slug) => {
  103 |     try {
  104 |       const now = new Date().toISOString();
  105 |       window.localStorage.setItem("lc.license.jwt.v1", "harness.fake.jwt");
  106 |       window.localStorage.setItem("lc:engine:session:v1", JSON.stringify({
  107 |         source: "channels-station.test.mp4", slug, status: "complete", percent: 1, stage: "thumbs",
  108 |         runtimeMode: "mock", startedAt: now, updatedAt: now,
  109 |       }));
  110 |       window.localStorage.setItem("lc.dock.open", "1");
  111 |       const stale: string[] = [];
  112 |       for (let i = 0; i < window.localStorage.length; i++) {
  113 |         const k = window.localStorage.key(i);
  114 |         if (k && k.startsWith(`lc.clip.${slug}:`)) stale.push(k);
  115 |       }
  116 |       for (const k of stale) window.localStorage.removeItem(k);
  117 |     } catch {}
  118 |   }, FIXTURE_SLUG);
  119 | }
  120 | 
  121 | const PLATFORMS = ["tiktok", "instagram", "youtube", "facebook", "x", "linkedin"] as const;
  122 | 
  123 | test.describe("Channels Station Journey", () => {
  124 |   test(`${JOURNEY} · honest mock-source state · zero fake channels · zero fake OAuth toasts`, async ({ page }, testInfo) => {
  125 |     const rec = new JourneyRecorder(page, testInfo);
  126 | 
  127 |     try {
  128 |       // ───────────────────────────────────────────────────────────────
  129 |       // PART A · Channels surface in mock-source mode
  130 |       // ───────────────────────────────────────────────────────────────
  131 |       await rec.step("Launch /#/channels", async () => {
  132 |         await interceptBackend(page);
  133 |         await seedAuth(page);
  134 |         await page.goto("/?skipIntro=1#/channels", { waitUntil: "domcontentloaded" });
> 135 |         await expect(page.locator('[data-testid="channels-stage"]')).toBeVisible({ timeout: 15_000 });
      |                                                                      ^ Error: expect(locator).toBeVisible() failed
  136 |       });
  137 | 
  138 |       await rec.step("Channels stage exposes source=mock + connectedCount=0", async () => {
  139 |         const stage = page.locator('[data-testid="channels-stage"]');
  140 |         const source = await stage.getAttribute("data-channels-source");
  141 |         const count = await stage.getAttribute("data-channels-connected-count");
  142 |         rec.assert("channels_source", source);
  143 |         rec.assert("channels_connected_count", count);
  144 |         expect(source).toBe("mock");
  145 |         expect(count).toBe("0");
  146 |       });
  147 | 
  148 |       await rec.step("Source pill says 'Backend offline · preview only' (honest in ALL builds)", async () => {
  149 |         const pill = page.locator('[data-testid="channels-source-pill"]');
  150 |         await expect(pill).toBeVisible();
  151 |         const dataSource = await pill.getAttribute("data-source");
  152 |         const text = await pill.textContent();
  153 |         rec.assert("source_pill_data", dataSource);
  154 |         rec.assert("source_pill_text", text);
  155 |         expect(dataSource).toBe("mock");
  156 |         expect(text?.toLowerCase()).toMatch(/backend offline|preview only/);
  157 |       });
  158 | 
  159 |       await rec.step("Offline banner is visible + honest copy", async () => {
  160 |         const banner = page.locator('[data-testid="channels-offline-banner"]');
  161 |         await expect(banner).toBeVisible();
  162 |         const text = await banner.textContent();
  163 |         rec.assert("offline_banner_text", text);
  164 |         expect(text?.toLowerCase()).toMatch(/no connected channels|not reachable|backend/);
  165 |       });
  166 | 
  167 |       await rec.step("Zero fake channel tiles render · the 10-fixture lie is gone", async () => {
  168 |         // ChannelTile is the rendering primitive for real connected accounts.
  169 |         // None should be present in mock-source mode.
  170 |         const tiles = page.locator('.lc-cg-tile, .lc-channel-tile');
  171 |         await expect(tiles).toHaveCount(0);
  172 |       });
  173 | 
  174 |       await rec.step("Each platform's AddAccount tile is disabled with COMING SOON state", async () => {
  175 |         const states: Record<string, string | null> = {};
  176 |         for (const platform of PLATFORMS) {
  177 |           const btn = page.locator(`[data-testid="channels-add-${platform}"]`);
  178 |           // Some platforms may render the "Upgrade to connect" empty tile
  179 |           // (tier-gated) instead of an AddAccount tile. Check for the
  180 |           // AddAccount tile if present; if absent it's the tier-locked
  181 |           // empty state — also honest.
  182 |           const present = await btn.count();
  183 |           if (present > 0) {
  184 |             await expect(btn).toBeDisabled();
  185 |             states[platform] = await btn.getAttribute("data-channels-add-state");
  186 |             expect(states[platform]).toBe("coming-soon");
  187 |           } else {
  188 |             states[platform] = "tier-locked-empty";
  189 |           }
  190 |         }
  191 |         rec.assert("platform_add_states", states);
  192 |       });
  193 | 
  194 |       await rec.step("Force-click first AddAccount tile · NO fake-toast lies fire", async () => {
  195 |         // The previous FAKE path emitted a "Linking…" toast + a "Linked"
  196 |         // toast 3s later. Both must be silent.
  197 |         const toastsBefore = await page.locator('.lc-toast').count();
  198 |         for (const platform of PLATFORMS) {
  199 |           const btn = page.locator(`[data-testid="channels-add-${platform}"]`);
  200 |           if (await btn.count() > 0) {
  201 |             await btn.click({ force: true }).catch(() => {});
  202 |           }
  203 |         }
  204 |         // Give the prior fake-OAuth setTimeout 3.5s to NOT fire.
  205 |         await page.waitForTimeout(3_500);
  206 |         const toastsAfter = await page.locator('.lc-toast').count();
  207 |         rec.assert("connect_toasts_before", toastsBefore);
  208 |         rec.assert("connect_toasts_after_force_click", toastsAfter);
  209 |         // No new toasts.
  210 |         expect(toastsAfter).toBeLessThanOrEqual(toastsBefore);
  211 |         // And specifically: no "Linking…" or "Linked" or "OAuth simulation" lies.
  212 |         await expect(page.locator('.lc-toast', { hasText: /linking|linked|oauth|webhook simulation/i })).toHaveCount(0);
  213 |       });
  214 | 
  215 |       await rec.step("STILL zero fake channels after the click-spam (no fake row persisted)", async () => {
  216 |         // The prior FAKE path would persist pending-link rows into the
  217 |         // mock cache even when the user clicked. With the honest throw,
  218 |         // no rows should exist.
  219 |         const tiles = page.locator('.lc-cg-tile, .lc-channel-tile');
  220 |         await expect(tiles).toHaveCount(0);
  221 |         // Connected-count still 0.
  222 |         const count = await page.locator('[data-testid="channels-stage"]').getAttribute("data-channels-connected-count");
  223 |         rec.assert("channels_connected_count_after_clicks", count);
  224 |         expect(count).toBe("0");
  225 |       });
  226 | 
  227 |       // ───────────────────────────────────────────────────────────────
  228 |       // PART B · Cross-station alignment · Publish target chips
  229 |       // ───────────────────────────────────────────────────────────────
  230 |       await rec.step("Navigate to Workstation Publish · target chips reflect empty channels", async () => {
  231 |         // Write localStorage DIRECTLY before navigation · addInitScript
  232 |         // queue ordering interacts unpredictably with prior steps in
  233 |         // long specs, so seed deterministically here. seedCompletedSession
  234 |         // ALSO adds a queued init script to harden it against the
  235 |         // subsequent navigation in step 11.
```