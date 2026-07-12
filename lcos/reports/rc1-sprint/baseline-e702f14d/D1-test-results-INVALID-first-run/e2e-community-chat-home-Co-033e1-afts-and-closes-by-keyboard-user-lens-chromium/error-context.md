# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e/community-chat-home.spec.ts >> Community chat home >> shared floating chat preserves failed drafts and closes by keyboard
- Location: tests/e2e/community-chat-home.spec.ts:402:3

# Error details

```
TimeoutError: locator.click: Timeout 120000ms exceeded.
Call log:
  - waiting for getByTestId('lc-chat-toggle')

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
  310 |       "1440x900",
  311 |     );
  312 |     fs.mkdirSync(evidenceDir, { recursive: true });
  313 |     await page.screenshot({
  314 |       path: path.join(evidenceDir, "loading-history.png"),
  315 |       fullPage: false,
  316 |       timeout: 20_000,
  317 |     });
  318 |     releaseHistory();
  319 |     await expect(page.getByText("Wednesday campaign drop is live. Check the campaign brief before clipping.")).toBeVisible();
  320 |   });
  321 | 
  322 |   test("offline history and send failure keep actions recoverable", async ({ page }) => {
  323 |     await seedAuth(page);
  324 |     await interceptBase(page);
  325 |     await interceptChat(page, { offline: true });
  326 |     await page.goto("/?skipIntro=1#/community", { waitUntil: "domcontentloaded" });
  327 |     await expect(page.getByText("Community chat is offline. Check your connection and retry.")).toBeVisible({
  328 |       timeout: 20_000,
  329 |     });
  330 |     await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  331 | 
  332 |     await page.unroute(/api\.liquidclips\.app\/chat\/messages/);
  333 |     await page.unroute(/api\.liquidclips\.app\/chat\/message$/);
  334 |     await interceptChat(page, { sendStatus: 503 });
  335 |     await page.getByRole("button", { name: "Retry" }).click();
  336 |     await expect(page.getByText("The side-by-side reaction layout is landing cleanly.")).toBeVisible();
  337 | 
  338 |     const composer = page.getByLabel("Message #global");
  339 |     await composer.fill("Keep this draft after failure");
  340 |     await page.getByRole("button", { name: "Send" }).click();
  341 |     await expect(page.getByText("Message could not be sent (503).")).toBeVisible();
  342 |     await expect(composer).toHaveValue("Keep this draft after failure");
  343 |   });
  344 | 
  345 |   test("GIF search returns a selectable result and media remains in-app", async ({ page }) => {
  346 |     await page.setViewportSize({ width: 1440, height: 900 });
  347 |     await seedAuth(page);
  348 |     await interceptBase(page);
  349 |     await interceptChat(page);
  350 |     await interceptMedia(page);
  351 |     await page.goto("/?skipIntro=1#/community", { waitUntil: "domcontentloaded" });
  352 |     await expect(page.getByTestId("community-chat-home")).toBeVisible({ timeout: 20_000 });
  353 | 
  354 |     await page.getByRole("button", { name: "Search GIFs and photos" }).click();
  355 |     const search = page.getByRole("textbox", { name: "Search GIFs", exact: true });
  356 |     await search.fill("applause");
  357 |     const result = page.getByRole("button", { name: "Use Reaction applause" });
  358 |     await expect(result).toBeVisible();
  359 | 
  360 |     const evidenceDir = path.resolve(
  361 |       process.cwd(),
  362 |       "docs",
  363 |       "ui-master",
  364 |       "evidence",
  365 |       "stage-4",
  366 |       "1440x900",
  367 |     );
  368 |     fs.mkdirSync(evidenceDir, { recursive: true });
  369 |     await page.screenshot({
  370 |       path: path.join(evidenceDir, "gif-picker.png"),
  371 |       fullPage: false,
  372 |     });
  373 | 
  374 |     await result.click();
  375 |     await expect(page.getByLabel("Message #global")).toHaveValue(
  376 |       "https://media.giphy.com/media/liquidclips-full/giphy.gif",
  377 |     );
  378 |     await expect(page.locator(".lc-chat-row-media")).toHaveCount(1);
  379 |   });
  380 | 
  381 |   test("media search distinguishes server failure from missing setup", async ({ page }) => {
  382 |     await seedAuth(page);
  383 |     await interceptBase(page);
  384 |     await interceptChat(page);
  385 |     await interceptMedia(page, { status: 500 });
  386 |     await page.goto("/?skipIntro=1#/community", { waitUntil: "domcontentloaded" });
  387 |     await expect(page.getByTestId("community-chat-home")).toBeVisible({ timeout: 20_000 });
  388 | 
  389 |     await page.getByRole("button", { name: "Search GIFs and photos" }).click();
  390 |     await page.getByRole("textbox", { name: "Search GIFs", exact: true }).fill("failure");
  391 |     await expect(page.getByText("Media search returned 500.")).toBeVisible();
  392 |     await expect(page.getByTestId("lc-chat-media").getByRole("button", { name: "Retry" })).toBeVisible();
  393 | 
  394 |     await page.unroute(/api\.liquidclips\.app\/chat\/media\/(giphy|pexels)/);
  395 |     await interceptMedia(page, { setupRequired: true });
  396 |     await page.getByTestId("lc-chat-media").getByRole("button", { name: "Retry" }).click();
  397 |     await expect(
  398 |       page.getByText("Set GIPHY_API_KEY on the backend to enable GIF search."),
  399 |     ).toBeVisible();
  400 |   });
  401 | 
  402 |   test("shared floating chat preserves failed drafts and closes by keyboard", async ({ page }) => {
  403 |     await seedAuth(page);
  404 |     await interceptBase(page);
  405 |     await interceptChat(page, { sendStatus: 503 });
  406 |     await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
  407 | 
  408 |     const toggle = page.getByTestId("lc-chat-toggle");
  409 |     await expect(toggle).toBeVisible({ timeout: 20_000 });
> 410 |     await toggle.click();
      |                  ^ TimeoutError: locator.click: Timeout 120000ms exceeded.
  411 |     await expect(page.getByTestId("lc-chat-panel")).toBeVisible();
  412 |     await expect(page.getByText("The side-by-side reaction layout is landing cleanly.")).toBeVisible();
  413 | 
  414 |     const composer = page.getByRole("textbox", { name: "Message #global" });
  415 |     await composer.fill("Floating chat keeps this draft");
  416 |     await page.getByTestId("lc-chat-panel").getByRole("button", { name: "Send" }).click();
  417 |     await expect(page.getByTestId("lc-chat-panel").getByText("Message could not be sent (503).")).toBeVisible();
  418 |     await expect(composer).toHaveValue("Floating chat keeps this draft");
  419 | 
  420 |     await page.keyboard.press("Escape");
  421 |     await expect(page.getByTestId("lc-chat-panel")).toHaveCount(0);
  422 |     await expect(toggle).toHaveAttribute("data-open", "false");
  423 |   });
  424 | 
  425 |   test("ordinary users can copy links but never receive moderation controls", async ({ page, context }) => {
  426 |     await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  427 |     await seedAuth(page);
  428 |     await interceptBase(page);
  429 |     await interceptChat(page, { viewerRole: "member" });
  430 |     await page.goto("/?skipIntro=1#/community", { waitUntil: "domcontentloaded" });
  431 |     const row = page.locator(".lc-chat-row", {
  432 |       hasText: "The side-by-side reaction layout is landing cleanly.",
  433 |     });
  434 |     await expect(row).toHaveAttribute("data-moderation-available", "false");
  435 |     await row.getByRole("button", { name: "Message actions for @lucia" }).click();
  436 |     await expect(row.getByRole("menuitem", { name: "Copy link to message" })).toBeVisible();
  437 |     await expect(row.getByRole("menuitem", { name: "Hide message" })).toHaveCount(0);
  438 |     await expect(row.getByRole("menuitem", { name: "Warn user" })).toHaveCount(0);
  439 |     await expect(row.getByRole("menuitem", { name: "Mute for 24 hours" })).toHaveCount(0);
  440 | 
  441 |     await row.getByRole("menuitem", { name: "Copy link to message" }).click();
  442 |     await expect(row.getByRole("menuitem", { name: "Link copied" })).toBeVisible();
  443 |     const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  444 |     expect(clipboard).toContain("#/community?message=msg-lucia");
  445 |   });
  446 | 
  447 |   test("staff moderator actions call live contracts and surface success, auth, and server failures", async ({ page }) => {
  448 |     await page.setViewportSize({ width: 1440, height: 900 });
  449 |     await seedAuth(page);
  450 |     await interceptBase(page);
  451 |     await interceptChat(page, { viewerRole: "staff" });
  452 |     await page.route(
  453 |       /api\.liquidclips\.app\/chat\/messages\/msg-lucia\/(hide|warn|mute24h)$/,
  454 |       (route) => {
  455 |         const action = new URL(route.request().url()).pathname.split("/").at(-1);
  456 |         if (action === "hide") {
  457 |           return route.fulfill({
  458 |             status: 200,
  459 |             contentType: "application/json",
  460 |             body: JSON.stringify({
  461 |               id: "msg-lucia",
  462 |               hidden: true,
  463 |               hidden_at: "2026-07-02T12:00:00Z",
  464 |               hidden_by_user_id: "community-harness",
  465 |               hide_reason: null,
  466 |             }),
  467 |           });
  468 |         }
  469 |         if (action === "warn") {
  470 |           return route.fulfill({
  471 |             status: 403,
  472 |             contentType: "application/json",
  473 |             body: JSON.stringify({ detail: "Staff role is no longer active." }),
  474 |           });
  475 |         }
  476 |         return route.fulfill({
  477 |           status: 503,
  478 |           contentType: "application/json",
  479 |           body: JSON.stringify({ detail: "Moderation service unavailable." }),
  480 |         });
  481 |       },
  482 |     );
  483 |     page.on("dialog", (dialog) => void dialog.accept());
  484 |     await page.goto("/?skipIntro=1#/community", { waitUntil: "domcontentloaded" });
  485 |     const row = page.locator(".lc-chat-row", {
  486 |       hasText: "The side-by-side reaction layout is landing cleanly.",
  487 |     });
  488 |     await expect(row).toHaveAttribute("data-moderation-available", "true");
  489 | 
  490 |     await row.click({ button: "right" });
  491 |     await expect(row.getByText("Moderator tools")).toBeVisible();
  492 |     await expect(row.getByRole("menuitem", { name: "Hide message" })).toBeEnabled();
  493 |     await expect(row.getByRole("menuitem", { name: "Warn user" })).toBeEnabled();
  494 |     await expect(row.getByRole("menuitem", { name: "Mute for 24 hours" })).toBeEnabled();
  495 | 
  496 |     const hideRequest = page.waitForRequest(
  497 |       (request) =>
  498 |         request.method() === "POST" &&
  499 |         new URL(request.url()).pathname.endsWith("/chat/messages/msg-lucia/hide"),
  500 |     );
  501 |     await row.getByRole("menuitem", { name: "Hide message" }).click();
  502 |     expect((await hideRequest).postDataJSON()).toEqual({});
  503 |     await expect(page.getByText("Message hidden")).toBeVisible();
  504 | 
  505 |     await row.click({ button: "right" });
  506 |     const warnRequest = page.waitForRequest(
  507 |       (request) =>
  508 |         request.method() === "POST" &&
  509 |         new URL(request.url()).pathname.endsWith("/chat/messages/msg-lucia/warn"),
  510 |     );
```