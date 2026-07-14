/**
 * loginTelemetry · lightweight fire-and-forget POST for login-flow steps.
 *
 * Ships 2026-07-06. Every strategic step in the login funnel calls
 * `logLoginStep(step, ctx)` to record where users are + where they
 * fall off. The backend stores rows in `login_step_events`; a follow-up
 * sprint renders the funnel in HQ Admin.
 *
 * Design:
 *   - Fire-and-forget · never awaits · never throws
 *   - Anonymous by default · session_id is a per-boot uuid stored in
 *     localStorage so we can trace one user's funnel without needing
 *     an account
 *   - Pool-aware · uses the same failover the Watchdog does when
 *     Constellation has a multi-Railway pool
 *   - Zero blocking · a broken backend never blocks the user
 */

const STEP_ENDPOINT = "/telemetry/login-step";
const SESSION_ID_KEY = "lc:login-session-id";

export type LoginStep =
  | "login_screen_shown"      // WelcomeRoute mounted
  | "clipper_clicked"          // User picked the guest-clipper path
  | "agency_clicked"           // User picked agency + opened Whop checkout
  | "existing_user_clicked"    // User picked "Sign in — I have an LC-ID" (skip Whop)
  | "existing_user_cancelled"  // User backed out of existing-user path to lane picker
  | "paste_code_attempted"     // Recovery paste form submitted
  | "paste_code_succeeded"     // Recovery paste activated successfully
  | "paste_code_failed"        // Recovery paste threw
  | "deep_link_arrived"        // handleActivationUrl invoked
  | "activation_succeeded"     // JWT stored via authStorage.setJwt
  | "activation_failed"        // Any activation error path
  | "whop_checkout_complete"   // Inline Whop checkout onComplete fired
  | "whop_checkout_awaiting_email"     // Post-checkout · user must paste LC-ID from Resend email
  | "whop_checkout_activation_failed"  // connect-from-checkout roundtrip failed
  | "marquee_play_failed"      // Poster-first marquee video .play() rejected (404 · decode · autoplay block)
  // P0 first-run access (2026-07-08) · Clerk OTP is the primary sign-in path.
  | "clerk_send_code_attempted"      // Identifier submitted → signIn.create + prepareFirstFactor
  | "clerk_send_code_succeeded"      // Clerk accepted the identifier + queued OTP delivery
  | "clerk_send_code_failed"         // Clerk rejected the identifier / send call failed
  | "clerk_verify_attempted"         // 6-digit code submitted → attemptFirstFactor
  | "clerk_verify_failed"            // Wrong / expired code · user can retry
  | "clerk_exchange_succeeded"       // POST /auth/clerk/exchange returned an LC license JWT
  | "clerk_exchange_failed";         // Backend rejected the Clerk session token

function ensureSessionId(): string {
  if (typeof window === "undefined") return "anonymous";
  try {
    let sid = window.localStorage.getItem(SESSION_ID_KEY);
    if (!sid) {
      const rand = () => Math.random().toString(36).slice(2, 10);
      sid = `sess_${Date.now().toString(36)}_${rand()}${rand()}`;
      window.localStorage.setItem(SESSION_ID_KEY, sid);
    }
    return sid;
  } catch {
    return "anonymous";
  }
}

function backendUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env || {};
  return env.VITE_BACKEND_URL || "https://api.liquidclips.app";
}

function appVersion(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const winAny = window as unknown as { __LC_APP_VERSION__?: string };
  return winAny.__LC_APP_VERSION__;
}

let inflight = 0;
const INFLIGHT_CAP = 6;

export function logLoginStep(step: LoginStep, ctx?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  /* 2026-07-13 D1 residual · E2E transport gate. `logLoginStep` uses
   * `keepalive: true` so `pagehide`/`beforeunload` sends survive. That
   * same keepalive pool bypasses Playwright's `page.route` CDP hooks,
   * which caused (a) cosmetic CORS console errors against the real
   * `api.liquidclips.app` origin during signed-out flows and (b) a
   * "route.continue: Assertion error" when a spec-level catch-all
   * `page.route(..., r => r.continue())` raced these fetches. The
   * matching gate lives in `diagnosticLogger.ts::isE2ETransportDisabled`,
   * `useAuditableAction.ts`, and `TopHud.tsx::audit-tick`. Production
   * behavior preserved · `__LCOS_E2E__` is never set outside the
   * Playwright harness (see `tests/e2e/_auth-harness.ts`). */
  if (
    (window as unknown as { __LCOS_E2E__?: boolean }).__LCOS_E2E__ === true
  ) {
    return;
  }
  if (inflight >= INFLIGHT_CAP) return;
  inflight++;
  const payload = {
    step,
    session_id: ensureSessionId(),
    ts: new Date().toISOString(),
    app_version: appVersion(),
    ctx: ctx ?? {},
  };
  try {
    void fetch(`${backendUrl()}${STEP_ENDPOINT}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    })
      .catch(() => {
        /* never blocks */
      })
      .finally(() => {
        inflight--;
      });
  } catch {
    inflight--;
  }
}
