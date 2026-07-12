# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e/browse-tab-omnipresent.spec.ts >> Browse Tab Omnipresent · 2E2 Gate >> Browse Tab Omnipresent · tab on every route + click opens overlay + Use-in-Engine handoff fires + chip visible · user stays put
- Location: tests/e2e/browse-tab-omnipresent.spec.ts:132:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-browse-rail-tab="root"]')
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for locator('[data-browse-rail-tab="root"]')

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
  87  |       console_errors: this.consoleErrors,
  88  |       ran_at: new Date().toISOString(),
  89  |     };
  90  |     const verdictPath = path.join(VERDICT_DIR, `browse-tab-omnipresent-${verdict.ran_at.replace(/[:.]/g, "-")}.json`);
  91  |     fs.writeFileSync(verdictPath, JSON.stringify(verdict, null, 2));
  92  |     await this.info.attach("lc:journey", { body: Buffer.from(JOURNEY), contentType: "text/plain" });
  93  |     await this.info.attach("lc:verdict", { path: verdictPath, contentType: "application/json" });
  94  |     await this.info.attach("lc:console-errors", { body: Buffer.from(JSON.stringify(this.consoleErrors)), contentType: "application/json" });
  95  |     await this.info.attach("lc:assertions", { body: Buffer.from(JSON.stringify(this.domAssertions)), contentType: "application/json" });
  96  |   }
  97  | }
  98  | 
  99  | /* Mock backend so /sync + /me don't actually fire against Railway. */
  100 | async function interceptBackend(page: Page) {
  101 |   await page.route(/api\.liquidclips\.app\/sync(\?.*)?$/, (r) => r.fulfill({
  102 |     status: 200, contentType: "application/json",
  103 |     body: JSON.stringify({ tier: "clipper", founder: false, subscription_status: "active", billing_provider: "clerk" }),
  104 |   }));
  105 |   await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (r) => r.fulfill({
  106 |     status: 200, contentType: "application/json",
  107 |     body: JSON.stringify({ email: "harness@liquidclips.app", effective_tier: "clipper", raw_tier: "clipper" }),
  108 |   }));
  109 | }
  110 | 
  111 | /* Seed the JWT so AuthGate passes + we land on the app shell. */
  112 | async function seedAuth(page: Page) {
  113 |   await page.addInitScript(() => {
  114 |     try { window.localStorage.setItem("lc.license.jwt.v1", "harness.fake.jwt"); } catch {}
  115 |   });
  116 | }
  117 | 
  118 | /* The 8 active routes from SECTION_IDS (deprecated ones excluded).
  119 |  * Hash maps from sectionRegistry.ts. */
  120 | const ROUTES = [
  121 |   { hash: "home",        label: "Home (CommandRoom)" },
  122 |   { hash: "browse",      label: "Browse section" },
  123 |   { hash: "editor",      label: "Editor / Workstation" },
  124 |   { hash: "projects",    label: "Projects / Library" },
  125 |   { hash: "campaign",    label: "Campaigns" },
  126 |   { hash: "account",     label: "Account" },
  127 |   { hash: "diagnostics", label: "Diagnostics" },
  128 |   { hash: "hq",          label: "HQ Bridge" },
  129 | ] as const;
  130 | 
  131 | test.describe("Browse Tab Omnipresent · 2E2 Gate", () => {
  132 |   test(`${JOURNEY} · tab on every route + click opens overlay + Use-in-Engine handoff fires + chip visible · user stays put`, async ({ page }, testInfo) => {
  133 |     const rec = new JourneyRecorder(page, testInfo);
  134 | 
  135 |     try {
  136 |       // ── 0 · DIAGNOSE why the tab is hidden (computed style + bounds) ────
  137 |       await rec.step("Diagnose tab computed style + bounds", async () => {
  138 |         await interceptBackend(page);
  139 |         await seedAuth(page);
  140 |         await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
  141 |         await page.waitForTimeout(2000); // let everything mount
  142 |         const diag = await page.evaluate(() => {
  143 |           const el = document.querySelector<HTMLElement>('[data-browse-rail-tab="root"]');
  144 |           if (!el) return { found: false };
  145 |           const cs = window.getComputedStyle(el);
  146 |           const r = el.getBoundingClientRect();
  147 |           const ancestors: Array<{ tag: string; cls: string; pos: string; overflow: string; transform: string }> = [];
  148 |           let cur: HTMLElement | null = el.parentElement;
  149 |           while (cur && ancestors.length < 6) {
  150 |             const ac = window.getComputedStyle(cur);
  151 |             ancestors.push({
  152 |               tag: cur.tagName,
  153 |               cls: cur.className?.toString().slice(0, 60) ?? "",
  154 |               pos: ac.position,
  155 |               overflow: ac.overflow,
  156 |               transform: ac.transform,
  157 |             });
  158 |             cur = cur.parentElement;
  159 |           }
  160 |           return {
  161 |             found: true,
  162 |             display: cs.display,
  163 |             visibility: cs.visibility,
  164 |             opacity: cs.opacity,
  165 |             position: cs.position,
  166 |             right: cs.right,
  167 |             top: cs.top,
  168 |             transform: cs.transform,
  169 |             zIndex: cs.zIndex,
  170 |             width: r.width,
  171 |             height: r.height,
  172 |             x: r.x,
  173 |             y: r.y,
  174 |             viewport_w: window.innerWidth,
  175 |             viewport_h: window.innerHeight,
  176 |             ancestors,
  177 |           };
  178 |         });
  179 |         rec.assert("tab_diagnostics", diag);
  180 |         // eslint-disable-next-line no-console
  181 |         console.log("[diag]", JSON.stringify(diag, null, 2));
  182 |       });
  183 | 
  184 |       // ── 1 · launch authenticated · home loads · tab present ──────────────
  185 |       await rec.step("Seed auth · launch /#/home · tab present at right edge", async () => {
  186 |         const tab = page.locator('[data-browse-rail-tab="root"]');
> 187 |         await expect(tab).toBeVisible({ timeout: 15_000 });
      |                           ^ Error: expect(locator).toBeVisible() failed
  188 |         const box = await tab.boundingBox();
  189 |         const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  190 |         if (!box) throw new Error("tab boundingBox null on home");
  191 |         // Tab right edge should be at or very near viewport right edge (fixed right:0).
  192 |         expect(box.x + box.width).toBeGreaterThan(viewport.width - 80);
  193 |         rec.assert("home_tab_x", box.x);
  194 |         rec.assert("home_tab_right_edge_offset", viewport.width - (box.x + box.width));
  195 |         rec.assert("home_viewport_width", viewport.width);
  196 |       });
  197 | 
  198 |       // ── 2-9 · tab visible on EVERY active route ──────────────────────────
  199 |       for (const route of ROUTES) {
  200 |         await rec.step(`Tab visible on /#/${route.hash} (${route.label})`, async () => {
  201 |           await page.evaluate((h) => { window.location.hash = `#/${h}`; }, route.hash);
  202 |           // Let route render + tab re-check
  203 |           await page.waitForTimeout(400);
  204 |           const tab = page.locator('[data-browse-rail-tab="root"]');
  205 |           await expect(tab).toBeVisible({ timeout: 8_000 });
  206 |           const box = await tab.boundingBox();
  207 |           const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  208 |           if (!box) throw new Error(`tab boundingBox null on ${route.hash}`);
  209 |           expect(box.x + box.width).toBeGreaterThan(viewport.width - 80);
  210 |           rec.assert(`${route.hash}_tab_visible`, true);
  211 |           rec.assert(`${route.hash}_tab_right_edge`, box.x + box.width);
  212 |         });
  213 |       }
  214 | 
  215 |       // ── 10 · spy on lc:browse-url-handoff event BEFORE clicking tab ──────
  216 |       await rec.step("Install lc:browse-url-handoff event spy on window", async () => {
  217 |         await page.evaluate(() => {
  218 |           (window as unknown as { __lcHandoffEvents: unknown[] }).__lcHandoffEvents = [];
  219 |           window.addEventListener("lc:browse-url-handoff", (e: Event) => {
  220 |             const ce = e as CustomEvent<{ url?: string; source?: string }>;
  221 |             ((window as unknown as { __lcHandoffEvents: unknown[] }).__lcHandoffEvents).push(ce.detail);
  222 |           });
  223 |         });
  224 |       });
  225 | 
  226 |       // ── 11 · go back to home (predictable state) + click tab ─────────────
  227 |       await rec.step("Navigate home · click pink Browse tab · overlay opens · tab hides", async () => {
  228 |         await page.evaluate(() => { window.location.hash = "#/home"; });
  229 |         await page.waitForTimeout(400);
  230 |         const tab = page.locator('[data-browse-rail-tab="root"]');
  231 |         await expect(tab).toBeVisible({ timeout: 5_000 });
  232 |         await tab.click();
  233 |         // Overlay should open
  234 |         await expect(page.locator('.lc-browse-overlay')).toBeVisible({ timeout: 5_000 });
  235 |         // Tab should hide (returns null when open===true)
  236 |         await expect(page.locator('[data-browse-rail-tab="root"]')).toBeHidden({ timeout: 2_000 });
  237 |         rec.assert("overlay_opened", true);
  238 |         rec.assert("tab_hidden_during_overlay", true);
  239 |       });
  240 | 
  241 |       // ── 12 · click Use in Engine → handoff event fires ──────────────────
  242 |       await rec.step("Click Use in Engine · handoff event fires with URL", async () => {
  243 |         // The button text contains "Use in Engine" — match loosely.
  244 |         const useInEngineBtn = page.getByRole("button", { name: /Use in Engine/i }).first();
  245 |         await expect(useInEngineBtn).toBeVisible({ timeout: 5_000 });
  246 |         await useInEngineBtn.click();
  247 |         await page.waitForTimeout(400);
  248 |         const events = await page.evaluate(() => (window as unknown as { __lcHandoffEvents: unknown[] }).__lcHandoffEvents ?? []);
  249 |         rec.assert("handoff_event_count", events.length);
  250 |         rec.assert("handoff_event_detail", events[0] ?? null);
  251 |         if (events.length === 0) throw new Error("lc:browse-url-handoff event never fired after Use in Engine click");
  252 |       });
  253 | 
  254 |       // ── 13 · InlineCreatePanel auto-opens with URL pre-filled + chip ────
  255 |       await rec.step("InlineCreatePanel auto-opens on URL tab · URL pre-filled · imported-from-browser chip visible", async () => {
  256 |         // Panel is mounted globally in AppShell now, so it opens regardless of route.
  257 |         // The handoff sets tab='url' + url=incoming + importedFromBrowser=true.
  258 |         const chip = page.locator('.lc-icp-handoff-chip');
  259 |         await expect(chip).toBeVisible({ timeout: 5_000 });
  260 |         const urlInput = page.locator('.lc-icp-input').first();
  261 |         await expect(urlInput).toBeVisible({ timeout: 3_000 });
  262 |         const urlValue = await urlInput.inputValue();
  263 |         rec.assert("inline_create_panel_url", urlValue);
  264 |         rec.assert("chip_visible", true);
  265 |         if (!urlValue || urlValue.length === 0) throw new Error("URL field not pre-filled");
  266 |       });
  267 | 
  268 |       // ── 14 · current route unchanged (user stayed on home) ──────────────
  269 |       await rec.step("User stayed on /#/home (no navigateTo on Use in Engine)", async () => {
  270 |         const hash = await page.evaluate(() => window.location.hash);
  271 |         rec.assert("final_hash", hash);
  272 |         // Should be #/home or #/ (no SECTION_EDITOR navigation)
  273 |         expect(hash).toMatch(/^#\/home/);
  274 |       });
  275 | 
  276 |       await rec.finalize();
  277 |     } catch (e) {
  278 |       await rec.finalize();
  279 |       throw e;
  280 |     }
  281 |   });
  282 | });
  283 | 
```