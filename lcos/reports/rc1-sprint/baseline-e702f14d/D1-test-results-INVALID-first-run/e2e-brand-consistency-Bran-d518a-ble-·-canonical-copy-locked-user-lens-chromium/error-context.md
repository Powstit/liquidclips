# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e/brand-consistency.spec.ts >> Brand Consistency Journey >> Brand Consistency · every route fits viewport · chrome stays visible · canonical copy locked
- Location: tests/e2e/brand-consistency.spec.ts:154:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-testid="avatar-orbit-button"]')
Expected: visible
Timeout: 4000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 4000ms
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
  99  |   "1.4K CLIPS",
  100 |   "@uncle.daniel.cuts",
  101 |   "@daniel.diyepriye",
  102 |   "@ddbeauty.cuts",
  103 |   "@enumcos",
  104 |   "Lorem ipsum",
  105 | ];
  106 | 
  107 | const CANONICAL_OFFLINE_PILL = "Backend offline · preview only";
  108 | const CANONICAL_LIVE_PILL = "Live · backend";
  109 | 
  110 | /* Routes we navigate the harness through. Each entry includes:
  111 |  *  - route id used by bus.emit("nav:click", { route })
  112 |  *  - mode the user must be in to see the route ("clipper" | "agency" | null = any)
  113 |  *  - whether the route is expected to render a route-title h1 */
  114 | interface RouteCase {
  115 |   route: string;
  116 |   mode?: "clipper" | "agency";
  117 |   expectTitle: boolean;
  118 | }
  119 | 
  120 | const ROUTES: ReadonlyArray<RouteCase> = [
  121 |   { route: "home",         expectTitle: true },
  122 |   { route: "workstation",  expectTitle: true },
  123 |   { route: "create",       expectTitle: true }, // alias → home with create panel
  124 |   { route: "library",      expectTitle: true }, // alias → workstation (BUG-042 stub uses h1)
  125 |   { route: "channels",     expectTitle: true },
  126 |   { route: "campaigns",    expectTitle: true },
  127 |   { route: "clipper",      expectTitle: true, mode: "clipper" },
  128 |   { route: "earn",         expectTitle: true, mode: "clipper" },
  129 |   { route: "community",    expectTitle: true },
  130 |   { route: "analytics",    expectTitle: true, mode: "agency" },
  131 |   { route: "submissions",  expectTitle: true, mode: "agency" },
  132 |   { route: "settings",     expectTitle: true },
  133 | ];
  134 | 
  135 | async function navigateToRoute(page: Page, r: RouteCase): Promise<void> {
  136 |   if (r.mode) {
  137 |     // Persist the mode so agency-gated routes (analytics, submissions)
  138 |     // actually render their content instead of redirecting to home.
  139 |     await page.evaluate((m) => {
  140 |       try { window.localStorage.setItem("lc.mode", m); } catch {}
  141 |       const w = window as unknown as { __lcBus?: { emit: (e: string, p: unknown) => void } };
  142 |       w.__lcBus?.emit?.("mode:change", { mode: m });
  143 |     }, r.mode);
  144 |   }
  145 |   await page.evaluate((route) => {
  146 |     const w = window as unknown as { __lcBus?: { emit: (e: string, p: unknown) => void } };
  147 |     w.__lcBus?.emit?.("nav:click", { route });
  148 |   }, r.route);
  149 |   // Allow alias resolution + route mount.
  150 |   await page.waitForTimeout(700);
  151 | }
  152 | 
  153 | test.describe("Brand Consistency Journey", () => {
  154 |   test(`${JOURNEY} · every route fits viewport · chrome stays visible · canonical copy locked`, async ({ page }, testInfo) => {
  155 |     // 2026-06-26 · 12-route loop + post-loop chrome/inbox/nav assertions
  156 |     // legitimately exceed the 90s default. The pre-D failure mode was a
  157 |     // missing route-title (steps short-circuited at step 9 missingTitles
  158 |     // assertion). After the data-route-title + InlineCreatePanel
  159 |     // close-on-nav fixes, the loop completes properly and needs more time.
  160 |     testInfo.setTimeout(150_000);
  161 |     const rec = new JourneyRecorder(page, testInfo);
  162 | 
  163 |     try {
  164 |       await rec.step("Launch app · seed JWT · land on home", async () => {
  165 |         await interceptBackend(page);
  166 |         await page.addInitScript(() => {
  167 |           try {
  168 |             window.localStorage.setItem("lc.license.jwt.v1", "harness.fake.jwt");
  169 |             // Start in clipper mode for the first half · agency-gated routes
  170 |             // swap mode in their navigateToRoute call.
  171 |             window.localStorage.setItem("lc.mode", "clipper");
  172 |           } catch {}
  173 |         });
  174 |         await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
  175 |         await expect(page.locator('[data-testid="home-tile-1"]')).toBeVisible({ timeout: 15_000 });
  176 |       });
  177 | 
  178 |       await rec.step("No fake unread badge on first mount", async () => {
  179 |         await expect(page.locator('[data-testid="avatar-orbit-badge"]')).toHaveCount(0);
  180 |       });
  181 | 
  182 |       await rec.step("TopHud user pill no longer shows the fake '1.4k clips' default", async () => {
  183 |         const bodyText = await page.evaluate(() => document.body.innerText);
  184 |         rec.assert("hud_1_4k_present", bodyText.toLowerCase().includes("1.4k"));
  185 |         expect(bodyText).not.toMatch(/Solo · 1\.4k clips/i);
  186 |         expect(bodyText).not.toMatch(/1\.4K CLIPS/);
  187 |       });
  188 | 
  189 |       const overflowReports: Array<{ route: string; scrollWidth: number; innerWidth: number }> = [];
  190 |       const missingTitles: string[] = [];
  191 |       const titleByRoute: Record<string, string> = {};
  192 | 
  193 |       for (const r of ROUTES) {
  194 |         await rec.step(`Route '${r.route}' · navigate + chrome + title + viewport fit`, async () => {
  195 |           await navigateToRoute(page, r);
  196 | 
  197 |           /* Avatar chrome must remain visible (the customer must always
  198 |            * be able to reach Settings / Notifications from any route). */
> 199 |           await expect(page.locator('[data-testid="avatar-orbit-button"]')).toBeVisible({ timeout: 4_000 });
      |                                                                             ^ Error: expect(locator).toBeVisible() failed
  200 | 
  201 |           /* The data-route attribute on .lc-app reflects the Design OS
  202 |            * inner route. For "create" + "library" (aliases), the inner
  203 |            * route resolves to home + workstation respectively · we just
  204 |            * confirm SOMETHING rendered. */
  205 |           const innerRoute = await page.evaluate(() => {
  206 |             return document.querySelector(".lc-app")?.getAttribute("data-route") ?? null;
  207 |           });
  208 |           rec.assert(`route_resolved_${r.route}`, innerRoute);
  209 | 
  210 |           /* Route title presence · accept any of:
  211 |            *   - h1 inside .lc-main
  212 |            *   - [data-route-title] anywhere in the route (used by
  213 |            *     CommandRoom + alias-home variants whose visible title
  214 |            *     is the TopHud greeting, not an h1) */
  215 |           if (r.expectTitle) {
  216 |             const h1Count = await page.locator(".lc-main h1").count();
  217 |             const titleAttrCount = await page.locator("[data-route-title]").count();
  218 |             if (h1Count === 0 && titleAttrCount === 0) missingTitles.push(r.route);
  219 |             else if (h1Count > 0) {
  220 |               const txt = (await page.locator(".lc-main h1").first().textContent()) ?? "";
  221 |               titleByRoute[r.route] = txt.trim();
  222 |             } else {
  223 |               const txt = await page.locator("[data-route-title]").first().getAttribute("data-route-title");
  224 |               titleByRoute[r.route] = (txt ?? "").trim();
  225 |             }
  226 |           }
  227 | 
  228 |           /* Horizontal overflow probe · the Tauri window defaults to
  229 |            * 1280×800. Anything that overflows is a bug. Allow 2px for
  230 |            * subpixel rounding. */
  231 |           const ovf = await page.evaluate(() => ({
  232 |             scrollWidth: document.documentElement.scrollWidth,
  233 |             innerWidth: window.innerWidth,
  234 |           }));
  235 |           if (ovf.scrollWidth > ovf.innerWidth + 2) {
  236 |             overflowReports.push({ route: r.route, ...ovf });
  237 |           }
  238 |         });
  239 |       }
  240 | 
  241 |       await rec.step("Every route resolved with a title", async () => {
  242 |         rec.assert("titles_by_route", titleByRoute);
  243 |         rec.assert("missing_titles", missingTitles);
  244 |         expect(missingTitles, `routes missing a route-title h1: ${missingTitles.join(", ")}`).toHaveLength(0);
  245 |       });
  246 | 
  247 |       await rec.step("No horizontal overflow on any route", async () => {
  248 |         rec.assert("overflow_reports", overflowReports);
  249 |         expect(overflowReports, `routes with horizontal overflow: ${JSON.stringify(overflowReports, null, 2)}`).toHaveLength(0);
  250 |       });
  251 | 
  252 |       await rec.step("Workstation fits viewport · cockpit-related chrome visible", async () => {
  253 |         await navigateToRoute(page, { route: "workstation", expectTitle: true });
  254 |         await expect(page.locator('[data-testid="avatar-orbit-button"]')).toBeVisible();
  255 |         // Workstation's main content container must not exceed viewport width.
  256 |         const sizes = await page.evaluate(() => {
  257 |           const main = document.querySelector(".lc-main") as HTMLElement | null;
  258 |           return {
  259 |             mainScrollWidth: main?.scrollWidth ?? 0,
  260 |             mainClientWidth: main?.clientWidth ?? 0,
  261 |             innerWidth: window.innerWidth,
  262 |           };
  263 |         });
  264 |         rec.assert("workstation_sizes", sizes);
  265 |         expect(sizes.mainScrollWidth).toBeLessThanOrEqual(sizes.innerWidth + 4);
  266 |       });
  267 | 
  268 |       await rec.step("No forbidden legacy / fixture strings anywhere across all routes", async () => {
  269 |         /* Walk every route once more, collecting body text. */
  270 |         const hits: Array<{ route: string; substring: string }> = [];
  271 |         for (const r of ROUTES) {
  272 |           await navigateToRoute(page, r);
  273 |           const text = await page.evaluate(() => document.body.innerText);
  274 |           for (const s of FORBIDDEN_SUBSTRINGS) {
  275 |             if (text.includes(s)) hits.push({ route: r.route, substring: s });
  276 |           }
  277 |         }
  278 |         rec.assert("forbidden_string_hits", hits);
  279 |         expect(hits, `forbidden strings rendered: ${JSON.stringify(hits, null, 2)}`).toHaveLength(0);
  280 |       });
  281 | 
  282 |       await rec.step("Backend offline + Live pills use canonical copy across Channels / Campaigns / Earn", async () => {
  283 |         const targetRoutes: ReadonlyArray<RouteCase> = [
  284 |           { route: "channels",  expectTitle: true },
  285 |           { route: "campaigns", expectTitle: true },
  286 |           { route: "earn",      expectTitle: true, mode: "clipper" },
  287 |         ];
  288 |         const variants: Array<{ route: string; text: string }> = [];
  289 |         for (const r of targetRoutes) {
  290 |           await navigateToRoute(page, r);
  291 |           /* Every `.lc-runtime-tag` text node must equal either the
  292 |            * canonical OFFLINE pill or the canonical LIVE pill (or be
  293 |            * the studio-preview secondary). The pills CSS-uppercase
  294 |            * everything, so we compare case-insensitively. */
  295 |           const pillTexts = await page.locator(".lc-runtime-tag").allInnerTexts();
  296 |           const canon = [CANONICAL_OFFLINE_PILL, CANONICAL_LIVE_PILL, "Studio preview"].map((s) => s.toLowerCase());
  297 |           for (const t of pillTexts) {
  298 |             const text = t.trim();
  299 |             if (text.length === 0) continue;
```