# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e/community-chat-home.spec.ts >> Community chat home >> ordinary users can copy links but never receive moderation controls
- Location: tests/e2e/community-chat-home.spec.ts:425:3

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator: locator('.lc-chat-row').filter({ hasText: 'The side-by-side reaction layout is landing cleanly.' })
Expected: "false"
Timeout: 120000ms
Error: element(s) not found

Call log:
  - Expect "toHaveAttribute" with timeout 120000ms
  - waiting for locator('.lc-chat-row').filter({ hasText: 'The side-by-side reaction layout is landing cleanly.' })

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
  410 |     await toggle.click();
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
> 434 |     await expect(row).toHaveAttribute("data-moderation-available", "false");
      |                       ^ Error: expect(locator).toHaveAttribute(expected) failed
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
  511 |     await row.getByRole("menuitem", { name: "Warn user" }).click();
  512 |     expect((await warnRequest).postDataJSON()).toEqual({});
  513 |     await expect(page.getByText("Not authorised")).toBeVisible();
  514 |     await expect(page.getByText("Staff role is no longer active.")).toBeVisible();
  515 | 
  516 |     await row.click({ button: "right" });
  517 |     const muteRequest = page.waitForRequest(
  518 |       (request) =>
  519 |         request.method() === "POST" &&
  520 |         new URL(request.url()).pathname.endsWith("/chat/messages/msg-lucia/mute24h"),
  521 |     );
  522 |     await row.getByRole("menuitem", { name: "Mute for 24 hours" }).click();
  523 |     expect((await muteRequest).postDataJSON()).toEqual({});
  524 |     await expect(page.getByText("Moderation failed")).toBeVisible();
  525 |     await expect(page.getByText("Moderation service unavailable.")).toBeVisible();
  526 | 
  527 |     const evidenceDir = path.resolve(
  528 |       process.cwd(),
  529 |       "docs/ui-master/evidence/stage-7/1440x900",
  530 |     );
  531 |     fs.mkdirSync(evidenceDir, { recursive: true });
  532 |     await page.screenshot({
  533 |       path: path.join(evidenceDir, "moderation-contract-gate.png"),
  534 |       fullPage: false,
```