# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e/activation-flow.spec.ts >> Activation Flow Journey >> Activation Flow · cold start · begin · handle · sync · home · reload-already-activated · mismatch · auth-fail
- Location: tests/e2e/activation-flow.spec.ts:121:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-testid="login-state-idle"]')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for locator('[data-testid="login-state-idle"]')

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
  35  | import { test, expect, type Page, type TestInfo } from "@playwright/test";
  36  | import * as fs from "node:fs";
  37  | import * as path from "node:path";
  38  | import { fileURLToPath } from "node:url";
  39  | 
  40  | const __filename = fileURLToPath(import.meta.url);
  41  | const __dirname = path.dirname(__filename);
  42  | 
  43  | const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");
  44  | const JOURNEY = "Activation Flow";
  45  | 
  46  | interface StepRecord { step: number; name: string; status: "PASS" | "FAIL"; }
  47  | 
  48  | class JourneyRecorder {
  49  |   private consoleErrors: string[] = [];
  50  |   private domAssertions: Record<string, unknown> = {};
  51  |   private currentStep = 0;
  52  |   constructor(private page: Page, private info: TestInfo) {
  53  |     page.on("pageerror", (e) => this.consoleErrors.push(`pageerror: ${e.message}`));
  54  |     page.on("console", (msg) => {
  55  |       const t = msg.type();
  56  |       if (t === "error" || t === "warning") this.consoleErrors.push(`console.${t}: ${msg.text()}`);
  57  |     });
  58  |     fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  59  |   }
  60  |   async step<T>(name: string, body: () => Promise<T>): Promise<T> {
  61  |     this.currentStep += 1;
  62  |     const n = this.currentStep;
  63  |     const label = `act-${String(n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  64  |     const screenshotPath = path.join(SCREENSHOT_DIR, `${label}.png`);
  65  |     try {
  66  |       const result = await body();
  67  |       try { await this.page.screenshot({ path: screenshotPath, fullPage: false }); } catch {}
  68  |       const rec: StepRecord = { step: n, name, status: "PASS" };
  69  |       await this.info.attach(`lc:step:${n}`, { body: Buffer.from(JSON.stringify(rec)), contentType: "application/json" });
  70  |       return result;
  71  |     } catch (e) {
  72  |       try { await this.page.screenshot({ path: screenshotPath, fullPage: false }); } catch {}
  73  |       const rec: StepRecord = { step: n, name, status: "FAIL" };
  74  |       await this.info.attach(`lc:step:${n}`, { body: Buffer.from(JSON.stringify(rec)), contentType: "application/json" });
  75  |       throw e;
  76  |     }
  77  |   }
  78  |   assert(k: string, v: unknown) { this.domAssertions[k] = v; }
  79  |   async finalize() {
  80  |     await this.info.attach("lc:journey", { body: Buffer.from(JOURNEY), contentType: "text/plain" });
  81  |     await this.info.attach("lc:console-errors", { body: Buffer.from(JSON.stringify(this.consoleErrors)), contentType: "application/json" });
  82  |     await this.info.attach("lc:assertions", { body: Buffer.from(JSON.stringify(this.domAssertions)), contentType: "application/json" });
  83  |   }
  84  | }
  85  | 
  86  | /* Mutable backend handler · each step can swap the /sync + /me
  87  |  * responses without re-registering the routes. */
  88  | type Handler = (route: import("@playwright/test").Route) => Promise<void> | void;
  89  | let syncHandler: Handler = (r) => r.fulfill({
  90  |   status: 200,
  91  |   contentType: "application/json",
  92  |   body: JSON.stringify({ tier: "solo", founder: false, subscription_status: "active", billing_provider: "clerk" }),
  93  | });
  94  | let meHandler: Handler = (r) => r.fulfill({
  95  |   status: 200,
  96  |   contentType: "application/json",
  97  |   body: JSON.stringify({ email: "harness@liquidclips.app", effective_tier: "solo", raw_tier: "solo" }),
  98  | });
  99  | 
  100 | async function interceptBackend(page: Page) {
  101 |   /* Catch-all first (Playwright reverse-priority registration rule) so
  102 |    * specifics override. */
  103 |   await page.route(/api\.liquidclips\.app\//, (route) => {
  104 |     if (route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  105 |     return route.continue();
  106 |   });
  107 |   await page.route(/api\.liquidclips\.app\/sync(\?.*)?$/, (route) => syncHandler(route));
  108 |   await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (route) => meHandler(route));
  109 | }
  110 | 
  111 | /* Build a deep-link URL the way the account-app would emit it. The
  112 |  * `challenge` value MUST match the nonce begin() persisted in
  113 |  * sessionStorage, otherwise handleActivationUrl() flips to "failed". */
  114 | function buildDeepLink(token: string, challenge: string, source: "clerk" | "whop" = "clerk"): string {
  115 |   return `liquidclips://activate?token=${encodeURIComponent(token)}&challenge=${encodeURIComponent(challenge)}&source=${source}`;
  116 | }
  117 | 
  118 | const FAKE_JWT = "harness.activation.jwt.v1";
  119 | 
  120 | test.describe("Activation Flow Journey", () => {
  121 |   test(`${JOURNEY} · cold start · begin · handle · sync · home · reload-already-activated · mismatch · auth-fail`, async ({ page }, testInfo) => {
  122 |     const rec = new JourneyRecorder(page, testInfo);
  123 | 
  124 |     try {
  125 |       await rec.step("Cold launch (no JWT) · LoginOnboarding renders idle state", async () => {
  126 |         await interceptBackend(page);
  127 |         /* No JWT in storage · skip splash via dev param. */
  128 |         await page.addInitScript(() => {
  129 |           try {
  130 |             window.localStorage.removeItem("lc.license.jwt.v1");
  131 |             window.sessionStorage.removeItem("lc.activation.pending_challenge.v1");
  132 |           } catch {}
  133 |         });
  134 |         await page.goto("/?skipIntro=1", { waitUntil: "domcontentloaded" });
> 135 |         await expect(page.locator('[data-testid="login-state-idle"]')).toBeVisible({ timeout: 10_000 });
      |                                                                        ^ Error: expect(locator).toBeVisible() failed
  136 |         await expect(page.locator('[data-testid="login-start-button"]')).toBeVisible();
  137 |         const status = await page.evaluate(() => {
  138 |           const w = window as unknown as { __lcActivation?: { snapshot: () => { status: string } } };
  139 |           return w.__lcActivation!.snapshot().status;
  140 |         });
  141 |         rec.assert("initial_status", status);
  142 |         expect(status).toBe("idle");
  143 |       });
  144 | 
  145 |       let nonce = "";
  146 |       await rec.step("begin() returns nonce · session-stores it · flips to waiting", async () => {
  147 |         nonce = await page.evaluate(() => {
  148 |           const w = window as unknown as { __lcActivation?: { begin: () => string } };
  149 |           return w.__lcActivation!.begin();
  150 |         });
  151 |         rec.assert("nonce_len", nonce.length);
  152 |         expect(nonce.length).toBe(64);
  153 |         const sessionNonce = await page.evaluate(() => {
  154 |           try { return window.sessionStorage.getItem("lc.activation.pending_challenge.v1"); } catch { return null; }
  155 |         });
  156 |         expect(sessionNonce).toBe(nonce);
  157 |         await expect(page.locator('[data-testid="login-state-waiting"]')).toBeVisible({ timeout: 2_000 });
  158 |       });
  159 | 
  160 |       await rec.step("handleUrl() with matching challenge · writes JWT · AuthGate flips to home", async () => {
  161 |         const url = buildDeepLink(FAKE_JWT, nonce, "clerk");
  162 |         await page.evaluate(async (u) => {
  163 |           const w = window as unknown as { __lcActivation?: { handleUrl: (u: string) => Promise<void> } };
  164 |           await w.__lcActivation!.handleUrl(u);
  165 |         }, url);
  166 |         /* The real customer journey: AuthGate sees hasJwt()===true on
  167 |          * the very next render after setJwt fires, unmounts
  168 |          * LoginOnboarding, and renders the main app. We assert the
  169 |          * end state (home tile visible) rather than the transient
  170 |          * "Activated" pill which races against the AuthGate flip. */
  171 |         await expect(page.locator('[data-testid="home-tile-1"]')).toBeVisible({ timeout: 10_000 });
  172 |         const storedJwt = await page.evaluate(() => {
  173 |           try { return window.localStorage.getItem("lc.license.jwt.v1"); } catch { return null; }
  174 |         });
  175 |         rec.assert("stored_jwt_matches", storedJwt === FAKE_JWT);
  176 |         expect(storedJwt).toBe(FAKE_JWT);
  177 |         const snap = await page.evaluate(() => {
  178 |           const w = window as unknown as { __lcActivation?: { snapshot: () => unknown } };
  179 |           return w.__lcActivation!.snapshot();
  180 |         });
  181 |         rec.assert("snapshot_after_activate", snap);
  182 |         const { status, tier, email, lastTokenSource, degraded } = snap as Record<string, unknown>;
  183 |         expect(status).toBe("activated");
  184 |         expect(tier).toBe("solo");
  185 |         expect(email).toBe("harness@liquidclips.app");
  186 |         expect(lastTokenSource).toBe("clerk");
  187 |         expect(degraded).toBe(false);
  188 |       });
  189 | 
  190 |       await rec.step("Cold reload with JWT preserved · AuthGate bypasses LoginOnboarding, lands on home", async () => {
  191 |         const jwtBefore = await page.evaluate(() => {
  192 |           try { return window.localStorage.getItem("lc.license.jwt.v1"); } catch { return null; }
  193 |         });
  194 |         expect(jwtBefore).toBe(FAKE_JWT);
  195 |         await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
  196 |         /* AuthGate sees stored JWT on mount, skips LoginOnboarding,
  197 |          * renders the main app directly. */
  198 |         await expect(page.locator('[data-testid="home-tile-1"]')).toBeVisible({ timeout: 15_000 });
  199 |         await expect(page.locator('[data-testid="login-state-idle"]')).toHaveCount(0);
  200 |       });
  201 | 
  202 |       await rec.step("Challenge mismatch · JWT NOT stored · failed state", async () => {
  203 |         /* Clear JWT + nonce, start a new flow, hit handleUrl with a
  204 |          * deliberately-wrong challenge. */
  205 |         await page.evaluate(() => {
  206 |           try {
  207 |             window.localStorage.removeItem("lc.license.jwt.v1");
  208 |             window.sessionStorage.removeItem("lc.activation.pending_challenge.v1");
  209 |           } catch {}
  210 |           const w = window as unknown as { __lcActivation?: { clear: () => void; begin: () => string } };
  211 |           w.__lcActivation!.clear();
  212 |         });
  213 |         await page.goto("/?skipIntro=1", { waitUntil: "domcontentloaded" });
  214 |         await expect(page.locator('[data-testid="login-state-idle"]')).toBeVisible({ timeout: 6_000 });
  215 |         const mismatchNonce = await page.evaluate(() => {
  216 |           const w = window as unknown as { __lcActivation?: { begin: () => string } };
  217 |           return w.__lcActivation!.begin();
  218 |         });
  219 |         const wrongUrl = buildDeepLink(FAKE_JWT, "wrong-challenge-" + mismatchNonce, "clerk");
  220 |         await page.evaluate(async (u) => {
  221 |           const w = window as unknown as { __lcActivation?: { handleUrl: (u: string) => Promise<void> } };
  222 |           await w.__lcActivation!.handleUrl(u);
  223 |         }, wrongUrl);
  224 |         await expect(page.locator('[data-testid="login-state-failed"]')).toBeVisible({ timeout: 3_000 });
  225 |         const errText = await page.locator('[data-testid="login-error"]').textContent();
  226 |         rec.assert("mismatch_error_text", errText);
  227 |         expect(errText?.toLowerCase()).toMatch(/challenge/);
  228 |         const storedJwt = await page.evaluate(() => {
  229 |           try { return window.localStorage.getItem("lc.license.jwt.v1"); } catch { return null; }
  230 |         });
  231 |         expect(storedJwt).toBeNull();
  232 |         await expect(page.locator('[data-testid="login-retry-button"]')).toBeVisible();
  233 |       });
  234 | 
  235 |       await rec.step("Backend 401 on /sync after fresh JWT mint · self-heals · JWT cleared · failed", async () => {
```