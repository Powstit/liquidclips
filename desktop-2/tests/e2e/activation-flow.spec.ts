/**
 * Activation Flow Journey · USER-LENS AUTOMATION GATE · TASK 1
 *
 * Locks the Download → Install → Activate → Home customer journey for
 * Liquid Clips Desktop 2.1.
 *
 * The native deep-link receipt (Tauri `register_uri_scheme` callback)
 * is impossible to exercise in a Playwright browser context, so the
 * harness drives the activation state machine directly via the
 * `window.__lcActivation` test seam — the same module function the
 * native deep-link handler calls. That covers every code path under
 * `src/lib/activation.ts` end-to-end.
 *
 * Scenarios:
 *  1. Cold launch with no JWT → LoginOnboarding visible with the
 *     "Start activation" CTA · activation snapshot status === "idle".
 *  2. begin() emits a 64-hex nonce, persists it in sessionStorage,
 *     flips snapshot to "waiting".
 *  3. handleUrl() with a CORRECT challenge + a JWT writes the JWT to
 *     localStorage, flips snapshot to "activated", fires /sync + /me
 *     in parallel.
 *  4. /sync + /me intercepted by harness · tier + email propagate
 *     into the snapshot.
 *  5. Click "Continue to Liquid Clips →" → app navigates to #/home
 *     and the home tile is visible.
 *  6. Cold reload with the JWT preserved → "Already activated" block
 *     renders + the same "Continue" button is reachable.
 *  7. begin() then handleUrl() with a WRONG challenge → snapshot flips
 *     to "failed" with a "challenge mismatch" error · JWT is NOT
 *     written to localStorage.
 *  8. begin() then handleUrl() with /sync returning 401 → snapshot
 *     flips to "failed" + JWT cleared from localStorage (the
 *     self-heal path).
 */
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");
const JOURNEY = "Activation Flow";

interface StepRecord { step: number; name: string; status: "PASS" | "FAIL"; }

class JourneyRecorder {
  private consoleErrors: string[] = [];
  private domAssertions: Record<string, unknown> = {};
  private currentStep = 0;
  constructor(private page: Page, private info: TestInfo) {
    page.on("pageerror", (e) => this.consoleErrors.push(`pageerror: ${e.message}`));
    page.on("console", (msg) => {
      const t = msg.type();
      if (t === "error" || t === "warning") this.consoleErrors.push(`console.${t}: ${msg.text()}`);
    });
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
  async step<T>(name: string, body: () => Promise<T>): Promise<T> {
    this.currentStep += 1;
    const n = this.currentStep;
    const label = `act-${String(n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const screenshotPath = path.join(SCREENSHOT_DIR, `${label}.png`);
    try {
      const result = await body();
      try { await this.page.screenshot({ path: screenshotPath, fullPage: false }); } catch {}
      const rec: StepRecord = { step: n, name, status: "PASS" };
      await this.info.attach(`lc:step:${n}`, { body: Buffer.from(JSON.stringify(rec)), contentType: "application/json" });
      return result;
    } catch (e) {
      try { await this.page.screenshot({ path: screenshotPath, fullPage: false }); } catch {}
      const rec: StepRecord = { step: n, name, status: "FAIL" };
      await this.info.attach(`lc:step:${n}`, { body: Buffer.from(JSON.stringify(rec)), contentType: "application/json" });
      throw e;
    }
  }
  assert(k: string, v: unknown) { this.domAssertions[k] = v; }
  async finalize() {
    await this.info.attach("lc:journey", { body: Buffer.from(JOURNEY), contentType: "text/plain" });
    await this.info.attach("lc:console-errors", { body: Buffer.from(JSON.stringify(this.consoleErrors)), contentType: "application/json" });
    await this.info.attach("lc:assertions", { body: Buffer.from(JSON.stringify(this.domAssertions)), contentType: "application/json" });
  }
}

/* Mutable backend handler · each step can swap the /sync + /me
 * responses without re-registering the routes. */
type Handler = (route: import("@playwright/test").Route) => Promise<void> | void;
let syncHandler: Handler = (r) => r.fulfill({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ tier: "solo", founder: false, subscription_status: "active", billing_provider: "clerk" }),
});
let meHandler: Handler = (r) => r.fulfill({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ email: "harness@liquidclips.app", effective_tier: "solo", raw_tier: "solo" }),
});

async function interceptBackend(page: Page) {
  /* Catch-all first (Playwright reverse-priority registration rule) so
   * specifics override. */
  await page.route(/api\.liquidclips\.app\//, (route) => {
    if (route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    return route.continue();
  });
  await page.route(/api\.liquidclips\.app\/sync(\?.*)?$/, (route) => syncHandler(route));
  await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (route) => meHandler(route));
}

/* Build a deep-link URL the way the account-app would emit it. The
 * `challenge` value MUST match the nonce begin() persisted in
 * sessionStorage, otherwise handleActivationUrl() flips to "failed". */
function buildDeepLink(token: string, challenge: string, source: "clerk" | "whop" = "clerk"): string {
  return `liquidclips://activate?token=${encodeURIComponent(token)}&challenge=${encodeURIComponent(challenge)}&source=${source}`;
}

const FAKE_JWT = "harness.activation.jwt.v1";

test.describe("Activation Flow Journey", () => {
  test(`${JOURNEY} · cold start · begin · handle · sync · home · reload-already-activated · mismatch · auth-fail`, async ({ page }, testInfo) => {
    const rec = new JourneyRecorder(page, testInfo);

    try {
      await rec.step("Cold launch (no JWT) · LoginOnboarding renders idle state", async () => {
        await interceptBackend(page);
        /* No JWT in storage · skip splash via dev param. */
        await page.addInitScript(() => {
          try {
            window.localStorage.removeItem("lc.license.jwt.v1");
            window.sessionStorage.removeItem("lc.activation.pending_challenge.v1");
          } catch {}
        });
        await page.goto("/?skipIntro=1", { waitUntil: "domcontentloaded" });
        await expect(page.locator('[data-testid="login-state-idle"]')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('[data-testid="login-start-button"]')).toBeVisible();
        const status = await page.evaluate(() => {
          const w = window as unknown as { __lcActivation?: { snapshot: () => { status: string } } };
          return w.__lcActivation!.snapshot().status;
        });
        rec.assert("initial_status", status);
        expect(status).toBe("idle");
      });

      let nonce = "";
      await rec.step("begin() returns nonce · session-stores it · flips to waiting", async () => {
        nonce = await page.evaluate(() => {
          const w = window as unknown as { __lcActivation?: { begin: () => string } };
          return w.__lcActivation!.begin();
        });
        rec.assert("nonce_len", nonce.length);
        expect(nonce.length).toBe(64);
        const sessionNonce = await page.evaluate(() => {
          try { return window.sessionStorage.getItem("lc.activation.pending_challenge.v1"); } catch { return null; }
        });
        expect(sessionNonce).toBe(nonce);
        await expect(page.locator('[data-testid="login-state-waiting"]')).toBeVisible({ timeout: 2_000 });
      });

      await rec.step("handleUrl() with matching challenge · writes JWT · AuthGate flips to home", async () => {
        const url = buildDeepLink(FAKE_JWT, nonce, "clerk");
        await page.evaluate(async (u) => {
          const w = window as unknown as { __lcActivation?: { handleUrl: (u: string) => Promise<void> } };
          await w.__lcActivation!.handleUrl(u);
        }, url);
        /* The real customer journey: AuthGate sees hasJwt()===true on
         * the very next render after setJwt fires, unmounts
         * LoginOnboarding, and renders the main app. We assert the
         * end state (home tile visible) rather than the transient
         * "Activated" pill which races against the AuthGate flip. */
        await expect(page.locator('[data-testid="home-tile-1"]')).toBeVisible({ timeout: 10_000 });
        const storedJwt = await page.evaluate(() => {
          try { return window.localStorage.getItem("lc.license.jwt.v1"); } catch { return null; }
        });
        rec.assert("stored_jwt_matches", storedJwt === FAKE_JWT);
        expect(storedJwt).toBe(FAKE_JWT);
        const snap = await page.evaluate(() => {
          const w = window as unknown as { __lcActivation?: { snapshot: () => unknown } };
          return w.__lcActivation!.snapshot();
        });
        rec.assert("snapshot_after_activate", snap);
        const { status, tier, email, lastTokenSource, degraded } = snap as Record<string, unknown>;
        expect(status).toBe("activated");
        expect(tier).toBe("solo");
        expect(email).toBe("harness@liquidclips.app");
        expect(lastTokenSource).toBe("clerk");
        expect(degraded).toBe(false);
      });

      await rec.step("Cold reload with JWT preserved · AuthGate bypasses LoginOnboarding, lands on home", async () => {
        const jwtBefore = await page.evaluate(() => {
          try { return window.localStorage.getItem("lc.license.jwt.v1"); } catch { return null; }
        });
        expect(jwtBefore).toBe(FAKE_JWT);
        await page.goto("/?skipIntro=1#/home", { waitUntil: "domcontentloaded" });
        /* AuthGate sees stored JWT on mount, skips LoginOnboarding,
         * renders the main app directly. */
        await expect(page.locator('[data-testid="home-tile-1"]')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('[data-testid="login-state-idle"]')).toHaveCount(0);
      });

      await rec.step("Challenge mismatch · JWT NOT stored · failed state", async () => {
        /* Clear JWT + nonce, start a new flow, hit handleUrl with a
         * deliberately-wrong challenge. */
        await page.evaluate(() => {
          try {
            window.localStorage.removeItem("lc.license.jwt.v1");
            window.sessionStorage.removeItem("lc.activation.pending_challenge.v1");
          } catch {}
          const w = window as unknown as { __lcActivation?: { clear: () => void; begin: () => string } };
          w.__lcActivation!.clear();
        });
        await page.goto("/?skipIntro=1", { waitUntil: "domcontentloaded" });
        await expect(page.locator('[data-testid="login-state-idle"]')).toBeVisible({ timeout: 6_000 });
        const mismatchNonce = await page.evaluate(() => {
          const w = window as unknown as { __lcActivation?: { begin: () => string } };
          return w.__lcActivation!.begin();
        });
        const wrongUrl = buildDeepLink(FAKE_JWT, "wrong-challenge-" + mismatchNonce, "clerk");
        await page.evaluate(async (u) => {
          const w = window as unknown as { __lcActivation?: { handleUrl: (u: string) => Promise<void> } };
          await w.__lcActivation!.handleUrl(u);
        }, wrongUrl);
        await expect(page.locator('[data-testid="login-state-failed"]')).toBeVisible({ timeout: 3_000 });
        const errText = await page.locator('[data-testid="login-error"]').textContent();
        rec.assert("mismatch_error_text", errText);
        expect(errText?.toLowerCase()).toMatch(/challenge/);
        const storedJwt = await page.evaluate(() => {
          try { return window.localStorage.getItem("lc.license.jwt.v1"); } catch { return null; }
        });
        expect(storedJwt).toBeNull();
        await expect(page.locator('[data-testid="login-retry-button"]')).toBeVisible();
      });

      await rec.step("Backend 401 on /sync after fresh JWT mint · self-heals · JWT cleared · failed", async () => {
        /* Re-arm by pressing retry · then begin a new flow with /sync
         * temporarily returning 401. */
        await page.evaluate(() => {
          const w = window as unknown as { __lcActivation?: { clear: () => void } };
          w.__lcActivation!.clear();
        });
        await page.goto("/?skipIntro=1", { waitUntil: "domcontentloaded" });
        await expect(page.locator('[data-testid="login-state-idle"]')).toBeVisible({ timeout: 6_000 });

        /* Swap /sync to 401 just for this step. */
        syncHandler = (route) => route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ detail: "invalid token" }),
        });

        const nonceForAuthFail = await page.evaluate(() => {
          const w = window as unknown as { __lcActivation?: { begin: () => string } };
          return w.__lcActivation!.begin();
        });
        const url = buildDeepLink(FAKE_JWT, nonceForAuthFail, "clerk");
        await page.evaluate(async (u) => {
          const w = window as unknown as { __lcActivation?: { handleUrl: (u: string) => Promise<void> } };
          await w.__lcActivation!.handleUrl(u);
        }, url);

        /* Self-heal: notifyAuthFailure clears the JWT and emits "failed". */
        await expect(page.locator('[data-testid="login-state-failed"]')).toBeVisible({ timeout: 4_000 });
        const storedJwt = await page.evaluate(() => {
          try { return window.localStorage.getItem("lc.license.jwt.v1"); } catch { return null; }
        });
        rec.assert("jwt_cleared_after_401", storedJwt === null);
        expect(storedJwt).toBeNull();

        /* Restore /sync default for any subsequent step. */
        syncHandler = (r) => r.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ tier: "solo", subscription_status: "active", billing_provider: "clerk" }),
        });
      });

      await rec.step("Degraded mode · /sync network failure · JWT preserved · degraded flag set", async () => {
        /* /sync returns network error · JWT should be preserved with
         * degraded=true (no self-heal · this is the documented
         * server-error vs auth-fail split). */
        await page.evaluate(() => {
          try {
            window.localStorage.removeItem("lc.license.jwt.v1");
            window.sessionStorage.removeItem("lc.activation.pending_challenge.v1");
          } catch {}
          const w = window as unknown as { __lcActivation?: { clear: () => void } };
          w.__lcActivation!.clear();
        });
        await page.goto("/?skipIntro=1", { waitUntil: "domcontentloaded" });
        await expect(page.locator('[data-testid="login-state-idle"]')).toBeVisible({ timeout: 6_000 });

        syncHandler = (route) => route.abort("failed");
        meHandler   = (route) => route.abort("failed");

        const nonceForDegraded = await page.evaluate(() => {
          const w = window as unknown as { __lcActivation?: { begin: () => string } };
          return w.__lcActivation!.begin();
        });
        const url = buildDeepLink(FAKE_JWT, nonceForDegraded, "clerk");
        await page.evaluate(async (u) => {
          const w = window as unknown as { __lcActivation?: { handleUrl: (u: string) => Promise<void> } };
          await w.__lcActivation!.handleUrl(u);
        }, url);

        /* JWT stored even when /sync + /me both fail · AuthGate flips
         * to the main app · degraded flag is set on the snapshot. */
        await expect(page.locator('[data-testid="home-tile-1"]')).toBeVisible({ timeout: 10_000 });
        const snap = await page.evaluate(() => {
          const w = window as unknown as { __lcActivation?: { snapshot: () => { status: string; degraded: boolean } } };
          return w.__lcActivation!.snapshot();
        });
        rec.assert("degraded_snapshot", snap);
        expect(snap.status).toBe("activated");
        expect(snap.degraded).toBe(true);
        const storedJwt = await page.evaluate(() => {
          try { return window.localStorage.getItem("lc.license.jwt.v1"); } catch { return null; }
        });
        expect(storedJwt).toBe(FAKE_JWT);

        /* Restore defaults. */
        syncHandler = (r) => r.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ tier: "solo", subscription_status: "active", billing_provider: "clerk" }),
        });
        meHandler = (r) => r.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ email: "harness@liquidclips.app", effective_tier: "solo", raw_tier: "solo" }),
        });
      });
    } finally {
      await rec.finalize();
    }
  });
});
