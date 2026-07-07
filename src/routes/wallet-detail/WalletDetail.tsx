/**
 * Route · wallet-detail
 * Source: 05_html-mockups/approved/wallet-detail.html v3.1
 *
 * C1-T1 · 2026-07-05 · Real wallet data pipeline.
 * Prior version (v3.1 port) rendered a hardcoded roster + drops
 * ledger as if live — every user saw the same fake fictional
 * initials. MASTER_AUDIT_2026-07-05 flagged this as P0 finding
 * #2 (Wallet fake-data ship blocker). This file now wires to
 * `useWalletLedger()` (junior-backend /me/wallet/summary) and
 * renders 5 explicit states:
 *
 *   loading                       skeleton on first mount
 *   unauthorized                  Sign-in CTA (401 / no JWT)
 *   error                         retry CTA
 *   empty                         new user · pre-payout state
 *   populated                     real ledger rows
 *   expired-affiliate-agreement   claim returned signature_frozen
 *
 * The Claim button (Task D wire) is preserved end-to-end. A
 * `signature_frozen` claim response now also flips the wallet page
 * into the expired-agreement state via `markSignatureExpired()`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DemoOverlay } from '../../components/demo-overlay';
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
import './WalletDetail.css';

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

  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  // ── Claim wire (Task D · preserved) ─────────────────────────
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
    setClaimState('claiming');
    const res: ClaimResponse | null = await postWalletClaim();
    if (!res) {
      setClaimState('error');
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
        return;
      }
      setClaimState('awaiting_signature');
      openBrowsePanel(res.blocked_reason.signature_url, 'browse-campaign');
      return;
    }
    setClaimState('released');
    const receiptHead = (res.receipt_sha256 ?? '').slice(0, 12);
    showingToast(
      'Payout released.',
      receiptHead ? `Receipt ${receiptHead}…` : undefined,
    );
    // Refetch so the balance drops to zero and the just-fired payout
    // shows in the recent ledger.
    void refetch();
    window.setTimeout(() => setClaimState('idle'), 4000);
  }, [
    markSignatureExpired,
    openBrowsePanel,
    refetch,
    showingToast,
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

  // ── Derived render values from real summary ──────────────────
  const balanceCents = summary?.balance_cents ?? 0;
  const pendingCents = summary?.pending_cents ?? 0;
  const nextPayoutAt = summary?.next_payout_at ?? null;
  const lifetimePaidCents = summary?.pipeline.paid_usd_cents ?? 0;
  const ledgerRows: WalletLedgerRow[] = summary?.recent_ledger ?? [];

  const balanceValue = fmtUsdCents(balanceCents);
  const balanceSubline = useMemo(() => {
    if (pendingCents > 0 && nextPayoutAt) {
      const rel = fmtRelativeTime(nextPayoutAt);
      return `${fmtUsdCents(pendingCents)} pending · next payout ${rel}`;
    }
    if (uiState === 'empty') {
      return 'Your first payout lands here the moment a referral subscribes.';
    }
    return 'Balance updated live from Whop · payouts fire on the next scheduler tick.';
  }, [pendingCents, nextPayoutAt, uiState]);

  const claimDisabled =
    uiState !== 'populated' ||
    balanceCents <= 0 ||
    claimState === 'claiming' ||
    claimState === 'awaiting_signature';

  const stageDataState: 'fresh-install' | 'populated' =
    uiState === 'populated' ? 'populated' : 'fresh-install';

  // ── Full-surface states (loading · unauthorized · error) ─────
  // These render as full-panel overlays and never mount the hero /
  // body / footer — the hero shows fake $0.00 numbers we don't want
  // the user to read as truth.
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
      <div className="wd-stage" data-state={stageDataState}>
        <div className="wd-panel">
          <div className="wd-panel-clip" />
          <div className="wd-whop-pill">
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

          {/* HERO */}
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
              <span className="wd-balance-eyebrow">
                Balance · Whop · instant
              </span>
              <div className="wd-balance-value">{balanceValue}</div>
              <div className="wd-balance-mrr">{balanceSubline}</div>
            </div>
            <div className="wd-stat-row">
              <div className="wd-stat-card">
                <div className="wd-stat-label">Balance</div>
                <div className="wd-stat-value is-money">
                  {fmtUsdCents(balanceCents)}
                </div>
              </div>
              <div className="wd-stat-card">
                <div className="wd-stat-label">Pending</div>
                <div className="wd-stat-value">
                  {fmtUsdCents(pendingCents)}
                </div>
              </div>
              <div className="wd-stat-card">
                <div className="wd-stat-label">Lifetime paid</div>
                <div className="wd-stat-value">
                  {fmtUsdCents(lifetimePaidCents)}
                </div>
              </div>
              <div className="wd-stat-card">
                <div className="wd-stat-label">Next payout</div>
                <div className="wd-stat-value">
                  {nextPayoutAt
                    ? fmtRelativeTime(nextPayoutAt)
                    : '—'}
                </div>
              </div>
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
            >
              {claimState === 'claiming'
                ? 'Claiming…'
                : claimState === 'awaiting_signature'
                  ? 'Waiting for signature…'
                  : 'Claim'}
            </button>
          </div>

          {/* BODY · clippers + drops */}
          <div className="wd-body">
            <div className="wd-col">
              <div className="wd-col-header">
                <div className="wd-col-title">Your clippers</div>
              </div>
              <div className="wd-col-scroll">
                <div className="wd-empty-hint">
                  Your paying clippers show up here the moment they subscribe
                  via your affiliate link.
                  <br />
                  <br />
                  Every clipper who subs = <b>$50/mo, for LIFE</b>.
                </div>
              </div>
            </div>

            <div className="wd-col">
              <div className="wd-col-header">
                <div className="wd-col-title">
                  Recent drops ·{' '}
                  <span className="wd-col-title-count">
                    {ledgerRows.length === 0 ? 'none yet' : 'live ledger'}
                  </span>
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

          {/* FOOTER · coach + fine */}
          <div className="wd-footer">
            <div className="wd-coach">
              <div className="wd-coach-thumb" onClick={toggleMute}>
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  loop
                  preload="auto"
                >
                  <source
                    src="/brand/founder/founder-wallet.mp4"
                    type="video/mp4"
                  />
                </video>
              </div>
              <div>
                <div className="wd-coach-eyebrow">
                  Daniel · founder · 33 sec
                </div>
                <div className="wd-coach-script">
                  &quot;Hey guys — here&apos;s your affiliate page. See lifetime
                  sales, streaks, all of it. Every clipper who subs pays out
                  $50/mo — <b>for life</b>. And remember: your commissions
                  only pay if you keep your subscription. Thanks — God bless.&quot;
                </div>
                <button
                  type="button"
                  className="wd-coach-audio"
                  onClick={toggleMute}
                >
                  {muted ? 'Click for sound' : 'Mute'}
                </button>
              </div>
            </div>
            <div className="wd-fine">
              Withdrawals via <b>Whop payout portal</b> · $10 min ·{' '}
              <b>5%</b> platform fee · ACH 2–3d or Instant (fee)
            </div>
          </div>
        </div>
      </div>

      {/* Contextual onboarding overlay · only in empty state, once. */}
      {uiState === 'empty' && (
        <DemoOverlay
          mp4Src="/demos/04-wallet-payouts.mp4"
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
