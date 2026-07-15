/**
 * Billing adapter boundary · 2026-06-23 monetisation pass.
 *
 * Architecture (post-Batch-2):
 *
 *   Whop ─→ backend webhook ─→ /me.subscription_status + paid_until
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
 *   Whop is the customer-facing payment rail. Clerk remains identity only.
 *   Whop plan changes propagate through:
 *      Whop → Standard Webhook-verified event → DB.users.subscription_status →
 *      /me response → useMe.snapshot.subscriptionStatus → adapter
 *      → BillingSnapshot.state.
 *
 *   For STARTING a checkout: desktop-2 redirects to account-app
 *   (`https://account.liquidclips.app/upgrade?plan=<plan>`) via the
 *   in-app browser handoff. account-app hosts the Whop-backed
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
import { openInApp } from "../openInApp";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type {
  BillingAdapter,
  BillingSnapshot,
  BillingState,
  CheckoutOutcome,
  PlanKey,
} from "./types";

/* ─── Backend subscription_status → BillingState mapping ──────────── */
/**
 * Time-aware mapping so "canceled" splits into "cancelled" (period not
 * yet elapsed · entitlement holds) vs "expired" (period elapsed) and
 * "trialing" surfaces as a distinct "trial" state so consumers can
 * render countdown copy.
 *
 * `paidUntil` is the ISO-8601 period end from `/me`. When absent we
 * treat as elapsed on the safe side (no free entitlement extension).
 */
export function mapSubscriptionStatus(
  status: string | null,
  hasActiveJwt: boolean,
  paidUntil: string | null,
): BillingState {
  if (!hasActiveJwt) return "free";
  if (!status) return "free";
  const s = status.toLowerCase();
  const now = Date.now();
  const periodEndMs = paidUntil ? Date.parse(paidUntil) : NaN;
  const periodElapsed = Number.isFinite(periodEndMs) ? periodEndMs <= now : true;
  // Backend uses two synonymous trial spellings: "trial" is the
  // default set at signup (models.py / desktop_auth.py) before any
  // Whop membership webhook has fired; "trialing" is set once
  // webhooks_whop.py confirms an actual Whop-tracked trial period.
  // Backend routes (sync.py, trial_convert.py, admin.py) already
  // treat both as equivalent — `in {"trial", "trialing"}` — so the
  // frontend must too, or every pre-Whop-connect signup (the most
  // common new-user state) hits the "unrecognized" fallback below.
  if (s === "trial" || s === "trialing") return "trial";
  if (s === "active") return "active";
  if (s === "past_due" || s === "unpaid") return "past_due";
  if (s === "canceled" || s === "cancelled") {
    return periodElapsed ? "expired" : "cancelled";
  }
  if (s === "incomplete" || s === "incomplete_expired") return "checkout_failed";
  // Unknown status string — treat as free + log via console.warn so it
  // surfaces in dev. NEVER silently upgrade.
  console.warn(`[billing] unrecognized subscription_status="${status}" · treating as free`);
  // 2026-07-13 · Post-RC1 · fire canonical `payment.mismatch` HqEvent
  // so HQ dashboards + Codex payment-lane classifiers see the drift.
  // This is the single "backend says X, we don't understand X"
  // signal — the highest-severity payment observability the runtime
  // has.
  void import("../hqEmit").then((h) => {
    h.emitHqEvent({
      category: "payment.mismatch",
      severity: "warn",
      topic: "billing.status.unrecognized",
      data: {
        received_status: status,
        treated_as: "free",
      },
    });
  }).catch(() => {
    /* HQ emit is best-effort */
  });
  return "free";
}

function tierToPlanKey(tier: string | null): PlanKey {
  if (tier === "agency") return "agency";
  if (tier === "growth") return "growth";
  if (tier === "pro")    return "pro";
  return "free";
}

/* ─── account-app Whop checkout URL ───────────────────────────────── */
const ACCOUNT_APP_WHOP_UPGRADE = "https://account.liquidclips.app/upgrade";
const ACCOUNT_APP_WHOP_CHECKOUT = "https://account.liquidclips.app/checkout";

function checkoutUrl(plan: PlanKey): string {
  // Free never charges. Send the user to the first paid Whop plan.
  const target = plan === "free" || plan === "accountpack" ? "pro" : plan;
  const url = new URL(ACCOUNT_APP_WHOP_UPGRADE);
  url.searchParams.set("plan", target);
  return url.toString();
}

/** Starter-offer checkout used by affiliate links. */
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
    if (sameSnapshot(this.snapshot, next)) return;
    this.snapshot = next;
    for (const l of this.listeners) l(next);
  }
  syncFromSource(next: BillingSnapshot): void { this.setSnapshot(next); }
  async startCheckout(planKey: PlanKey): Promise<CheckoutOutcome> {
    // LC-UI-P0-001 hardening: a mock adapter must NEVER silently report
    // success in an authenticated path — that's how the Agency upgrade CTA
    // returned {ok:true} without ever opening checkout. If a JWT is present
    // the caller should be on the real adapter; if it isn't, that's a
    // selection bug we want to surface, not paper over with a fake "active"
    // snapshot. Refuse with an explicit error so the toast/feedback path
    // upstream fires.
    if (hasJwt()) {
      this.setSnapshot({ ...this.snapshot, state: "checkout_failed", lastCheckoutFailed: true });
      return {
        ok: false,
        planKey,
        error: "mock_adapter_in_authenticated_path",
      };
    }
    this.setSnapshot({ ...this.snapshot, state: "checkout_started", lastCheckoutFailed: false });
    await new Promise((r) => setTimeout(r, 100));
    this.setSnapshot({
      state: "active",
      currentPlan: planKey,
      source: "mock",
      lastCheckoutFailed: false,
      trialEndsAt: null,
      periodEnd: null,
    });
    return { ok: true, planKey };
  }
  subscribe(listener: (s: BillingSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}

/* ─── Real adapter (Me-backed · Whop subscription via backend) ────── */

class MeBackedBillingAdapter implements BillingAdapter {
  readonly isMock = false;
  private snapshot: BillingSnapshot;
  private listeners = new Set<(s: BillingSnapshot) => void>();

  constructor(initial: BillingSnapshot) { this.snapshot = initial; }
  getSnapshot(): BillingSnapshot { return this.snapshot; }
  setSnapshot(next: BillingSnapshot): void {
    if (sameSnapshot(this.snapshot, next)) return;
    this.snapshot = next;
    for (const l of this.listeners) l(next);
  }
  syncFromSource(next: BillingSnapshot): void { this.setSnapshot(next); }
  async startCheckout(planKey: PlanKey): Promise<CheckoutOutcome> {
    // Real flow: redirect to account-app's Whop checkout.
    // The webhook back-channel updates /me; useMe re-fetches on focus
    // and the snapshot updates via this adapter's subscribe.
    this.setSnapshot({ ...this.snapshot, state: "checkout_started", lastCheckoutFailed: false });
    try {
      await openInApp(checkoutUrl(planKey), { intent: "read-only" });
      /* The browser-preview shell can mount the Browse overlay, but it
       * cannot create the native child webview that carries checkout.
       * Treat that as an explicit checkout-open failure instead of
       * reporting success merely because overlay state changed. */
      if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
        throw new Error("Checkout requires the packaged desktop browser.");
      }
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
 * LC-UI-P0-001 (2026-06-26) — the prior implementation cached ONE
 * adapter at first render. Because that first render almost always
 * predates the /me fetch resolving, the cache permanently latched to
 * MockBillingAdapter even after the user logged in, and Mock's
 * startCheckout returned {ok:true} without ever opening a checkout
 * URL. Result: silent Agency-upgrade CTA failure.
 *
 * New shape:
 *   - TWO stable module-scope singletons (`_realAdapter`, `_mockAdapter`).
 *     Both keep stable identity per category so React effects keyed off
 *     `billing.adapter` don't churn.
 *   - The hook selects between them per-render based on `loggedIn`
 *     (hasJwt()), which is synchronous and authoritative — no waiting
 *     on /me. Authenticated paths always use the real (opener-backed)
 *     adapter; unauthenticated dev preview uses mock.
 *   - Mock startCheckout refuses to silently succeed when a JWT is
 *     present (defence in depth — see MockBillingAdapter above).
 *
 * Snapshot derivation stays a pure recomputation per render — no
 * useState/useEffect/subscribe loop. The infinite-re-render bug that
 * v0.7.68 fixed is preserved.
 */

function derivePlanKey(tier: string | null | undefined): PlanKey {
  return tierToPlanKey(typeof tier === "string" ? tier : null);
}

/* ─── Public hook · used by every UI surface ──────────────────────── */

let _realAdapter: MeBackedBillingAdapter | null = null;
let _mockAdapter: MockBillingAdapter | null = null;

function sameSnapshot(a: BillingSnapshot, b: BillingSnapshot): boolean {
  return (
    a.state === b.state &&
    a.currentPlan === b.currentPlan &&
    a.source === b.source &&
    a.lastCheckoutFailed === b.lastCheckoutFailed &&
    a.trialEndsAt === b.trialEndsAt &&
    a.periodEnd === b.periodEnd
  );
}

export function useBillingState(): BillingSnapshot & {
  adapter: BillingAdapter;
} {
  const me = useMe();
  const tierCtx = useTierCaps();
  const loggedIn = hasJwt();
  const meSourceReal = me.source === "real-http" || me.source === "session-cache";

  const snapshot: BillingSnapshot = (() => {
    if (meSourceReal && me.snapshot) {
      const state = mapSubscriptionStatus(
        me.snapshot.subscriptionStatus,
        loggedIn,
        me.snapshot.paidUntil,
      );
      return {
        state,
        currentPlan: derivePlanKey(me.snapshot.effectiveTier),
        source: "real",
        lastCheckoutFailed: state === "checkout_failed",
        // Only surface trialEndsAt when the state is trial · elsewhere
        // consumers should treat it as null so the countdown copy path
        // doesn't accidentally render for non-trial users.
        trialEndsAt: state === "trial" ? me.snapshot.paidUntil : null,
        // periodEnd flows through for cancelled / expired / active
        // renewal date. Consumers gate their copy on state, not on
        // presence of this field.
        periodEnd: me.snapshot.paidUntil,
      };
    }
    if (!loggedIn) {
      return {
        state: "free",
        currentPlan: "free",
        source: "mock",
        lastCheckoutFailed: false,
        trialEndsAt: null,
        periodEnd: null,
      };
    }
    const planKey = derivePlanKey(tierCtx.tier);
    const state: BillingState = planKey === "free" ? "free" : "active";
    // Authenticated but /me hasn't resolved yet · snapshot source is "real"
    // because the user IS authenticated even if the snapshot is derived
    // from the tier fallback. The adapter selected below is the real one.
    return {
      state,
      currentPlan: planKey,
      source: "real",
      lastCheckoutFailed: false,
      trialEndsAt: null,
      periodEnd: null,
    };
  })();

  const adapter = loggedIn
    ? (_realAdapter ??= new MeBackedBillingAdapter(snapshot))
    : (_mockAdapter ??= new MockBillingAdapter(snapshot));

  const subscribe = useCallback(
    (listener: (next: BillingSnapshot) => void) => adapter.subscribe(listener),
    [adapter],
  );
  const getSnapshot = useCallback(() => adapter.getSnapshot(), [adapter]);
  const liveSnapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  /* Reconcile backend/tier changes into the stable adapter. Checkout state
   * changes remain live through useSyncExternalStore instead of disappearing
   * inside a private singleton that no component observes. */
  useEffect(() => {
    adapter.syncFromSource(snapshot);
  }, [
    adapter,
    snapshot.state,
    snapshot.currentPlan,
    snapshot.source,
    snapshot.lastCheckoutFailed,
  ]);

  return { ...liveSnapshot, adapter };
}

// Test seam · lets unit tests reset the module singletons between cases.
export function __resetBillingAdapterForTests(): void {
  _realAdapter = null;
  _mockAdapter = null;
}
