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

import { useState } from "react";
import { motion as fm } from "framer-motion";
import { useActivation } from "../../lib/activation";
import { hasJwt, getAuthSource } from "../../lib/authStorage";
import { openSmart } from "../../lib/openSmart";
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
      await openSmart(url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setOpenError(msg);
      // Don't reset the state machine · the user can complete activation
      // by pasting the URL into a browser by hand. Nonce is held.
    }
  };

  const handleContinue = () => {
    if (typeof window === "undefined") return;
    window.location.hash = "#/home";
  };

  const handleRetry = () => {
    activation.clearActivation();
    setOpenError(null);
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
                onContinue={handleContinue}
                onRetry={handleRetry}
              />
            )}

            <p className="lc-login-foot">
              Activation opens your default browser. The app waits up to 5 minutes
              for the return.
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
  onContinue: () => void;
  onRetry: () => void;
}) {
  const { status, error, tier, email, degraded, lastTokenSource, openError, onStart, onContinue, onRetry } = props;

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
  return (
    <div className="lc-login-status is-idle" data-testid="login-state-idle" data-activation-status="idle">
      <ol className="lc-login-steps">
        <li><strong>1 ·</strong> Click "Start activation"</li>
        <li><strong>2 ·</strong> Sign in on the web</li>
        <li><strong>3 ·</strong> Browser returns to this app</li>
        <li><strong>4 ·</strong> You're in</li>
      </ol>
      <button
        type="button"
        className="lc-login-cta lc-login-cta-primary"
        data-testid="login-start-button"
        onClick={onStart}
      >
        Start activation
      </button>
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
