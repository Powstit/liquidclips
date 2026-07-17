/**
 * Whop checkout URLs · single source of truth.
 *
 * The whole sign-in / paywall funnel goes through Whop's hosted
 * checkout page. Whop is the payment rail, the identity provider
 * (Google / Apple / email hosted by Whop), the card-on-file
 * storage-of-record, and the receipt/tax invoice generator.
 *
 * Flow (J3 STRAND 3 fix · 2026-07-05):
 *   1. User clicks any "Get started free" / "Sign in" / "Unlock" CTA
 *   2. openWhopFounderCheckout() routes through `openSmart`, which
 *      calls Tauri's `tauri-plugin-opener` — a NATIVE OS call that
 *      opens the URL in the user's default browser (Safari / Chrome /
 *      Arc), NOT in the in-app BrowseOverlay webview.
 *
 *      Why not the in-app overlay: when Whop redirects to
 *      `liquidclips://activate?token=<jwt>` after checkout, that
 *      redirect fires INSIDE the overlay webview and gets swallowed
 *      — the custom-scheme URL never reaches the OS deep-link
 *      handler, so activation silently no-ops. Opening in the real
 *      OS browser routes the deep-link through the OS handler
 *      correctly. Bonus: no popup blockers (native call, not
 *      `window.open`).
 *   3. User enters email + card in their default browser (no charge · $0 trial)
 *   4. Whop redirects to the success URL configured on the plan:
 *      https://api.jnremployee.com/whop/checkout-success
 *   5. Backend mints a license JWT and 302s to
 *      liquidclips://activate?token=<jwt>
 *   6. OS hands the custom-scheme URL to the Liquid Clips Rust
 *      deep-link handler, which emits an event
 *   7. activation.ts handleActivationUrl() stores the JWT
 *   8. AuthGate re-checks hasJwt() and the TopHud "Sign in" pill
 *      is replaced by the user avatar / tier chip
 *
 * Feature-gate triggers (remove watermark, publish, agency features)
 * open the SAME URL — Whop's own upgrade UX handles "trial · card
 * on file · charge me now" via `end_free_trial` (see backend
 * routes/trial_convert.py).
 */

import { openSmart } from "./openSmart";
import { bus } from "../design-os/bridge";
import { beginActivation } from "./activation";

/**
 * Founder Access plan — the sole paid tier for new users.
 * 2026-07-05 (ship-day walk fix) · rotated from `plan_svbzoXoT4oj6b`
 * (had a 365-day trial with card capture at signup — wrong model) to
 * `plan_NMKvKj8SVVKsY`: $99.99/mo · immediate charge · no trial · cap
 * 12,000. In-app 10-clip starter pass handles the "free trial" — Whop
 * checkout only fires when a user attempts clip 11 (or watermark
 * removal / publish gate). This matches Daniel's mental model: card
 * captured at Whop only when the value is delivered, not at signup.
 * Prior plans are grandfathered in FOUNDER_PLAN_IDS so any in-flight
 * checkouts still resolve to the founder tier.
 */
export const WHOP_FOUNDER_PLAN_ID = "plan_NMKvKj8SVVKsY";

/** Public Whop checkout URL for the Founder Access $0-trial plan. */
export const WHOP_FOUNDER_CHECKOUT_URL = `https://whop.com/checkout/${WHOP_FOUNDER_PLAN_ID}`;

// ── 2026-07-17 · Liquid Studio ladder · analysis-hours billing pivot ──
//
// Additive · WHOP_FOUNDER_PLAN_ID stays for grandfathered paywall
// triggers + legacy ransom-paywall entry points. New Studio checkouts
// route through these two IDs.
//
//   Studio            → plan_dhssNse4FfPlI · $99.99/mo · 100h hosted
//                       AI included · legacy "Growth" plan renamed to
//                       "Liquid Studio" in Whop dashboard.
//   Studio Unlimited  → plan_Yyh9NoYq8v6b6 · $199/mo · BYOK OpenAI ·
//                       no Liquid Clips hour cap. Env-driven so the
//                       plan can stay hidden until Phase C is ready
//                       (fail-closed default: `null`).

export const WHOP_STUDIO_PLAN_ID: string =
  (typeof import.meta !== "undefined" &&
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_WHOP_STUDIO_PLAN_ID) ||
  "plan_dhssNse4FfPlI";

export const WHOP_STUDIO_UNLIMITED_PLAN_ID: string | null = (() => {
  const raw =
    typeof import.meta !== "undefined" &&
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_WHOP_STUDIO_UNLIMITED_PLAN_ID;
  return raw && raw.trim() ? raw.trim() : null;
})();

/**
 * Ransom-paywall Gate 1 · Whop authorization · $1 one_time · card required.
 *
 * LOCKED 2026-07-06 (Daniel). Shape:
 *   - `plan_type: "one_time"` · `initial_price: 1.00` · card required today
 *   - Whop confirmed via 4-shape API probe that **no $0 plan can force card
 *     entry**. Minimum floor is $1.00 across both one_time AND renewal
 *     plans. This is the min-viable Whop-native card-on-file trust wall.
 *   - User pays $1 at LoginScreen · card stored on Whop customer profile ·
 *     every subsequent WhopCheckoutEmbed mount shows saved-card one-click
 *     confirm.
 *   - Gate 2 (Agency $99.99/mo · plan_NMKvKj8SVVKsY) mounts a fresh
 *     WhopCheckoutEmbed at every ransom-paywall trigger — user hits
 *     one-click Confirm with •••• 4242 · $99.99 charges · tier flips to
 *     Agency via webhooks_whop.py:326 (FOUNDER_PLAN_IDS → "autopilot" →
 *     agency alias in features.py).
 *   - Both plans may be active simultaneously; Whop honors Gate 2's
 *     Agency tier as effective per Daniel's "overlap OK" 2026-07-06 rule.
 *
 * Deprecated shapes (do NOT resurrect):
 *   - `plan_jVn4WVTEA0YNf` (one_time $0) — Whop treats as free enrollment,
 *     card entry is silently skipped regardless of `card_payments: true`
 *     or explicit exclusion of every non-card payment method.
 *   - `plan_1jtkUjUmHbaC3` ($0 today + $1/365d renewal) — Max's earlier
 *     attempt · works but delayed-charge surprise a year later.
 *   - `plan_QkO3rm1uCTUF8` (one_time $0 + all non-card methods excluded) —
 *     scoping probe; Whop STILL returned `accepted_payment_methods:["free"]`.
 */
export const WHOP_AUTHORIZATION_PLAN_ID = "plan_SMaXhQLXpSOaH";
export const WHOP_AUTHORIZATION_CHECKOUT_URL = `https://whop.com/checkout/${WHOP_AUTHORIZATION_PLAN_ID}`;

/** Deprecated aliases · retained one release for import-site migration. */
export const FREE_TIER_PLAN_ID = WHOP_AUTHORIZATION_PLAN_ID;
export const FREE_TIER_CHECKOUT_URL = WHOP_AUTHORIZATION_CHECKOUT_URL;
export const FREE_WITH_CARD_PLAN_ID = WHOP_AUTHORIZATION_PLAN_ID;
export const FREE_WITH_CARD_CHECKOUT_URL = WHOP_AUTHORIZATION_CHECKOUT_URL;

/**
 * QA test plan · $2/mo · hidden on Whop (direct-link only).
 * Used for internal end-to-end walk-throughs so we exercise the real
 * payment rail without burning a Founder seat. Not shown in any
 * user-facing UI. Env-gated to LIQUIDCLIPS_QA=1 in dev/QA builds.
 */
export const WHOP_QA_TEST_PLAN_ID = "plan_kx90QwXvszCI7";
export const WHOP_QA_TEST_CHECKOUT_URL = `https://whop.com/checkout/${WHOP_QA_TEST_PLAN_ID}`;

/**
 * QA-mode swap · when active, every openWhopFounderCheckout call routes
 * to the $2 test plan instead of the $99.99 Founder plan. Never persists
 * server-side · never affects other users · only the local machine that
 * flipped the flag. Two ways to enable:
 *   1. Runtime · load the app with `?qa=1` on any window URL. The URL
 *      handler below sets `lc:qa-mode=1` in localStorage and reloads.
 *   2. Build-time · set env var `LIQUIDCLIPS_QA=1`.
 * Two ways to disable: `?qa=0` on the URL, or clear localStorage.
 */
export const LC_QA_MODE_KEY = "lc:qa-mode";

function readQaModeUrlParam(): "1" | "0" | null {
  if (typeof window === "undefined") return null;
  try {
    const q = new URLSearchParams(window.location.search).get("qa");
    if (q === "1") return "1";
    if (q === "0") return "0";
    return null;
  } catch {
    return null;
  }
}

export function isQaModeActive(): boolean {
  if (typeof window === "undefined") return false;
  // Env-var short-circuit (build-time enable).
  // `import.meta.env` is Vite-only; guard the read so tests / SSR don't blow up.
  try {
    const env = (import.meta as { env?: Record<string, string | undefined> }).env;
    if (env?.LIQUIDCLIPS_QA === "1" || env?.VITE_LIQUIDCLIPS_QA === "1") return true;
  } catch {
    /* not in Vite runtime */
  }
  try {
    return window.localStorage.getItem(LC_QA_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Idempotently syncs the `?qa=1|0` URL param into localStorage on boot. */
export function initQaMode(): void {
  const param = readQaModeUrlParam();
  if (param == null) return;
  try {
    if (param === "1") window.localStorage.setItem(LC_QA_MODE_KEY, "1");
    else window.localStorage.removeItem(LC_QA_MODE_KEY);
  } catch {
    /* private browsing / quota — non-fatal */
  }
}

/**
 * Resolves the Founder checkout URL for the current session.
 * QA-mode swaps in the $2 test plan so we can exercise the real Whop
 * rail without burning a Founder seat.
 */
export function resolveWhopFounderCheckoutUrl(): string {
  return isQaModeActive() ? WHOP_QA_TEST_CHECKOUT_URL : WHOP_FOUNDER_CHECKOUT_URL;
}

/**
 * Open Whop's hosted checkout in the user's default OS browser.
 *
 * J3 STRAND 3 fix · routes through `openSmart` (Tauri's
 * `tauri-plugin-opener`) so the URL opens NATIVELY in Safari /
 * Chrome / Arc — not in the in-app BrowseOverlay webview. This is
 * required so Whop's post-checkout redirect to
 * `liquidclips://activate?token=<jwt>` reaches the OS deep-link
 * handler; the overlay webview swallows custom-scheme redirects.
 *
 * If the native opener call throws (extremely rare — plugin
 * missing / capability scope regression), we fall back to a toast
 * that carries the URL so the user can paste it into a browser
 * manually. No silent dead-clicks.
 */
export async function openWhopFounderCheckout(): Promise<void> {
  const url = resolveWhopFounderCheckoutUrl();
  try {
    await openSmart(url);
  } catch (e) {
    // openSmart routes https URLs through opener plugin's openUrl;
    // if that plugin call rejects, surface the URL so the user has
    // a recovery path instead of a silent dead button.
    // eslint-disable-next-line no-console
    console.warn("[whopCheckout] openSmart failed:", e);
    bus.emit("toast", {
      kind: "warning",
      title: "Couldn't open Whop sign-in",
      body: `Please visit ${url} to sign in.`,
      ttl: 12000,
    });
  }
}

/** account-app bridge that shows BOTH sign-in AND sign-up options. */
export const CONNECT_DESKTOP_BRIDGE_BASE = "https://account.liquidclips.app/connect-desktop";

/**
 * Open the sign-in-or-sign-up bridge on account.liquidclips.app.
 *
 * 2026-07-05 · ship-day walk fix · The previous behaviour (direct
 * Whop checkout URL) assumed the user was a NEW buyer and always
 * showed a signup+checkout page. Existing users had no path to
 * sign in with credentials they already had.
 *
 * The account-app /connect-desktop route renders THREE options:
 *   1. Clerk `<SignIn>` widget — for users who already have a
 *      Liquid Clips account (email + password / OAuth).
 *   2. "Continue with Whop" button (behind NEXT_PUBLIC_WHOP_SIGNIN_ENABLED)
 *      — for users who bought via a Whop creator link and want to
 *      resume their existing membership.
 *   3. "Get a membership" WhopBanner — for brand-new buyers who
 *      land here without a membership yet.
 *
 * All three paths return via the desktop deep-link `liquidclips://
 * activate?token=<jwt>&challenge=<nonce>` and the challenge check
 * inside activation.ts keeps the round-trip authenticated.
 */
export async function openSignInOrSignUpBridge(): Promise<void> {
  const challenge = beginActivation();
  const url = `${CONNECT_DESKTOP_BRIDGE_BASE}?challenge=${encodeURIComponent(challenge)}`;
  try {
    await openSmart(url);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[whopCheckout] openSmart failed:", e);
    bus.emit("toast", {
      kind: "warning",
      title: "Couldn't open the sign-in page",
      body: `Please visit ${CONNECT_DESKTOP_BRIDGE_BASE} to sign in.`,
      ttl: 12000,
    });
  }
}
