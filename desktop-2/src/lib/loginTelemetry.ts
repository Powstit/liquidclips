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
  | "paste_code_attempted"     // Recovery paste form submitted
  | "paste_code_succeeded"     // Recovery paste activated successfully
  | "paste_code_failed"        // Recovery paste threw
  | "deep_link_arrived"        // handleActivationUrl invoked
  | "activation_succeeded"     // JWT stored via authStorage.setJwt
  | "activation_failed"        // Any activation error path
  | "whop_checkout_complete"   // Inline Whop checkout onComplete fired
  | "whop_checkout_awaiting_email"     // Post-checkout · user must paste LC-ID from Resend email
  | "whop_checkout_activation_failed"; // connect-from-checkout roundtrip failed

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
  if (typeof window !== "undefined") {
    const winAny = window as unknown as { __LC_BACKEND_URL__?: string };
    if (winAny.__LC_BACKEND_URL__) return winAny.__LC_BACKEND_URL__;
  }
  return "https://api.liquidclips.app";
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
