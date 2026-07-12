# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e/clerk-otp-login.spec.ts >> P0 · Clerk OTP login surface >> Whop tertiary link stays demoted below primary + LC-ID
- Location: tests/e2e/clerk-otp-login.spec.ts:100:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator:  getByTestId('welcome-clipper')
Expected: visible
Received: hidden
Timeout:  8000ms

Call log:
  - Expect "toBeVisible" with timeout 8000ms
  - waiting for getByTestId('welcome-clipper')
    19 × locator resolved to <button type="button" data-testid="welcome-clipper" class="lc-login-fallback-link lc-login-fallback-link-muted">Continue with Whop</button>
       - unexpected value "hidden"

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
  57  |     expect(primaryVisible).not.toBe("none");
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
> 108 |     await expect(clipperCta).toBeVisible({ timeout: 8000 });
      |                              ^ Error: expect(locator).toBeVisible() failed
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