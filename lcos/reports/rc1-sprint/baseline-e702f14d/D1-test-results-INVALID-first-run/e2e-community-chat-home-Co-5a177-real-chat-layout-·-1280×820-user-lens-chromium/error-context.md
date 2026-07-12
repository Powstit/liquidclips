# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e/community-chat-home.spec.ts >> Community chat home >> real chat layout · 1280×820
- Location: tests/e2e/community-chat-home.spec.ts:199:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('community-chat-home')
Expected: visible
Timeout: 20000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 20000ms
  - waiting for getByTestId('community-chat-home')

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
  109 |         can_write: true,
  110 |         viewer_role: options.viewerRole ?? "member",
  111 |       }),
  112 |     });
  113 |   });
  114 |   await page.route(/api\.liquidclips\.app\/chat\/message$/, (route) => {
  115 |     const status = options.sendStatus ?? 200;
  116 |     if (status !== 200) {
  117 |       return route.fulfill({
  118 |         status,
  119 |         contentType: "application/json",
  120 |         body: JSON.stringify({ detail: "send unavailable" }),
  121 |       });
  122 |     }
  123 |     const body = route.request().postDataJSON() as { channel: string; content: string };
  124 |     return route.fulfill({
  125 |       status: 200,
  126 |       contentType: "application/json",
  127 |       body: JSON.stringify({
  128 |         message: {
  129 |           ...messages[1],
  130 |           id: "msg-sent",
  131 |           user_id: "community-harness",
  132 |           username: "clipper",
  133 |           channel: body.channel,
  134 |           content: body.content,
  135 |           created_at: new Date().toISOString(),
  136 |         },
  137 |       }),
  138 |     });
  139 |   });
  140 | }
  141 | 
  142 | async function interceptMedia(
  143 |   page: Page,
  144 |   options: { status?: number; setupRequired?: boolean } = {},
  145 | ): Promise<void> {
  146 |   await page.route(/api\.liquidclips\.app\/chat\/media\/(giphy|pexels)/, (route) => {
  147 |     if (options.setupRequired) {
  148 |       return route.fulfill({
  149 |         status: 503,
  150 |         contentType: "application/json",
  151 |         body: JSON.stringify({ detail: "setup_required" }),
  152 |       });
  153 |     }
  154 |     const status = options.status ?? 200;
  155 |     if (status !== 200) {
  156 |       return route.fulfill({
  157 |         status,
  158 |         contentType: "application/json",
  159 |         body: JSON.stringify({ detail: "media unavailable" }),
  160 |       });
  161 |     }
  162 |     return route.fulfill({
  163 |       status: 200,
  164 |       contentType: "application/json",
  165 |       body: JSON.stringify({
  166 |         provider: "giphy",
  167 |         results: [{
  168 |           id: "gif-reaction",
  169 |           preview_url: "https://media.giphy.com/media/liquidclips-preview/giphy.gif",
  170 |           full_url: "https://media.giphy.com/media/liquidclips-full/giphy.gif",
  171 |           title: "Reaction applause",
  172 |         }],
  173 |       }),
  174 |     });
  175 |   });
  176 |   await page.route(/media\.giphy\.com\/media\/.*\/giphy\.gif/, (route) =>
  177 |     route.fulfill({
  178 |       status: 200,
  179 |       contentType: "image/svg+xml",
  180 |       body: [
  181 |         '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">',
  182 |         '<defs><linearGradient id="g"><stop stop-color="#ff1a8c"/><stop offset="1" stop-color="#15122c"/></linearGradient></defs>',
  183 |         '<rect width="640" height="360" rx="24" fill="url(#g)"/>',
  184 |         '<circle cx="250" cy="170" r="54" fill="#fff" opacity=".9"/>',
  185 |         '<circle cx="390" cy="170" r="54" fill="#fff" opacity=".9"/>',
  186 |         '<text x="320" y="300" text-anchor="middle" fill="white" font-family="sans-serif" font-size="34">REACTION APPLAUSE</text>',
  187 |         "</svg>",
  188 |       ].join(""),
  189 |     }),
  190 |   );
  191 | }
  192 | 
  193 | test.describe("Community chat home", () => {
  194 |   for (const viewport of [
  195 |     { width: 1040, height: 680 },
  196 |     { width: 1280, height: 820 },
  197 |     { width: 1440, height: 900 },
  198 |   ]) {
  199 |     test(`real chat layout · ${viewport.width}×${viewport.height}`, async ({ page }) => {
  200 |       await page.setViewportSize(viewport);
  201 |       await page.emulateMedia({ reducedMotion: "reduce" });
  202 |       await seedAuth(page);
  203 |       await interceptBase(page);
  204 |       await interceptChat(page);
  205 |       await interceptMedia(page);
  206 |       await page.goto("/?skipIntro=1#/community", { waitUntil: "domcontentloaded" });
  207 | 
  208 |       const home = page.getByTestId("community-chat-home");
> 209 |       await expect(home).toBeVisible({ timeout: 20_000 });
      |                          ^ Error: expect(locator).toBeVisible() failed
  210 |       await expect(page.getByText("Wednesday campaign drop is live. Check the campaign brief before clipping.")).toBeVisible();
  211 |       await expect(page.locator('[data-room-id="global"]')).toHaveAttribute("data-active", "true");
  212 |       await expect(page.locator('[data-room-id="clippers-lounge"]')).toHaveAttribute("data-pending", "true");
  213 |       await expect(page.locator(".lc-chat-toggle")).toHaveCount(0);
  214 |       await expect(page.locator(".lc-chat-row-media")).toHaveCount(1);
  215 | 
  216 |       const geometry = await page.evaluate(() => {
  217 |         const home = document.querySelector(".lc-community-chat") as HTMLElement;
  218 |         const routeTitle = document.querySelector(
  219 |           ".lc-community-stage > [data-route-title]",
  220 |         ) as HTMLElement;
  221 |         return {
  222 |           viewportWidth: window.innerWidth,
  223 |           viewportHeight: window.innerHeight,
  224 |           bodyScrollWidth: document.documentElement.scrollWidth,
  225 |           streamOverflow: getComputedStyle(
  226 |             document.querySelector(".lc-community-message-stream") as HTMLElement,
  227 |           ).overflowY,
  228 |           homeBottom: home.getBoundingClientRect().bottom,
  229 |           homeHeight: home.getBoundingClientRect().height,
  230 |           routeTitleWidth: routeTitle.getBoundingClientRect().width,
  231 |           routeTitleHeight: routeTitle.getBoundingClientRect().height,
  232 |         };
  233 |       });
  234 |       expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  235 |       expect(geometry.streamOverflow).toMatch(/auto|scroll/);
  236 |       expect(geometry.homeBottom).toBeGreaterThanOrEqual(geometry.viewportHeight - 40);
  237 |       expect(geometry.homeBottom).toBeLessThanOrEqual(geometry.viewportHeight);
  238 |       expect(geometry.homeHeight).toBeGreaterThan(viewport.height * 0.72);
  239 |       expect(geometry.routeTitleWidth).toBeLessThanOrEqual(1);
  240 |       expect(geometry.routeTitleHeight).toBeLessThanOrEqual(1);
  241 | 
  242 |       const evidenceDir = path.resolve(
  243 |         process.cwd(),
  244 |         "docs",
  245 |         "ui-master",
  246 |         "evidence",
  247 |         "stage-3",
  248 |         `${viewport.width}x${viewport.height}`,
  249 |       );
  250 |       fs.mkdirSync(evidenceDir, { recursive: true });
  251 |       await page.screenshot({
  252 |         path: path.join(evidenceDir, "community-populated.png"),
  253 |         fullPage: false,
  254 |       });
  255 |     });
  256 |   }
  257 | 
  258 |   test("pending room, agency gate, and visibility preference are honest", async ({ page }) => {
  259 |     await seedAuth(page);
  260 |     await interceptBase(page, "solo");
  261 |     await interceptChat(page);
  262 |     await page.goto("/?skipIntro=1#/community", { waitUntil: "domcontentloaded" });
  263 |     await expect(page.getByTestId("community-chat-home")).toBeVisible({ timeout: 20_000 });
  264 | 
  265 |     await page.locator('[data-room-id="clippers-lounge"]').click();
  266 |     await expect(page.getByText("This room needs a backend channel before messages can be stored.")).toBeVisible();
  267 |     await expect(page.getByText("No placeholder messages or member counts are being shown.")).toBeVisible();
  268 | 
  269 |     await page.locator('[data-room-id="agency-vip"]').click();
  270 |     await expect(page.getByText("Agency VIP is available only to an active Agency account.")).toBeVisible();
  271 | 
  272 |     const presence = page.getByTestId("community-presence-toggle");
  273 |     await expect(presence).toHaveAttribute("data-online", "1");
  274 |     await presence.click();
  275 |     await expect(presence).toHaveAttribute("data-online", "0");
  276 |     await page.reload({ waitUntil: "domcontentloaded" });
  277 |     await expect(page.getByTestId("community-presence-toggle")).toHaveAttribute("data-online", "0");
  278 |   });
  279 | 
  280 |   test("loading history is explicit before real messages arrive", async ({ page }) => {
  281 |     await page.setViewportSize({ width: 1440, height: 900 });
  282 |     await seedAuth(page);
  283 |     await interceptBase(page);
  284 |     let releaseHistory!: () => void;
  285 |     const historyGate = new Promise<void>((resolve) => {
  286 |       releaseHistory = resolve;
  287 |     });
  288 |     await page.route(/api\.liquidclips\.app\/chat\/messages/, async (route) => {
  289 |       await historyGate;
  290 |       await route.fulfill({
  291 |         status: 200,
  292 |         contentType: "application/json",
  293 |         body: JSON.stringify({
  294 |           channel: "global",
  295 |           messages,
  296 |           can_write: true,
  297 |           viewer_role: "member",
  298 |         }),
  299 |       });
  300 |     });
  301 |     await page.goto("/?skipIntro=1#/community", { waitUntil: "domcontentloaded" });
  302 | 
  303 |     await expect(page.getByText("Loading real messages…")).toBeVisible();
  304 |     const evidenceDir = path.resolve(
  305 |       process.cwd(),
  306 |       "docs",
  307 |       "ui-master",
  308 |       "evidence",
  309 |       "stage-4",
```