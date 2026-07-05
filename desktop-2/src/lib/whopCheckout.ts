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

/**
 * QA test plan · $2/mo · hidden on Whop (direct-link only).
 * Used for internal end-to-end walk-throughs so we exercise the real
 * payment rail without burning a Founder seat. Not shown in any
 * user-facing UI. Env-gated to LIQUIDCLIPS_QA=1 in dev/QA builds.
 */
export const WHOP_QA_TEST_PLAN_ID = "plan_kx90QwXvszCI7";
export const WHOP_QA_TEST_CHECKOUT_URL = `https://whop.com/checkout/${WHOP_QA_TEST_PLAN_ID}`;

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
  try {
    await openSmart(WHOP_FOUNDER_CHECKOUT_URL);
  } catch (e) {
    // openSmart routes https URLs through opener plugin's openUrl;
    // if that plugin call rejects, surface the URL so the user has
    // a recovery path instead of a silent dead button.
    // eslint-disable-next-line no-console
    console.warn("[whopCheckout] openSmart failed:", e);
    bus.emit("toast", {
      kind: "warning",
      title: "Couldn't open Whop sign-in",
      body: `Please visit ${WHOP_FOUNDER_CHECKOUT_URL} to sign in.`,
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
