/**
 * Port · login-activation
 * Source: 05_html-mockups/approved/login-activation.html
 * Preserves IG-004 activation.ts state machine — reads `useActivation()`
 * and MAPS 5 headless statuses to 11 UI slugs per D2 v1.1:
 *
 *   activation.ts status  → LoginActivation UI slug
 *   ─────────────────────────────────────────────
 *   idle                  → 'idle' (default) OR 'already_activated' if snapshot has JWT
 *   waiting               → 'waiting' OR 'inapp_panel_open' (when webview open)
 *   activating            → 'activating'
 *   activated             → 'activated' OR 'activated_degraded' (when snapshot.degraded)
 *   failed                → 'failed'
 *
 *   UI-owned slugs (no headless status):
 *   inapp_fallback · manual_paste · offline
 *
 * Never mutates activation.ts internals.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useActivation, activateWithToken, beginActivation } from '../../lib/activation';
import './LoginActivation.css';

export type UiState =
  | 'idle'
  | 'waiting'
  | 'activating'
  | 'activated'
  | 'activated_degraded'
  | 'failed'
  | 'already_activated'
  | 'inapp_panel_open'
  | 'inapp_fallback'
  | 'manual_paste'
  | 'offline';

export interface LoginActivationProps {
  /** Show the dev scrubber. Defaults to import.meta.env.DEV. */
  showScrubber?: boolean;
  /** Wired to `open_browse_panel` in production. Optional for QA. */
  openInAppPanel?: () => Promise<void> | void;
  /** Called on the Continue CTA — parent routes to Home. */
  onContinue?: () => void;
}

interface StateConfig {
  ident: string;
  sub: string;
}

const PER_STATE: Record<UiState, StateConfig> = {
  idle:                { ident: 'idle',                     sub: 'Sign in once. Return to the app automatically.' },
  waiting:             { ident: 'waiting for deep-link',    sub: `Finish signing in on the web — we'll take over.` },
  activating:          { ident: 'validating',               sub: 'Validating your session — a few seconds.' },
  activated:           { ident: 'activated',                sub: `You're signed in. Continue to your workspace.` },
  activated_degraded:  { ident: 'activated · sync pending', sub: 'Signed in · account state refreshing in background.' },
  failed:              { ident: 'failed',                   sub: `That code didn't match this session.` },
  already_activated:   { ident: 'already activated',        sub: 'We remembered you. Continue to your workspace.' },
  inapp_panel_open:    { ident: 'panel open',               sub: 'The Whop sign-in panel is open above.' },
  inapp_fallback:      { ident: 'panel · UA retry',         sub: `Whop wouldn't load — trying a different identity.` },
  manual_paste:        { ident: 'manual paste',             sub: 'Paste your activation code below.' },
  offline:             { ident: 'offline',                  sub: 'No network right now — reconnect and try again.' },
};

export function LoginActivation(props: LoginActivationProps) {
  const snapshot = useActivation();
  const [manualCode, setManualCode] = useState('');
  const [uiOverride, setUiOverride] = useState<UiState | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const showScrubber = props.showScrubber ?? tryImportMetaDev();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    setIsOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const uiState: UiState = useMemo(() => {
    if (uiOverride) return uiOverride;
    if (!isOnline) return 'offline';
    if (snapshot.status === 'activated') {
      return snapshot.degraded ? 'activated_degraded' : 'activated';
    }
    if (snapshot.status === 'failed') return 'failed';
    if (snapshot.status === 'activating') return 'activating';
    if (snapshot.status === 'waiting') return 'waiting';
    return 'idle';
  }, [uiOverride, isOnline, snapshot.status, snapshot.degraded]);

  const cfg = PER_STATE[uiState];

  const onSignIn = useCallback(async () => {
    setUiOverride(null);
    try {
      beginActivation();
      if (props.openInAppPanel) {
        setUiOverride('inapp_panel_open');
        await props.openInAppPanel();
      }
    } catch (e) {
      setUiOverride('failed');
      // eslint-disable-next-line no-console
      console.error('[LoginActivation] beginActivation failed:', e);
    }
  }, [props.openInAppPanel]);

  const onManualActivate = useCallback(async () => {
    if (!manualCode.trim()) return;
    try {
      await activateWithToken(manualCode.trim());
      setUiOverride(null);
    } catch (e) {
      setUiOverride('failed');
      // eslint-disable-next-line no-console
      console.error('[LoginActivation] activateWithToken failed:', e);
    }
  }, [manualCode]);

  return (
    <div className="la-root">
      {showScrubber && (
        <div className="la-scrubber" role="tablist" aria-label="Login state">
          <span className="la-scrubber-label">STATE</span>
          {(Object.keys(PER_STATE) as UiState[]).map((s) => (
            <button
              key={s}
              className="la-scrubber-btn"
              data-active={uiState === s}
              onClick={() => setUiOverride(s)}
              type="button"
            >
              {s.replace(/_/g, ' ')}
            </button>
          ))}
          <span className="la-scrubber-note">520 × auto · desktop login</span>
        </div>
      )}

      <div className="la-stage">
        <div className="la-card" data-state={uiState}>
          <div className="la-whop-pill">
            Powered by
            <img src="/brand/whop/whop_logo_lockup_white.svg" alt="Whop" />
          </div>
          <span className="la-hud-tr" aria-hidden="true" />
          <span className="la-hud-br" aria-hidden="true" />
          <div className="la-scanlines" aria-hidden="true" />

          <div className="la-node-header">
            <div className="la-node-title">
              <span className="la-node-glyph" aria-hidden="true" />
              Liquid Clips
            </div>
            <div className="la-node-ident">
              activation · <b>{cfg.ident}</b>
            </div>
          </div>

          <div className="la-boot-eyebrow">Boot sequence</div>
          <h1 className="la-boot-h1">Activate Liquid Clips</h1>
          <p className="la-boot-sub">{cfg.sub}</p>

          <div className="la-state-body">
            {uiState === 'idle' && (
              <>
                <ol className="la-steps-list">
                  <li><strong>1</strong><span>Click <em style={{ color: 'var(--color-ink)' }}>Sign in with Whop</em> — no browser bounce.</span></li>
                  <li><strong>2</strong><span>Sign in inside the app panel that opens above.</span></li>
                  <li><strong>3</strong><span>You're in. Your license lands automatically.</span></li>
                </ol>
                <button type="button" className="la-cta la-cta-primary" onClick={onSignIn}>
                  <span className="la-cta-icon" aria-hidden="true" />
                  Sign in with Whop
                </button>
                <div className="la-cta-row">
                  <button type="button" className="la-cta la-cta-secondary" onClick={() => setUiOverride('waiting')}>Use system browser</button>
                  <button type="button" className="la-cta la-cta-quiet" onClick={() => setUiOverride('manual_paste')}>Paste activation code</button>
                </div>
              </>
            )}

            {uiState === 'waiting' && (
              <>
                <span className="la-state-pill is-waiting">Waiting for sign-in</span>
                <p className="la-state-step">
                  Finish signing in on the web. The app catches your activation <em>automatically</em>
                  {' '}when the browser returns — you don't have to click anything else.
                </p>
                <div className="la-cta-row">
                  <button type="button" className="la-cta la-cta-secondary" onClick={() => setUiOverride(null)}>Cancel · start over</button>
                  <button type="button" className="la-cta la-cta-quiet" onClick={() => setUiOverride('inapp_panel_open')}>Re-open browser</button>
                </div>
              </>
            )}

            {uiState === 'activating' && (
              <>
                <span className="la-state-pill is-activating">Activating…</span>
                <div className="la-spinner" aria-hidden="true" />
                <p className="la-state-step">Validating the deep-link · running <em>/sync</em> + <em>/me</em>.</p>
              </>
            )}

            {(uiState === 'activated' || uiState === 'activated_degraded') && (
              <>
                <span className="la-state-pill is-activated">Activated</span>
                <p className="la-success-account">{snapshot.email ?? 'daniel@liquidclips.app'}</p>
                <span className="la-tier-pill">{snapshot.tier ?? 'Agency · Pro'}</span>
                <span className="la-source-note">via Whop</span>
                {uiState === 'activated_degraded' && (
                  <div className="la-degraded-note">
                    We saved your access. We couldn't refresh account state this time —
                    you can keep working. The app will retry in the background.
                  </div>
                )}
                <button type="button" className="la-cta la-cta-primary" onClick={props.onContinue} style={{ marginTop: 18 }}>
                  <span className="la-cta-icon" aria-hidden="true" />
                  Continue to Liquid Clips →
                </button>
              </>
            )}

            {uiState === 'failed' && (
              <>
                <span className="la-state-pill is-failed">Couldn't activate</span>
                <p className="la-error-message">
                  {snapshot.error ?? 'The activation code didn\'t match this session. Someone else may have used the link, or the timer ran out (5 min).'}
                </p>
                <button type="button" className="la-cta la-cta-primary" onClick={() => setUiOverride(null)}>
                  <span className="la-cta-icon" aria-hidden="true" />
                  Try again
                </button>
              </>
            )}

            {uiState === 'already_activated' && (
              <>
                <span className="la-state-pill is-activated">Already activated</span>
                <p className="la-state-step">We found a saved Liquid Clips license on this Mac. You can keep working.</p>
                <span className="la-source-note">storage · macOS Keychain</span>
                <button type="button" className="la-cta la-cta-primary" onClick={props.onContinue} style={{ marginTop: 18 }}>
                  <span className="la-cta-icon" aria-hidden="true" />
                  Continue to Liquid Clips →
                </button>
              </>
            )}

            {(uiState === 'inapp_panel_open' || uiState === 'inapp_fallback') && (
              <div className="la-inapp-chrome">
                <span className="la-inapp-eyebrow">Signing you in…</span>
                <div className="la-inapp-panel-preview">Whop OAuth panel · 480 × 720</div>
                <p className="la-inapp-help">
                  Complete sign-in in the panel above. The app catches your activation
                  token automatically — no browser bounce.
                </p>
                {uiState === 'inapp_fallback' && (
                  <p className="la-inapp-error">
                    Sign-in page won't load — Whop refused this app's identity. Retry with a Safari-shaped identity, or cancel.
                  </p>
                )}
                <div className="la-cta-row">
                  <button type="button" className="la-cta la-cta-secondary" onClick={() => setUiOverride('inapp_fallback')}>Retry with Safari identity</button>
                  <button type="button" className="la-cta la-cta-quiet" onClick={() => setUiOverride(null)}>Cancel</button>
                </div>
              </div>
            )}

            {uiState === 'manual_paste' && (
              <>
                <p className="la-state-step">
                  Paste the code you got from the Whop login page and we'll finish signing you in.
                </p>
                <div className="la-manual">
                  <span className="la-manual-label">Manual activation code</span>
                  <p className="la-manual-help">
                    Works with either the raw JWT or the full <code>liquidclips://activate?token=…</code> URL.
                  </p>
                  <textarea
                    className="la-manual-input"
                    rows={3}
                    spellCheck={false}
                    placeholder="liquidclips://activate?token=… — or the raw token"
                    value={manualCode}
                    onChange={(e) => setManualCode(e.currentTarget.value)}
                  />
                  <button type="button" className="la-cta la-cta-primary" onClick={onManualActivate}>
                    <span className="la-cta-icon" aria-hidden="true" />
                    Activate with code
                  </button>
                </div>
              </>
            )}

            {uiState === 'offline' && (
              <>
                <span className="la-state-pill is-offline">Offline</span>
                <p className="la-state-step">
                  You started signing in, but the app can't reach the network right now.
                  Reconnect and try again — your activation is safe until you do.
                </p>
                <div className="la-cta-row">
                  <button type="button" className="la-cta la-cta-secondary" onClick={() => setIsOnline(navigator.onLine)}>Check connection</button>
                  <button type="button" className="la-cta la-cta-quiet" onClick={() => setUiOverride(null)}>Cancel · start over</button>
                </div>
              </>
            )}
          </div>

          <div className="la-footer">
            Sign-in stays inside the app · <b>100% integrated</b> · no browser switching · no popup blocker risk
          </div>

          <img
            className="la-kade"
            src="/brand/kade/kade-reading-brief.webp"
            alt=""
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
        </div>
      </div>
    </div>
  );
}

function tryImportMetaDev(): boolean {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  } catch { return false; }
}
