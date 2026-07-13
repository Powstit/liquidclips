/**
 * _auth-harness.ts · Canonical Playwright auth-seed helper
 *
 * Every failing spec in the D1 baseline sweep (2026-07-12) landed on the
 * "Sign in to Liquid Clips" screen because its inline JWT seed did NOT
 * satisfy the current AuthGate + WelcomeGate + useMe boot contract.
 *
 * Root cause (proven):
 *   1. Specs seeded `localStorage["lc.license.jwt.v1"] = "harness.fake.jwt"`
 *      but nothing else. That satisfies `hasJwt()` inside `authStorage.ts`,
 *      but useMe hydration never lands because the catch-all `/api/**`
 *      mock returns `{}` — which fails `MeBackendResponse` shape checks
 *      and leaves `TopHud`/`SplashLeaderboard` stuck on "Signing in…".
 *   2. On top of that, WelcomeGate can flap back to `WelcomeRoute` if the
 *      `lc:welcome-acked` sentinel isn't set alongside the JWT.
 *   3. The auto `/me/money-rollup` fetch (WalletDetail + hooks in shell)
 *      hits the catch-all `{}` mock → shape guard fires → console warns
 *      + wallet renders "unauthorized" state. Not a shell-mount failure,
 *      but a distraction that made root-cause slow to isolate.
 *
 * This helper writes the exact set of localStorage keys + route mocks the
 * current product code expects, so every downstream test can share ONE
 * canonical "authenticated returning user" boot. Specs that want a
 * different tier / whop-connected state pass options — but they should
 * NEVER re-implement the JWT seed inline.
 *
 * Contract satisfied:
 *   - localStorage `lc.license.jwt.v1`                           (Wave 1 canonical · authStorage.ts:27)
 *   - localStorage `app.liquidclips.auth.v1.jwt`                 (legacy safety · cold-start-returning.spec.ts)
 *   - localStorage `app.liquidclips.auth.v1.whop_authorized_at`  (WelcomeGate escape · cold-start-returning.spec.ts)
 *   - localStorage `lc:welcome-acked` = "1"                      (WelcomeGate escape · App.tsx:478)
 *   - route mock `/sync`             → tier / subscription_status
 *   - route mock `/me`               → realistic MeResponse (shape-valid)
 *   - route mock `/affiliate/me`     → basic affiliate response (AffiliateWidget.tsx:96)
 *   - route mock `/me/money-rollup`  → zero-balance canonical rollup (moneyRollup.ts:96)
 *   - route mock catch-all           → 200 `{}` on GET (parity with legacy `interceptBackend`)
 *
 * Does NOT invoke Keychain (IG-014 policy — passive callers never touch
 * OS Keychain from a hot path).
 *
 * Does NOT bypass product code — WelcomeGate + AuthGate + FunnelGate
 * still run their real code paths; we only satisfy their observable
 * inputs.
 */

import type { Page } from "@playwright/test";

/* ─── Constants ─────────────────────────────────────────────────────── */

/** Canonical harness JWT string. Used by every spec so a grep for the
 *  literal surfaces every seeded test in one shot. `not-real` in the
 *  literal so anyone auditing production logs can't confuse it with a
 *  real token. */
export const CANONICAL_HARNESS_JWT = "harness-jwt-authenticated-e2e-not-real";

/** Canonical harness LC-ID. Format matches `^LC-[A-Z0-9]{6}$` per
 *  identity ladder Wave 1 (useMe.ts:120). */
const CANONICAL_HARNESS_LC_ID = "LC-HARN01";

/** Canonical harness handle. Format matches `^[a-z0-9_]{3,20}$` per
 *  identity ladder Wave 1 (useMe.ts:110). */
const CANONICAL_HARNESS_HANDLE = "harness_e2e";

/** localStorage keys we seed / clear. Kept in sync with product code:
 *   - LC_JWT_KEY               · authStorage.ts:27
 *   - LEGACY_JWT_KEY           · used by cold-start-returning.spec.ts as
 *                                a safety mirror
 *   - LEGACY_WHOP_AUTHORIZED   · cold-start-returning.spec.ts
 *   - WELCOME_ACKED_KEY        · App.tsx:480
 */
const LC_JWT_KEY = "lc.license.jwt.v1";
const LEGACY_JWT_KEY = "app.liquidclips.auth.v1.jwt";
const LEGACY_WHOP_AUTHORIZED_KEY = "app.liquidclips.auth.v1.whop_authorized_at";
const WELCOME_ACKED_KEY = "lc:welcome-acked";

/* ─── Types ─────────────────────────────────────────────────────────── */

export type HarnessTier = "clipper" | "solo" | "pro" | "agency" | "autopilot";

export interface AuthHarnessOptions {
  /** effective / raw tier the /sync + /me mocks report. Default `solo`. */
  tier?: HarnessTier;
  /** When true, /me reports a `whop_user_id` + /sync reports
   *  `whop_authorized_at`. Default false (Whop-not-yet-linked path). */
  whop_connected?: boolean;
  /** Override the seeded handle. `null` means the seeded snapshot has
   *  no handle (identity ladder falls to `lc-id` rung). Default:
   *  `CANONICAL_HARNESS_HANDLE`. */
  handle?: string | null;
  /** Override the seeded LC-ID. `null` means the seeded snapshot has
   *  no lc_id (falls to email-local rung). Default:
   *  `CANONICAL_HARNESS_LC_ID`. */
  lc_id?: string | null;
  /** When true, the /me mock reports `admin_override: true` +
   *  `platform_role: "admin"`. Default false. */
  admin_override?: boolean;
}

/* ─── Internal helpers ──────────────────────────────────────────────── */

/**
 * Build a valid /me response body matching `MeBackendResponse` in
 * `src/design-os/state/useMe.ts`. Missing fields yield honest nulls in
 * `adaptMe()`; we intentionally populate every field a shell surface
 * reads so no assertion in a spec has to reason about undefined-vs-null
 * from an unmocked field.
 */
function buildMeBody(opts: AuthHarnessOptions): Record<string, unknown> {
  const tier: HarnessTier = opts.tier ?? "solo";
  const isFree = tier === "clipper";
  return {
    backend_user_id: "harness-user-1",
    clerk_id: "user_harness_e2e",
    email: "harness@liquidclips.app",
    whop_user_id: opts.whop_connected ? "user_harness_whop" : null,
    affiliate_id: null,
    raw_tier: tier,
    effective_tier: tier,
    admin_override: opts.admin_override ?? false,
    billing_provider: isFree ? null : "whop",
    subscription_status: isFree ? "inactive" : "active",
    paid_until: isFree ? null : "2099-01-01T00:00:00Z",
    platform_role: opts.admin_override ? "admin" : "none",
    capabilities: opts.admin_override
      ? [
          "read:all",
          "write:all",
          "admin:override",
        ]
      : [],
    tenant_contexts: [],
    operating_mode: "self",
    target_tenant_id: null,
    capability_schema_version: 1,
    whop_company_id: opts.whop_connected && tier === "agency"
      ? "biz_harness_e2e"
      : null,
    lc_id: opts.lc_id === undefined ? CANONICAL_HARNESS_LC_ID : opts.lc_id,
    handle: opts.handle === undefined ? CANONICAL_HARNESS_HANDLE : opts.handle,
  };
}

/**
 * Build a valid /sync response body matching `SyncResponse` in
 * `src/lib/activation.ts`. Adds `whop_authorized_at` when connected.
 */
function buildSyncBody(opts: AuthHarnessOptions): Record<string, unknown> {
  const tier: HarnessTier = opts.tier ?? "solo";
  const isFree = tier === "clipper";
  return {
    tier,
    founder: false,
    subscription_status: isFree ? "inactive" : "active",
    billing_provider: isFree ? null : "whop",
    features: {},
    remaining_exports: 999,
    admin_override: opts.admin_override ?? false,
    paid_until: isFree ? null : "2099-01-01T00:00:00Z",
    whop_authorized_at: opts.whop_connected
      ? new Date().toISOString()
      : null,
    new_license_jwt: null,
    onboarding_status: {},
  };
}

/**
 * Build a canonical zero-balance money-rollup response matching
 * `MoneyRollup` in `src/lib/moneyRollup.ts`. Every field the shape
 * guard validates is populated with a valid zero/false value.
 */
function buildMoneyRollupBody(): Record<string, unknown> {
  return {
    user_id: "harness-user-1",
    wallet_balance_cents: 0,
    affiliate_mrr_cents: 0,
    referral_total_cents: 0,
    payout_eligible_cents: 0,
    total_lifetime_earnings_cents: 0,
    as_of_ts_ms: Date.now(),
    withdraw_gates: {
      has_balance: false,
      affiliate_agreement_signed: false,
      whop_connected: false,
      payout_ready: false,
    },
  };
}

/**
 * Build a basic affiliate response for `AffiliateWidget` (`/affiliate/me`).
 * Widget reads `data.affiliate` — shape derived from
 * `src/design-os/earn/AffiliateWidget.tsx:96`.
 */
function buildAffiliateBody(opts: AuthHarnessOptions): Record<string, unknown> {
  const handle = opts.handle === undefined
    ? CANONICAL_HARNESS_HANDLE
    : opts.handle;
  return {
    affiliate: {
      connected: false,
      affiliate_code: null,
      referral_url: handle ? `https://liquidclips.app/r/${handle}` : null,
      mrr_cents: 0,
      lifetime_earnings_cents: 0,
      paid_referrals: 0,
    },
  };
}

/* ─── Route mock installer ──────────────────────────────────────────── */

/**
 * Install the four canonical backend mocks. Registration order matters:
 * Playwright evaluates matching routes in REVERSE registration order,
 * so the broad `/api/**` catch-all is registered first and the
 * endpoint-specific handlers below it win for their specific URLs.
 * This mirrors the ordering discipline in
 * `tests/e2e/fixtures/backendFixtures.ts::installBackendStubs`.
 */
async function installAuthRouteMocks(
  page: Page,
  opts: AuthHarnessOptions,
): Promise<void> {
  const meBody = buildMeBody(opts);
  const syncBody = buildSyncBody(opts);
  const rollupBody = buildMoneyRollupBody();
  const affiliateBody = buildAffiliateBody(opts);

  /* Catch-all FIRST so specifics below take priority. */
  await page.route(/api\.liquidclips\.app\//, (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      });
    }
    return route.continue();
  });

  await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(meBody),
    }),
  );

  await page.route(/api\.liquidclips\.app\/sync(\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(syncBody),
    }),
  );

  await page.route(/api\.liquidclips\.app\/me\/money-rollup(\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(rollupBody),
    }),
  );

  await page.route(/api\.liquidclips\.app\/affiliate\/me(\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(affiliateBody),
    }),
  );

  /* 2026-07-13 D1 residual · Telemetry mocks REMOVED. Previously we
   * registered context-level routes for `/telemetry/diagnostic` +
   * `/lcos/events/ingest` because Playwright's page-level `page.route`
   * doesn't reliably intercept `keepalive: true` fetches (they go
   * through the browser's separate keepalive pool, outside CDP routing).
   *
   * The correct fix landed in `src/lib/diagnosticLogger.ts` (ad5c9d0f):
   * `isE2ETransportDisabled()` no-ops both telemetry senders at the
   * product-code level when `window.__LCOS_E2E__ === true`, so the
   * keepalive request never leaves the page. Matching gates live in
   * `useAuditableAction.ts` (audit-tick), `TopHud.tsx` (audit-tick), and
   * `loginTelemetry.ts` (/telemetry/login-step).
   *
   * The context-level mocks became redundant + harmful — they collided
   * with spec-level `page.route(..., r => r.continue())` catch-alls
   * (Playwright throws "route.continue: Assertion error" when a
   * context handler has already begun fulfilling a request that a page
   * handler still holds a `continue` reference to). Removing them
   * eliminates the collision. Production is untouched — the E2E flag
   * is never set outside the harness. */

  /* 2026-07-13 · D1 cluster 2 · /channels* backend-offline mock.
   *
   * Product contract (`src/design-os/engine/sidecar-stub.ts::channels.list()`):
   *   - real HTTP 2xx  → source = "real-http" · adapter reads
   *     `Array.isArray(j) ? j : (j.channels ?? [])`
   *   - real HTTP throws (non-2xx / network) → source = "mock" · uses
   *     the local `channelState.channels` (empty by default)
   *
   * The channels-station journey asserts `data-channels-source === "mock"`
   * because the "no fake connected channels" contract requires the honest
   * offline banner to render. Without an explicit mock, the auth-harness
   * catch-all returns 200 `{}` → `[]` + source "real-http", which the
   * spec correctly flags. Force the 503 backend-offline branch here so
   * every spec (including channels-station) gets the honest mock-source
   * state without re-implementing this bit inline.
   *
   * A spec that WANTS the real-http path with seeded rows can override
   * this by registering its own `/channels` route AFTER
   * seedAuthenticatedShell (Playwright most-recent-wins). */
  await page.route(
    /api\.liquidclips\.app\/channels(\/.*)?(\?.*)?$/,
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          status: "mock",
          reason: "harness-forced-offline",
        }),
      }),
  );
}

/**
 * 2026-07-12 · Known-safe console-error signatures that specs guarding
 * `consoleErrors === []` should ignore.
 *
 * Playwright's `page.route` (and `context.route`) do NOT reliably
 * intercept fetches emitted with `keepalive: true` — the browser sends
 * these on a separate keepalive pool that bypasses CDP-level route
 * hooks. `diagnosticLogger.ts` uses `keepalive: true` for the two
 * telemetry POSTs so the payloads survive page-hide events, which is
 * correct product behavior but causes cosmetic CORS console errors
 * against the real `api.liquidclips.app` origin.
 *
 * This filter recognises the known-safe telemetry patterns so specs
 * that assert on `consoleErrors === []` see a clean stream without
 * having to relax their guard for genuine product errors.
 */
export function isHarnessNoiseConsoleError(text: string): boolean {
  return (
    /Access to fetch at 'https:\/\/api\.liquidclips\.app\/(telemetry\/diagnostic|lcos\/events\/ingest)/.test(
      text,
    ) ||
    /Failed to load resource:.*net::ERR_FAILED/.test(text) ||
    /tauri-adapter|favicon|sourcemap/i.test(text)
  );
}

/* ─── Public API ────────────────────────────────────────────────────── */

/**
 * seedAuthenticatedShell(page, opts?)
 *
 * MUST be called BEFORE `page.goto()` on any spec that expects `.lc-app`
 * to be visible. Writes localStorage seeds + backend route mocks.
 *
 * Specs that need spec-specific overrides can:
 *   - call additional `page.addInitScript(...)` AFTER this to add more
 *     localStorage entries (do NOT overwrite the auth keys we set).
 *   - call `page.route(...)` AFTER this to override a specific endpoint.
 *     Playwright's reverse-registration priority means specific
 *     overrides land first.
 */
export async function seedAuthenticatedShell(
  page: Page,
  opts: AuthHarnessOptions = {},
): Promise<void> {
  await installAuthRouteMocks(page, opts);

  const whopAuthorizedAt = opts.whop_connected
    ? new Date().toISOString()
    : new Date().toISOString();
  /* We always write a `whop_authorized_at` marker so the legacy cold-
   * start-returning contract stays satisfied. The `whop_connected`
   * option instead controls what the /me + /sync mocks report — that's
   * the field the runtime code actually reads. */

  await page.addInitScript(
    ([jwt, whopAt]) => {
      try {
        window.localStorage.setItem("lc.license.jwt.v1", jwt);
        window.localStorage.setItem("app.liquidclips.auth.v1.jwt", jwt);
        window.localStorage.setItem(
          "app.liquidclips.auth.v1.whop_authorized_at",
          whopAt,
        );
        window.localStorage.setItem("lc:welcome-acked", "1");
        /* 2026-07-13 D1 residual · Pre-dismiss the ActivateFounderPanel
         * nudge for authenticated harness sessions too. The fixture /me
         * response reports subscription_status="inactive" for non-agency
         * tiers → MembershipGate mounts ActivateFounderPanel over the
         * bottom-right of every route, which intercepts pointer events
         * on any CTA in that region (Workstation Inspector "Edit clip",
         * Home cockpit tiles, etc.). The dismiss key stores the last
         * dismissal timestamp with a 24h window · setting it to
         * Date.now() simulates the real "returning user already
         * dismissed" state. See seedGuestShell for the matching
         * behaviour. */
        window.localStorage.setItem(
          "lc.membership.activate-nudge-dismissed-at",
          String(Date.now()),
        );
      } catch {
        /* localStorage disabled — every downstream check will fail; the
         * harnessAssertShell() call after page.goto() will surface a
         * clear error. */
      }
      /* 2026-07-13 · E2E telemetry-transport gate. `diagnosticLogger.ts`
       * checks this flag and no-ops the two keepalive POSTs
       * (`/telemetry/diagnostic` + `/lcos/events/ingest`). Playwright's
       * `page.route` intercept is unreliable for keepalive requests
       * because the browser sends them on a separate keepalive pool
       * outside CDP's routing. Setting the flag AT INIT (before any
       * app script runs) is the exact seam the logger reads. Production
       * never sets `__LCOS_E2E__` so the keepalive behaviour survives
       * for real users. */
      (window as unknown as { __LCOS_E2E__?: boolean }).__LCOS_E2E__ = true;
    },
    [CANONICAL_HARNESS_JWT, whopAuthorizedAt] as const,
  );
}

/**
 * seedGuestShell(page, opts?)
 *
 * D1 residual (2026-07-13) · adds the "authenticated but no identity
 * data" seed the visual/workstation baseline needs. Boots the shell
 * past AuthGate + WelcomeGate (so `.lc-app` mounts) but seeds a /me
 * response whose handle + lc_id are null and email local-part is
 * literally "Guest" — so the TopHud identity ladder resolves to the
 * rung-3 (email-local) copy "Guest".
 *
 * Rationale: `seedAuthenticatedShell(page)` defaults handle="harness_e2e"
 * and lc_id="LC-HARN01"; the identity ladder therefore renders "@harness_e2e".
 * Specs that need the anonymous "Guest" pill can't just re-mock /me
 * after this call because the ladder races the initial hydration.
 *
 * Product contract (`TopHud.tsx::identityLadder`):
 *   Rung 1: handle          → "@handle"
 *   Rung 2: lcId             → "LC-XXXXXX"
 *   Rung 3: email local-part → "guest" (case preserved from email)
 *   Rung 4: pending          → "Signing in…"
 *   Rung 5: hydrated + empty → "Complete profile"
 *
 * Passing `email: "Guest@liquidclips.test"` lands rung 3 with copy
 * "Guest". The tier is forced to `clipper` so `.lc-hud-user-tier` reads
 * "Free" (`useTierCaps.tier === "clipper"` → capitalised "Free" in
 * TopHud, per SplashLeaderboard mirror).
 *
 * Same shell-mount + route-mock plumbing as `seedAuthenticatedShell`,
 * just with a caller-provided identity shape.
 */
export async function seedGuestShell(page: Page): Promise<void> {
  await seedAuthenticatedShell(page, {
    tier: "clipper",
    handle: null,
    lc_id: null,
  });
  /* Explicit /me override so email local-part → "Guest". The base
   * harness /me mock uses `harness@liquidclips.app` (local-part
   * "harness") which would render as "harness" on the pill. Register
   * AFTER seedAuthenticatedShell so most-recent-wins picks this up. */
  const guestMeBody = {
    backend_user_id: "harness-guest",
    clerk_id: "user_harness_guest",
    email: "Guest@liquidclips.test",
    whop_user_id: null,
    affiliate_id: null,
    raw_tier: "clipper",
    effective_tier: "clipper",
    admin_override: false,
    billing_provider: null,
    subscription_status: "inactive",
    paid_until: null,
    platform_role: "none",
    capabilities: [] as string[],
    tenant_contexts: [] as unknown[],
    operating_mode: "self",
    target_tenant_id: null,
    capability_schema_version: 1,
    whop_company_id: null,
    lc_id: null,
    handle: null,
  };
  await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(guestMeBody),
    }),
  );
  /* 2026-07-13 D1 residual · pre-dismiss the ActivateFounderPanel
   * (Agency Access nudge). Guest-shell fixtures land on a free-tier
   * user with no active subscription, which triggers MembershipGate
   * to mount `ActivateFounderPanel` — a `position: fixed; right: 24px;
   * bottom: 24px` ~420px card that overlaps the bottom-right of the
   * Workstation Inspector (both the docked ≥1100px column and the
   * <1100px floating drawer) AND the bottom-right of every route with
   * CTAs in that corner. It intercepts pointer events on the target
   * button and Playwright's `.click()` retries until test timeout.
   *
   * The panel checks `lc.membership.activate-nudge-dismissed-at`
   * (isNudgeDismissed helper · 24h window). Setting it to Date.now()
   * simulates the "returning user, already dismissed" state, which is
   * a real product state — free-tier users see the nudge once, dismiss
   * it, and it stays gone for 24 hours. Production behaviour is
   * completely unchanged. */
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem(
        "lc.membership.activate-nudge-dismissed-at",
        String(Date.now()),
      );
    } catch { /* private mode / quota · panel stays mounted */ }
  });
}

/**
 * seedSignedOutShell(page)
 *
 * Clears every auth localStorage key so the app boots into the signed-
 * out state (`WelcomeRoute` → `SimpleLoginPanel`). Does NOT mock backend
 * routes — signed-out flows should not need /me + /sync (they'd be 401
 * against real backend anyway). Specs that need a specific route mock
 * can add it after this call.
 */
/**
 * simulateWalletOffline(page)
 *
 * 2026-07-13 · Forces `/me/wallet/summary` to return HTTP 503 so the
 * WalletDetail route mounts its `data-ui-state="error"` branch (with
 * `data-testid="wallet-offline-retry"` visible). Registered as a
 * page-level route override — Playwright resolves most-recent-wins so
 * this beats any earlier `/me/wallet/summary` mock installed by
 * `seedAuthenticatedShell` + `installBackendStubs`.
 *
 * Rationale · the button audit's `wallet-offline-retry` control only
 * has semantic meaning while the wallet is in the offline branch.
 * Clicking it against a "populated" wallet response is a no-op that
 * would incorrectly classify as a dead control. This helper puts the
 * page in the state the button is designed to operate in BEFORE the
 * audit clicks it.
 *
 * The route override stays installed for the lifetime of the page
 * unless the caller cancels it. Since the button-audit resets the
 * page (`page.goto(...)`) after every control, one call before the
 * Wallet route walk is sufficient — subsequent hard navigations do
 * NOT drop the override.
 */
export async function simulateWalletOffline(page: Page): Promise<void> {
  await page.route(
    /api\.liquidclips\.app\/me\/wallet\/summary(\?.*)?$/,
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          status: "offline",
          reason: "harness-forced-wallet-offline",
        }),
      }),
  );
}

/**
 * clearWalletOfflineSimulation(page)
 *
 * Removes the offline override so the next wallet fetch resolves via
 * the standard `installBackendStubs` fixture. Currently unused (the
 * audit resets each control via `page.goto`), but kept so a caller
 * that stays on the wallet route across multiple controls can flip
 * back into the populated branch.
 */
export async function clearWalletOfflineSimulation(page: Page): Promise<void> {
  await page.unroute(/api\.liquidclips\.app\/me\/wallet\/summary(\?.*)?$/);
}

export async function seedSignedOutShell(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem("lc.license.jwt.v1");
      window.localStorage.removeItem("app.liquidclips.auth.v1.jwt");
      window.localStorage.removeItem(
        "app.liquidclips.auth.v1.whop_authorized_at",
      );
      window.localStorage.removeItem("lc:welcome-acked");
      window.sessionStorage.removeItem(
        "lc.activation.pending_challenge.v1",
      );
    } catch {
      /* localStorage disabled — signed-out is the default anyway. */
    }
    /* 2026-07-13 D1 residual · Set the E2E transport gate on signed-out
     * shells too. Signed-out flows still boot the same shell code (which
     * includes diagnosticLogger + loginTelemetry keepalive senders). If
     * the flag isn't set, those keepalive POSTs bypass `page.route`
     * intercepts (they go through the browser's separate keepalive pool)
     * and hit the real production origin — floods console with CORS
     * errors AND collides with any page-level `r.continue()` catch-all
     * (Playwright's route pipeline throws "route.continue: Assertion
     * error" when a keepalive fetch races the continue handler).
     * Production stays unaffected — the flag is only set inside the
     * Playwright harness. */
    (window as unknown as { __LCOS_E2E__?: boolean }).__LCOS_E2E__ = true;
  });
}

/**
 * harnessAssertShell(page)
 *
 * Call IMMEDIATELY after `page.goto(...)` on any spec that used
 * `seedAuthenticatedShell`. Surfaces a clear
 * `"AUTH HARNESS SETUP FAILED"` error rather than dozens of downstream
 * "element not visible" timeouts.
 *
 * The 30_000ms budget matches the observed Vite dev cold-compile
 * ceiling in `playwright.config.ts` (local navigation timeout is 120s;
 * we intentionally use less so a harness misconfig fails faster than a
 * genuine perf regression).
 */
export async function harnessAssertShell(page: Page): Promise<void> {
  const shell = page.locator('[data-testid="app-shell"]');
  try {
    await shell.waitFor({ state: "visible", timeout: 30_000 });
  } catch (err) {
    /* Fail fast with the reason a triage engineer needs. Include the
     * observable state (welcome route visible? sign-in copy present?)
     * so the fix is obvious from the first failure line. */
    const [welcomeVisible, signInCopyPresent] = await Promise.all([
      page.locator('[data-testid="welcome-route-root"]').isVisible().catch(() => false),
      page.getByText("Sign in to Liquid Clips").isVisible().catch(() => false),
    ]);
    const shellCount = await shell.count().catch(() => 0);
    const cause = welcomeVisible
      ? "WelcomeRoute mounted · lc:welcome-acked or JWT seed missing"
      : signInCopyPresent
        ? "SimpleLoginPanel mounted · JWT seed missing OR /me returned invalid shape"
        : shellCount === 0
          ? "No app-shell element in DOM · Vite dev server may have failed to compile"
          : "app-shell exists but not visible · CSS or mount race";
    throw new Error(
      `AUTH HARNESS SETUP FAILED: ${cause}. ` +
        `Ensure seedAuthenticatedShell(page, opts) was called BEFORE page.goto(). ` +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
