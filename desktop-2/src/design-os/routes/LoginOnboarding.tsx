/**
 * LoginOnboarding · P1-1E · Beta-honest activation surface
 *
 * Replaces the Phase 5B SimPage placeholder. Renders the smallest UI that
 * lets a real beta user activate the desktop using the headless activation
 * primitives shipped in P1-1D.
 *
 * Hard rules honored (locked):
 *   - No native Keychain, no Rust commands, no 401 self-heal.
 *   - No bounty:create OAuth, no new Whop scopes.
 *   - No Settings UI, no billing, no tier-gating routes here.
 *   - No in-app auth webview · system browser is the v1 door.
 *   - No HQ bridge verbs.
 *
 * Reuses:
 *   - useActivation()   (P1-1D-a state machine)
 *   - hasJwt()          (P1-1B storage primitive)
 *   - openSmart()       (existing Tauri-shell + window.open fallback)
 *
 * Activation URL chosen: `https://liquidclips.app/connect-desktop?challenge=<nonce>`
 *   mirrors the proven legacy desktop activation entry. The query param
 *   carries the nonce minted by useActivation().beginActivation(). The
 *   page on account-app handles Clerk sign-in server-side and emits the
 *   `liquidclips://activate?token=…&challenge=…` deep-link back to the
 *   desktop · which deepLinkBoot.ts (P1-1D-b) catches at the app root.
 */

import { useEffect, useState } from "react";
import { motion as fm } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useActivation, activateWithToken, handleActivationUrl } from "../../lib/activation";
import { hasJwt, getAuthSource } from "../../lib/authStorage";
import { openInApp } from "../../lib/openInApp";
import { DesignOSAppShell } from "../components/AppShell";
import { EngineSessionProvider, useEngineSession } from "../state/useEngineSession";
import { presets } from "../motion";
import "./SimPage.css";
import "./LoginOnboarding.css";

/** Account-app activation entry · proven legacy URL.
 *  Override via VITE_ACTIVATION_URL if a beta env needs it. */
function activationBaseUrl(): string {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const v = (import.meta as any).env?.VITE_ACTIVATION_URL as string | undefined;
    if (typeof v === "string" && v.length > 0) return v;
  } catch { /* noop */ }
  return "https://liquidclips.app/connect-desktop";
}

function buildActivationUrl(challenge: string): string {
  const base = activationBaseUrl();
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}challenge=${encodeURIComponent(challenge)}`;
}

/** Backend base URL for the in-app auth panel. Mirrors the resolver in
 *  activation.ts + wallet.ts so a beta env override lands consistently. */
function backendUrlFor(): string {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const v = (import.meta as any).env?.VITE_BACKEND_URL as string | undefined;
    if (typeof v === "string" && v.length > 0) return v;
  } catch { /* noop */ }
  return "https://api.liquidclips.app";
}

function LoginOnboardingBody() {
  /* P1-2B-c-i · routed through DesignOSAppShell + the boot-sequence
   * world so the activation surface feels like Liquid Clips, not a
   * generic dark form. Kade lands center · matches the "boot moment"
   * choreography. Session is provided by the outer Route entry so
   * useEngineSession resolves correctly. */
  const session = useEngineSession();
  const activation = useActivation();
  // Captured at mount only · the deep-link path flips useActivation state
  // when it lands · so we don't need to re-poll hasJwt() on every render.
  const [boundOnMount] = useState<boolean>(() => hasJwt());
  const [openError, setOpenError] = useState<string | null>(null);

  const authSource = getAuthSource();

  // If a user already had a JWT at mount time AND the in-session activation
  // machine is still idle (no flow started), surface "already activated".
  const alreadyActivated = boundOnMount && activation.status === "idle";

  const handleStartActivation = async () => {
    setOpenError(null);
    const challenge = activation.beginActivation();
    const url = buildActivationUrl(challenge);
    try {
      await openInApp(url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setOpenError(msg);
      // Don't reset the state machine · the user can complete activation
      // by pasting the URL into a browser by hand. Nonce is held.
    }
  };

  // v2.2.13 · in-app auth overlay. Opens the Whop OAuth flow inside a
  // native Tauri child webview so the user never leaves the app. When
  // the backend redirects to liquidclips://activate?token=…, Rust's
  // on_navigation hook (auth_panel.rs) catches the URL BEFORE it hits
  // the OS protocol handler and emits `activation:token_intercept`.
  // A useEffect below listens for that event and pipes the token into
  // activateWithToken() · closes the panel · flips signed-in.
  const [inAppOpen, setInAppOpen] = useState(false);
  const [inAppFallback, setInAppFallback] = useState(false);
  const [inAppError, setInAppError] = useState<string | null>(null);

  const openInAppAuth = async (useFallbackUa = false) => {
    setOpenError(null);
    setInAppError(null);
    // Mint the challenge once per attempt (retry generates a fresh one).
    const challenge = activation.beginActivation();
    // Backend Whop OAuth start endpoint · issues the authorize redirect
    // to whop.com/api/v1/oauth/authorize with our client_id + the
    // challenge threaded as the OAuth `state`. On success Whop calls
    // /auth/whop/callback which mints the JWT and redirects to
    // liquidclips://activate?token=<jwt>&challenge=<state>&source=whop.
    const backend = backendUrlFor();
    const url = `${backend}/auth/whop/start?challenge=${encodeURIComponent(challenge)}`;

    // Bounds · center the auth panel over the viewport at 480×720. React
    // measures via window sizes (Tauri passes logical coords). The
    // panel is layered above the main app content · the "close" button
    // in the fallback UI destroys it.
    const w = Math.min(480, window.innerWidth - 40);
    const h = Math.min(720, window.innerHeight - 80);
    const x = Math.max(20, (window.innerWidth - w) / 2);
    const y = Math.max(40, (window.innerHeight - h) / 2);

    try {
      await invoke("open_auth_panel", {
        url,
        x,
        y,
        width: w,
        height: h,
        fallbackUa: useFallbackUa,
      });
      setInAppOpen(true);
      setInAppFallback(useFallbackUa);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setInAppError(`Couldn't open the in-app sign-in · ${msg}`);
    }
  };

  const closeInAppAuth = async () => {
    try {
      await invoke("close_auth_panel");
    } catch { /* silent · panel may already be closed */ }
    setInAppOpen(false);
    setInAppFallback(false);
  };

  // Retry with Safari-shaped UA when Whop's page refuses the default
  // WKWebView identity. This keeps auth 100% in-app · no system browser
  // handoff · matches Daniel's constraint.
  const retryWithSafariUa = () => {
    void openInAppAuth(true);
  };

  // Listen for the Rust-side token intercept. The event fires the moment
  // the auth webview tries to navigate to liquidclips://activate?token=…
  // — before the OS deep-link handler runs. We route the token through
  // the same activateWithToken() path that the manual paste input uses,
  // so post-mint /sync + /me orchestration is identical.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<{ token?: string; url?: string; source?: string }>(
      "activation:token_intercept",
      (evt) => {
        const payload = evt.payload || {};
        const token = payload.token || "";
        const full = payload.url || "";
        void closeInAppAuth();
        if (full.startsWith("liquidclips://") || full.startsWith("junior://")) {
          void handleActivationUrl(full);
        } else if (token) {
          void activateWithToken(token);
        } else {
          setInAppError("Sign-in returned no activation token · try again.");
        }
      },
    )
      .then((fn) => { unlisten = fn; })
      .catch(() => { /* Tauri event bus unavailable in browser preview */ });
    return () => { unlisten?.(); };
  }, []);

  const handleContinue = () => {
    if (typeof window === "undefined") return;
    window.location.hash = "#/home";
  };

  const handleRetry = () => {
    activation.clearActivation();
    setOpenError(null);
    setInAppError(null);
  };

  return (
    <DesignOSAppShell
      world="boot-sequence"
      route="login"
      defaultKade={session.kade ?? "idle"}
      kadePlacement="center"
    >
      <fm.div
        className="sim-stage"
        variants={presets.routeEnter}
        initial="initial"
        animate="animate"
      >
        <fm.div
          className="sim-welcome"
          data-kade-anchor
          variants={presets.staggerContainer}
          initial="initial"
          animate="animate"
        >
          <fm.span className="sim-eb" variants={presets.staggerItem}>
            Boot sequence
          </fm.span>
          <fm.h1 className="sim-h1" variants={presets.staggerItem}>
            Activate Liquid Clips
          </fm.h1>
          <fm.p className="sim-sub" variants={presets.staggerItem}>
            Sign in once · return to the app automatically.
          </fm.p>
        </fm.div>

        {/* Existing activation card body preserved · only the page-level
         *  wrapper changed. All state blocks + handlers + activation
         *  primitives identical to P1-1E. */}
        <div className="lc-login">
          <div className="lc-login-card">
            {alreadyActivated ? (
              <AlreadyActivatedBlock onContinue={handleContinue} authSource={authSource} />
            ) : (
              <ActivationStateBlock
                status={activation.status}
                error={activation.error}
                tier={activation.tier}
                email={activation.email}
                degraded={activation.degraded}
                lastTokenSource={activation.lastTokenSource}
                openError={openError}
                onStart={handleStartActivation}
                onInAppStart={() => void openInAppAuth(false)}
                onContinue={handleContinue}
                onRetry={handleRetry}
              />
            )}

            {inAppOpen ? (
              <div
                className="lc-login-inapp-chrome"
                data-testid="login-inapp-chrome"
                role="status"
                aria-live="polite"
              >
                <span className="lc-login-inapp-eyebrow">
                  Signing you in…
                </span>
                <p className="lc-login-inapp-help">
                  Complete sign-in in the panel above. The app catches your
                  activation token automatically · no browser bounce.
                </p>
                <div className="lc-login-inapp-actions">
                  {!inAppFallback ? (
                    <button
                      type="button"
                      className="lc-login-cta lc-login-cta-quiet"
                      onClick={retryWithSafariUa}
                      data-testid="login-inapp-retry-ua"
                    >
                      Sign-in won't load? Retry
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="lc-login-cta lc-login-cta-quiet"
                    onClick={() => void closeInAppAuth()}
                    data-testid="login-inapp-close"
                  >
                    Cancel
                  </button>
                </div>
                {inAppError ? (
                  <p className="lc-login-inapp-error">{inAppError}</p>
                ) : null}
              </div>
            ) : null}

            <p className="lc-login-foot">
              Sign in stays inside the app · 100% integrated · no browser
              switching · no popup blocker risk.
            </p>
          </div>
        </div>
      </fm.div>
    </DesignOSAppShell>
  );
}

/** Activation route entry · provides the Engine session so the inner
 *  body can render through DesignOSAppShell on the boot-sequence world.
 *  Mirrors the Channels / Schedule / Settings pattern. */
export function LoginOnboardingRoute() {
  return (
    <EngineSessionProvider resetOnRouteEnter>
      <LoginOnboardingBody />
    </EngineSessionProvider>
  );
}

/* ─── State blocks ──────────────────────────────────────────────────── */

function ActivationStateBlock(props: {
  status: ReturnType<typeof useActivation>["status"];
  error: string | null;
  tier: string | null;
  email: string | null;
  degraded: boolean;
  lastTokenSource: ReturnType<typeof useActivation>["lastTokenSource"];
  openError: string | null;
  onStart: () => void;
  onInAppStart?: () => void;
  onContinue: () => void;
  onRetry: () => void;
}) {
  const { status, error, tier, email, degraded, lastTokenSource, openError, onStart, onInAppStart, onContinue, onRetry } = props;

  if (status === "activated") {
    return (
      <div className="lc-login-status is-activated" data-testid="login-state-activated" data-activation-status="activated">
        <span className="lc-login-state-pill is-activated" data-testid="login-state-pill">
          {degraded ? "Activated · sync pending" : "Activated"}
        </span>
        {email && <p className="lc-login-account">{email}</p>}
        {tier && <span className="lc-login-tier-pill">{tier.toUpperCase()}</span>}
        {lastTokenSource && lastTokenSource !== "unknown" && (
          <span className="lc-login-source">
            via {lastTokenSource === "whop" ? "Whop" : "Email"}
          </span>
        )}
        {degraded && (
          <p className="lc-login-degraded">
            We saved your access · we couldn't refresh account state. You can
            continue · the app will retry in the background.
          </p>
        )}
        <button
          type="button"
          className="lc-login-cta lc-login-cta-primary"
          data-testid="login-continue-button"
          onClick={onContinue}
        >
          Continue to Liquid Clips →
        </button>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="lc-login-status is-failed" data-testid="login-state-failed" data-activation-status="failed">
        <span className="lc-login-state-pill is-failed" data-testid="login-state-pill">Couldn't activate</span>
        <p className="lc-login-error" data-testid="login-error">{error ?? "Activation failed."}</p>
        <button
          type="button"
          className="lc-login-cta lc-login-cta-primary"
          data-testid="login-retry-button"
          onClick={onRetry}
        >
          Try again
        </button>
      </div>
    );
  }

  if (status === "activating") {
    return (
      <div className="lc-login-status is-activating" data-testid="login-state-activating" data-activation-status="activating">
        <span className="lc-login-state-pill is-activating" data-testid="login-state-pill">Activating…</span>
        <div className="lc-login-spinner" aria-hidden="true" />
        <p className="lc-login-step">Validating the deep-link.</p>
      </div>
    );
  }

  if (status === "waiting") {
    return (
      <div className="lc-login-status is-waiting" data-testid="login-state-waiting" data-activation-status="waiting">
        <span className="lc-login-state-pill is-waiting" data-testid="login-state-pill">Waiting for sign-in</span>
        <p className="lc-login-step">
          Finish signing in on the web · this app will pick up the activation
          automatically when the browser returns.
        </p>
        {openError && (
          <p className="lc-login-error">
            Couldn't open the browser · {openError}. Open the link manually
            then return here.
          </p>
        )}
        <div className="lc-login-cta-row">
          <button
            type="button"
            className="lc-login-cta lc-login-cta-secondary"
            data-testid="login-cancel-button"
            onClick={onRetry}
          >
            Cancel · start over
          </button>
          <button
            type="button"
            className="lc-login-cta lc-login-cta-quiet"
            onClick={onStart}
          >
            Re-open browser
          </button>
        </div>
      </div>
    );
  }

  // status === "idle" · the default · no JWT, no flow started.
  // v2.2.13 · primary path is in-app Whop OAuth (no browser bounce).
  // "Use system browser instead" is kept for the rare case a user
  // wants the classic Clerk/system-browser flow.
  return (
    <div className="lc-login-status is-idle" data-testid="login-state-idle" data-activation-status="idle">
      <ol className="lc-login-steps">
        <li><strong>1 ·</strong> Click "Sign in with Whop"</li>
        <li><strong>2 ·</strong> Sign in right here in the app</li>
        <li><strong>3 ·</strong> You're in — no browser bounce</li>
      </ol>
      {onInAppStart ? (
        <button
          type="button"
          className="lc-login-cta lc-login-cta-primary"
          data-testid="login-inapp-button"
          onClick={onInAppStart}
        >
          Sign in with Whop
        </button>
      ) : null}
      <button
        type="button"
        className={`lc-login-cta ${onInAppStart ? "lc-login-cta-quiet" : "lc-login-cta-primary"}`}
        data-testid="login-start-button"
        onClick={onStart}
      >
        {onInAppStart ? "Use system browser instead" : "Start activation"}
      </button>
      <ManualActivationCard />
    </div>
  );
}

/** v2.2.11 · pop-up-blocker fallback. When the browser swallows the
 *  liquidclips:// deep-link (Safari + some Chrome configs), the Whop
 *  callback page shows a "Copy Activation Code" button. The user
 *  pastes that token here to complete activation manually. Accepts
 *  either the raw JWT or the full `liquidclips://activate?…` URL — we
 *  branch on the prefix so both forms work without educating the user. */
function ManualActivationCard(): JSX.Element {
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const onSubmit = async () => {
    const value = token.trim();
    if (!value || submitting) return;
    setSubmitting(true);
    setHint(null);
    try {
      if (value.startsWith("liquidclips://")) {
        await handleActivationUrl(value);
      } else {
        await activateWithToken(value);
      }
      setToken("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setHint(`Couldn't activate · ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="lc-login-manual"
      data-testid="login-manual-activation"
    >
      <span className="lc-login-manual-label">Enter Manual Activation Code</span>
      <p className="lc-login-manual-help">
        Mac blocked the automatic handoff? Paste the activation code from the
        Whop login page and we'll finish signing you in.
      </p>
      <textarea
        className="lc-login-manual-input"
        data-testid="login-manual-activation-input"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="liquidclips://activate?token=… · or the raw token"
        rows={3}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        disabled={submitting}
      />
      <button
        type="button"
        className="lc-login-cta lc-login-cta-secondary"
        data-testid="login-manual-activation-submit"
        onClick={() => void onSubmit()}
        disabled={submitting || token.trim().length === 0}
      >
        {submitting ? "Activating…" : "Activate with code"}
      </button>
      {hint ? (
        <p
          className="lc-login-manual-error"
          data-testid="login-manual-activation-error"
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function AlreadyActivatedBlock(props: {
  onContinue: () => void;
  authSource: ReturnType<typeof getAuthSource>;
}) {
  const { onContinue, authSource } = props;
  return (
    <div className="lc-login-status is-already" data-testid="login-state-already-activated" data-activation-status="already-activated">
      <span className="lc-login-state-pill is-activated" data-testid="login-state-pill">Already activated</span>
      <p className="lc-login-step">
        We found a saved Liquid Clips license. You can keep working.
      </p>
      <span className="lc-login-source">
        storage · {authSource === "tauri-keychain" ? "macOS Keychain" : "browser"}
      </span>
      <button
        type="button"
        className="lc-login-cta lc-login-cta-primary"
        data-testid="login-continue-button"
        onClick={onContinue}
      >
        Continue to Liquid Clips →
      </button>
    </div>
  );
}
