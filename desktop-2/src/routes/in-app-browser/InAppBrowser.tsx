/**
 * Port · in-app-browser
 * Source: 05_html-mockups/approved/in-app-browser.html
 *
 * BrowseOverlay chrome reskin. Hosts Gmail + Whop + YouTube +
 * engine-consumable webviews INSIDE the desktop app. Chrome
 * ports faithfully; webview slot is a mock in this port — the
 * production wire lives at src-tauri/src/browse.rs (unchanged).
 *
 * 11 states per D2 v1.1 slug map:
 *   default · loading · error · maximized · gmail-inbox ·
 *   whop-checkout · youtube-auth · engine-consumable ·
 *   add-shortcut-open · outreach-inbox (new) ·
 *   other-mail-linked (new · sync-mail Other branch)
 *
 * Sync-mail button family (Daniel 2026-07-04):
 *   [Gmail] → runs F5 OAuth (Layer 2)
 *   [Other] → opens `other-mail-linked` placeholder state
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { renderInline } from '../../components/safe-inline';
import { SafeImg } from '../../components/safe';
// Chapter 6 · behavioural events. Canonical lcDiag rail — no parallel telemetry.
import { lcDiag } from '../../lib/diagnosticLogger';
import './InAppBrowser.css';

export type BrowserState =
  | 'default'
  | 'loading'
  | 'error'
  | 'maximized'
  | 'gmail-inbox'
  | 'whop-checkout'
  | 'youtube-auth'
  | 'engine-consumable'
  | 'add-shortcut-open'
  | 'outreach-inbox'
  | 'other-mail-linked';

type Intent = 'whop' | 'checkout' | 'youtube' | 'gmail' | 'engine' | 'outreach';

interface StateConfig {
  intent: Intent;
  intentLabel: string;
  domain: string;
  address: string;
  max: boolean;
  kadePose: string;
}

const PER_STATE: Record<BrowserState, StateConfig> = {
  'default':           { intent: 'whop',     intentLabel: 'Whop · rewards',           domain: 'whop.com/rewards',       address: 'https://whop.com/rewards',                       max: false, kadePose: 'kade-community-mode' },
  'loading':           { intent: 'whop',     intentLabel: 'Whop · rewards',           domain: 'whop.com',               address: 'https://whop.com/rewards',                       max: false, kadePose: 'kade-community-mode' },
  'error':             { intent: 'whop',     intentLabel: 'Whop · offline',           domain: 'whop.com',               address: 'https://whop.com/rewards',                       max: false, kadePose: 'kade-error' },
  'maximized':         { intent: 'whop',     intentLabel: 'Whop · rewards',           domain: 'whop.com/rewards',       address: 'https://whop.com/rewards',                       max: true,  kadePose: 'kade-community-mode' },
  'gmail-inbox':       { intent: 'gmail',    intentLabel: 'Gmail · inbox',            domain: 'mail.google.com',        address: 'https://mail.google.com/mail/u/0/#inbox',        max: false, kadePose: 'kade-idle' },
  'whop-checkout':     { intent: 'checkout', intentLabel: 'Whop · checkout · $99.99', domain: 'whop.com/checkout',      address: 'https://whop.com/checkout?plan=lc-unlock-99',    max: false, kadePose: 'kade-earn-mode' },
  'youtube-auth':      { intent: 'youtube',  intentLabel: 'Google · YouTube auth',    domain: 'accounts.google.com',    address: 'https://accounts.google.com/o/oauth2/auth?scope=youtube', max: false, kadePose: 'kade-idle' },
  'engine-consumable': { intent: 'engine',   intentLabel: 'Engine · consumable',      domain: 'youtube.com/@mkbhd',     address: 'https://youtube.com/@mkbhd',                     max: false, kadePose: 'kade-idle' },
  'add-shortcut-open': { intent: 'whop',     intentLabel: 'Whop · rewards',           domain: 'whop.com/rewards',       address: 'https://whop.com/rewards',                       max: false, kadePose: 'kade-community-mode' },
  'outreach-inbox':    { intent: 'outreach', intentLabel: 'Outreach · replies',       domain: 'app.liquidclips.mail',   address: 'app://outreach/inbox',                           max: false, kadePose: 'kade-hover' },
  'other-mail-linked': { intent: 'outreach', intentLabel: 'Other mail · linked',      domain: 'liquidclips.app/mail',   address: 'app://outreach/other',                           max: false, kadePose: 'kade-hover' },
};

export interface InAppBrowserProps {
  showScrubber?: boolean;
  onClose?: () => void;
  onSyncGmail?: () => void;
  onSyncOther?: () => void;
}

export function InAppBrowser(props: InAppBrowserProps) {
  const [state, setState] = useState<BrowserState>('default');
  const showScrubber = props.showScrubber ?? tryImportMetaDev();

  const cfg = PER_STATE[state];

  // ── Behavioural HQ events (Chapter 6) ───────────────────────────
  // Approved mockup has no <video> tag → skip founder-video events.
  const mountedRef = useRef(false);
  const stateSeenRef = useRef<Set<BrowserState>>(new Set());
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    lcDiag('in_app_browser_viewed', { first_view: true, state, intent: cfg.intent });
    stateSeenRef.current.add(state);
    lcDiag('in_app_browser_state_viewed', {
      state,
      first_view_of_state: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!mountedRef.current) return;
    const firstView = !stateSeenRef.current.has(state);
    if (firstView) stateSeenRef.current.add(state);
    lcDiag('in_app_browser_state_viewed', {
      state,
      first_view_of_state: firstView,
    });
    // Emit a navigation event whenever the address host changes.
    // Approved mockup ships fixed cfg.address per state — hoisting the
    // URL host lets HQ see where a session steered.
    try {
      const host = new URL(cfg.address).host || cfg.domain;
      lcDiag('in_app_browser_navigate', {
        url_host: host,
        state,
        intent: cfg.intent,
      });
    } catch {
      lcDiag('in_app_browser_navigate', {
        url_host: cfg.domain,
        state,
        intent: cfg.intent,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const onSyncGmail = useCallback(() => {
    lcDiag('in_app_browser_cta_clicked', {
      cta_id: 'sync-gmail',
      cta_label: 'Sync Gmail',
      state,
    });
    props.onSyncGmail?.();
    setState('gmail-inbox');
  }, [props, state]);

  const onSyncOther = useCallback(() => {
    lcDiag('in_app_browser_cta_clicked', {
      cta_id: 'sync-other',
      cta_label: 'Other',
      state,
    });
    props.onSyncOther?.();
    setState('other-mail-linked');
  }, [props, state]);

  const rowsByState = useMemo(() => ORDER, []);

  return (
    <div className="iab-root">
      {showScrubber && (
        <div className="iab-scrubber" role="tablist" aria-label="Browser state">
          <span className="iab-scrubber-label">STATE</span>
          {rowsByState.map((s, i) => (
            <button
              key={s}
              type="button"
              className="iab-scrubber-btn"
              data-active={state === s}
              onClick={() => setState(s)}
            >
              {i + 1} · {s.replace(/-/g, ' ')}
            </button>
          ))}
          <span className="iab-scrubber-note">90 × 88% · portaled overlay · 1280×820</span>
        </div>
      )}

      <div className="iab-app-backdrop">
        <div className="iab-app-backdrop-label">
          Desktop app · <b>Home</b> · in-app browser open
        </div>
        <div className="iab-scrim" />

        <div className="iab-overlay" data-state={state} data-intent={cfg.intent} data-max={cfg.max ? 'true' : 'false'}>
          <div className="iab-whop-pill">
            Powered by
            <SafeImg src="/brand/whop/whop_logo_lockup_white.svg" fallback="hide" alt="Whop" />
          </div>
          <span className="iab-hud-tr" aria-hidden="true" />
          <span className="iab-hud-br" aria-hidden="true" />
          <div className="iab-scanlines" aria-hidden="true" />
          <div className="iab-progress" aria-hidden="true" />

          {/* Chrome header */}
          <div className="iab-chrome-header">
            <div className="iab-traffic" aria-hidden="true"><span /><span /><span /></div>
            <span className="iab-intent-pill">{cfg.intentLabel}</span>
            <span className="iab-chrome-title">In-app browser · <b>{cfg.domain}</b></span>
            <div className="iab-chrome-actions">
              <button type="button" className="iab-chrome-btn" title="Maximize" onClick={() => setState(state === 'maximized' ? 'default' : 'maximized')}>⛶</button>
              {/* Phase 1 · purge Category 2 · this chrome preview isn't
                  the primary open-in-system button (that lives on the
                  outer BrowseOverlay footer). Disabled to avoid a
                  dead-button click; the outer chrome owns the real
                  external-open action. */}
              <button type="button" className="iab-chrome-btn" title="Preview only · use footer's Open in system browser" disabled>↗</button>
              <button type="button" className="iab-chrome-btn is-danger" title="Close" onClick={props.onClose}>✕</button>
            </div>
          </div>

          {/* Toolbar */}
          <div className="iab-toolbar">
            <div className="iab-nav-cluster">
              <button className="iab-nav-btn" disabled title="Back">‹</button>
              <button className="iab-nav-btn" disabled title="Forward">›</button>
              <button className="iab-nav-btn" title="Reload">⟳</button>
            </div>
            <div className="iab-address-bar">
              <span className="iab-lock" aria-hidden="true" />
              <input className="iab-address-input" type="text" defaultValue={cfg.address} spellCheck={false} />
              {/* Phase 1 · purge Category 2 · this preview button was
                  cosmetic; the real "Use in Engine" action lives on
                  the outer BrowseOverlay toolbar with the wired
                  handoff. Disabled here so the customer doesn't
                  chase a dead affordance. */}
              <button className="iab-use-in-engine" type="button" title="Preview only · use outer chrome's Use in Engine button" disabled>
                ⚡ Use in Engine
              </button>
            </div>
            <div className="iab-toolbar-actions">
              {/* Sync-mail button family (Daniel 2026-07-04) */}
              <button type="button" className="iab-sync-mail-btn" onClick={onSyncGmail} title="Link Gmail via F5 OAuth">
                ✉ Sync Gmail
              </button>
              <button type="button" className="iab-sync-mail-btn is-quiet" onClick={onSyncOther} title="Link a non-Gmail inbox">
                Other
              </button>
            </div>
          </div>

          {/* Quick links */}
          <div className="iab-quick-links">
            {/* Phase 1 · purge Category 2 · preview quick-link chips
                are decorative on the fallback surface. The real
                quick-link row lives on the outer BrowseOverlay
                chrome. Disabled to avoid dead-button clicks. */}
            <button type="button" className="iab-quick-link is-active" disabled><span className="iab-quick-link-dot" />Whop Rewards</button>
            <button type="button" className="iab-quick-link" disabled><span className="iab-quick-link-dot" style={{ background: 'var(--color-cyan-cool)' }} />Campaigns</button>
            <button type="button" className="iab-quick-link" disabled><span className="iab-quick-link-dot" style={{ background: 'var(--color-fuchsia-deep)' }} />Earn</button>
            <button type="button" className="iab-quick-link" disabled><span className="iab-quick-link-dot" style={{ background: 'var(--iab-amber)' }} />Community</button>
          </div>

          {/* Body · rail + webview */}
          <div className="iab-body">
            <aside className="iab-rail" aria-label="Sovereign rail">
              <button className="iab-rail-btn is-active" title="TikTok composer">T</button>
              <button className="iab-rail-btn" title="YouTube composer">Y</button>
              <button className="iab-rail-btn" title="Instagram composer">I</button>
              <div className="iab-rail-sep" />
              <button className="iab-rail-btn" title="Notion">N</button>
              <button className="iab-rail-btn" title="Discord">D</button>
              <button className="iab-rail-add" type="button" title="Add shortcut" onClick={() => setState('add-shortcut-open')}>+</button>
            </aside>

            <div className="iab-webview-slot">
              {/* Whop rewards */}
              <div className="iab-webview-mock iab-webview-whop">
                <div className="iab-whop-hero">
                  <div className="iab-whop-eyebrow">Whop · rewards</div>
                  <h1 className="iab-whop-h1">Your Liquid Clips agency payouts</h1>
                  <p className="iab-whop-sub">
                    Every clipper you invite pays out on a rolling cycle. Grid below reflects
                    live balance, pending, and last cycle.
                  </p>
                  <div className="iab-whop-cards">
                    <div className="iab-whop-card"><div className="iab-whop-card-label">Balance</div><div className="iab-whop-card-value">$847.12</div></div>
                    <div className="iab-whop-card"><div className="iab-whop-card-label">Pending</div><div className="iab-whop-card-value">$212.40</div></div>
                    <div className="iab-whop-card"><div className="iab-whop-card-label">Last cycle</div><div className="iab-whop-card-value">$1,304</div></div>
                  </div>
                </div>
              </div>

              {/* Whop checkout */}
              <div className="iab-webview-mock iab-webview-checkout">
                <div className="iab-checkout-card">
                  <div className="iab-checkout-brand">Whop · checkout</div>
                  <h2 className="iab-checkout-h1">Unlock everything</h2>
                  <div className="iab-checkout-line"><span>100 clips</span><b>watermark removed</b></div>
                  <div className="iab-checkout-line"><span>Auto-post</span><b>on · TT · IG · Shorts</b></div>
                  <div className="iab-checkout-line"><span>Back-catalog rescan</span><b>on · quarterly</b></div>
                  <div className="iab-checkout-total"><span>Total</span><b>$99.99</b></div>
                  <button className="iab-checkout-btn" type="button">Pay with card</button>
                </div>
              </div>

              {/* YouTube OAuth */}
              <div className="iab-webview-mock iab-webview-youtube">
                <div className="iab-yt-oauth">
                  <div className="iab-yt-logo">Sign in with Google</div>
                  <div className="iab-yt-eyebrow">to continue to Liquid Clips</div>
                  <div className="iab-yt-permission">
                    Liquid Clips wants to <b>view your YouTube account</b>, including your
                    subscriber count, upload history, and public channel data.
                    <br /><br />
                    This is used to find similar creators you can send clips to.
                  </div>
                  <div className="iab-yt-btns">
                    <button className="iab-yt-btn is-quiet">Cancel</button>
                    <button className="iab-yt-btn">Allow</button>
                  </div>
                </div>
              </div>

              {/* Gmail inbox */}
              <div className="iab-webview-mock iab-webview-gmail">
                <div className="iab-gm-toolbar">
                  <div>Inbox</div>
                  <div className="iab-gm-search">Search mail</div>
                  <div>1–50 of 2,431</div>
                </div>
                {GMAIL_ROWS.map((r, i) => (
                  <div key={i} className={`iab-gm-row ${r.unread ? 'is-unread' : ''}`}>
                    <div className="iab-gm-sender">{r.sender}</div>
                    <div className="iab-gm-subject">{renderInline(r.subject)}</div>
                    <div className="iab-gm-date">{r.date}</div>
                  </div>
                ))}
              </div>

              {/* Outreach inbox (new) */}
              <div className="iab-webview-mock iab-webview-outreach">
                <div className="iab-outreach-hero">
                  <div className="iab-outreach-eyebrow">Outreach · replies</div>
                  <h1 className="iab-outreach-h1">Your warm-peer sends</h1>
                  <p className="iab-outreach-sub">
                    Live status per recipient · updates instantly when someone opens or replies.
                    Zero SDR noise · just the ones that matter.
                  </p>
                </div>
                {OUTREACH_ROWS.map((r, i) => (
                  <div key={i} className="iab-outreach-row">
                    <div className="iab-outreach-avatar">{r.initials}</div>
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--color-ink)', fontWeight: 600 }}>{r.name}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{r.subject}</div>
                    </div>
                    <span className={`iab-outreach-status is-${r.status}`}>{r.status}</span>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--color-text-tertiary)' }}>{r.when}</div>
                  </div>
                ))}
              </div>

              {/* Other-mail linked (new fallback) */}
              <div className="iab-webview-mock iab-webview-other">
                <div className="iab-other">
                  <div className="iab-other-eyebrow">Other mail · we'll handle it</div>
                  <h1 className="iab-other-h1">You don't need Gmail</h1>
                  <p className="iab-other-sub">
                    We send your warm-peer outreach from a Liquid Clips inbox · your handle
                    stays CC'd so replies come back to you. Ships as its own mini-layer after G1.
                  </p>
                  <div className="iab-other-list">
                    <div className="iab-other-row"><span><b>Outlook</b> · Microsoft 365</span><span className="iab-other-badge">Coming</span></div>
                    <div className="iab-other-row"><span><b>iCloud</b> · @icloud.com / @me.com</span><span className="iab-other-badge">Coming</span></div>
                    <div className="iab-other-row"><span><b>Custom domain</b> · your@brand.com</span><span className="iab-other-badge">Coming</span></div>
                  </div>
                </div>
              </div>

              {/* Error */}
              <div className="iab-webview-mock iab-webview-error">
                <div className="iab-error-card">
                  <span className="iab-error-badge">Couldn't load page</span>
                  <h2 className="iab-error-title">whop.com didn't respond</h2>
                  <p className="iab-error-sub">
                    Either your connection dropped or Whop is having a rough moment.
                    You can retry or open the page in your system browser.
                  </p>
                  {/* Phase 1 · purge Category 2 · error-state actions
                      route out via the outer BrowseOverlay chrome (its
                      footer holds the wired "Open in system browser"
                      and its toolbar the wired reload). Disabled here
                      to avoid dead-button clicks in the preview. */}
                  <div className="iab-error-actions">
                    <button type="button" className="iab-error-btn is-primary" disabled title="Preview only · use outer toolbar reload">Retry</button>
                    <button type="button" className="iab-error-btn" disabled title="Preview only · use outer footer's Open in system browser">Open in system browser</button>
                  </div>
                </div>
              </div>

              {/* Kade */}
              <img
                className="iab-kade"
                src={`/brand/kade/${cfg.kadePose}.webp`}
                alt=""
                onError={(e) => (e.currentTarget.style.display = 'none')}
              />
            </div>
          </div>

          {/* Add-shortcut form */}
          <div className="iab-add-form" role="dialog" aria-label="Add shortcut">
            <div className="iab-add-form-eyebrow">Sovereign rail · new shortcut</div>
            <h2 className="iab-add-form-h1">Add a shortcut</h2>
            <label className="iab-add-form-field">
              <span className="iab-add-form-label">Label</span>
              <input className="iab-add-form-input" type="text" defaultValue="Notion" spellCheck={false} />
            </label>
            <label className="iab-add-form-field">
              <span className="iab-add-form-label">URL</span>
              <input className="iab-add-form-input" type="url" defaultValue="https://notion.so/liquidclips" spellCheck={false} />
            </label>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 8 }}>
              Shortcuts sync across all workspaces on this Mac. Max 8 total.
            </div>
            <div className="iab-add-form-actions">
              <button type="button" className="iab-add-form-btn" onClick={() => setState('default')}>Cancel</button>
              <button type="button" className="iab-add-form-btn is-primary">Add shortcut</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const ORDER: BrowserState[] = [
  'default',
  'loading',
  'error',
  'maximized',
  'gmail-inbox',
  'whop-checkout',
  'youtube-auth',
  'engine-consumable',
  'add-shortcut-open',
  'outreach-inbox',
  'other-mail-linked',
];

const GMAIL_ROWS = [
  { sender: 'Marques Brownlee',  subject: '<b>Re: Your 100 clips are ready</b> — thanks, this looks great. When can I…', date: '10:42', unread: true },
  { sender: 'Casey Neistat',     subject: '<b>Re: Free preview</b> — interesting angle. What\'s the catch?',              date: '09:15', unread: true },
  { sender: 'Emma Chamberlain',  subject: 'Re: 100 clips — sounds fun, sent to my manager to review',                      date: 'Wed',   unread: false },
  { sender: 'Colin & Samir',     subject: 'Re: Preview link — hey, is this real? cool if so',                              date: 'Wed',   unread: false },
  { sender: 'Airrack',           subject: 'Re: Free preview — done, paid. links?',                                          date: 'Tue',   unread: false },
];

const OUTREACH_ROWS = [
  { initials: 'MB', name: 'Marques Brownlee', subject: 'I ran your channel through Liquid Clips',           status: 'replied', when: '3m ago' },
  { initials: 'CN', name: 'Casey Neistat',    subject: 'I ran your channel through Liquid Clips',           status: 'opened',  when: '18m ago' },
  { initials: 'EC', name: 'Emma Chamberlain', subject: 'I ran your channel through Liquid Clips',           status: 'sent',    when: '2h ago' },
  { initials: 'CS', name: 'Colin & Samir',    subject: 'I ran your channel through Liquid Clips',           status: 'opened',  when: '4h ago' },
  { initials: 'AR', name: 'Airrack',          subject: 'I ran your channel through Liquid Clips',           status: 'replied', when: '1d ago' },
];

function tryImportMetaDev(): boolean {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  } catch { return false; }
}
