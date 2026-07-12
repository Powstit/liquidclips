# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e/clerk-otp-login.spec.ts >> P0 · Clerk OTP login surface >> primary lane renders Clerk panel OR LC-ID fallback per env gate
- Location: tests/e2e/clerk-otp-login.spec.ts:31:3

# Error details

```
Error: expect(received).not.toBe(expected) // Object.is equality

Expected: not "none"
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
  1   | /**
  2   |  * P0 first-run access · Clerk OTP login E2E · 2026-07-08
  3   |  *
  4   |  * Walks the primary sign-in surface end-to-end at the DOM level:
  5   |  *   1. Cold start · shell doesn't render yet · WelcomeRoute mounts
  6   |  *   2. ClerkOtpPanel renders inside the primary lane (when
  7   |  *      VITE_CLERK_PUBLISHABLE_KEY is set at build time) OR the LC-ID
  8   |  *      lane renders as fallback (when unset · matches P0-F01 gate)
  9   |  *   3. Format validation · phone normalizer + email regex
  10  |  *   4. LC-ID fallback link routes to the recovery form
  11  |  *   5. Whop tertiary link routes to the Whop iframe path (proves demoted)
  12  |  *
  13  |  * We cannot actually exercise the Clerk OTP delivery from within a
  14  |  * Playwright spec (no real inbox / SMS pipe), so we verify the surface
  15  |  * contract only:
  16  |  *   - the panel is present in the primary lane
  17  |  *   - the input accepts email + phone
  18  |  *   - the "Send code" button fires (mocked Clerk client at page.evaluate)
  19  |  *   - error region has role="alert"
  20  |  *   - LC-ID and Whop links are the two fallback affordances underneath
  21  |  *
  22  |  * Full end-to-end OTP delivery is exercised via a manual walk per the
  23  |  * PROOF.md signature checklist · this spec proves the wire, not the
  24  |  * network.
  25  |  */
  26  | import { test, expect } from "@playwright/test";
  27  | 
  28  | test.use({ viewport: { width: 1440, height: 900 } });
  29  | 
  30  | test.describe("P0 · Clerk OTP login surface", () => {
  31  |   test("primary lane renders Clerk panel OR LC-ID fallback per env gate", async ({
  32  |     page,
  33  |     baseURL,
  34  |   }) => {
  35  |     /* Fresh cold-open · no auth seed. WelcomeRoute mounts. */
  36  |     await page.addInitScript(() => {
  37  |       try {
  38  |         window.localStorage.removeItem("lc.license.jwt.v1");
  39  |         window.localStorage.removeItem("app.liquidclips.auth.v1.jwt");
  40  |         window.localStorage.removeItem("lc:welcome-acked");
  41  |       } catch { /* non-fatal */ }
  42  |     });
  43  | 
  44  |     await page.goto(baseURL ?? "/");
  45  | 
  46  |     /* Welcome / lane picker must mount within a reasonable window. */
  47  |     await expect(page.getByTestId("welcome-route-root")).toBeVisible({ timeout: 8000 });
  48  | 
  49  |     /* Primary lane must be either Clerk panel OR LC-ID fallback.
  50  |      * P0-F01 fix guarantees no crash when Clerk key is absent. */
  51  |     const clerkPanel = page.getByTestId("clerk-otp-panel");
  52  |     const lcIdCta = page.getByTestId("welcome-existing").first();
  53  |     const primaryVisible = await Promise.race([
  54  |       clerkPanel.waitFor({ state: "visible", timeout: 4000 }).then(() => "clerk"),
  55  |       lcIdCta.waitFor({ state: "visible", timeout: 4000 }).then(() => "lcid"),
  56  |     ]).catch(() => "none");
> 57  |     expect(primaryVisible).not.toBe("none");
      |                                ^ Error: expect(received).not.toBe(expected) // Object.is equality
  58  |   });
  59  | 
  60  |   test("clerk panel · identifier input accepts email + phone", async ({
  61  |     page,
  62  |     baseURL,
  63  |   }) => {
  64  |     await page.goto(baseURL ?? "/");
  65  |     const panel = page.getByTestId("clerk-otp-panel");
  66  |     if (!(await panel.isVisible().catch(() => false))) {
  67  |       test.skip(true, "Clerk panel not rendered · publishable key not set in this env");
  68  |       return;
  69  |     }
  70  | 
  71  |     const input = page.getByTestId("clerk-identifier-input");
  72  |     await expect(input).toBeVisible();
  73  | 
  74  |     await input.fill("you@example.com");
  75  |     await expect(input).toHaveAttribute("inputmode", "email");
  76  |     await expect(page.getByTestId("clerk-send-code")).toBeEnabled();
  77  | 
  78  |     await input.fill("+447700900000");
  79  |     await expect(input).toHaveAttribute("inputmode", "tel");
  80  |     await expect(page.getByTestId("clerk-send-code")).toBeEnabled();
  81  |   });
  82  | 
  83  |   test("LC-ID fallback link routes to recovery form", async ({
  84  |     page,
  85  |     baseURL,
  86  |   }) => {
  87  |     await page.goto(baseURL ?? "/");
  88  |     const lcidCta = page.getByTestId("welcome-existing").first();
  89  |     await expect(lcidCta).toBeVisible({ timeout: 8000 });
  90  | 
  91  |     await lcidCta.click();
  92  | 
  93  |     /* onExistingUserClick flips signInMode to "existing" · the
  94  |      * existing-mode card renders `welcome-existing-lcid-input` at
  95  |      * WelcomeRoute.tsx:810. */
  96  |     const lcidInput = page.getByTestId("welcome-existing-lcid-input");
  97  |     await expect(lcidInput).toBeVisible({ timeout: 6000 });
  98  |   });
  99  | 
  100 |   test("Whop tertiary link stays demoted below primary + LC-ID", async ({
  101 |     page,
  102 |     baseURL,
  103 |   }) => {
  104 |     await page.goto(baseURL ?? "/");
  105 |     const clipperCta = page.getByTestId("welcome-clipper");
  106 |     /* Must exist SOMEWHERE on the page (tertiary text link), but must
  107 |      * NOT be the primary CTA (that spot goes to Clerk or LC-ID). */
  108 |     await expect(clipperCta).toBeVisible({ timeout: 8000 });
  109 | 
  110 |     /* Sanity: the primary lane isn't Whop-first. Grab bounding boxes
  111 |      * and confirm the Whop link sits below the primary panel. */
  112 |     const primary = page.locator(".lc-login-picker-inner").first();
  113 |     const primaryBox = await primary.boundingBox();
  114 |     const whopBox = await clipperCta.boundingBox();
  115 |     expect(primaryBox && whopBox).not.toBeNull();
  116 |     if (primaryBox && whopBox) {
  117 |       /* Whop tertiary must be inside the primary card (fallback row) */
  118 |       expect(whopBox.y).toBeGreaterThanOrEqual(primaryBox.y);
  119 |     }
  120 |   });
  121 | });
  122 | 
```