# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e/activation-bonus-states.spec.ts >> Activation Bonus States · $50 Sponsored Reward >> State transition · rejected state renders distinct status + CTA
- Location: tests/e2e/activation-bonus-states.spec.ts:185:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('sponsored-reward-status-badge')
Expected: visible
Timeout: 120000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 120000ms
  - waiting for getByTestId('sponsored-reward-status-badge')

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
  176 |     await expect(cta).toHaveAttribute("data-cta-kind", "withdraw");
  177 | 
  178 |     await page.screenshot({
  179 |       path: "/tmp/srm-04-earn-approved-state.png",
  180 |       fullPage: false,
  181 |       timeout: 20_000,
  182 |     });
  183 |   });
  184 | 
  185 |   test("State transition · rejected state renders distinct status + CTA", async ({ page }) => {
  186 |     await interceptBackend(page);
  187 |     await seedSession(page, {
  188 |       clearanceStartedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString(),
  189 |       clearanceVerdict: "rejected",
  190 |       paidAt: null,
  191 |       notifiedMilestone: true,
  192 |       notifiedSubscriptionRequired: true,
  193 |       notifiedClearance: true,
  194 |       notifiedApproved: false,
  195 |       notifiedRejected: false,
  196 |       notifiedPaid: false,
  197 |     });
  198 |     await page.goto("/?skipIntro=1#/earn", { waitUntil: "domcontentloaded" });
  199 |     await page.waitForLoadState("networkidle");
  200 |     await page.waitForTimeout(1500);
  201 | 
  202 |     const badge = page.getByTestId("sponsored-reward-status-badge");
> 203 |     await expect(badge).toBeVisible();
      |                         ^ Error: expect(locator).toBeVisible() failed
  204 |     const badgeText = await badge.textContent();
  205 |     expect(badgeText?.toLowerCase()).toContain("rejected");
  206 | 
  207 |     const cta = page.getByTestId("sponsored-reward-cta");
  208 |     await expect(cta).toHaveAttribute("data-cta-kind", "view-reason");
  209 | 
  210 |     await page.screenshot({
  211 |       path: "/tmp/srm-05-earn-rejected-state.png",
  212 |       fullPage: false,
  213 |       timeout: 20_000,
  214 |     });
  215 |   });
  216 | 
  217 |   test("State transition · paid state renders distinct status + CTA", async ({ page }) => {
  218 |     await interceptBackend(page);
  219 |     await seedSession(page, {
  220 |       clearanceStartedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString(),
  221 |       clearanceVerdict: "approved",
  222 |       paidAt: new Date().toISOString(),
  223 |       notifiedMilestone: true,
  224 |       notifiedSubscriptionRequired: true,
  225 |       notifiedClearance: true,
  226 |       notifiedApproved: true,
  227 |       notifiedRejected: false,
  228 |       notifiedPaid: false,
  229 |     });
  230 |     await page.goto("/?skipIntro=1#/earn", { waitUntil: "domcontentloaded" });
  231 |     await page.waitForLoadState("networkidle");
  232 |     await page.waitForTimeout(1500);
  233 | 
  234 |     const badge = page.getByTestId("sponsored-reward-status-badge");
  235 |     await expect(badge).toBeVisible();
  236 |     const badgeText = await badge.textContent();
  237 |     expect(badgeText?.toLowerCase()).toContain("paid");
  238 | 
  239 |     const cta = page.getByTestId("sponsored-reward-cta");
  240 |     await expect(cta).toHaveAttribute("data-cta-kind", "view-history");
  241 | 
  242 |     await page.screenshot({
  243 |       path: "/tmp/srm-06-earn-paid-state.png",
  244 |       fullPage: false,
  245 |       timeout: 20_000,
  246 |     });
  247 |   });
  248 | });
  249 | 
```