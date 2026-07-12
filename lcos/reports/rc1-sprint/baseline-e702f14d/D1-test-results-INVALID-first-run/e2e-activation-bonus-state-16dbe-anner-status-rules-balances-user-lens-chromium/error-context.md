# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e/activation-bonus-states.spec.ts >> Activation Bonus States · $50 Sponsored Reward >> Earn tab · module renders with banner + status + rules + balances
- Location: tests/e2e/activation-bonus-states.spec.ts:67:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('sponsored-reward-module')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByTestId('sponsored-reward-module')

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
  1   | /**
  2   |  * Activation Bonus States · Phase 2 UX test (IG-SOV-2.2-001)
  3   |  *
  4   |  * Proves the $50 Sponsored Reward module:
  5   |  *   1. Earn tab renders the activation bonus module (banner + status).
  6   |  *   2. Requirements checklist appears (Rules section).
  7   |  *   3. Progress to 5,000 views is shown (both paths visible).
  8   |  *   4. Pending vs Approved vs Paid balances render distinctly.
  9   |  *   5. [simulator] chip shows when isMock === true.
  10  |  *   6. Pool depletion meter renders.
  11  |  *   7. SponsoredRewardCard mounts in /campaigns.
  12  |  *   8. SponsoredRewardStrip mounts on /home (clipper mode).
  13  |  *
  14  |  * Drives state transitions via the puppeteer-only seam
  15  |  * window.__lcDebugActivationBonus to verify each state's CTA.
  16  |  *
  17  |  * Captures screenshots in tracking / milestone / pending / approved
  18  |  * states for proof.
  19  |  */
  20  | 
  21  | import { test, expect, type Page } from "@playwright/test";
  22  | 
  23  | const FIXTURE_SLUG = "uncle-daniel-clip-squad-2026";
  24  | 
  25  | async function interceptBackend(page: Page) {
  26  |   const successMe = {
  27  |     user: { id: "harness", email: "harness@liquidclips.test" },
  28  |     effective_tier: "free",
  29  |     subscription_status: null,
  30  |     tier: "free",
  31  |   };
  32  |   const successSync = { tier: "free", caps: { watermarkLocked: true } };
  33  |   await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (route) =>
  34  |     route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(successMe) }),
  35  |   );
  36  |   await page.route(/api\.liquidclips\.app\/sync(\?.*)?$/, (route) =>
  37  |     route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(successSync) }),
  38  |   );
  39  |   await page.route(/api\.liquidclips\.app\//, (route) => {
  40  |     if (route.request().method() === "GET") {
  41  |       return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  42  |     }
  43  |     return route.continue();
  44  |   });
  45  | }
  46  | 
  47  | async function seedSession(page: Page, bonusState?: Record<string, unknown>) {
  48  |   await page.addInitScript(({ slug, bonus }) => {
  49  |     try {
  50  |       const now = new Date().toISOString();
  51  |       window.localStorage.setItem("lc.license.jwt.v1", "harness.fake.jwt");
  52  |       window.localStorage.setItem(
  53  |         "lc:engine:session:v1",
  54  |         JSON.stringify({ source: "test.mp4", slug, status: "complete", percent: 1, stage: "thumbs", runtimeMode: "mock", startedAt: now, updatedAt: now }),
  55  |       );
  56  |       // Bonus state: explicit seed if provided, else wipe so tracking state is fresh.
  57  |       if (bonus) {
  58  |         window.localStorage.setItem("lc.activation-bonus.v1", JSON.stringify(bonus));
  59  |       } else {
  60  |         window.localStorage.removeItem("lc.activation-bonus.v1");
  61  |       }
  62  |     } catch { /* noop */ }
  63  |   }, { slug: FIXTURE_SLUG, bonus: bonusState ?? null });
  64  | }
  65  | 
  66  | test.describe("Activation Bonus States · $50 Sponsored Reward", () => {
  67  |   test("Earn tab · module renders with banner + status + rules + balances", async ({ page }) => {
  68  |     await interceptBackend(page);
  69  |     await seedSession(page);
  70  |     await page.goto("/?skipIntro=1#/earn", { waitUntil: "domcontentloaded" });
  71  |     await page.waitForLoadState("networkidle");
  72  |     await page.waitForTimeout(1500);
  73  | 
  74  |     const module_ = page.getByTestId("sponsored-reward-module");
> 75  |     await expect(module_).toBeVisible({ timeout: 10_000 });
      |                           ^ Error: expect(locator).toBeVisible() failed
  76  | 
  77  |     // Banner pill + simulator chip
  78  |     await expect(page.getByTestId("sponsored-reward-pill")).toBeVisible();
  79  |     await expect(page.getByTestId("sponsored-reward-sim-chip")).toBeVisible();
  80  | 
  81  |     // Status badge + status copy
  82  |     await expect(page.getByTestId("sponsored-reward-status-badge")).toBeVisible();
  83  |     await expect(page.getByTestId("sponsored-reward-status-copy")).toBeVisible();
  84  | 
  85  |     // Two-path progress
  86  |     await expect(page.getByTestId("sponsored-reward-views-progress")).toBeVisible();
  87  |     await expect(page.getByTestId("sponsored-reward-affiliates-progress")).toBeVisible();
  88  | 
  89  |     // Balances trio
  90  |     await expect(page.getByTestId("sponsored-reward-pending")).toBeVisible();
  91  |     await expect(page.getByTestId("sponsored-reward-approved")).toBeVisible();
  92  |     await expect(page.getByTestId("sponsored-reward-paid")).toBeVisible();
  93  | 
  94  |     // Rules + footer (simulator label)
  95  |     await expect(page.getByTestId("sponsored-reward-rules")).toBeVisible();
  96  |     await expect(page.getByTestId("sponsored-reward-rules-footer")).toBeVisible();
  97  | 
  98  |     // Pool meter
  99  |     await expect(page.getByTestId("sponsored-reward-pool")).toBeVisible();
  100 | 
  101 |     // CTA exists for tracking state ("Keep clipping → views unlock at 5,000")
  102 |     const cta = page.getByTestId("sponsored-reward-cta");
  103 |     await expect(cta).toBeVisible();
  104 |     await expect(cta).toHaveAttribute("data-cta-kind", "keep-clipping");
  105 | 
  106 |     await page.screenshot({
  107 |       path: "/tmp/srm-01-earn-tracking-state.png",
  108 |       fullPage: false,
  109 |       timeout: 20_000,
  110 |     });
  111 |   });
  112 | 
  113 |   test("Sponsored Reward Card · pinned at top of /campaigns", async ({ page }) => {
  114 |     await interceptBackend(page);
  115 |     await seedSession(page);
  116 |     await page.goto("/?skipIntro=1#/campaigns", { waitUntil: "domcontentloaded" });
  117 |     await page.waitForLoadState("networkidle");
  118 |     await page.waitForTimeout(1500);
  119 | 
  120 |     const card = page.getByTestId("sponsored-reward-card");
  121 |     await expect(card).toBeVisible({ timeout: 10_000 });
  122 |     await expect(page.getByTestId("sponsored-reward-card-pill")).toBeVisible();
  123 | 
  124 |     await page.screenshot({
  125 |       path: "/tmp/srm-02-campaigns-card.png",
  126 |       fullPage: false,
  127 |       timeout: 20_000,
  128 |     });
  129 |   });
  130 | 
  131 |   test("Sponsored Reward Strip · clipper home", async ({ page }) => {
  132 |     await interceptBackend(page);
  133 |     await seedSession(page);
  134 |     await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
  135 |     await page.waitForLoadState("networkidle");
  136 |     await page.waitForTimeout(1500);
  137 | 
  138 |     const strip = page.getByTestId("sponsored-reward-strip");
  139 |     await expect(strip).toBeVisible({ timeout: 10_000 });
  140 |     await expect(strip).toHaveAttribute("data-state");
  141 | 
  142 |     await page.screenshot({
  143 |       path: "/tmp/srm-03-home-strip.png",
  144 |       fullPage: false,
  145 |       timeout: 20_000,
  146 |     });
  147 |   });
  148 | 
  149 |   test("State transition · approved state renders breakdown + withdraw CTA", async ({ page }) => {
  150 |     await interceptBackend(page);
  151 |     await seedSession(page, {
  152 |       clearanceStartedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString(),
  153 |       clearanceVerdict: "approved",
  154 |       paidAt: null,
  155 |       notifiedMilestone: true,
  156 |       notifiedSubscriptionRequired: true,
  157 |       notifiedClearance: true,
  158 |       notifiedApproved: false,
  159 |       notifiedRejected: false,
  160 |       notifiedPaid: false,
  161 |     });
  162 |     await page.goto("/?skipIntro=1#/earn", { waitUntil: "domcontentloaded" });
  163 |     await page.waitForLoadState("networkidle");
  164 |     await page.waitForTimeout(1500);
  165 | 
  166 |     const badge = page.getByTestId("sponsored-reward-status-badge");
  167 |     await expect(badge).toBeVisible();
  168 |     const badgeText = await badge.textContent();
  169 |     expect(badgeText?.toLowerCase()).toContain("approved");
  170 | 
  171 |     // Breakdown should appear in approved state
  172 |     await expect(page.getByTestId("sponsored-reward-breakdown")).toBeVisible();
  173 | 
  174 |     // CTA should be "withdraw"
  175 |     const cta = page.getByTestId("sponsored-reward-cta");
```