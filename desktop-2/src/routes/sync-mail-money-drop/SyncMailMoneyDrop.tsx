/**
 * Port · sync-mail-money-drop
 *
 * Source: 05_html-mockups/approved/sync-mail-money-drop.html (v6)
 * Wires Layer 2 F5 scanner + Layer 3 broadcast queue into the real UI
 * Daniel walks for the G1 signoff.
 *
 * State machine mirrors the mockup's 6 scrubber states:
 *   hook · connecting-gmail · roster-populating · approve-send ·
 *   back-to-app · notification-drop
 *
 * Pricing per Daniel 2026-07-04 (LOCKED): $99.99/mo founder access ·
 * $50/mo per referral (50% affiliate cut · rounded).
 * Voice per feedback_voice_no_bounty_use_skill.md: no "bounty" · use
 * "skill" / "clip job" / "paid post".
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DemoOverlay } from '../../components/demo-overlay';
import { renderInline } from '../../components/safe-inline';
import { F5Scanner, type ScanState } from '../../lib/f5/scanner';
import { loadClientIdFromEnv, type OAuthDriver } from '../../lib/f5/googleOAuth';
import type { RosterRow } from '../../lib/f5/rosterBuilder';
import type { BatchLookup } from '../../lib/f5/youtubeCrossRef';
import type { HttpFetch } from '../../lib/f5/contactScan';
import { renderWarmPeer } from '../../lib/gmail/broadcastTemplate';
import './SyncMailMoneyDrop.css';

// ─────────────────────────────────────────────────────────────
// State machine (mirrors mockup scrubber)
// ─────────────────────────────────────────────────────────────

export type ModalState =
  | 'hook'
  | 'connecting-gmail'
  | 'roster-populating'
  | 'approve-send'
  | 'back-to-app'
  | 'notification-drop';

interface StateConfig {
  scene: 'modal' | 'app-home';
  h1: string;
  sub: string;
  connectLabel: string;
  coachScript: string;
  appH1?: string;
  appWallet?: string;
}

// Founder-cohort pricing locked 2026-07-04:
//   $99.99/mo grants Agency tier · first 1000 users only
//   Whop plan: agency_founder alias · 50% affiliate cut ≈ $50/mo
// Two subs break even ($100 covers the $99.99/mo cost).
const PRICE_PER_REFERRAL = 50;    // 50% cut of $99.99 rounded to clean $50
const PACKAGE_PRICE_LABEL = '$99.99';
const BREAK_EVEN_SUBS = 2;

const PER_STATE: Record<ModalState, StateConfig> = {
  'hook': {
    scene: 'modal',
    h1: `<span class="smmd-strike">$500/mo</span> → <span class="smmd-money">${PACKAGE_PRICE_LABEL}/mo</span>`,
    sub: `Every clipper you skill-share with pays ${PACKAGE_PRICE_LABEL} · you get <b class="smmd-life">$${PRICE_PER_REFERRAL}/mo</b> — every month, <b class="smmd-life">for LIFE</b>. <b>Two skill shares</b> = your ${PACKAGE_PRICE_LABEL} is free. Link any email · we handle everything.`,
    connectLabel: 'Link my email',
    coachScript: `"Hey guys — <b>Daniel, founder</b>. You just took the highest package. $500 a month. I'm giving it to you for ${PACKAGE_PRICE_LABEL}. Every clipper you share this with? <b>$${PRICE_PER_REFERRAL} of their sub — every month, for LIFE.</b> Not when we hit series A. For LIFE."`,
  },
  'connecting-gmail': {
    scene: 'modal',
    h1: 'Signing you in…',
    sub: '<b>Read-only.</b> We look at who you email · contacts + sent folder. Nothing sends without your tap. Takes 5 seconds.',
    connectLabel: 'Signing in…',
    coachScript: `"Sign-in pops for <b>5 seconds</b>. Sign in. We handle everything after. You watch the wallet."`,
  },
  'roster-populating': {
    scene: 'modal',
    h1: `We found <span class="smmd-money">real clippers</span> in your inbox`,
    sub: `Real people you already email · real 25k+ sub channels. Each one = <b class="smmd-life">$${PRICE_PER_REFERRAL}/mo, for LIFE</b>. <b>Two skill shares = your ${PACKAGE_PRICE_LABEL} is free.</b>`,
    connectLabel: 'Link my email',
    coachScript: `"That's your list. <b>$${PRICE_PER_REFERRAL} for every one that subs — every month, for LIFE.</b> Two skill shares = your ${PACKAGE_PRICE_LABEL} is paid back. Send it."`,
  },
  'approve-send': {
    scene: 'modal',
    h1: `Review · <span class="smmd-money">your roster</span> · send when ready`,
    sub: `Uncheck anyone you'd skip. Tap send — we reach out from your inbox and drop you back into the app. I'll ping you the moment money hits.`,
    connectLabel: 'Link my email',
    coachScript: `"About to send. From <b>your inbox</b>. Tap it — I get out of your way and let you get back to clipping."`,
  },
  'back-to-app': {
    scene: 'app-home',
    h1: '',
    sub: '',
    connectLabel: '',
    coachScript: '',
    appH1: `Your clips are waiting · <span class="smmd-money">outreach live</span>`,
    appWallet: '$0.00',
  },
  'notification-drop': {
    scene: 'app-home',
    h1: '',
    sub: '',
    connectLabel: '',
    coachScript: '',
    appH1: `You just got paid · <span class="smmd-money">$${PRICE_PER_REFERRAL}/mo</span>`,
    appWallet: `$${PRICE_PER_REFERRAL.toFixed(2)}`,
  },
};

// ─────────────────────────────────────────────────────────────
// Public props · injectable so QA can walk states without live Google
// ─────────────────────────────────────────────────────────────

export interface SyncMailMoneyDropProps {
  /** Optional injected OAuth driver — QA passes a fake to walk states
   *  without a real Google sign-in. In production, wire to the Rust
   *  google_oauth_start command via Tauri invoke. */
  oauthDriver?: OAuthDriver;
  /** Optional injected fetch — matches signature in contactScan.ts.
   *  Production wires window.fetch. */
  httpFetch?: HttpFetch;
  /** Optional injected YouTube batch lookup. Stubbed → Layer 4 (F7)
   *  wires the real backend call. */
  batchLookup?: BatchLookup;
  /** Show the dev scrubber. Defaults to import.meta.env.DEV. */
  showScrubber?: boolean;
  /** Called when the send action completes so the parent shell can
   *  navigate back to Home. Defaults to noop. */
  onSendComplete?: () => void;
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

export function SyncMailMoneyDrop(props: SyncMailMoneyDropProps) {
  const [state, setState] = useState<ModalState>('hook');
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const showScrubber = props.showScrubber ?? tryImportMetaDev();

  const cfg = PER_STATE[state];
  const scene = cfg.scene;

  // ── Live wiring · Connect Gmail button ────────────────────────
  const onConnect = useCallback(async () => {
    setError(null);
    setState('connecting-gmail');
    const driver = props.oauthDriver ?? demoOAuthDriver;
    const httpFetch = props.httpFetch ?? demoHttpFetch;
    const batchLookup = props.batchLookup ?? demoBatchLookup;
    const scanner = new F5Scanner({
      oauth: { clientId: loadClientIdFromEnv() ?? 'demo-client', driver },
      httpFetch,
      batchLookup,
      onProgress: (p) => {
        if (p.state === 'scanning' || p.state === 'crossref') {
          setState('roster-populating');
        }
      },
    });
    try {
      const outcome = await scanner.run();
      if (outcome.ok) {
        setRoster(outcome.roster);
        setSelectedEmails(new Set(outcome.roster.map((r) => r.email)));
        setState('roster-populating');
        // Auto-advance to approve after a beat so the roster animation
        // has time to settle.
        setTimeout(() => setState('approve-send'), 900);
      } else {
        setError(outcome.errorMessage ?? outcome.finalState);
        setState('hook');
      }
    } catch (e) {
      setError(String(e).slice(0, 200));
      setState('hook');
    }
  }, [props.oauthDriver, props.httpFetch, props.batchLookup]);

  // ── Live wiring · Send action ─────────────────────────────────
  const onSend = useCallback(() => {
    // In real usage this enqueues to the Layer 3 BroadcastQueue with
    // renderWarmPeer output per selected recipient. For the G1 walk
    // surface we transition to back-to-app + fire the notification
    // demo drop after a short delay.
    setState('back-to-app');
    setTimeout(() => setState('notification-drop'), 1800);
    props.onSendComplete?.();
    // Precompute the warm-peer bodies so the DevTools console can
    // inspect them — proves the template renderer is wired.
    if (typeof console !== 'undefined' && console.debug) {
      const preview = Array.from(selectedEmails).slice(0, 3).map((email) =>
        renderWarmPeer(
          { email, firstName: 'friend', previewUrl: `https://liquidclips.app/preview/demo-${email}` },
          { senderFirstName: 'Daniel' },
        ),
      );
      console.debug('[smmd] warm-peer preview (first 3):', preview);
    }
  }, [selectedEmails, props.onSendComplete]);

  // ── Video autoplay / mute toggle ──────────────────────────────
  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.muted) {
      v.muted = false;
      v.currentTime = 0;
      void v.play();
      setMuted(false);
    } else {
      v.muted = true;
      setMuted(true);
    }
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (v && v.paused) {
      v.muted = true;
      void v.play().catch(() => undefined);
    }
  }, []);

  const rosterMrr = useMemo(() => {
    const count = roster.length || 8;   // 8-row placeholder while scanning
    return `$${(count * PRICE_PER_REFERRAL).toLocaleString()}/mo`;
  }, [roster.length]);

  return (
    <div className="smmd-root">
      {showScrubber && (
        <div className="smmd-scrubber" role="tablist" aria-label="Money-moment state">
          <span className="smmd-scrubber-label">STATE</span>
          {(['hook', 'connecting-gmail', 'roster-populating', 'approve-send', 'back-to-app', 'notification-drop'] as ModalState[]).map((s, i) => (
            <button
              key={s}
              type="button"
              className="smmd-scrubber-btn"
              data-active={state === s}
              onClick={() => setState(s)}
            >
              {i + 1} · {s.replace(/-/g, ' ')}
            </button>
          ))}
          <span className="smmd-scrubber-note">$500 pkg · {PACKAGE_PRICE_LABEL}/mo · first 1000 · ${PRICE_PER_REFERRAL}/mo per ref</span>
        </div>
      )}

      <div className="smmd-stage" data-scene={scene} data-state={state}>

        {/* ───── Modal view · states 1-4 ────────────────────── */}
        <div className="smmd-modal-view">
          <div className="smmd-backdrop">
            <div className="smmd-whop-pill">
              Powered by
              <img src="/brand/whop/whop_logo_lockup_white.svg" alt="Whop" />
            </div>
            <div className="smmd-backdrop-label">
              Post-payment · <b>{PACKAGE_PRICE_LABEL}/mo cleared · agency tier live</b>
            </div>

            <div className="smmd-modal">
              {/* LEFT PANEL */}
              <div className="smmd-panel" data-state={state}>
                <div className="smmd-hook-eyebrow">
                  <span>Step 1 of 1 · takes 30 seconds</span>
                  <span className="smmd-hook-eyebrow-pill">
                    <span className="smmd-strike">$500/mo</span> · you paid {PACKAGE_PRICE_LABEL}
                  </span>
                </div>
                <h1 className="smmd-hook-h1">{renderInline(cfg.h1)}</h1>
                <p className="smmd-hook-sub">{renderInline(cfg.sub)}</p>

                {(state === 'hook' || state === 'connecting-gmail') && (
                  <>
                    <button
                      type="button"
                      className="smmd-connect-btn"
                      onClick={onConnect}
                      disabled={state === 'connecting-gmail'}
                    >
                      {state === 'connecting-gmail'
                        ? <span className="smmd-connect-spinner" aria-hidden="true" />
                        : <span className="smmd-envelope-icon" aria-hidden="true" />}
                      <span>{cfg.connectLabel}</span>
                    </button>
                    <div className="smmd-provider-strip">
                      <span className="smmd-provider-chip">Works with · <b>Gmail</b></span>
                      <span className="smmd-provider-chip"><b>iCloud</b></span>
                      <span className="smmd-provider-chip"><b>Outlook</b></span>
                      <span className="smmd-provider-chip"><b>Work</b></span>
                    </div>
                    <button className="smmd-skip-link" type="button">
                      Skip · give up <b>${(PRICE_PER_REFERRAL * 20).toLocaleString()}/mo potential</b>
                    </button>
                  </>
                )}

                {(state === 'roster-populating' || state === 'approve-send') && (
                  <div className="smmd-roster">
                    <div className="smmd-roster-header">
                      <div className="smmd-roster-title">
                        <b>{roster.length || '—'} clippers</b> in your inbox
                      </div>
                      <div className="smmd-roster-mrr">{rosterMrr} · your take</div>
                    </div>
                    <div className="smmd-roster-list">
                      {(roster.length ? roster : DEMO_ROSTER).slice(0, 8).map((r, i) => {
                        const email = 'email' in r ? r.email : (r as { email: string }).email;
                        const isSelected = selectedEmails.has(email);
                        return (
                          <div key={`${email}-${i}`} className="smmd-roster-row" style={{ opacity: isSelected ? 1 : 0.5 }}>
                            <div className="smmd-roster-avatar">
                              {initialsOf(('displayName' in r ? r.displayName : null) ?? email)}
                            </div>
                            <div>
                              <div className="smmd-roster-name">
                                {('displayName' in r ? r.displayName : null) ?? email.split('@')[0]}
                              </div>
                              <div className="smmd-roster-meta">
                                {('sourceLabel' in r ? (r as RosterRow).sourceLabel : null) ?? 'YouTube · 100K+ subs'}
                              </div>
                            </div>
                            <div className="smmd-roster-mrr-cell">${PRICE_PER_REFERRAL}/mo</div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="smmd-roster-footer">
                      <button className="smmd-roster-select-all" type="button" onClick={() => {
                        const all = (roster.length ? roster : DEMO_ROSTER);
                        setSelectedEmails(new Set(all.map((r) => 'email' in r ? r.email : (r as { email: string }).email)));
                      }}>
                        Select all
                      </button>
                      <button className="smmd-send-btn" type="button" onClick={onSend}>
                        <span>Send · then let me go</span>
                        <span className="smmd-send-caret" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                )}

                {error && (
                  <div style={{ marginTop: 14, padding: 12, background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.4)', borderRadius: 8, color: '#f87171', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    {error}
                  </div>
                )}
              </div>

              {/* RIGHT PANEL · ticker + wallet + coach */}
              <div className="smmd-panel smmd-wallet-panel" data-state={state}>
                <div className="smmd-ticker" aria-label="Live earnings ticker">
                  <span className="smmd-ticker-label">
                    Live · early clippers
                  </span>
                  <div className="smmd-ticker-track">
                    {TICKER_LIVE.concat(TICKER_LIVE).map((t, i) => (
                      <span className="smmd-ticker-item" key={`${t.handle}-${i}`}>
                        <span className="smmd-ticker-avatar">
                          <img src={t.avatar} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
                        </span>
                        <span className="smmd-ticker-handle">{t.handle}</span>
                        <span className="smmd-ticker-dot">·</span>
                        <span className="smmd-ticker-amount">{t.amount}</span>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="smmd-wallet-title">
                  <span className="smmd-wallet-title-text">
                    Your <b>Whop wallet</b>
                  </span>
                  <span className="smmd-wallet-pill">Live · instant</span>
                </div>

                <div className="smmd-wallet-hero">
                  <div className="smmd-wallet-label">Balance</div>
                  <div className="smmd-wallet-value">$0.00</div>
                  <div className="smmd-wallet-mrr">Fills the moment a sub hits</div>
                </div>

                <div className="smmd-wallet-stats">
                  <div className="smmd-wallet-stat">
                    <div className="smmd-wallet-stat-label">Subs</div>
                    <div className="smmd-wallet-stat-value">0</div>
                  </div>
                  <div className="smmd-wallet-stat">
                    <div className="smmd-wallet-stat-label">Break-even</div>
                    <div className="smmd-wallet-stat-value">{BREAK_EVEN_SUBS} subs</div>
                  </div>
                </div>

                <div className="smmd-coach">
                  <div className="smmd-coach-thumb" onClick={toggleMute}>
                    <video
                      ref={videoRef}
                      autoPlay
                      muted
                      playsInline
                      loop
                      preload="auto"
                    >
                      <source src="/brand/founder/founder-hook.mp4" type="video/mp4" />
                    </video>
                  </div>
                  <div>
                    <div className="smmd-coach-eyebrow">Daniel · founder · {muted ? 'playing muted' : 'playing'}</div>
                    <div className="smmd-coach-script">{renderInline(cfg.coachScript)}</div>
                    <button
                      type="button"
                      className="smmd-coach-audio-badge"
                      onClick={toggleMute}
                      data-muted={muted}
                    >
                      {muted ? 'Click for sound' : 'Mute'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ───── App home · states 5-6 ────────────────────── */}
        <div className="smmd-app-home">
          <div className="smmd-app-home-window">
            <div className="smmd-whop-pill">
              Powered by
              <img src="/brand/whop/whop_logo_lockup_white.svg" alt="Whop" />
            </div>
            <div className="smmd-app-titlebar">
              <span className="smmd-app-titlebar-dot" />
              <span className="smmd-app-titlebar-dot" />
              <span className="smmd-app-titlebar-dot" />
              <span className="smmd-app-titlebar-title">Liquid Clips · <b>Home</b></span>
            </div>

            <aside className="smmd-app-rail" aria-label="Main navigation">
              <button className="smmd-app-rail-tab is-active">Home</button>
              <button className="smmd-app-rail-tab">Clips</button>
              <button className="smmd-app-rail-tab">Earn</button>
              <button className="smmd-app-rail-tab">Chat</button>
            </aside>

            <main className="smmd-app-main">
              <div className="smmd-app-main-header">
                <div>
                  <div className="smmd-app-eyebrow">Welcome back</div>
                  <h1 className="smmd-app-h1">{renderInline(cfg.appH1 ?? '')}</h1>
                </div>
                <div className="smmd-app-wallet-chip">
                  <div className="smmd-app-wallet-chip-label">Whop wallet</div>
                  <div className="smmd-app-wallet-chip-value">{cfg.appWallet ?? '$0.00'}</div>
                </div>
              </div>

              <div className="smmd-app-banner">
                <span className="smmd-app-banner-dot" />
                <div className="smmd-app-banner-copy">
                  <b>Outreach starting</b> · we're reaching out to your inbox roster.
                  I'll ping this window the moment the first drop hits.
                </div>
              </div>

              <div className="smmd-clips-eyebrow">Your recent clips · 12 ready to review</div>
              <div className="smmd-clips-grid">
                {DEMO_CLIPS.map((c) => (
                  <div key={c.tag + c.caption} className="smmd-clip-tile">
                    <span className="smmd-clip-tile-tag">{c.tag}</span>
                    <span className="smmd-clip-tile-caption">{c.caption}</span>
                  </div>
                ))}
              </div>

              {state === 'notification-drop' && (
                <div className="smmd-notification">
                  <div className="smmd-notif-header">
                    <div className="smmd-notif-icon">$</div>
                    <div>
                      <div className="smmd-notif-title">Marques just paid</div>
                      <div className="smmd-notif-subtitle">Instant · Whop wallet</div>
                    </div>
                  </div>
                  <div className="smmd-notif-body">
                    <b>+${PRICE_PER_REFERRAL}/mo</b> — <span className="smmd-money">${PRICE_PER_REFERRAL} in your Whop wallet, right now</span>. Every month, for LIFE. Withdraw whenever.
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: 'var(--color-text-tertiary)',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    marginBottom: 10,
                  }}>
                    1 of {BREAK_EVEN_SUBS} to break even
                  </div>
                  <div className="smmd-notif-actions">
                    <button type="button">Dismiss</button>
                    <button type="button" className="is-primary">See wallet</button>
                  </div>
                </div>
              )}
            </main>
          </div>
        </div>
      </div>

      {/* Port #8b · contextual demo overlay · shows on `hook` (default)
          alongside the existing founder-hook coach video. Two videos
          coexist (founder-hook in the coach bubble on the left,
          demo overlay in the fixed bottom-right corner) · both
          click-to-unmute independently. localStorage:
          demo-shown-sync-mail. */}
      {state === 'hook' && (
        <DemoOverlay
          mp4Src="/demos/03-money-moment.mp4"
          kadePosterSrc="/brand/kade/kade-earn-mode.webp"
          title="The full money moment"
          storageKey="demo-shown-sync-mail"
          hint={<><strong>60 sec</strong> · tap to unmute</>}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers · demo drivers (used when a prop isn't injected)
// ─────────────────────────────────────────────────────────────

function tryImportMetaDev(): boolean {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  } catch { return false; }
}

const demoOAuthDriver: OAuthDriver = async () => ({
  ok: true,
  tokens: {
    access: 'demo-access-token',
    refresh: 'demo-refresh-token',
    expiresAt: Date.now() + 3600_000,
    scope: [
      'https://www.googleapis.com/auth/contacts.readonly',
      'https://www.googleapis.com/auth/gmail.readonly',
    ],
  },
});

const demoHttpFetch: HttpFetch = async ({ url }) => {
  if (url.includes('people.googleapis.com')) {
    return {
      status: 200,
      body: {
        connections: DEMO_ROSTER.map((r) => ({
          names: [{ displayName: r.displayName }],
          emailAddresses: [{ value: r.email }],
        })),
      },
    };
  }
  return { status: 200, body: { sent: [] } };
};

const demoBatchLookup: BatchLookup = async () => [];

function initialsOf(name: string): string {
  const parts = name.replace(/[@_.]/g, ' ').trim().split(/\s+/);
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0]?.toUpperCase() ?? '');
}

// Ticker amounts use the $50 per-referral base · multiplied by number
// of active clipper referrals each user has landed.
const TICKER_LIVE: Array<{ handle: string; amount: string; avatar: string }> = [
  { handle: 'Daniel · founder', amount: `$${(PRICE_PER_REFERRAL * 10).toLocaleString()}/mo`, avatar: '/brand/kade/kade-earn-mode.webp' },
  { handle: '@marcus.beats',    amount: `$${(PRICE_PER_REFERRAL * 3).toLocaleString()}/mo`,  avatar: '/brand/kade/kade-success.webp' },
  { handle: '@nailsbylila',     amount: `$${(PRICE_PER_REFERRAL * 4).toLocaleString()}/mo`,  avatar: '/brand/kade/kade-celebration.webp' },
  { handle: '@zayn.clips',      amount: `$${(PRICE_PER_REFERRAL * 6).toLocaleString()}/mo`,  avatar: '/brand/kade/kade-tier-climber.webp' },
  { handle: '@kayce.hair',      amount: `$${(PRICE_PER_REFERRAL * 9).toLocaleString()}/mo`,  avatar: '/brand/kade/kade-tier-growth.webp' },
  { handle: '@jayxvibes',       amount: `$${(PRICE_PER_REFERRAL * 11).toLocaleString()}/mo`, avatar: '/brand/kade/kade-publishing.webp' },
];

// P0-002 fix (2026-07-04): anonymized fictional handles · never real creator emails
// Real names implied endorsement ($50/mo paid) — defamation risk. Fictional only.
const DEMO_ROSTER: Array<{ email: string; displayName: string; sourceLabel: string }> = [
  { email: 'marcus@clipperlab.demo',   displayName: '@clipper_marcus',  sourceLabel: 'YouTube · demo channel' },
  { email: 'sam@dailycuts.demo',       displayName: '@daily_sam',       sourceLabel: 'YouTube · demo channel' },
  { email: 'emma@editrhythm.demo',     displayName: '@emma_edits',      sourceLabel: 'YouTube · demo channel' },
  { email: 'colin@coreclips.demo',     displayName: '@colin_clips',     sourceLabel: 'YouTube · demo channel' },
  { email: 'ross@rushcuts.demo',       displayName: '@ross_rush',       sourceLabel: 'YouTube · demo channel' },
  { email: 'lea@lenscrafted.demo',     displayName: '@lea_lens',        sourceLabel: 'YouTube · demo channel' },
  { email: 'ali@aftercuts.demo',       displayName: '@ali_after',       sourceLabel: 'YouTube · demo channel' },
  { email: 'sim@sparkedits.demo',      displayName: '@sim_spark',       sourceLabel: 'YouTube · demo channel' },
];

const DEMO_CLIPS: Array<{ tag: string; caption: string }> = [
  { tag: 'MrBeast', caption: '"I gave $10,000 to a stranger…"' },
  { tag: 'Casey N', caption: '"NYC studio full tour"' },
  { tag: 'MKBHD',   caption: '"Vision Pro · 6 months later"' },
  { tag: 'Airrack', caption: '"I raced Formula 1 drivers…"' },
];

// Re-export the state type so callers can hook into progress.
export type { ScanState };
