# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e/browse-shortcuts.spec.ts >> shortcut rail enforces the six-icon capacity
- Location: tests/e2e/browse-shortcuts.spec.ts:86:1

# Error details

```
TimeoutError: locator.click: Timeout 120000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Open in-app browser', exact: true })

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
  1  | import { expect, test, type Page } from "@playwright/test";
  2  | 
  3  | import { installBackendStubs } from "./fixtures/backendFixtures";
  4  | 
  5  | async function boot(page: Page, shortcuts: unknown[] = []): Promise<void> {
  6  |   await installBackendStubs(page, { tier: "agency" });
  7  |   await page.addInitScript((seedShortcuts) => {
  8  |     window.localStorage.setItem("lc.license.jwt.v1", "browse.harness.jwt");
  9  |     window.localStorage.setItem(
  10 |       "lc.onboarding.agency-welcome.seen.v1",
  11 |       "1",
  12 |     );
  13 |     window.localStorage.setItem(
  14 |       "lc.scheduler.shortcuts.v1",
  15 |       JSON.stringify(seedShortcuts),
  16 |     );
  17 |   }, shortcuts);
  18 |   await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
  19 |   await expect(page.locator(".lc-app")).toBeVisible({ timeout: 40_000 });
  20 |   await page
  21 |     .getByRole("button", { name: "Open in-app browser", exact: true })
> 22 |     .click();
     |      ^ TimeoutError: locator.click: Timeout 120000ms exceeded.
  23 |   await expect(
  24 |     page.getByRole("dialog", { name: "Browser overlay" }),
  25 |   ).toBeVisible();
  26 | }
  27 | 
  28 | test("shortcut form validates, persists, navigates, cancels, and respects Escape", async ({
  29 |   page,
  30 | }) => {
  31 |   await boot(page);
  32 |   const browser = page.getByRole("dialog", { name: "Browser overlay" });
  33 | 
  34 |   await browser.getByRole("button", { name: "Add shortcut" }).click();
  35 |   const form = page.getByRole("dialog", { name: "Add shortcut" });
  36 |   await expect(form).toBeVisible();
  37 |   await expect(form.getByRole("textbox", { name: "Shortcut name" })).toBeFocused();
  38 | 
  39 |   await form.getByRole("button", { name: "Add shortcut" }).click();
  40 |   await expect(form.getByRole("alert")).toHaveText("Name can't be empty.");
  41 | 
  42 |   await form.getByRole("textbox", { name: "Shortcut name" }).fill("LinkedIn");
  43 |   await form.getByRole("textbox", { name: "Shortcut URL" }).fill("ftp://invalid");
  44 |   await form.getByRole("button", { name: "Add shortcut" }).click();
  45 |   await expect(form.getByRole("alert")).toHaveText(
  46 |     "URL must start with http:// or https://",
  47 |   );
  48 | 
  49 |   await form
  50 |     .getByRole("textbox", { name: "Shortcut URL" })
  51 |     .fill("https://www.linkedin.com/feed/");
  52 |   await form.getByRole("button", { name: "Add shortcut" }).click();
  53 |   await expect(form).toBeHidden();
  54 |   const linkedIn = browser.getByRole("button", { name: "Open LinkedIn" });
  55 |   await expect(linkedIn).toBeVisible();
  56 | 
  57 |   const persisted = await page.evaluate(() =>
  58 |     JSON.parse(
  59 |       window.localStorage.getItem("lc.scheduler.shortcuts.v1") ?? "[]",
  60 |     ),
  61 |   );
  62 |   expect(persisted).toEqual([
  63 |     expect.objectContaining({
  64 |       label: "LinkedIn",
  65 |       url: "https://www.linkedin.com/feed/",
  66 |     }),
  67 |   ]);
  68 | 
  69 |   await linkedIn.click();
  70 |   await expect(browser.getByRole("textbox", { name: "URL bar" })).toHaveValue(
  71 |     "https://www.linkedin.com/feed/",
  72 |   );
  73 | 
  74 |   await browser.getByRole("button", { name: "Add shortcut" }).click();
  75 |   await expect(form).toBeVisible();
  76 |   await page.keyboard.press("Escape");
  77 |   await expect(form).toBeHidden();
  78 |   await expect(browser).toBeVisible();
  79 | 
  80 |   await browser.getByRole("button", { name: "Add shortcut" }).click();
  81 |   await form.getByRole("button", { name: "Cancel" }).click();
  82 |   await expect(form).toBeHidden();
  83 |   await expect(browser).toBeVisible();
  84 | });
  85 | 
  86 | test("shortcut rail enforces the six-icon capacity", async ({ page }) => {
  87 |   await boot(page, [
  88 |     { id: "one", label: "LinkedIn", url: "https://linkedin.com" },
  89 |     { id: "two", label: "Threads", url: "https://threads.net" },
  90 |     { id: "three", label: "Bluesky", url: "https://bsky.app" },
  91 |   ]);
  92 |   const browser = page.getByRole("dialog", { name: "Browser overlay" });
  93 |   await expect(browser.getByText("6/6")).toBeVisible();
  94 |   await expect(
  95 |     browser.getByRole("button", { name: "Add shortcut" }),
  96 |   ).toHaveCount(0);
  97 | });
  98 | 
```