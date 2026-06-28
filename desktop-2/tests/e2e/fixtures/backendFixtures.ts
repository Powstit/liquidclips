/**
 * Schema-valid backend fixtures · 2026-06-26.
 *
 * Mirrors the Pydantic models in junior-backend (see
 * `src/lib/wallet.ts` WalletSummary, `src/lib/activation.ts`
 * SyncResponse, `src/design-os/state/useMe.ts` MeBackendResponse).
 * Every field the live backend returns has a value here so the
 * AuthGate, useMe, billing/adapter, useTierCaps, and WalletPanel
 * read non-undefined values across every authenticated route.
 *
 * Daniel-locked rule (2026-06-26): a fixture that omits a field the
 * UI reads is itself a bug — the audit's job is to expose that, not
 * to paper over it. If a new field appears in the backend Pydantic
 * model, add it here AND patch the component that reads it.
 */
import type { Page } from "@playwright/test";

/* ─── /me (MeBackendResponse) ───────────────────────────────────────── */

export interface MeFixtureOverrides {
  tier?: "free" | "pro" | "growth" | "agency" | "solo";
  email?: string;
  adminOverride?: boolean;
}

export function meFixture(overrides: MeFixtureOverrides = {}): Record<string, unknown> {
  const tier = overrides.tier ?? "pro";
  return {
    backend_user_id: "harness-user-1",
    clerk_id: "user_harness",
    email: overrides.email ?? "harness@liquidclips.app",
    whop_user_id: null,
    affiliate_id: null,
    raw_tier: tier,
    effective_tier: tier,
    admin_override: overrides.adminOverride ?? false,
    billing_provider: "clerk",
    subscription_status: tier === "free" ? "inactive" : "active",
    paid_until: tier === "free" ? null : "2099-01-01T00:00:00Z",
  };
}

/* ─── /sync (SyncResponse) ──────────────────────────────────────────── */

export function syncFixture(overrides: MeFixtureOverrides = {}): Record<string, unknown> {
  const tier = overrides.tier ?? "pro";
  return {
    tier,
    founder: false,
    subscription_status: tier === "free" ? "inactive" : "active",
    billing_provider: "clerk",
    features: {},
    remaining_exports: 999,
    admin_override: overrides.adminOverride ?? false,
  };
}

/* ─── /me/wallet/summary (WalletSummary) ────────────────────────────── */

export function walletSummaryFixture(): Record<string, unknown> {
  return {
    pipeline: {
      in_review_usd_cents: 0,
      approved_usd_cents: 0,
      paid_usd_cents: 0,
      rejected_usd_cents: 0,
      total_pipeline_usd_cents: 0,
    },
    stats: {
      lifetime_views: 0,
      total_submissions: 0,
      approval_rate_pct: 0,
      affiliate_revenue_usd_cents: 0,
    },
    campaigns: [],
    recent_activity: [],
    withdraw: {
      is_live: false,
      min_withdrawal_usd: 50,
      lc_fee_pct: 5,
      currency: "USD",
      payout_ready: false,
      destination_wallet: null,
    },
  };
}

/* ─── Installer · routes for every endpoint the live app calls. ─────── */

export interface InstallBackendStubsOptions extends MeFixtureOverrides {
  /** When true, /me/wallet/summary returns a malformed 200 (used by
   *  the malformed-wallet focused test to prove the WalletPanel
   *  guard). Default false. */
  walletMalformed?: boolean;
}

export async function installBackendStubs(page: Page, opts: InstallBackendStubsOptions = {}): Promise<void> {
  const me = meFixture(opts);
  const sync = syncFixture(opts);
  const wallet = opts.walletMalformed ? { /* 200 but missing every field the UI reads */ } : walletSummaryFixture();

  /* Playwright evaluates matching routes in reverse registration order.
   * Register the broad fallback first so the endpoint-specific handlers
   * below win for /me, /sync, and wallet. */
  /* Catch-all for any other GET to the backend · 200 with empty body
   * so the UI's "degraded but not offline" paths fire instead of
   * cascading failures. */
  await page.route(/api\.liquidclips\.app\//, (r) => {
    if (r.request().method() === "GET") return r.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    return r.continue();
  });
  await page.route(/api\.liquidclips\.app\/me(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(me) }));
  await page.route(/api\.liquidclips\.app\/sync(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sync) }));
  await page.route(/api\.liquidclips\.app\/me\/wallet\/summary(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(wallet) }));
}
