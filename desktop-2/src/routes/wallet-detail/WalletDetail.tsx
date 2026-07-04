/**
 * Port · wallet-detail
 * Source: 05_html-mockups/approved/wallet-detail.html v3.1
 *
 * 6 scrubber states (fresh-install + populated + 4 hover demos).
 * Hover states use native CSS `:hover` — Playwright's `page.hover()`
 * fires the same. Rows carry `data-tile` per D2 v1.1:
 *   streak-row-N · paid-row-N · missed-row-N · cancelled-row-N
 *
 * Pricing: $50/mo per referral · matches sync-mail port fix commit.
 * Coach video: /brand/founder/founder-wallet.mp4
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './WalletDetail.css';

export type WalletState =
  | 'fresh-install'
  | 'populated'
  | 'hover-marques'
  | 'hover-ali'
  | 'hover-airrack'
  | 'hover-johnny';

type RowStatus = 'paid' | 'streak' | 'missed' | 'cancelled';
type KadePose = 'celebration' | 'success' | 'error' | 'idle';

interface ClipperRow {
  id: string;
  name: string;
  initials: string;
  joinedMeta: string;
  hoverHandle: string;
  status: RowStatus;
  statusLabel: string;
  mrr: string;
  tileSlug: string;
  hoverStatusLabel: string;
  hoverStats: Array<{ label: string; value: string; money?: boolean }>;
  hoverFooter: string;
  kadePose: KadePose;
}

interface DropRow {
  quiet: boolean;
  name: string;
  meta: string;
  time: string;
  amount: string;
  negative?: boolean;
}

// ─────────────────────────────────────────────────────────────
// Locked roster (mirror of mockup) — pricing $50 per referral.
// ─────────────────────────────────────────────────────────────

const CLIPPERS: ClipperRow[] = [
  {
    id: 'marques',
    name: 'Marques Brownlee',
    initials: 'MB',
    joinedMeta: 'joined 47d ago',
    hoverHandle: 'joined May 19 · 47 days ago',
    status: 'streak',
    statusLabel: 'Paid',
    mrr: '$50/mo',
    tileSlug: 'streak-row-0',
    hoverStatusLabel: 'Paid · 2 mo streak',
    hoverStats: [
      { label: 'Your MRR', value: '$50/mo', money: true },
      { label: 'Lifetime paid', value: '$200', money: true },
      { label: 'Next drop', value: 'Aug 15' },
    ],
    hoverFooter: 'Reactivates <b>automatically</b> next billing',
    kadePose: 'celebration',
  },
  {
    id: 'casey',
    name: 'Casey Neistat',
    initials: 'CN',
    joinedMeta: 'joined 44d ago',
    hoverHandle: 'joined May 22 · 44 days ago',
    status: 'paid',
    statusLabel: 'Paid',
    mrr: '$50/mo',
    tileSlug: 'paid-row-0',
    hoverStatusLabel: 'Paid this month',
    hoverStats: [
      { label: 'Your MRR', value: '$50/mo', money: true },
      { label: 'Lifetime paid', value: '$100', money: true },
      { label: 'Next drop', value: 'Aug 22' },
    ],
    hoverFooter: 'Reactivates <b>automatically</b> next billing',
    kadePose: 'success',
  },
  {
    id: 'emma',
    name: 'Emma Chamberlain',
    initials: 'EC',
    joinedMeta: 'joined 44d ago',
    hoverHandle: 'joined May 22 · 44 days ago',
    status: 'streak',
    statusLabel: 'Paid',
    mrr: '$50/mo',
    tileSlug: 'streak-row-1',
    hoverStatusLabel: 'Paid · 2 mo streak',
    hoverStats: [
      { label: 'Your MRR', value: '$50/mo', money: true },
      { label: 'Lifetime paid', value: '$200', money: true },
      { label: 'Next drop', value: 'Aug 22' },
    ],
    hoverFooter: 'Reactivates <b>automatically</b> next billing',
    kadePose: 'celebration',
  },
  {
    id: 'airrack',
    name: 'Airrack',
    initials: 'AR',
    joinedMeta: 'joined 32d ago',
    hoverHandle: 'joined June 3 · 32 days ago',
    status: 'missed',
    statusLabel: 'Grace',
    mrr: '$50/mo',
    tileSlug: 'missed-row-0',
    hoverStatusLabel: 'Grace · 3 days left',
    hoverStats: [
      { label: 'Your MRR', value: '$50/mo', money: true },
      { label: 'Lifetime paid', value: '$100', money: true },
      { label: 'Next drop', value: 'If they pay by Aug 6' },
    ],
    hoverFooter: 'Whop retries card <b>3× in 3 days</b> · system-handled',
    kadePose: 'error',
  },
  {
    id: 'ali',
    name: 'Ali Abdaal',
    initials: 'AA',
    joinedMeta: 'joined 8d ago',
    hoverHandle: 'joined June 27 · 8 days ago',
    status: 'paid',
    statusLabel: 'Paid',
    mrr: '$50/mo',
    tileSlug: 'paid-row-1',
    hoverStatusLabel: 'Paid this month',
    hoverStats: [
      { label: 'Your MRR', value: '$50/mo', money: true },
      { label: 'Lifetime paid', value: '$50', money: true },
      { label: 'Next drop', value: 'Aug 27' },
    ],
    hoverFooter: 'Reactivates <b>automatically</b> next billing',
    kadePose: 'success',
  },
  {
    id: 'johnny',
    name: 'Johnny Harris',
    initials: 'JH',
    joinedMeta: 'cancelled 12d ago',
    hoverHandle: 'joined May 30 · cancelled Jun 22',
    status: 'cancelled',
    statusLabel: 'Cancelled',
    mrr: '$50/mo',
    tileSlug: 'cancelled-row-0',
    hoverStatusLabel: 'Cancelled · 12d ago',
    hoverStats: [
      { label: 'Your MRR', value: '$0/mo' },
      { label: 'Lifetime paid', value: '$100', money: true },
      { label: 'Next drop', value: '—' },
    ],
    hoverFooter: 'Balance already dropped <b>stays yours</b>',
    kadePose: 'idle',
  },
  { id: 'cleo',   name: 'Cleo Abram',    initials: 'CA', joinedMeta: 'joined 12d ago', hoverHandle: 'joined June 23 · 12 days ago', status: 'paid', statusLabel: 'Paid', mrr: '$50/mo', tileSlug: 'paid-row-2', hoverStatusLabel: 'Paid this month', hoverStats: [{ label: 'Your MRR', value: '$50/mo', money: true }, { label: 'Lifetime paid', value: '$50', money: true }, { label: 'Next drop', value: 'Aug 23' }], hoverFooter: 'Reactivates <b>automatically</b> next billing', kadePose: 'success' },
  { id: 'colin',  name: 'Colin & Samir', initials: 'CS', joinedMeta: 'joined 41d ago', hoverHandle: 'joined May 25 · 41 days ago', status: 'paid', statusLabel: 'Paid', mrr: '$50/mo', tileSlug: 'paid-row-3', hoverStatusLabel: 'Paid this month', hoverStats: [{ label: 'Your MRR', value: '$50/mo', money: true }, { label: 'Lifetime paid', value: '$100', money: true }, { label: 'Next drop', value: 'Aug 25' }], hoverFooter: 'Reactivates <b>automatically</b> next billing', kadePose: 'success' },
  { id: 'simone', name: 'Simone Giertz', initials: 'SG', joinedMeta: 'joined 6d ago',  hoverHandle: 'joined June 29 · 6 days ago',  status: 'paid', statusLabel: 'Paid', mrr: '$50/mo', tileSlug: 'paid-row-4', hoverStatusLabel: 'Paid this month', hoverStats: [{ label: 'Your MRR', value: '$50/mo', money: true }, { label: 'Lifetime paid', value: '$50',  money: true }, { label: 'Next drop', value: 'Aug 29' }], hoverFooter: 'Reactivates <b>automatically</b> next billing', kadePose: 'success' },
  { id: 'marina', name: 'Marina Mogilko', initials: 'MK', joinedMeta: 'joined 2d ago',  hoverHandle: 'joined July 2 · 2 days ago',   status: 'paid', statusLabel: 'Paid', mrr: '$50/mo', tileSlug: 'paid-row-5', hoverStatusLabel: 'Paid this month', hoverStats: [{ label: 'Your MRR', value: '$50/mo', money: true }, { label: 'Lifetime paid', value: '$50',  money: true }, { label: 'Next drop', value: 'Sep 2' }],  hoverFooter: 'Reactivates <b>automatically</b> next billing', kadePose: 'success' },
];

const DROPS: DropRow[] = [
  { quiet: false, name: 'Marques Brownlee · $50 drop',      meta: 'Whop split · 50% · instant', time: '2h ago',  amount: '+$50.00' },
  { quiet: false, name: 'Casey Neistat · $50 drop',         meta: 'Whop split · 50% · instant', time: '1d ago',  amount: '+$50.00' },
  { quiet: true,  name: 'Payout to bank · $500.00',         meta: 'ACH · standard · 2-3 days',  time: '4d ago',  amount: '-$500.00', negative: true },
  { quiet: false, name: 'Emma Chamberlain · $50 drop',      meta: 'Whop split · 50% · instant', time: '6d ago',  amount: '+$50.00' },
  { quiet: false, name: 'Colin & Samir · $50 drop',         meta: 'Whop split · 50% · instant', time: '8d ago',  amount: '+$50.00' },
  { quiet: false, name: 'Airrack · $50 drop',               meta: 'Whop split · 50% · instant', time: '12d ago', amount: '+$50.00' },
  { quiet: false, name: 'Cleo Abram · $50 drop',            meta: 'Whop split · 50% · instant', time: '14d ago', amount: '+$50.00' },
  { quiet: true,  name: 'Payout to bank · $250.00',         meta: 'Instant · fee · to card',    time: '18d ago', amount: '-$250.00', negative: true },
  { quiet: false, name: 'Ali Abdaal · $50 drop',            meta: 'Whop split · 50% · instant', time: '21d ago', amount: '+$50.00' },
];

const STATE_TO_HOVER_ID: Record<WalletState, string | null> = {
  'fresh-install':    null,
  'populated':        null,
  'hover-marques':    'marques',
  'hover-ali':        'ali',
  'hover-airrack':    'airrack',
  'hover-johnny':     'johnny',
};

// ─────────────────────────────────────────────────────────────

export interface WalletDetailProps {
  showScrubber?: boolean;
  onWithdraw?: () => void;
  onBack?: () => void;
}

export function WalletDetail(props: WalletDetailProps) {
  const [state, setState] = useState<WalletState>('fresh-install');
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [hoverAnchor, setHoverAnchor] = useState<{ x: number; y: number } | null>(null);
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const showScrubber = props.showScrubber ?? tryImportMetaDev();

  const stageDataState: 'fresh-install' | 'populated' = state === 'fresh-install' ? 'fresh-install' : 'populated';

  // Force-hover from the scrubber demos.
  const forcedHoverId = STATE_TO_HOVER_ID[state];
  const activeHoverId = hoverId ?? forcedHoverId;
  const activeHoverRow = useMemo(
    () => (activeHoverId ? CLIPPERS.find((c) => c.id === activeHoverId) ?? null : null),
    [activeHoverId],
  );

  const onRowEnter = useCallback((id: string, rect: DOMRect) => {
    setHoverId(id);
    // Position the fixed card next to the row · right side when there's
    // room, otherwise flip left.
    const cardWidth = 280;
    const rightGap = 14;
    const canRight = rect.right + cardWidth + rightGap < window.innerWidth;
    const x = canRight ? rect.right + rightGap : rect.left - cardWidth - rightGap;
    const y = Math.max(16, Math.min(window.innerHeight - 320, rect.top - 8));
    setHoverAnchor({ x, y });
  }, []);
  const onRowLeave = useCallback(() => {
    if (forcedHoverId) return;   // keep the demo card visible
    setHoverId(null);
    setHoverAnchor(null);
  }, [forcedHoverId]);

  // When the scrubber picks a hover-demo, pin the card at the row's slot.
  useEffect(() => {
    if (!forcedHoverId) return;
    const row = document.querySelector(`[data-clipper-id="${forcedHoverId}"]`);
    if (row) {
      const rect = row.getBoundingClientRect();
      onRowEnter(forcedHoverId, rect);
    }
  }, [forcedHoverId, onRowEnter]);

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

  const balanceValue = state === 'fresh-install' ? '$0.00' : '$247.50';
  const balanceMrrLabel = state === 'fresh-install'
    ? 'Your MRR fills the moment a sub hits'
    : '$742.50/mo · next payout in 4 days';
  const activeCount = state === 'fresh-install' ? 0 : 15;
  const lifetime = state === 'fresh-install' ? '$0' : '$1,485';
  const breakEven = state === 'fresh-install' ? '—' : '7.4×';

  return (
    <div className="wd-root">
      {showScrubber && (
        <div className="wd-scrubber" role="tablist" aria-label="Wallet state">
          <span className="wd-scrubber-label">STATE</span>
          {[
            { id: 'fresh-install', label: '1 · Fresh install · empty' },
            { id: 'populated',     label: '2 · Populated · 15 clippers' },
            { id: 'hover-marques', label: '3 · Hover · paid + streak' },
            { id: 'hover-ali',     label: '4 · Hover · paid normal' },
            { id: 'hover-airrack', label: '5 · Hover · grace / missed' },
            { id: 'hover-johnny',  label: '6 · Hover · cancelled' },
          ].map((s) => (
            <button
              key={s.id}
              type="button"
              className="wd-scrubber-btn"
              data-active={state === s.id}
              onClick={() => setState(s.id as WalletState)}
            >
              {s.label}
            </button>
          ))}
          <span className="wd-scrubber-note">Hover any clipper row · IRL</span>
        </div>
      )}

      <div className="wd-stage" data-state={stageDataState}>
        <div className="wd-panel">
          <div className="wd-panel-clip" />
          <div className="wd-whop-pill">
            Powered by
            <img src="/brand/whop/whop_logo_lockup_white.svg" alt="Whop" />
          </div>

          {/* HERO */}
          <div className="wd-hero">
            <div className="wd-hero-meta">
              <button className="wd-back-btn" type="button" onClick={props.onBack}>Back</button>
              <span className="wd-wallet-label">Wallet · <b>referral ledger</b></span>
            </div>
            <div>
              <span className="wd-balance-eyebrow">Balance · Whop · instant</span>
              <div className="wd-balance-value">{balanceValue}</div>
              <div className="wd-balance-mrr">
                {state === 'fresh-install' ? balanceMrrLabel : <><b>{balanceMrrLabel.split(' ·')[0]}</b>{balanceMrrLabel.slice(balanceMrrLabel.indexOf(' ·'))}</>}
              </div>
            </div>
            <div className="wd-stat-row">
              <div className="wd-stat-card"><div className="wd-stat-label">Active</div><div className="wd-stat-value">{activeCount}</div></div>
              <div className="wd-stat-card"><div className="wd-stat-label">Your MRR</div><div className="wd-stat-value is-money">{state === 'fresh-install' ? '$0.00' : '$742.50'}</div></div>
              <div className="wd-stat-card"><div className="wd-stat-label">Lifetime</div><div className="wd-stat-value">{lifetime}</div></div>
              <div className="wd-stat-card"><div className="wd-stat-label">Break-even</div><div className="wd-stat-value">{breakEven}</div></div>
            </div>
            <button className="wd-withdraw-btn" type="button" onClick={props.onWithdraw} disabled={state === 'fresh-install'}>
              Withdraw
            </button>
          </div>

          {/* BODY · clippers + drops */}
          <div className="wd-body">
            <div className="wd-col">
              <div className="wd-col-header">
                <div className="wd-col-title">Your clippers · <span className="wd-col-title-count">{activeCount} paying</span></div>
                <div className="wd-col-tabs">
                  <button className="wd-col-tab is-active">Paying</button>
                  <button className="wd-col-tab">All</button>
                </div>
              </div>
              <div className="wd-col-scroll">
                <div className="wd-empty-hint">
                  No clippers yet.<br /><br />
                  Send outreach from the money-moment window · every clipper who subs = <b>$50/mo, for LIFE</b>.
                </div>
                {CLIPPERS.map((c) => (
                  <div
                    key={c.id}
                    className="wd-clipper-row"
                    data-tile={c.tileSlug}
                    data-clipper-id={c.id}
                    onMouseEnter={(e) => onRowEnter(c.id, e.currentTarget.getBoundingClientRect())}
                    onMouseLeave={onRowLeave}
                  >
                    <div className="wd-clipper-avatar">{c.initials}</div>
                    <div className="wd-clipper-info">
                      <div className="wd-clipper-name">{c.name}</div>
                      <div className="wd-clipper-meta">{c.joinedMeta}</div>
                    </div>
                    <span className={`wd-status-pill ${statusPillClass(c.status)}`}>{c.statusLabel}</span>
                    <div className={`wd-clipper-mrr ${c.status === 'missed' ? 'is-quiet' : ''} ${c.status === 'cancelled' ? 'is-strike' : ''}`}>{c.mrr}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="wd-col">
              <div className="wd-col-header">
                <div className="wd-col-title">Recent drops · <span className="wd-col-title-count">this month</span></div>
                <div className="wd-col-tabs">
                  <button className="wd-col-tab is-active">Month</button>
                  <button className="wd-col-tab">Lifetime</button>
                </div>
              </div>
              <div className="wd-col-scroll">
                <div className="wd-empty-hint">
                  <b>0 drops</b> so far.<br /><br />
                  The moment a clipper subs, their $50 lands here instantly.
                </div>
                {DROPS.map((d, i) => (
                  <div key={i} className="wd-drop-row">
                    <div className={`wd-drop-mark ${d.quiet ? 'is-quiet' : ''}`} />
                    <div>
                      <div className="wd-drop-name">{d.name}</div>
                      <div className="wd-drop-meta">{d.meta}</div>
                    </div>
                    <div className="wd-drop-time">{d.time}</div>
                    <div className={`wd-drop-amount ${d.negative ? 'is-neg' : ''}`}>{d.amount}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* FOOTER · coach + fine */}
          <div className="wd-footer">
            <div className="wd-coach">
              <div className="wd-coach-thumb" onClick={toggleMute}>
                <video ref={videoRef} autoPlay muted playsInline loop preload="auto">
                  <source src="/brand/founder/founder-wallet.mp4" type="video/mp4" />
                </video>
              </div>
              <div>
                <div className="wd-coach-eyebrow">Daniel · founder · 33 sec</div>
                <div className="wd-coach-script">
                  "Hey guys — here's your affiliate page. See lifetime sales, streaks, all of it.
                  Hover any clipper to check if they paid this month. We don't advise contacting
                  affiliates — unless they're your friends. And remember: <b>your commissions only
                  pay if you keep your subscription.</b> Thanks — God bless."
                </div>
                <button type="button" className="wd-coach-audio" onClick={toggleMute}>
                  {muted ? 'Click for sound' : 'Mute'}
                </button>
              </div>
            </div>
            <div className="wd-fine">
              Withdrawals via <b>Whop payout portal</b> · $10 min · <b>5%</b> platform fee · ACH 2–3d or Instant (fee)
            </div>
          </div>
        </div>
      </div>

      {/* Hover card · fixed positioning, mouseenter positions it */}
      {activeHoverRow && hoverAnchor && (
        <div
          className="wd-hover-card is-visible"
          style={{ left: hoverAnchor.x, top: hoverAnchor.y }}
          onMouseEnter={() => setHoverId(activeHoverRow.id)}
          onMouseLeave={onRowLeave}
        >
          <div className="wd-hover-kade">
            <img
              src={`/brand/kade/kade-${activeHoverRow.kadePose}.webp`}
              alt=""
              onError={(e) => (e.currentTarget.style.display = 'none')}
            />
          </div>
          <div className="wd-hover-name">{activeHoverRow.name}</div>
          <div className="wd-hover-handle">{activeHoverRow.hoverHandle}</div>
          <div className="wd-hover-status-line">
            <span className={`wd-status-pill ${statusPillClass(activeHoverRow.status)}`}>{activeHoverRow.hoverStatusLabel}</span>
          </div>
          <div className="wd-hover-stats">
            {activeHoverRow.hoverStats.map((s) => (
              <div key={s.label} className="wd-hover-stat">
                <span className="wd-hover-stat-label">{s.label}</span>
                <span className={`wd-hover-stat-value ${s.money ? 'is-money' : ''}`}>{s.value}</span>
              </div>
            ))}
          </div>
          <div className="wd-hover-footer" dangerouslySetInnerHTML={{ __html: activeHoverRow.hoverFooter }} />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────

function statusPillClass(status: RowStatus): string {
  if (status === 'missed') return 'is-missed';
  if (status === 'cancelled') return 'is-cancelled';
  return 'is-paid';   // paid + streak share the same pill visual
}

function tryImportMetaDev(): boolean {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  } catch { return false; }
}
