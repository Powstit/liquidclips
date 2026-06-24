/**
 * Billing adapter boundary · 2026-06-23 monetisation pass.
 *
 * Architecture (post-Batch-2):
 *
 *   Clerk ─→ backend webhook ─→ /me.subscription_status + paid_until
 *                                      │
 *                                      ▼
 *                          useMe() in desktop-2 src/design-os/state
 *                                      │
 *                                      ▼
 *                      MeBackedBillingAdapter (REAL source)
 *                                      │
 *                                      ▼
 *                              useBillingState()
 *
 *   The "real Clerk subscription source" in desktop-2 IS /me — there is
 *   NO direct @clerk/clerk-react in this repo (only account-app has
 *   @clerk/nextjs). Clerk plan changes propagate through:
 *      Clerk → svix-verified webhook → DB.users.subscription_status →
 *      /me response → useMe.snapshot.subscriptionStatus → adapter
 *      → BillingSnapshot.state.
 *
 *   For STARTING a checkout: desktop-2 redirects to account-app
 *   (`https://account.liquidclips.app/checkout?plan=<plan>`) via the
 *   existing `openSmart` helper. account-app hosts the Clerk-backed
 *   checkout UI. After completion, the webhook lands and /me updates
 *   on next poll.
 *
 *   MockBillingAdapter remains as the simulator/dev fallback when /me
 *   has no usable snapshot (fixture-fallback or unknown source).
 *
 * Status reporting: BillingSnapshot.source === "real" when /me has
 *   resolved with a usable subscription_status; otherwise "mock".
 *   `BillingAdapter.isMock` reflects this for honest UI labelling.
 */

import { hasJwt } from "../authStorage";
import { useMe } from "../../design-os/state/useMe";
import { useTierCaps } from "../../design-os/state/useTierCaps";
import { openSmart } from "../openSmart";
import type {
  BillingAdapter,
  BillingSnapshot,
  BillingState,
  CheckoutOutcome,
  PlanKey,
} from "./types";

/* ─── Clerk subscription_status → BillingState mapping ────────────── */
function mapSubscriptionStatus(
  status: string | null,
  hasActiveJwt: boolean,
): BillingState {
  if (!hasActiveJwt) return "free";
  if (!status) return "free";
  const s = status.toLowerCase();
  if (s === "active" || s === "trialing") return "active";
  if (s === "past_due" || s === "unpaid") return "past_due";
  if (s === "canceled" || s === "cancelled") return "cancelled";
  if (s === "incomplete" || s === "incomplete_expired") return "checkout_failed";
  // Unknown status string — treat as free + log via console.warn so it
  // surfaces in dev. NEVER silently upgrade.
  console.warn(`[billing] unrecognized subscription_status="${status}" · treating as free`);
  return "free";
}

function tierToPlanKey(tier: string | null): PlanKey {
  if (tier === "agency") return "agency";
  if (tier === "growth") return "growth";
  if (tier === "pro")    return "pro";
  return "free";
}

/* ─── account-app checkout URL ──────────────────────────────────────
 *
 * 2026-06-23 audit fix: the /checkout page in account-app is a
 * Whop-only affiliate funnel selling Solo $29.99 — it does not branch
 * on ?plan= and does not render Clerk's CheckoutButton. The
 * Clerk-wired pricing surface lives at /dashboard#plans (which
 * mounts PricingCards with all four plan cards + per-card
 * CheckoutButton wrappers). Sending desktop users there closes the
 * money loop for pro/growth/agency without rebuilding /checkout.
 *
 * For the `solo` plan key (Whop-rail), keep the /checkout funnel.
 */
const ACCOUNT_APP_CLERK_PLANS = "https://account.liquidclips.app/dashboard";
const ACCOUNT_APP_WHOP_CHECKOUT = "https://account.liquidclips.app/checkout";

function checkoutUrl(plan: PlanKey): string {
  // free shouldn't trigger checkout, but fall back to plans surface anyway.
  if (plan === "free") {
    return `${ACCOUNT_APP_CLERK_PLANS}#plans`;
  }
  // Clerk-rail plans land on the dashboard's PricingCards section so the
  // CheckoutButton component handles plan selection + redirect.
  // accountpack uses ?addon=accountpack so PricingCards renders the focused
  // $6/mo add-on CheckoutButton above the regular plan grid.
  const url = new URL(ACCOUNT_APP_CLERK_PLANS);
  url.hash = "plans";
  if (plan === "accountpack") {
    url.searchParams.set("addon", "accountpack");
  } else {
    url.searchParams.set("plan", plan);
  }
  return url.toString();
}

/** Whop-rail checkout (Solo affiliate funnel). Retained for the Solo
 *  upgrade path; not currently wired from PLAN_CATALOG because Solo is
 *  affiliate-only today. Exposed for the affiliate-driven entry. */
export function whopSoloCheckoutUrl(): string {
  return ACCOUNT_APP_WHOP_CHECKOUT;
}

/* ─── Mock adapter (simulator / dev fallback) ─────────────────────── */

class MockBillingAdapter implements BillingAdapter {
  readonly isMock = true;
  private snapshot: BillingSnapshot;
  private listeners = new Set<(s: BillingSnapshot) => void>();

  constructor(initial: BillingSnapshot) { this.snapshot = initial; }
  getSnapshot(): BillingSnapshot { return this.snapshot; }
  setSnapshot(next: BillingSnapshot): void {
    this.snapshot = next;
    for (const l of this.listeners) l(next);
  }
  async startCheckout(planKey: PlanKey): Promise<CheckoutOutcome> {
    this.setSnapshot({ ...this.snapshot, state: "checkout_started", lastCheckoutFailed: false });
    await new Promise((r) => setTimeout(r, 100));
    this.setSnapshot({
      state: "active",
      currentPlan: planKey,
      source: "mock",
      lastCheckoutFailed: false,
    });
    return { ok: true, planKey };
  }
  subscribe(listener: (s: BillingSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}

/* ─── Real adapter (Me-backed · Clerk subscription via backend) ───── */

class MeBackedBillingAdapter implements BillingAdapter {
  readonly isMock = false;
  private snapshot: BillingSnapshot;
  private listeners = new Set<(s: BillingSnapshot) => void>();

  constructor(initial: BillingSnapshot) { this.snapshot = initial; }
  getSnapshot(): BillingSnapshot { return this.snapshot; }
  setSnapshot(next: BillingSnapshot): void {
    this.snapshot = next;
    for (const l of this.listeners) l(next);
  }
  async startCheckout(planKey: PlanKey): Promise<CheckoutOutcome> {
    // Real flow: redirect to account-app's checkout (Clerk-hosted).
    // The webhook back-channel updates /me; useMe re-fetches on focus
    // and the snapshot updates via this adapter's subscribe.
    this.setSnapshot({ ...this.snapshot, state: "checkout_started", lastCheckoutFailed: false });
    try {
      await openSmart(checkoutUrl(planKey));
      return { ok: true, planKey };
    } catch (err) {
      this.setSnapshot({ ...this.snapshot, state: "checkout_failed", lastCheckoutFailed: true });
      return { ok: false, planKey, error: err instanceof Error ? err.message : "checkout_open_failed" };
    }
  }
  subscribe(listener: (s: BillingSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}

/* ─── Singleton selection · real preferred · mock fallback ──────────
 *
 * v0.7.68 — simplified to break the infinite re-render loop that
 * crashed the app when AgencyPreviewBanner mounted. The prior version
 * had a useEffect that called `adapter.setSnapshot(initial)`; that
 * setter triggered `setSnap` via the listener pattern, which re-ran
 * the hook → useMemo re-computed `initial` (sometimes with a new
 * reference) → useEffect re-fired → infinite loop.
 *
 * New shape:
 *   - ONE module-scope adapter, picked at first hook call based on
 *     hasJwt() at that moment. Hot-swap removed — picking the right
 *     adapter on later /me transitions can be added back when there's
 *     a real-source signal worth swapping for.
 *   - Snapshot derivation is INSIDE the adapter, recomputed on
 *     every render of any subscriber via a small `recompute()` step
 *     in the hook. No useMemo on the snapshot · React's reconciliation
 *     handles same-value bails. */

function derivePlanKey(tier: string | null | undefined): PlanKey {
  return tierToPlanKey(typeof tier === "string" ? tier : null);
}

/* ─── Public hook · used by every UI surface ──────────────────────── */

let _adapter: BillingAdapter | null = null;

/**
 * Pure derived hook · no useState, no useEffect. Re-derives the
 * snapshot from /me + tier on every render. The adapter is a stable
 * module-singleton, so `billing.adapter.startCheckout(...)` is always
 * safe to call.
 *
 * Live state updates (e.g., user comes back from external checkout)
 * propagate naturally because useMe re-fetches /me and tier flips →
 * this hook re-derives a new snapshot.
 *
 * The earlier subscribe/setState pattern caused (a) an infinite
 * re-render loop that crashed the app via AgencyPreviewBanner, and
 * (b) added ~10s to every brand-consistency walk because every
 * consumer mount paid the subscribe + effect cost. Pure derivation
 * avoids both problems · the cost of NOT propagating local mock
 * setSnapshot calls is acceptable (mock is dev-only).
 */
export function useBillingState(): BillingSnapshot & {
  adapter: BillingAdapter;
} {
  const me = useMe();
  const tierCtx = useTierCaps();
  const loggedIn = hasJwt();
  const meSourceReal = me.source === "real-http" || me.source === "session-cache";

  const snapshot: BillingSnapshot = (() => {
    if (meSourceReal && me.snapshot) {
      const state = mapSubscriptionStatus(me.snapshot.subscriptionStatus, loggedIn);
      return {
        state,
        currentPlan: derivePlanKey(me.snapshot.effectiveTier),
        source: "real",
        lastCheckoutFailed: state === "checkout_failed",
      };
    }
    if (!loggedIn) {
      return { state: "free", currentPlan: "free", source: "mock", lastCheckoutFailed: false };
    }
    const planKey = derivePlanKey(tierCtx.tier);
    const state: BillingState = planKey === "free" ? "free" : "active";
    return { state, currentPlan: planKey, source: "mock", lastCheckoutFailed: false };
  })();

  // First-call picks the adapter and never swaps after. The MockBilling
  // case stays "mock" forever for that mount; reload picks up a real
  // adapter once /me has resolved.
  if (!_adapter) {
    _adapter = meSourceReal && me.snapshot
      ? new MeBackedBillingAdapter(snapshot)
      : new MockBillingAdapter(snapshot);
  }

  return { ...snapshot, adapter: _adapter };
}

// Test seam · lets unit tests reset the module singleton between cases.
// Not used in production code; safe no-op when undefined.
export function __resetBillingAdapterForTests(): void {
  _adapter = null;
}
