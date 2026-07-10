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
import {
  FALLBACK_REFERRAL_URL,
  SEND_STAGGER_MS,
  buildMailtoUrl,
  selectSendBatch,
} from '../../lib/f5/sendComposer';
import { openSmart } from '../../lib/openSmart';
import { getJwt } from '../../lib/authStorage';
import { bus } from '../../design-os/bridge';
import { SafeImg } from '../../components/safe';
// Chapter 6 · behavioural events. Emit through the canonical lcDiag
// rail — no parallel telemetry.
import { lcDiag } from '../../lib/diagnosticLogger';
// ag-29 (2026-07-06) · Sovereign-Operator Protocol · wrap the F5
// Scanner send flow. Failures inside the mailto: composer batch
// (openSmart throwing, roster shape drift, /affiliate/me 5xx) surface
// on the HQ Admin dashboard for Daniel to triage. onSendWrapped
// re-throws so the existing error toast + state machine stays honest.
import { Watchdog, watchdogWrap } from '../../lib/watchdog';
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
    // Pricing pivot 2026-07-06 (LOCKED) · single honest price ·
    // Agency $99.99/mo · no $500 strike-through, no fake "normally"
    // anchor. The affiliate pitch keeps the $50/mo/for-LIFE hook but
    // uses only the real price as the reference number.
    h1: `<span class="smmd-money">${PACKAGE_PRICE_LABEL}/mo</span> · every clipper you share = <span class="smmd-life">$${PRICE_PER_REFERRAL}/mo for LIFE</span>`,
    sub: `Every clipper you skill-share with pays ${PACKAGE_PRICE_LABEL} · you get <b class="smmd-life">$${PRICE_PER_REFERRAL}/mo</b> — every month, <b class="smmd-life">for LIFE</b>. <b>Two skill shares</b> = your ${PACKAGE_PRICE_LABEL} is free. Link any email · we handle everything.`,
    connectLabel: 'Link my email',
    coachScript: `"Hey guys — <b>Daniel, founder</b>. Agency access is ${PACKAGE_PRICE_LABEL}/mo. Every clipper you share this with? <b>$${PRICE_PER_REFERRAL} of their sub — every month, for LIFE.</b> Not when we hit series A. For LIFE."`,
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

  // ── Behavioural HQ events (Chapter 6) ───────────────────────────
  // First-mount fires ONCE per session. State-view fires ONCE per
  // distinct state per session (Set-gated so scrubber walks + F5
  // scanner state transitions each count once).
  const mountedRef = useRef(false);
  const stateSeenRef = useRef<Set<ModalState>>(new Set());
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    lcDiag('sync_mail_money_drop_viewed', { first_view: true });
    stateSeenRef.current.add(state);
    lcDiag('sync_mail_money_drop_state_viewed', {
      state,
      first_view_of_state: true,
    });
    // Intentional single-fire on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!mountedRef.current) return;
    const firstView = !stateSeenRef.current.has(state);
    if (firstView) stateSeenRef.current.add(state);
    lcDiag('sync_mail_money_drop_state_viewed', {
      state,
      first_view_of_state: firstView,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // ── Live wiring · Connect Gmail button ────────────────────────
  const onConnect = useCallback(async () => {
    lcDiag('sync_mail_money_drop_cta_clicked', {
      cta_id: 'connect-gmail',
      cta_label: cfg.connectLabel,
      state,
    });
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
  }, [props.oauthDriver, props.httpFetch, props.batchLookup, cfg.connectLabel, state]);

  // ── Live wiring · Send action ─────────────────────────────────
  // CM-T10 · 2026-07-05 · walk-around wire. F5 OAuth scopes are read-only
  // so the app can't send email. Instead we open the user's default mail
  // client with a pre-filled warm-peer draft per selected roster row.
  // Real emails go out from the user's own signed-in Gmail / Apple Mail
  // when they hit Send inside the draft. Staggered by SEND_STAGGER_MS
  // so macOS Mail queues the drafts cleanly instead of choking on N
  // simultaneous opens. Capped at SEND_BATCH_CAP (8) per click so the
  // user isn't buried in drafts.
  const onSend = useCallback(async () => {
    const batch = selectSendBatch(roster, selectedEmails);
    lcDiag('sync_mail_money_drop_cta_clicked', {
      cta_id: 'send-batch',
      cta_label: 'Send · then let me go',
      batch_size: batch.length,
      roster_size: roster.length,
    });
    if (batch.length === 0) {
      setError('Select at least one skill share to send.');
      return;
    }

    // Best-effort fetch of the caller's affiliate URL + first name so
    // each draft embeds the real preview link + sender greeting. Both
    // fall back to safe defaults so a network hiccup doesn't strand
    // the send — the drafts still open with a working generic referral.
    let referralUrl = FALLBACK_REFERRAL_URL;
    let senderFirstName = 'Daniel';
    try {
      const jwt = getJwt();
      if (jwt) {
        const base = (import.meta as unknown as { env?: { VITE_BACKEND_URL?: string } })
          .env?.VITE_BACKEND_URL ?? 'https://api.liquidclips.app';
        const [affRes, meRes] = await Promise.all([
          fetch(`${base}/affiliate/me`, {
            headers: { authorization: `Bearer ${jwt}` },
            cache: 'no-store',
          }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
          fetch(`${base}/me`, {
            headers: { authorization: `Bearer ${jwt}` },
            cache: 'no-store',
          }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ]);
        const url = affRes?.affiliate?.referral_url;
        if (typeof url === 'string' && url.length > 0) referralUrl = url;
        const rawName =
          (typeof meRes?.first_name === 'string' && meRes.first_name) ||
          (typeof meRes?.handle === 'string' && meRes.handle) ||
          (typeof meRes?.email === 'string' && meRes.email.split('@')[0]) ||
          '';
        if (rawName) {
          senderFirstName = rawName.split(/\s+/, 1)[0] || senderFirstName;
        }
      }
    } catch { /* keep fallback defaults */ }

    // Stagger the openSmart() calls so macOS Mail has room to queue
    // each draft. openSmart routes mailto: through the tauri-plugin-
    // opener url channel (verified 2026-06-26 · openSmart.ts:51).
    let opened = 0;
    for (const row of batch) {
      const mailto = buildMailtoUrl({ row, senderFirstName, referralUrl });
      try {
        await openSmart(mailto);
        opened += 1;
      } catch {
        // Non-fatal: skip this row, keep opening the rest. The user
        // will still get N-1 drafts and can retry the missed one.
      }
      if (batch.indexOf(row) < batch.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, SEND_STAGGER_MS));
      }
    }

    if (opened === 0) {
      setError('Mail client refused to open. Try again or copy the templates.');
      return;
    }
    bus.emit('toast', {
      kind: 'info',
      title: `${opened} draft${opened === 1 ? '' : 's'} opened`,
      body: `Send from your own Mail app · we prefilled the warm-peer template with your referral link.`,
      ttl: 8000,
    });

    // Preserve the existing cinematic tail so the state machine still
    // resolves to notification-drop for the "money moment" reveal.
    setState('back-to-app');
    setTimeout(() => setState('notification-drop'), 1800);
    props.onSendComplete?.();
  }, [roster, selectedEmails, props.onSendComplete]);

  // ag-29 wrap · re-throws inside watchdogWrap so failure surfaces at
  // HQ Admin. The Watchdog boundary around the send button catches the
  // re-throw so the existing error toast still fires and the shell
  // stays alive.
  const onSendWrapped = useMemo(
    () => watchdogWrap(
      {
        id: 'agency/ag-29/f5-scanner-send',
        label: 'F5 Scanner send',
        cluster: 'agency',
        source: 'src/routes/sync-mail-money-drop/SyncMailMoneyDrop.tsx:onSend',
      },
      onSend,
    ),
    [onSend],
  );

  // ── Video autoplay / mute toggle ──────────────────────────────
  // Chapter 6 · founder_video_started fires once per session on first
  // real (un-muted) play — the muted autoplay preview is scenery, not
  // engagement. founder_video_finished fires on end OR 75% threshold.
  const videoStartedRef = useRef(false);
  const videoFinishedRef = useRef(false);
  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.muted) {
      v.muted = false;
      v.currentTime = 0;
      void v.play();
      setMuted(false);
      if (!videoStartedRef.current) {
        videoStartedRef.current = true;
        lcDiag('founder_video_started', {
          surface: 'sync-mail-money-drop',
          video_file: 'founder-hook.mp4',
        });
      }
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

  // Chapter 6 · founder_video_finished · fires on `ended` OR when
  // playback crosses 75% of duration, whichever first. Set-gated so
  // scrub-back doesn't re-fire.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onEnded = () => {
      if (videoFinishedRef.current) return;
      videoFinishedRef.current = true;
      lcDiag('founder_video_finished', {
        surface: 'sync-mail-money-drop',
        seconds_watched: Math.floor(v.currentTime),
      });
    };
    const onTimeUpdate = () => {
      if (videoFinishedRef.current) return;
      const dur = v.duration;
      if (!Number.isFinite(dur) || dur <= 0) return;
      if (v.currentTime / dur >= 0.75) {
        videoFinishedRef.current = true;
        lcDiag('founder_video_finished', {
          surface: 'sync-mail-money-drop',
          seconds_watched: Math.floor(v.currentTime),
        });
      }
    };
    v.addEventListener('ended', onEnded);
    v.addEventListener('timeupdate', onTimeUpdate);
    return () => {
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('timeupdate', onTimeUpdate);
    };
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
          <span className="smmd-scrubber-note">{PACKAGE_PRICE_LABEL}/mo agency · first 1000 · ${PRICE_PER_REFERRAL}/mo per ref</span>
        </div>
      )}

      <div className="smmd-stage" data-scene={scene} data-state={state}>

        {/* ───── Modal view · states 1-4 ────────────────────── */}
        <div className="smmd-modal-view">
          <div className="smmd-backdrop">
            <div className="smmd-whop-pill">
              Powered by
              <SafeImg src="/brand/whop/whop_logo_lockup_white.svg" fallback="hide" alt="Whop" />
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
                    Agency · you paid {PACKAGE_PRICE_LABEL}
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
                      <Watchdog
                        id="agency/ag-29/f5-scanner-send"
                        label="F5 Scanner send"
                        cluster="agency"
                        source="src/routes/sync-mail-money-drop/SyncMailMoneyDrop.tsx:onSend"
                      >
                        <button className="smmd-send-btn" type="button" onClick={onSendWrapped}>
                          <span>Send · then let me go</span>
                          <span className="smmd-send-caret" aria-hidden="true" />
                        </button>
                      </Watchdog>
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
              <SafeImg src="/brand/whop/whop_logo_lockup_white.svg" fallback="hide" alt="Whop" />
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
