/**
 * Route · wallet-detail
 * Source: 05_html-mockups/approved/wallet-detail.html v3 · 2026-07-04
 * (canonical copy at desktop-2/docs/mockups/approved/wallet-detail.html)
 *
 * Chapter 10 · 2026-07-10 (Lane A · Product surface).
 * Brought to full parity with the approved mockup:
 *   - POWERED BY WHOP header badge
 *   - Breadcrumb (BACK · WALLET · REFERRAL LEDGER)
 *   - Filter pills (BALANCE · WHOP · INSTANT · informational)
 *   - 6-state selector (visually hidden unless admin override is active)
 *   - 4-metric row bound to real hook fields (Active · Your MRR · Lifetime ·
 *     Break-even) with honest "hide-the-cell" when a field is missing
 *   - Withdraw CTA wired to the same claim path WalletPanel uses
 *   - Your Clippers card + Recent Drops card with honest empty states
 *     when the API doesn't yet surface roster / drop rows
 *   - Founder video in <SafeVideo> · Daniel's verbatim speech-bubble
 *     script · "CLICK FOR SOUND" toggle
 *   - Behavioral lcDiag events (no `*_rendered` events)
 *   - Watchdog + EngineErrorBoundary wrap the SimulatorRouter surface
 *     mount (see src/design-os/routing/SimulatorRouter.tsx). The route
 *     is ALSO reachable through AccountSection → outer AppShell hash
 *     resolution (#/account) which mounts <WalletDetail /> directly;
 *     the Section-mounted path relies on section-level boundaries.
 *
 * C1-T1 · 2026-07-05 · Real wallet data pipeline (retained).
 * `useWalletLedger()` (single shared fetch, module-level cache in
 * src/lib/wallet.ts) returns the 5 authoritative states:
 *   loading                       skeleton on first mount
 *   unauthorized                  Sign-in CTA (401 / no JWT)
 *   error                         retry CTA
 *   empty                         new user · pre-payout state
 *   populated                     real ledger rows
 *   expired-affiliate-agreement   claim returned signature_frozen
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DemoOverlay } from '../../components/demo-overlay';
import { SafeVideo } from '../../components/safe/SafeVideo';
import {
  postWalletClaim,
  isAgreementSignedMessage,
  CLAIM_BLOCKED_HEADING,
  useWalletLedger,
  fmtUsdCents,
  fmtRelativeTime,
  type ClaimResponse,
  type WalletLedgerRow,
} from '../../lib/wallet';
import { useBrowseOverlay } from '../../state/browseOverlay';
import { bus } from '../../design-os/bridge/events';
import { lcDiag } from '../../lib/diagnosticLogger';
import './WalletDetail.css';

// Chapter 10 · Six approved scrubber states. In production these are
// visually hidden UNLESS admin state-override is active — Lane B is
// building `admin_state_override.checkOverride('wallet-detail')` on the
// backend + StatePuppeteerTab in the account-app HQ. Until that lands,
// `readAdminOverride()` always returns null so the scrubber never
// paints in the shipped app. When Lane B ships the endpoint, wire it
// here — do NOT wire it now.
type WalletMockupState =
  | 'fresh-install'
  | 'populated'
  | 'hover-paid-streak'
  | 'hover-paid-normal'
  | 'hover-grace-missed'
  | 'hover-cancelled';

const WALLET_MOCKUP_STATES: ReadonlyArray<{ id: WalletMockupState; label: string }> = [
  { id: 'fresh-install',       label: '1 · Fresh install · empty' },
  { id: 'populated',           label: '2 · Populated · 15 clippers' },
  { id: 'hover-paid-streak',   label: '3 · Hover · paid + streak' },
  { id: 'hover-paid-normal',   label: '4 · Hover · paid normal' },
  { id: 'hover-grace-missed',  label: '5 · Hover · grace / missed' },
  { id: 'hover-cancelled',     label: '6 · Hover · cancelled' },
];

/** Reads Lane B's `admin_state_override.checkOverride('wallet-detail')`
 *  once the backend endpoint lands. Until then this always returns
 *  null so the scrubber stays keyboard-invisible in production.
 *  See CLAUDE_DESKTOP2_UI_MASTER.md § "admin state-override". */
function readAdminOverride(): WalletMockupState | null {
  // TODO(lane-b): replace with real read once
  // `junior-backend/app/routes/admin_state_override.py` ships. Contract:
  //   window.__lcAdminStateOverride?.checkOverride('wallet-detail')
  //     ?? null;
  return null;
}

export interface WalletDetailProps {
  onBack?: () => void;
  /** Legacy escape hatch · QA harness passes an override to short-
   *  circuit the claim wire and forward the click to the harness. */
  onWithdraw?: () => void;
}

export function WalletDetail(props: WalletDetailProps) {
  const {
    uiState,
    summary,
    errorReason,
    refetch,
    markSignatureExpired,
  } = useWalletLedger();

  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  // ── Admin-only mockup state selector (visually hidden in prod) ──
  const adminOverride = readAdminOverride();
  const [visibleMockupState, setVisibleMockupState] = useState<WalletMockupState>(
    adminOverride ?? 'populated',
  );

  // ── Behavioral HQ events (all through existing lcDiag) ──────────
  const mountedRef = useRef(false);
  const stateSeenRef = useRef<Set<WalletMockupState>>(new Set());
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    lcDiag('wallet_viewed', { state: uiState });
    // First-view of the visible mockup state (mostly interesting when
    // Lane B's override is active).
    stateSeenRef.current.add(visibleMockupState);
    lcDiag('wallet_state_viewed', {
      state: visibleMockupState,
      first_view_of_state: true,
    });
    // Intentional single-fire on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    // Fire once per new visible-state (admin override sweep).
    if (!mountedRef.current) return;
    const firstView = !stateSeenRef.current.has(visibleMockupState);
    if (firstView) stateSeenRef.current.add(visibleMockupState);
    lcDiag('wallet_state_viewed', {
      state: visibleMockupState,
      first_view_of_state: firstView,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleMockupState]);

  // ── Claim wire (Task D · preserved) ─────────────────────────────
  const openBrowsePanel = useBrowseOverlay((s) => s.openWith);
  const closeBrowsePanel = useBrowseOverlay((s) => s.close);
  type ClaimUiState =
    | 'idle'
    | 'claiming'
    | 'awaiting_signature'
    | 'released'
    | 'error';
  const [claimState, setClaimState] = useState<ClaimUiState>('idle');
  const [toast, setToast] = useState<{ heading: string; body?: string } | null>(
    null,
  );
  const toastTimerRef = useRef<number | null>(null);
  const showingToast = useCallback((heading: string, body?: string) => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToast({ heading, body });
    toastTimerRef.current = window.setTimeout(() => setToast(null), 4200);
  }, []);

  const runClaim = useCallback(async () => {
    const availableCents = summary?.balance_cents ?? 0;
    lcDiag('withdraw_clicked', { available_cents: availableCents });
    setClaimState('claiming');
    const res: ClaimResponse | null = await postWalletClaim();
    if (!res) {
      setClaimState('error');
      lcDiag('withdraw_failed', { reason: 'network' });
      showingToast(
        'Wallet is briefly unreachable.',
        'Check your connection · try again in a moment.',
      );
      return;
    }
    if (res.blocked && res.blocked_reason) {
      const heading =
        CLAIM_BLOCKED_HEADING[res.blocked_reason.code]
        ?? res.blocked_reason.message;
      showingToast(heading, res.blocked_reason.message);
      if (res.blocked_reason.code === 'signature_frozen') {
        markSignatureExpired();
        setClaimState('idle');
        lcDiag('withdraw_failed', { reason: 'signature_frozen' });
        return;
      }
      setClaimState('awaiting_signature');
      lcDiag('withdraw_failed', { reason: res.blocked_reason.code });
      openBrowsePanel(res.blocked_reason.signature_url, 'browse-campaign');
      return;
    }
    setClaimState('released');
    const releasedCents = res.amount_released_cents ?? availableCents;
    lcDiag('withdraw_succeeded', { amount_cents: releasedCents });
    const receiptHead = (res.receipt_sha256 ?? '').slice(0, 12);
    showingToast(
      'Payout released.',
      receiptHead ? `Receipt ${receiptHead}…` : undefined,
    );
    void refetch();
    window.setTimeout(() => setClaimState('idle'), 4000);
  }, [
    markSignatureExpired,
    openBrowsePanel,
    refetch,
    showingToast,
    summary,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMessage = (ev: MessageEvent) => {
      if (!isAgreementSignedMessage(ev.data)) return;
      if (claimState !== 'awaiting_signature') return;
      closeBrowsePanel();
      void runClaim();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [claimState, closeBrowsePanel, runClaim]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // ── Founder-video mute toggle + HQ events ───────────────────────
  const videoStartedRef = useRef(false);
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
          surface: 'wallet-detail',
          video_file: 'founder-wallet.mp4',
        });
      }
    } else {
      v.muted = true;
      setMuted(true);
    }
  }, []);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onEnded = () => {
      lcDiag('founder_video_finished', {
        surface: 'wallet-detail',
        seconds_watched: Math.floor(v.currentTime),
      });
    };
    v.addEventListener('ended', onEnded);
    return () => v.removeEventListener('ended', onEnded);
  }, []);

  // ── Derived render values from real summary ──────────────────
  const balanceCents = summary?.balance_cents ?? 0;
  const pendingCents = summary?.pending_cents ?? 0;
  const nextPayoutAt = summary?.next_payout_at ?? null;
  const lifetimePaidCents = summary?.pipeline.paid_usd_cents ?? 0;
  const ledgerRows: WalletLedgerRow[] = summary?.recent_ledger ?? [];

  // Chapter 10 · 4-metric row bindings. Task spec calls for:
  //   ACTIVE clippers   → affiliate roster count · NOT in current API →
  //                       cell HIDDEN (see comment below)
  //   YOUR MRR          → monthly_recurring_referral_usd · NOT in
  //                       current API → cell HIDDEN
  //   LIFETIME          → lifetime_paid_usd_cents (pipeline.paid_usd_cents)
  //   BREAK-EVEN        → (lifetime - subscription_cost) — subscription_cost
  //                       NOT in current API → cell HIDDEN
  //
  // TODO(backend): surface these fields on /me/wallet/summary. Until
  // they land, the row degrades to Balance + Pending + Lifetime + Next
  // payout (the same real fields the previous version rendered). Every
  // hidden cell is documented so a future backend patch can flip it on
  // with a one-line change.
  const activeClipperCount: number | null = null; // TODO(backend): summary.affiliate_active_count
  const mrrCents: number | null = null;           // TODO(backend): summary.monthly_recurring_referral_usd_cents
  const subscriptionCostCents: number | null = null; // TODO(backend): summary.subscription_cost_usd_cents
  const breakEvenRatio =
    lifetimePaidCents > 0 && subscriptionCostCents !== null && subscriptionCostCents > 0
      ? lifetimePaidCents / subscriptionCostCents
      : null;

  const balanceValue = fmtUsdCents(balanceCents);
  const balanceSubline = useMemo(() => {
    if (mrrCents !== null && mrrCents > 0) {
      // Approved mockup subline: `$X.XX/mo · next payout in Nd`.
      if (nextPayoutAt) {
        return `${fmtUsdCents(mrrCents)}/mo · next payout ${fmtRelativeTime(nextPayoutAt)}`;
      }
      return `${fmtUsdCents(mrrCents)}/mo`;
    }
    if (pendingCents > 0 && nextPayoutAt) {
      const rel = fmtRelativeTime(nextPayoutAt);
      return `${fmtUsdCents(pendingCents)} pending · next payout ${rel}`;
    }
    if (uiState === 'empty') {
      return 'Fills the moment a sub hits.';
    }
    return 'Balance updated live from Whop · payouts fire on the next scheduler tick.';
  }, [mrrCents, pendingCents, nextPayoutAt, uiState]);

  const claimDisabled =
    uiState !== 'populated' ||
    balanceCents <= 0 ||
    claimState === 'claiming' ||
    claimState === 'awaiting_signature';

  // Fire withdraw_disabled once per reason change so HQ sees why the
  // CTA didn't accept a click. Reason is the strongest gate right now.
  const disabledReasonRef = useRef<string | null>(null);
  useEffect(() => {
    if (!claimDisabled) {
      disabledReasonRef.current = null;
      return;
    }
    const reason =
      uiState !== 'populated'
        ? `ui_state:${uiState}`
        : balanceCents <= 0
          ? 'balance_below_minimum'
          : `claim_state:${claimState}`;
    if (disabledReasonRef.current === reason) return;
    disabledReasonRef.current = reason;
    lcDiag('withdraw_disabled', { reason });
  }, [claimDisabled, uiState, balanceCents, claimState]);

  const stageDataState: 'fresh-install' | 'populated' =
    uiState === 'populated' ? 'populated' : 'fresh-install';

  // ── Full-surface states (loading · unauthorized · error) ─────
  if (uiState === 'loading') {
    return (
      <div className="wd-root" data-ui-state="loading">
        <div className="wd-stage" data-state="fresh-install">
          <div className="wd-panel wd-panel--full">
            <div className="wd-full-state" data-testid="wallet-loading">
              <div className="wd-full-title">Loading your wallet…</div>
              <div className="wd-full-body">
                Fetching your balance from Whop.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (uiState === 'unauthorized') {
    return (
      <div className="wd-root" data-ui-state="unauthorized">
        <div className="wd-stage" data-state="fresh-install">
          <div className="wd-panel wd-panel--full">
            <div className="wd-full-state" data-testid="wallet-unauthorized">
              <div className="wd-full-title">Sign in to see your wallet</div>
              <div className="wd-full-body">
                Your wallet is scoped to your Whop account · sign in to see
                real balance + payout history.
              </div>
              <button
                type="button"
                className="wd-full-cta"
                onClick={() => bus.emit('auth:open-panel', {})}
                data-testid="wallet-sign-in"
              >
                Sign in
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (uiState === 'error') {
    const bodyCopy =
      errorReason === 'network'
        ? 'Wallet is briefly unreachable. Check your connection and try again.'
        : errorReason === 'shape'
          ? 'The wallet response is out of shape. Please retry in a moment.'
          : 'The wallet endpoint returned an error. Please try again.';
    return (
      <div className="wd-root" data-ui-state="error">
        <div className="wd-stage" data-state="fresh-install">
          <div className="wd-panel wd-panel--full">
            <div className="wd-full-state" data-testid="wallet-error">
              <div className="wd-full-title">Wallet briefly out of reach</div>
              <div className="wd-full-body">{bodyCopy}</div>
              <button
                type="button"
                className="wd-full-cta"
                onClick={() => void refetch()}
                data-testid="wallet-retry"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // uiState is `empty`, `populated`, or `expired-affiliate-agreement`.
  return (
    <div className="wd-root" data-ui-state={uiState}>
      {/* Admin-only mockup state scrubber. In production Lane B's
          override endpoint gates the paint entirely — until then the
          scrubber renders keyboard-invisible (0×0 clip · aria-hidden).
          When Lane B lands the override, remove the visually-hidden
          wrap and gate paint on `adminOverride !== null`. */}
      <div
        className="wd-scrubber"
        role="tablist"
        aria-label="Wallet mockup state"
        aria-hidden={adminOverride === null}
        data-testid="wallet-state-scrubber"
        style={
          adminOverride === null
            ? { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', whiteSpace: 'nowrap' }
            : undefined
        }
      >
        <span className="wd-scrubber-label">STATE</span>
        {WALLET_MOCKUP_STATES.map((s) => (
          <button
            key={s.id}
            type="button"
            className="wd-scrubber-btn"
            data-active={visibleMockupState === s.id ? 'true' : 'false'}
            onClick={() => setVisibleMockupState(s.id)}
            tabIndex={adminOverride === null ? -1 : 0}
          >
            {s.label}
          </button>
        ))}
        <span className="wd-scrubber-note">Hover any clipper row · IRL</span>
      </div>

      <div className="wd-stage" data-state={stageDataState}>
        <div className="wd-panel">
          <div className="wd-panel-clip" />

          {/* POWERED BY WHOP header badge */}
          <div className="wd-whop-pill" data-testid="wallet-powered-by-whop">
            Powered by
            <img
              src="/brand/whop/whop_logo_lockup_white.svg"
              alt="Whop"
              onError={(e) => (e.currentTarget.style.display = 'none')}
            />
          </div>

          {uiState === 'expired-affiliate-agreement' && (
            <div
              className="wd-expired-banner"
              role="status"
              aria-live="polite"
              data-testid="wallet-expired-banner"
            >
              <div className="wd-expired-title">
                Your affiliate agreement is frozen
              </div>
              <div className="wd-expired-body">
                A payment dispute on your subscription has paused payouts.
                Contact support to resolve the dispute before further
                payouts can be issued.
              </div>
              <a
                className="wd-expired-cta"
                href="mailto:support@liquidclips.app"
              >
                Contact support
              </a>
            </div>
          )}

          {/* HERO · breadcrumb + balance + 4-metric row + withdraw */}
          <div className="wd-hero">
            <div className="wd-hero-meta">
              <button
                className="wd-back-btn"
                type="button"
                onClick={props.onBack}
              >
                Back
              </button>
              <span className="wd-wallet-label">
                Wallet · <b>referral ledger</b>
              </span>
            </div>
            <div>
              <span
                className="wd-balance-eyebrow"
                data-testid="wallet-filter-pills"
              >
                {/* Filter pills — informational; the endpoint returns a
                    single "Whop instant" bucket today so these are
                    read-only labels until the backend exposes multiple
                    payout rails. */}
                Balance · Whop · instant
              </span>
              <div className="wd-balance-value" data-testid="wallet-balance">
                {balanceValue}
              </div>
              <div className="wd-balance-mrr">{balanceSubline}</div>
            </div>
            <div className="wd-stat-row" data-testid="wallet-4-metric-row">
              {/* ACTIVE clippers · cell hidden when the API doesn't
                  surface roster count yet — see TODO(backend) above. */}
              {activeClipperCount !== null ? (
                <div className="wd-stat-card" data-testid="wallet-stat-active">
                  <div className="wd-stat-label">Active</div>
                  <div className="wd-stat-value">{activeClipperCount}</div>
                </div>
              ) : null}
              {/* YOUR MRR · cell hidden when the API doesn't surface
                  monthly_recurring_referral_usd_cents yet. */}
              {mrrCents !== null ? (
                <div className="wd-stat-card" data-testid="wallet-stat-mrr">
                  <div className="wd-stat-label">Your MRR</div>
                  <div className="wd-stat-value is-money">
                    {fmtUsdCents(mrrCents)}
                  </div>
                </div>
              ) : null}
              {/* LIFETIME · always present when summary loaded. */}
              <div className="wd-stat-card" data-testid="wallet-stat-lifetime">
                <div className="wd-stat-label">Lifetime</div>
                <div className="wd-stat-value">
                  {fmtUsdCents(lifetimePaidCents)}
                </div>
              </div>
              {/* BREAK-EVEN · hidden until subscription_cost is in
                  the API. */}
              {breakEvenRatio !== null ? (
                <div className="wd-stat-card" data-testid="wallet-stat-break-even">
                  <div className="wd-stat-label">Break-even</div>
                  <div className="wd-stat-value">
                    {breakEvenRatio.toFixed(1)}×
                  </div>
                </div>
              ) : null}
              {/* Fallback tiles when backend is missing 3 of 4 fields
                  · surface the honest fields we DO have so the row
                  never shrinks to a single card. */}
              {activeClipperCount === null && mrrCents === null ? (
                <div className="wd-stat-card" data-testid="wallet-stat-balance">
                  <div className="wd-stat-label">Balance</div>
                  <div className="wd-stat-value is-money">
                    {fmtUsdCents(balanceCents)}
                  </div>
                </div>
              ) : null}
              {activeClipperCount === null && mrrCents === null ? (
                <div className="wd-stat-card" data-testid="wallet-stat-pending">
                  <div className="wd-stat-label">Pending</div>
                  <div className="wd-stat-value">
                    {fmtUsdCents(pendingCents)}
                  </div>
                </div>
              ) : null}
              {breakEvenRatio === null && subscriptionCostCents === null ? (
                <div className="wd-stat-card" data-testid="wallet-stat-next-payout">
                  <div className="wd-stat-label">Next payout</div>
                  <div className="wd-stat-value">
                    {nextPayoutAt ? fmtRelativeTime(nextPayoutAt) : '—'}
                  </div>
                </div>
              ) : null}
            </div>
            <button
              className="wd-withdraw-btn"
              type="button"
              onClick={() => {
                if (props.onWithdraw) {
                  props.onWithdraw();
                  return;
                }
                if (
                  claimState === 'claiming' ||
                  claimState === 'awaiting_signature'
                )
                  return;
                void runClaim();
              }}
              disabled={claimDisabled}
              aria-busy={
                claimState === 'claiming' ||
                claimState === 'awaiting_signature'
              }
              data-claim-state={claimState}
              data-testid="wallet-withdraw"
            >
              {claimState === 'claiming'
                ? 'Claiming…'
                : claimState === 'awaiting_signature'
                  ? 'Waiting for signature…'
                  : 'Withdraw'}
            </button>
          </div>

          {/* BODY · Your Clippers + Recent drops */}
          <div className="wd-body">
            {/* Your Clippers · PAYING / ALL filter */}
            <div className="wd-col" data-testid="wallet-clippers-card">
              <div className="wd-col-header">
                <div className="wd-col-title">
                  Your clippers ·{' '}
                  <span className="wd-col-title-count">
                    {activeClipperCount !== null
                      ? `${activeClipperCount} paying`
                      : 'none yet'}
                  </span>
                </div>
                <div className="wd-col-tabs" role="tablist" aria-label="Clipper filter">
                  <button
                    type="button"
                    className="wd-col-tab is-active"
                    role="tab"
                    aria-selected="true"
                    disabled
                  >
                    Paying
                  </button>
                  <button
                    type="button"
                    className="wd-col-tab"
                    role="tab"
                    aria-selected="false"
                    disabled
                  >
                    All
                  </button>
                </div>
              </div>
              <div className="wd-col-scroll">
                {/* Honest empty · the backend doesn't yet expose the
                    affiliate roster on /me/wallet/summary. When it
                    does, replace this with .map() over
                    `summary.affiliate_roster`. */}
                <div className="wd-empty-hint" data-testid="wallet-clippers-empty">
                  Send outreach from the money-moment window · every
                  clipper who subs = <b>$50/mo, for LIFE</b>.
                </div>
              </div>
            </div>

            {/* Recent drops · MONTH / LIFETIME filter */}
            <div className="wd-col" data-testid="wallet-drops-card">
              <div className="wd-col-header">
                <div className="wd-col-title">
                  Recent drops ·{' '}
                  <span className="wd-col-title-count">
                    {ledgerRows.length === 0 ? 'none yet' : 'this month'}
                  </span>
                </div>
                <div className="wd-col-tabs" role="tablist" aria-label="Drops filter">
                  <button
                    type="button"
                    className="wd-col-tab is-active"
                    role="tab"
                    aria-selected="true"
                    disabled
                  >
                    Month
                  </button>
                  <button
                    type="button"
                    className="wd-col-tab"
                    role="tab"
                    aria-selected="false"
                    disabled
                  >
                    Lifetime
                  </button>
                </div>
              </div>
              <div className="wd-col-scroll">
                {ledgerRows.length === 0 ? (
                  <div className="wd-empty-hint" data-testid="wallet-drops-empty">
                    <b>0 drops</b> so far.
                    <br />
                    <br />
                    The moment a clipper subs, their $50 lands here instantly.
                  </div>
                ) : (
                  ledgerRows.map((row) => {
                    const negative = row.type === 'debit' || row.type === 'payout';
                    const sign = negative ? '-' : '+';
                    const amount = `${sign}${fmtUsdCents(Math.abs(row.amount_cents))}`;
                    return (
                      <div
                        key={row.id}
                        className="wd-drop-row"
                        data-ledger-type={row.type}
                        data-testid="wallet-drop-row"
                      >
                        <div
                          className={`wd-drop-mark ${row.type === 'payout' ? 'is-quiet' : ''}`}
                        />
                        <div>
                          <div className="wd-drop-name">
                            {ledgerRowLabel(row)}
                          </div>
                          <div className="wd-drop-meta">
                            {ledgerRowMeta(row)}
                          </div>
                        </div>
                        <div className="wd-drop-time">
                          {fmtRelativeTime(row.created_at)}
                        </div>
                        <div
                          className={`wd-drop-amount ${negative ? 'is-neg' : ''}`}
                        >
                          {amount}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* FOOTER · founder video + fine-print */}
          <div className="wd-footer">
            <div className="wd-coach" data-testid="wallet-founder-video">
              <div
                className="wd-coach-thumb"
                onClick={toggleMute}
                role="button"
                tabIndex={0}
                aria-label={muted ? 'Play founder video with sound' : 'Mute founder video'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleMute();
                  }
                }}
              >
                <SafeVideo
                  ref={videoRef}
                  src="/brand/founder/founder-wallet.mp4"
                  autoPlay
                  muted
                  playsInline
                  loop
                  preload="auto"
                />
              </div>
              <div>
                <div className="wd-coach-eyebrow">
                  Daniel · founder · 33 sec
                </div>
                <div className="wd-coach-script">
                  &ldquo;Hey guys — here&apos;s your affiliate page. See lifetime
                  sales, streaks, all of it. Hover any clipper to check if they
                  paid this month. We don&apos;t advise contacting affiliates —
                  unless they&apos;re your friends. And remember:{' '}
                  <b>your commissions only pay if you keep your subscription.</b>{' '}
                  Thanks — God bless.&rdquo;
                </div>
                <button
                  type="button"
                  className="wd-coach-audio"
                  onClick={toggleMute}
                  data-muted={muted ? 'true' : 'false'}
                  data-testid="wallet-founder-sound"
                >
                  {muted ? 'Click for sound' : 'Mute'}
                </button>
              </div>
            </div>
            <div className="wd-fine">
              Withdrawals via <b>Whop payout portal</b> · $50 min ·{' '}
              <b>5%</b> platform fee · ACH 2–3d or Instant (fee)
            </div>
          </div>
        </div>
      </div>

      {/* Contextual onboarding overlay · only in empty state, once. */}
      {uiState === 'empty' && (
        <DemoOverlay
          mp4Src="/brand/walkthroughs/04-earn-wallet-and-payouts.mp4"
          kadePosterSrc="/brand/kade/kade-success.webp"
          title="Wallet & payouts tour"
          storageKey="demo-shown-wallet"
          hint={
            <>
              <strong>60 sec</strong> · tap to unmute · ✕ to dismiss
            </>
          }
        />
      )}

      {toast && (
        <div
          className="wd-claim-toast"
          role="status"
          aria-live="polite"
          data-testid="wallet-claim-toast"
        >
          <div className="wd-claim-toast-heading">{toast.heading}</div>
          {toast.body && (
            <div className="wd-claim-toast-body">{toast.body}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────

function ledgerRowLabel(row: WalletLedgerRow): string {
  if (row.type === 'payout') {
    return `Payout to Whop wallet · ${fmtUsdCents(Math.abs(row.amount_cents))}`;
  }
  if (row.type === 'debit') {
    return `Reversal · ${fmtUsdCents(Math.abs(row.amount_cents))}`;
  }
  // credit
  if (row.source === 'whop_affiliate') {
    return `Referral drop · ${fmtUsdCents(row.amount_cents)}`;
  }
  return `Credit · ${fmtUsdCents(row.amount_cents)}`;
}

function ledgerRowMeta(row: WalletLedgerRow): string {
  if (row.type === 'payout') {
    return `Whop payout · ${row.currency}`;
  }
  if (row.type === 'debit') {
    return `${row.source} · ${row.currency}`;
  }
  if (row.source === 'whop_affiliate') {
    return 'Whop split · 50% · instant';
  }
  return `${row.source} · ${row.currency}`;
}
