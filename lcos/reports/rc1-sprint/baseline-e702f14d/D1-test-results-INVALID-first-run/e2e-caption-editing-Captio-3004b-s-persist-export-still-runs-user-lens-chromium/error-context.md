# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e/caption-editing.spec.ts >> Caption Editing Journey >> Caption Editing · customer can edit captions and changes persist + export still runs
- Location: tests/e2e/caption-editing.spec.ts:175:3

# Error details

```
TimeoutError: page.waitForSelector: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('[data-testid="clip-card"]') to be visible

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e5]:
    - img "Liquid Clips" [ref=e6]
    - generic [ref=e7]:
      - heading "Sign in to Liquid Clips" [level=1] [ref=e8]
      - generic [ref=e9]:
        - generic [ref=e10]: Email
        - textbox "Email" [active] [ref=e11]:
          - /placeholder: you@example.com
        - button "Send code" [ref=e12] [cursor=pointer]
  - region "Recent clips from Liquid Clips users" [ref=e13]:
    - generic [ref=e15]:
      - generic [ref=e16] [cursor=pointer]:
        - img [ref=e17]
        - generic [ref=e18]: $618
        - generic "muted" [ref=e19]: 🔇
        - generic [ref=e20]: "@featured"
      - generic [ref=e21] [cursor=pointer]:
        - img [ref=e22]
        - generic [ref=e23]: $424
        - generic "muted" [ref=e24]: 🔇
        - generic [ref=e25]: "@clipper-02"
      - generic [ref=e26] [cursor=pointer]:
        - img [ref=e27]
        - generic [ref=e28]: $331
        - generic "muted" [ref=e29]: 🔇
        - generic [ref=e30]: "@clipper-03"
      - generic [ref=e31] [cursor=pointer]:
        - img [ref=e32]
        - generic [ref=e33]: $273
        - generic "muted" [ref=e34]: 🔇
        - generic [ref=e35]: "@clipper-04"
      - generic [ref=e36] [cursor=pointer]:
        - img [ref=e37]
        - generic [ref=e38]: $512
        - generic "muted" [ref=e39]: 🔇
        - generic [ref=e40]: "@clipper-05"
      - generic [ref=e41] [cursor=pointer]:
        - img [ref=e42]
        - generic [ref=e43]: $189
        - generic "muted" [ref=e44]: 🔇
        - generic [ref=e45]: "@clipper-06"
      - generic [ref=e46] [cursor=pointer]:
        - img [ref=e47]
        - generic [ref=e48]: $475
        - generic "muted" [ref=e49]: 🔇
        - generic [ref=e50]: "@clipper-07"
      - generic [ref=e51] [cursor=pointer]:
        - img [ref=e52]
        - generic [ref=e53]: $246
        - generic "muted" [ref=e54]: 🔇
        - generic [ref=e55]: "@clipper-08"
      - generic [ref=e56] [cursor=pointer]:
        - img [ref=e57]
        - generic [ref=e58]: $394
        - generic "muted" [ref=e59]: 🔇
        - generic [ref=e60]: "@clipper-09"
      - generic [ref=e61] [cursor=pointer]:
        - img [ref=e62]
        - generic [ref=e63]: $556
        - generic "muted" [ref=e64]: 🔇
        - generic [ref=e65]: "@clipper-10"
      - generic [ref=e66] [cursor=pointer]:
        - img [ref=e67]
        - generic [ref=e68]: $618
        - generic "muted" [ref=e69]: 🔇
        - generic [ref=e70]: "@featured"
      - generic [ref=e71] [cursor=pointer]:
        - img [ref=e72]
        - generic [ref=e73]: $424
        - generic "muted" [ref=e74]: 🔇
        - generic [ref=e75]: "@clipper-02"
      - generic [ref=e76] [cursor=pointer]:
        - img [ref=e77]
        - generic [ref=e78]: $331
        - generic "muted" [ref=e79]: 🔇
        - generic [ref=e80]: "@clipper-03"
      - generic [ref=e81] [cursor=pointer]:
        - img [ref=e82]
        - generic [ref=e83]: $273
        - generic "muted" [ref=e84]: 🔇
        - generic [ref=e85]: "@clipper-04"
      - generic [ref=e86] [cursor=pointer]:
        - img [ref=e87]
        - generic [ref=e88]: $512
        - generic "muted" [ref=e89]: 🔇
        - generic [ref=e90]: "@clipper-05"
      - generic [ref=e91] [cursor=pointer]:
        - img [ref=e92]
        - generic [ref=e93]: $189
        - generic "muted" [ref=e94]: 🔇
        - generic [ref=e95]: "@clipper-06"
      - generic [ref=e96] [cursor=pointer]:
        - img [ref=e97]
        - generic [ref=e98]: $475
        - generic "muted" [ref=e99]: 🔇
        - generic [ref=e100]: "@clipper-07"
      - generic [ref=e101] [cursor=pointer]:
        - img [ref=e102]
        - generic [ref=e103]: $246
        - generic "muted" [ref=e104]: 🔇
        - generic [ref=e105]: "@clipper-08"
      - generic [ref=e106] [cursor=pointer]:
        - img [ref=e107]
        - generic [ref=e108]: $394
        - generic "muted" [ref=e109]: 🔇
        - generic [ref=e110]: "@clipper-09"
      - generic [ref=e111] [cursor=pointer]:
        - img [ref=e112]
        - generic [ref=e113]: $556
        - generic "muted" [ref=e114]: 🔇
        - generic [ref=e115]: "@clipper-10"
    - paragraph [ref=e116]:
      - text: 870 clippers ·
      - generic [ref=e117]: $4018
      - text: paid last week
```

# Test source

```ts
  87  |   }
  88  | 
  89  |   assert(key: string, value: unknown) {
  90  |     this.domAssertions[key] = value;
  91  |   }
  92  | 
  93  |   async finalize() {
  94  |     await this.info.attach("lc:journey", { body: Buffer.from(JOURNEY), contentType: "text/plain" });
  95  |     await this.info.attach("lc:console-errors", {
  96  |       body: Buffer.from(JSON.stringify(this.consoleErrors)),
  97  |       contentType: "application/json",
  98  |     });
  99  |     await this.info.attach("lc:assertions", {
  100 |       body: Buffer.from(JSON.stringify(this.domAssertions)),
  101 |       contentType: "application/json",
  102 |     });
  103 |   }
  104 | }
  105 | 
  106 | async function interceptBackend(page: Page) {
  107 |   const successMe = {
  108 |     user: { id: "harness", email: "harness@liquidclips.test", tier: "solo" },
  109 |     tier: "solo",
  110 |   };
  111 |   const successSync = { tier: "solo", caps: { watermarkLocked: false } };
  112 |   await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (route) =>
  113 |     route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(successMe) }),
  114 |   );
  115 |   await page.route(/api\.liquidclips\.app\/sync(\?.*)?$/, (route) =>
  116 |     route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(successSync) }),
  117 |   );
  118 |   await page.route(/api\.liquidclips\.app\//, (route) => {
  119 |     if (route.request().method() === "GET") {
  120 |       return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  121 |     }
  122 |     return route.continue();
  123 |   });
  124 | }
  125 | 
  126 | async function seedCompletedSession(page: Page) {
  127 |   await page.addInitScript((slug) => {
  128 |     try {
  129 |       const now = new Date().toISOString();
  130 |       window.localStorage.setItem("lc.license.jwt.v1", "harness.fake.jwt");
  131 |       window.localStorage.setItem(
  132 |         "lc:engine:session:v1",
  133 |         JSON.stringify({
  134 |           source: "caption-journey.test.mp4",
  135 |           slug,
  136 |           status: "complete",
  137 |           percent: 1,
  138 |           stage: "thumbs",
  139 |           runtimeMode: "mock",
  140 |           startedAt: now,
  141 |           updatedAt: now,
  142 |         }),
  143 |       );
  144 |       window.localStorage.setItem("lc.dock.open", "1");
  145 |       for (let i = 0; i < window.localStorage.length; i++) {
  146 |         const k = window.localStorage.key(i);
  147 |         if (k && k.startsWith(`lc.clip.${slug}:`)) window.localStorage.removeItem(k);
  148 |       }
  149 |     } catch { /* private mode / quota — degrade silently */ }
  150 |   }, FIXTURE_SLUG);
  151 | }
  152 | 
  153 | const NEW_TEXT = "Stop scrolling. Watch this.";
  154 | const NEW_STYLE = "cyan-bold";
  155 | const NEW_POSITION = "top";
  156 | 
  157 | async function clickDockTab(page: Page, name: string): Promise<void> {
  158 |   const pill = page.locator(
  159 |     ".lc-cockpit-dock .lc-cd-pill",
  160 |     { hasText: new RegExp(`^${name}$`, "i") },
  161 |   );
  162 |   const box = await pill.boundingBox();
  163 |   if (!box) throw new Error(`Cockpit tab "${name}" has no clickable box`);
  164 |   await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  165 | }
  166 | 
  167 | async function clickByPointer(page: Page, locator: Locator): Promise<void> {
  168 |   await locator.scrollIntoViewIfNeeded();
  169 |   const box = await locator.boundingBox();
  170 |   if (!box) throw new Error("Control has no clickable box");
  171 |   await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  172 | }
  173 | 
  174 | test.describe("Caption Editing Journey", () => {
  175 |   test(`${JOURNEY} · customer can edit captions and changes persist + export still runs`, async ({ page }, testInfo) => {
  176 |     test.setTimeout(180_000);
  177 |     const rec = new JourneyRecorder(page, testInfo);
  178 | 
  179 |     try {
  180 |       await rec.step("Launch app and seed completed session", async () => {
  181 |         await interceptBackend(page);
  182 |         await seedCompletedSession(page);
  183 |         await page.goto("/?skipIntro=1#/workstation", { waitUntil: "domcontentloaded" });
  184 |       });
  185 | 
  186 |       await rec.step("Navigate to Workstation", async () => {
> 187 |         await page.waitForSelector('[data-testid="clip-card"]', { timeout: 30_000 });
      |                    ^ TimeoutError: page.waitForSelector: Timeout 30000ms exceeded.
  188 |       });
  189 | 
  190 |       await rec.step("Confirm clip grid is populated", async () => {
  191 |         const count = await page.locator('[data-testid="clip-card"]').count();
  192 |         expect(count).toBeGreaterThanOrEqual(2);
  193 |         rec.assert("grid_clip_count", count);
  194 |       });
  195 | 
  196 |       await rec.step("Click Edit on first clip", async () => {
  197 |         const firstCard = page.locator('[data-testid="clip-card"][data-clip-idx="0"]');
  198 |         await firstCard.locator('button.lc-clip-cta', { hasText: /^Edit$/ }).first().click();
  199 |       });
  200 | 
  201 |       await rec.step("Cockpit dock opens", async () => {
  202 |         const dock = page.locator('.lc-cockpit-dock[data-open="1"]');
  203 |         await expect(dock).toBeVisible({ timeout: 4_000 });
  204 |       });
  205 | 
  206 |       await rec.step("Switch dock to Caption tab", async () => {
  207 |         await clickDockTab(page, "Caption");
  208 |         await expect(page.locator('.lc-cockpit-dock[data-module="caption"]')).toBeVisible({ timeout: 4_000 });
  209 |         rec.assert("dock_on_caption", true);
  210 |       });
  211 | 
  212 |       // Capture originals before mutation.
  213 |       const originalText = await page.locator('[data-testid="caption-text"]').inputValue();
  214 |       const originalStyle = await page.locator('[data-testid="caption-preview"]').getAttribute("data-style");
  215 |       const originalPosition = await page.locator('[data-testid="caption-preview"]').getAttribute("data-position");
  216 |       rec.assert("caption_original_text", originalText);
  217 |       rec.assert("caption_original_style", originalStyle);
  218 |       rec.assert("caption_original_position", originalPosition);
  219 | 
  220 |       await rec.step("Change caption Line text", async () => {
  221 |         const input = page.locator('[data-testid="caption-text"]');
  222 |         await input.fill(NEW_TEXT);
  223 |         await expect.poll(async () => page.locator('[data-testid="caption-preview-text"]').textContent()).toContain(NEW_TEXT);
  224 |       });
  225 | 
  226 |       await rec.step(`Pick Style → ${NEW_STYLE}`, async () => {
  227 |         await clickByPointer(page, page.locator(`[data-testid="caption-style-${NEW_STYLE}"]`));
  228 |         await expect.poll(async () => page.locator('[data-testid="caption-preview"]').getAttribute("data-style")).toBe(NEW_STYLE);
  229 |       });
  230 | 
  231 |       await rec.step(`Pick Position → ${NEW_POSITION}`, async () => {
  232 |         await clickByPointer(page, page.locator(`[data-testid="caption-position-${NEW_POSITION}"]`));
  233 |         await expect.poll(async () => page.locator('[data-testid="caption-preview"]').getAttribute("data-position")).toBe(NEW_POSITION);
  234 |       });
  235 | 
  236 |       await rec.step("Dock preview reflects new text + style + position", async () => {
  237 |         const preview = page.locator('[data-testid="caption-preview"]');
  238 |         const text = page.locator('[data-testid="caption-preview-text"]');
  239 |         const styleAttr = await preview.getAttribute("data-style");
  240 |         const positionAttr = await preview.getAttribute("data-position");
  241 |         const previewText = await text.textContent();
  242 |         rec.assert("caption_preview_style", styleAttr);
  243 |         rec.assert("caption_preview_position", positionAttr);
  244 |         rec.assert("caption_preview_text", previewText);
  245 |         expect(styleAttr).toBe(NEW_STYLE);
  246 |         expect(positionAttr).toBe(NEW_POSITION);
  247 |         expect(previewText).toContain(NEW_TEXT);
  248 |       });
  249 | 
  250 |       await rec.step("Letter-spacing is honestly marked COMING SOON", async () => {
  251 |         // BUG-035 honest-stub assertion: no fake "applied" badge. The label
  252 |         // explicitly tells the customer this knob doesn't reach the export.
  253 |         const badge = page.locator('[data-testid="caption-letter-spacing-coming-soon"]');
  254 |         await expect(badge).toBeVisible();
  255 |         const copy = await badge.textContent();
  256 |         rec.assert("letter_spacing_coming_soon_copy", copy);
  257 |         expect(copy?.toLowerCase()).toMatch(/coming soon/);
  258 |         // Also: no toast-shaped lie about it being applied.
  259 |       });
  260 | 
  261 |       await rec.step("Verify Apply Captions button is enabled (dirty)", async () => {
  262 |         const apply = page.locator('[data-testid="caption-apply"]');
  263 |         await expect(apply).toBeVisible();
  264 |         await expect(apply).toBeEnabled();
  265 |         await expect(apply).toHaveAttribute("data-caption-state", "idle");
  266 |       });
  267 | 
  268 |       await rec.step("Click Apply captions", async () => {
  269 |         await clickByPointer(page, page.locator('[data-testid="caption-apply"]'));
  270 |       });
  271 | 
  272 |       await rec.step("Caption apply completes and commits the edit", async () => {
  273 |         const apply = page.locator('[data-testid="caption-apply"]');
  274 |         await expect.poll(async () => apply.getAttribute("data-caption-state"), {
  275 |           timeout: 8_000,
  276 |           intervals: [200, 400, 800, 1200],
  277 |         }).not.toBe("applying");
  278 |         const finalState = await apply.getAttribute("data-caption-state");
  279 |         expect(["done", "idle"]).toContain(finalState);
  280 |         await expect(apply).toBeDisabled();
  281 |         rec.assert("caption_state_reached_done", true);
  282 |       });
  283 | 
  284 |       await rec.step("Switch to second clip", async () => {
  285 |         const secondShell = page.locator('[data-testid="clip-card"][data-clip-idx="1"] [data-testid="clip-shell"]');
  286 |         await secondShell.click();
  287 |         await page.locator('.lc-cd-clip-num', { hasText: "#2" }).waitFor({ timeout: 4_000 });
```