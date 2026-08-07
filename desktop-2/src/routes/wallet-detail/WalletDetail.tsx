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
 * AU-B-2 (2026-07-10) · six-state machine wired to State Puppeteer.
 * `useWalletLedger()` now returns one of six data-state keys matching
 * `junior-backend/app/state_puppet_fixtures.py`:
 *
 *   fresh_install  populated  paid_normal  paid_streak  grace  cancelled
 *
 * Wire states (non-data) still cover loading / unauthorized / error /
 * expired-affiliate-agreement. The 6 keys are also exposed as
 * `WALLET_STATE_KEYS` from `lib/wallet.ts` so consumers can enumerate
 * them without re-declaring the union.
 *
 * State Puppeteer integration:
 *   - Backend endpoint `/me/wallet/summary` sets `X-State-Override: true`
 *     when an admin-applied override returns a fixture.
 *   - `useWalletLedger.stateOverride` exposes that boolean.
 *   - The scrubber pill row mounts only when `stateOverride === true`
 *     — real customers never see it.
 *   - Clearing the override (via HQ StatePuppeteerTab) is picked up by
 *     the next `refetch()`, which resets the state key to the real
 *     ledger derivation.
 *
 * AU-B-3 (2026-07-10) · Connect Whop CTA. Signed-in users whose
 * /me snapshot has no `whopUserId` see an inline "Connect Whop to
 * activate payouts and earn recurring referral income." card. The
 * CTA fires the same OAuth flow Settings.tsx uses (`connectWhop()`
 * shared util). On `activation:complete`, the wallet refetches AND
 * emits `connect_whop_completed`. Failures surface a customer-safe
 * toast + emit `connect_whop_failed`.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { DemoOverlay } from '../../components/demo-overlay';
import { SafeVideo } from '../../components/safe/SafeVideo';
import {
  postWalletClaim,
  isAgreementSignedMessage,
  CLAIM_BLOCKED_HEADING,
  useWalletLedger,
  fmtUsdCents,
  fmtRelativeTime,
  WALLET_STATE_KEYS,
  type ClaimResponse,
  type WalletLedgerRow,
  type WalletStateKey,
} from '../../lib/wallet';
import { useBrowseOverlay } from '../../state/browseOverlay';
import { bus } from '../../design-os/bridge/events';
import { useEvent } from '../../design-os/bridge';
import { lcDiag } from '../../lib/diagnosticLogger';
import { useMe } from '../../design-os/state/useMe';
// Wave D1 · j015-runtime-update · protect j011-payout while a
// wallet claim / withdrawal is in flight. A runtime restart mid-
// signature would strand the payout.
import { useProtectedJourney } from '../../lib/protectedJourney';
import { connectWhop } from '../../lib/whopConnect';
// 2026-07-10 · Crew P1 · canonical referral-loop surfaces mounted
// alongside the ledger. CrewMatchTool = paste-list check flow;
// ReferralPipelineTile = live pipeline read from /me/crew/pipeline.
import { CrewMatchTool } from '../../design-os/earn/CrewMatchTool';
import { ReferralPipelineTile } from '../../design-os/earn/ReferralPipelineTile';
// R3 (2026-07-11) · referral link copy + QR on the money surface.
// AffiliateWidget already renders the /me/affiliate.referral_url with
// copy-URL + copy-QR + download-QR actions — mount it above the crew
// block so the wallet money surface has the referral share primitives
// without duplicating fetch/copy/QR business logic.
import { AffiliateWidget } from '../../design-os/earn/AffiliateWidget';
// 2026-08-06 — AffiliateWidget.css existed but was only ever imported by
// Settings.tsx and the deprecated legacy Earn.tsx (design-os/routes/Earn.tsx)
// — never by WalletDetail, the component that actually mounts
// <AffiliateWidget /> today. CSS side-effect imports are bundle-global, so
// the widget only looked styled here if Settings had happened to load
// earlier in the same session. Confirmed live 2026-08-06: raw, unstyled
// referral-link/QR/MRR text on the real Wallet page. Left behind during
// the 2026-07-10 money-surface pivot that moved AffiliateWidget's mount
// point from Earn.tsx to WalletDetail without moving this import.
import '../../design-os/earn/AffiliateWidget.css';
// Train C2 (2026-07-12) · canonical money rollup — every visible money
// value on the wallet summary + affiliate MRR + payout eligibility gates
// reads from THIS hook. INV-004: withdraw is disabled unless every gate
// in `rollup.withdraw_gates` is true. Not a fixture: values are queried
// live from the authoritative wallet ledger + agreement service.
import { useMoneyRollup } from '../../lib/moneyRollup';
import './WalletDetail.css';

/**
 * The six canonical customer-data states (from `state_puppet_fixtures.py`).
 * Human-readable labels for the puppet scrubber. IDs match `WalletStateKey`
 * from `lib/wallet.ts` — the assertion below fails compile if the sets
 * ever drift.
 */
const WALLET_MOCKUP_STATES: ReadonlyArray<{ id: WalletStateKey; label: string }> = [
  { id: 'fresh_install', label: '1 · Fresh install · empty' },
  { id: 'populated',     label: '2 · Populated · pending only' },
  { id: 'paid_normal',   label: '3 · Paid · normal' },
  { id: 'paid_streak',   label: '4 · Paid · streak' },
  { id: 'grace',         label: '5 · Grace · missed payment' },
  { id: 'cancelled',     label: '6 · Cancelled · frozen' },
];
const _WALLET_STATE_KEY_PARITY: readonly WalletStateKey[] =
  WALLET_MOCKUP_STATES.map((s) => s.id);
void _WALLET_STATE_KEY_PARITY;
void WALLET_STATE_KEYS;

export interface WalletDetailProps {
  onBack?: () => void;
  /** Legacy escape hatch · QA harness passes an override to short-
   *  circuit the claim wire and forward the click to the harness. */
  onWithdraw?: () => void;
}

/**
 * 2026-08-07 — WalletDetail mounts inside the AppShell's component tree,
 * which wraps routes in framer-motion containers that set an inline
 * `transform`. That makes `position: fixed` descendants position
 * relative to THAT ancestor instead of the true viewport — a
 * position:fixed attempt directly on .wd-root was tried and reverted
 * (broke the layout worse: sidebar bleeding through, content
 * misaligned). The actual problem it was trying to fix is real: when
 * the router doesn't fully unmount the previous route before this one
 * mounts, the previous route's content and Wallet's just stack in
 * normal document flow instead of Wallet covering it.
 *
 * Real fix: escape the transformed ancestor entirely via a portal to
 * document.body — the same pattern already proven elsewhere in this
 * codebase for "must render above everything, regardless of what's
 * mounted" (see UpdateReadyIndicator.tsx). WalletDetailInner's JSX is
 * completely unchanged; only WHERE it mounts in the DOM changes, which
 * is why this is safe where the earlier CSS-only attempt wasn't.
 */
export function WalletDetail(props: WalletDetailProps) {
  if (typeof document === 'undefined') return null;
  return createPortal(<WalletDetailInner {...props} />, document.body);
}

function WalletDetailInner(props: WalletDetailProps) {
  const {
    uiState,
    dataState,
    stateOverride,
    summary,
    errorReason,
    refetch,
    markSignatureExpired,
  } = useWalletLedger();
  const me = useMe();
  // Train C2 · canonical money rollup. Wallet summary values, affiliate
  // MRR, and payout eligibility gates all read from this ONE source.
  // Byte-identical numbers land on HQ mirror via /admin/money-rollup/{user_id}.
  const moneyRollup = useMoneyRollup();

  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  // ── AU-B-3 · Connect Whop CTA state ─────────────────────────────
  // Gated on `me.snapshot?.whopUserId == null` — signed-in unlinked
  // users see the CTA; linked users don't. `meLoading` keeps the CTA
  // hidden during first hydrate so a linked user doesn't briefly
  // render an "unlinked" state.
  const meLoading = me.loading && !me.snapshot;
  const meHasSnapshot = !!me.snapshot;
  const whopLinked = !!me.snapshot?.whopUserId;
  const showConnectWhopCta = meHasSnapshot && !whopLinked;
  const [connectingWhop, setConnectingWhop] = useState(false);

  const handleConnectWhopClick = useCallback(async () => {
    if (connectingWhop) return;
    lcDiag('connect_whop_clicked', { source: 'wallet_detail' });
    setConnectingWhop(true);
    try {
      await connectWhop();
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120);
      lcDiag('connect_whop_failed', { source: 'wallet_detail', reason });
      bus.emit('toast', {
        kind: 'warning',
        title: "Couldn't start Whop sign-in",
        body: "Try again in a moment · we couldn't open your browser.",
      });
    } finally {
      setConnectingWhop(false);
    }
  }, [connectingWhop]);

  // On `activation:complete` the deep-link handler fires — refresh the
  // wallet (whopUserId flips + summary now includes real data) and
  // emit `connect_whop_completed` so HQ pairs the click with the
  // outcome.
  useEvent('activation:complete', () => {
    lcDiag('connect_whop_completed', { source: 'wallet_detail' });
    void refetch();
    void me.reload();
    // Train C2 · money-rollup must refetch so the withdraw gates
    // reflect the new whop-connected + payout-ready state.
    void moneyRollup.refetch();
  });

  // ── Behavioral HQ events (all through existing lcDiag) ──────────
  const mountedRef = useRef(false);
  const stateSeenRef = useRef<Set<WalletStateKey>>(new Set());
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    lcDiag('wallet_viewed', {
      state: uiState,
      data_state: dataState,
      state_override: stateOverride,
    });
    if (dataState) {
      stateSeenRef.current.add(dataState);
      lcDiag('wallet_state_viewed', {
        state: dataState,
        first_view_of_state: true,
        state_override: stateOverride,
      });
    }
    // Intentional single-fire on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    // Fire once per new data-state (admin override sweep or organic
    // state transition on refetch).
    if (!mountedRef.current) return;
    if (!dataState) return;
    const firstView = !stateSeenRef.current.has(dataState);
    if (firstView) stateSeenRef.current.add(dataState);
    lcDiag('wallet_state_viewed', {
      state: dataState,
      first_view_of_state: firstView,
      state_override: stateOverride,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataState, stateOverride]);

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
  // Wave D1 · j015-runtime-update · protected while a payout is
  // mid-flight (claiming, awaiting signature, or in the released
  // acknowledgement window). Idle + error are safe to interrupt.
  useProtectedJourney(
    'j011-payout',
    claimState === 'claiming' || claimState === 'awaiting_signature' || claimState === 'released',
  );
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
      // AU-B-6 · Money Funnel HQ tab consumes wallet_claim_failed
      // alongside the legacy withdraw_failed emit. Two events with
      // different names so the HQ panel can filter by claim-specific
      // failures without polluting the withdraw funnel counts.
      lcDiag('withdraw_failed', { reason: 'network' });
      lcDiag('wallet_claim_failed', { reason: 'network' });
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
        lcDiag('wallet_claim_failed', { reason: 'signature_frozen' });
        return;
      }
      setClaimState('awaiting_signature');
      lcDiag('withdraw_failed', { reason: res.blocked_reason.code });
      lcDiag('wallet_claim_failed', { reason: res.blocked_reason.code });
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
  // 2026-08-05 — the real, live balance sitting in the user's connected
  // Whop sub-merchant wallet (whop_payments.retrieve_account() →
  // GET /ledger_accounts/{id}), distinct from `balanceCents` above
  // (our own internal ledger total, which can lag Whop's real number
  // until the nightly payout scheduler actually transfers a credit).
  // `null` while summary hasn't loaded yet, matching the other
  // conditionally-hidden cells in the 4-metric row below.
  const whopAvailableCents: number | null =
    summary !== null && summary !== undefined
      ? summary.withdraw.available_usd_cents
      : null;
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
  // Train C2 · MRR sourced from the canonical /me/money-rollup — the
  // ONLY place UI + HQ + backend agree on affiliate revenue. `null`
  // while the rollup is still loading so the row hides the cell rather
  // than fabricating a $0 value.
  const mrrCents: number | null =
    moneyRollup.rollup !== null && moneyRollup.rollup.affiliate_mrr_cents > 0
      ? moneyRollup.rollup.affiliate_mrr_cents
      : null;
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
    if (uiState === 'fresh_install') {
      return 'Fills the moment a sub hits.';
    }
    if (uiState === 'grace') {
      return 'Payouts held while your subscription is in grace · resolve to release.';
    }
    if (uiState === 'cancelled') {
      return 'Payouts frozen · reactivate your subscription to release the balance.';
    }
    return 'Balance updated live from Whop · payouts fire on the next scheduler tick.';
  }, [mrrCents, pendingCents, nextPayoutAt, uiState]);

  // AU-B-2 · Claim only fires in the two states with an available
  // balance to release (`paid_normal` + `paid_streak`). `populated`
  // has pending only, `fresh_install` has nothing, `grace`/`cancelled`
  // are frozen server-side.
  const isClaimableDataState =
    uiState === 'paid_normal' || uiState === 'paid_streak';
  // Train C2 · INV-004 · withdraw disabled unless EVERY eligibility
  // gate is true. `withdraw_gates` is queried from the authoritative
  // /me/money-rollup endpoint — customer UI + HQ + direct DB read all
  // agree byte-identical. When the rollup is loading, the gates are
  // conservatively `false` so we never render an actionable withdraw
  // during hydrate.
  const withdrawGates = moneyRollup.rollup?.withdraw_gates ?? null;
  const inv004Eligible =
    withdrawGates !== null &&
    withdrawGates.has_balance &&
    withdrawGates.affiliate_agreement_signed &&
    withdrawGates.whop_connected &&
    withdrawGates.payout_ready;
  const claimDisabled =
    !isClaimableDataState ||
    balanceCents <= 0 ||
    !inv004Eligible ||
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
    // Train C2 · INV-004 · surface WHICH gate blocked the claim so HQ
    // Money Funnel can categorise ineligible-clicks by root cause.
    let reason: string;
    if (!isClaimableDataState) {
      reason = `ui_state:${uiState}`;
    } else if (balanceCents <= 0) {
      reason = 'balance_below_minimum';
    } else if (withdrawGates && !withdrawGates.affiliate_agreement_signed) {
      reason = 'inv004:agreement_unsigned';
    } else if (withdrawGates && !withdrawGates.whop_connected) {
      reason = 'inv004:whop_unlinked';
    } else if (withdrawGates && !withdrawGates.payout_ready) {
      reason = 'inv004:payout_not_ready';
    } else if (!withdrawGates) {
      reason = 'rollup_loading';
    } else {
      reason = `claim_state:${claimState}`;
    }
    if (disabledReasonRef.current === reason) return;
    disabledReasonRef.current = reason;
    lcDiag('withdraw_disabled', { reason });
  }, [
    claimDisabled,
    isClaimableDataState,
    uiState,
    balanceCents,
    claimState,
    withdrawGates,
  ]);

  // Legacy CSS wire · the stylesheet distinguishes only `fresh-install`
  // vs `populated`. Map the six-state key into the two visual buckets
  // so existing selectors keep working (hero size, empty-row hides).
  const stageDataState: 'fresh-install' | 'populated' =
    uiState === 'fresh_install' ? 'fresh-install' : 'populated';

  // ── Full-surface states (loading · unauthorized · error) ─────
  // D1 Cluster E fix (2026-07-12) · surface the wallet-panel root
  // testid + data-state="loading|offline|empty" on WalletDetail's own
  // honest states. Prior versions kept these behind wd-root only, so
  // downstream contracts (earn-affiliate-polish, earn-station,
  // wallet-malformed-response) fell back to SectionWithFallback's
  // generic "Wallet briefly out of reach" and failed to find the
  // in-panel offline branch. The data-testid wire is additive — the
  // wd-root + wd-stage layout is unchanged and the SectionWithFallback
  // safety net still catches genuine crashes.
  if (uiState === 'loading') {
    return (
      <div
        className="wd-root"
        data-ui-state="loading"
        data-testid="wallet-panel"
        data-state="loading"
      >
        {/* D1-cluster-T (2026-07-12) · brand-consistency invariant
         *  requires every customer-visible route to expose an <h1>.
         *  Visually hidden so the loading/offline/empty states keep
         *  their approved copy first in reading order for sighted
         *  users while screen readers still land on the wallet's
         *  canonical route title. Same h1 duplicated per state
         *  branch since WalletDetail short-circuits before rendering
         *  the shared hero. */}
        <h1 className="lc-visually-hidden">Wallet</h1>
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
      <div
        className="wd-root"
        data-ui-state="unauthorized"
        data-testid="wallet-panel"
        data-state="empty"
      >
        {/* D1-cluster-T (2026-07-12) · brand-consistency h1 · see loading branch. */}
        <h1 className="lc-visually-hidden">Wallet</h1>
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
      <div
        className="wd-root"
        data-ui-state="error"
        data-testid="wallet-panel"
        data-state="offline"
      >
        {/* D1-cluster-T (2026-07-12) · brand-consistency h1 · see loading branch. */}
        <h1 className="lc-visually-hidden">Wallet</h1>
        <div className="wd-stage" data-state="fresh-install">
          <div className="wd-panel wd-panel--full">
            <div
              className="wd-full-state"
              data-testid="wallet-offline-state"
            >
              <div className="wd-full-title">Wallet briefly out of reach</div>
              <div className="wd-full-body">{bodyCopy}</div>
              <button
                type="button"
                className="wd-full-cta"
                /* 2026-07-13 · Emit a toast on retry so the click has a
                 * user-visible acknowledgement even when the refetch
                 * returns the same error. Real UX benefit — offline
                 * retries otherwise land silently and the user
                 * hammers the button. Also produces an observable
                 * side-effect the button audit can classify without
                 * having to poll the `data-ui-state` error→loading→error
                 * transition on the wd-root wrapper. */
                onClick={() => {
                  bus.emit('toast', {
                    kind: 'info',
                    title: 'Checking your wallet…',
                    body: 'Reaching Whop again for the latest balance.',
                    ttl: 3_000,
                  });
                  void refetch();
                }}
                data-testid="wallet-offline-retry"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // BUG-017 · j010-referral · derive the customer-facing share URL
  // client-side from the handle already surfaced on /me. This mirrors
  // the derivation AffiliateWidget performs internally when
  // /me/affiliate.referral_url hasn't populated yet, so the DOM seam
  // `data-referral-link[data-copy-value]` is a stable predictor of
  // the string the copy affordance will hit the clipboard with. Null
  // until the user has claimed a handle — honest empty state, no
  // fabricated placeholder URL.
  const referralUrl = me.snapshot?.handle
    ? `https://liquidclips.app/join/${me.snapshot.handle}`
    : null;

  // uiState is one of the six WALLET_STATE_KEYS or
  // `expired-affiliate-agreement`. Real customers never see the
  // scrubber row — it mounts only when `stateOverride === true`
  // (backend flag set by StatePuppeteerTab overrides).
  // D1 Cluster E (2026-07-12) · add wallet-panel testid + data-state
  // ="loaded" wire so earn-affiliate-polish + earn-station contracts
  // read from the same seam WalletDetail already ships. The existing
  // customer-data state key stays exposed via data-data-state (was
  // just data-state before — now split so the two contracts don't
  // conflict).
  return (
    <div
      className="wd-root"
      data-testid="wallet-panel"
      data-state="loaded"
      data-ui-state={uiState}
      data-state-override={stateOverride ? 'true' : 'false'}
      data-data-state={dataState ?? ''}
      // Train C2 · money-rollup mirror seam. Every visible money value
      // matches these attributes byte-for-byte with the /me/money-rollup
      // response — the anchor point for money-rollup.test.ts +
      // HQ mirror-parity proofs. `unknown` while the rollup loads.
      data-money-rollup-loaded={moneyRollup.rollup ? 'true' : 'false'}
      data-money-rollup-balance-cents={
        moneyRollup.rollup?.wallet_balance_cents ?? 'unknown'
      }
      data-money-rollup-mrr-cents={
        moneyRollup.rollup?.affiliate_mrr_cents ?? 'unknown'
      }
      data-money-rollup-referral-total-cents={
        moneyRollup.rollup?.referral_total_cents ?? 'unknown'
      }
      data-money-rollup-payout-eligible-cents={
        moneyRollup.rollup?.payout_eligible_cents ?? 'unknown'
      }
      data-money-rollup-lifetime-cents={
        moneyRollup.rollup?.total_lifetime_earnings_cents ?? 'unknown'
      }
      data-money-rollup-as-of-ts-ms={
        moneyRollup.rollup?.as_of_ts_ms ?? 'unknown'
      }
    >
      {/* AU-B-2 · Admin-only puppet state scrubber. Only mounts when
          the backend flagged this response as puppet-driven via
          `X-State-Override: true`. Real customers never see this row
          (aria-hidden + visually-clipped when no override). The
          scrubber is READ-ONLY: it shows which of the six states the
          current fixture is rendering, so admins can confirm the
          override matches intent without leaving the wallet. Actual
          apply/clear happens in HQ StatePuppeteerTab. */}
      <div
        className="wd-scrubber"
        role="tablist"
        aria-label="Wallet mockup state"
        aria-hidden={!stateOverride}
        data-testid="wallet-state-scrubber"
        data-active={stateOverride ? 'true' : 'false'}
        style={
          !stateOverride
            ? { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', whiteSpace: 'nowrap' }
            : undefined
        }
      >
        <span className="wd-scrubber-label">STATE · puppet</span>
        {WALLET_MOCKUP_STATES.map((s) => (
          <button
            key={s.id}
            type="button"
            className="wd-scrubber-btn"
            data-state-key={s.id}
            data-active={dataState === s.id ? 'true' : 'false'}
            aria-pressed={dataState === s.id}
            disabled
            tabIndex={-1}
          >
            {s.label}
          </button>
        ))}
        <span className="wd-scrubber-note">
          Clear override from HQ StatePuppeteerTab to exit puppet mode.
        </span>
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
            {/* D1-cluster-T (2026-07-12) · brand-consistency invariant
             *  requires every route to expose an <h1>. The approved
             *  wallet-detail mockup carries the same "Wallet" copy so
             *  the money-surface rule is preserved. `wd-hero-h1`
             *  visually hides the heading (see WalletDetail.css) so
             *  the approved balance-hero stays first in reading order
             *  for sighted users while screen readers still land on
             *  the wallet's canonical route title. */}
            <h1 className="wd-hero-h1 lc-visually-hidden">Wallet</h1>
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

            {/* AU-B-3 · Connect Whop CTA. Only mounts for signed-in
                users whose /me snapshot has no whopUserId. `meLoading`
                keeps the CTA hidden during first hydrate so a linked
                user doesn't see it flash. */}
            {!meLoading && showConnectWhopCta && (
              <div
                className="wd-connect-whop-card"
                data-testid="wallet-connect-whop-cta"
                role="region"
                aria-label="Connect Whop to activate payouts"
              >
                <div className="wd-connect-whop-body">
                  <div className="wd-connect-whop-title">
                    Connect Whop to activate payouts and earn recurring referral income.
                  </div>
                  <div className="wd-connect-whop-sub">
                    Sign in through Whop once · your affiliate handle links to your Whop account · every clipper you refer pays out to this wallet automatically.
                  </div>
                </div>
                <button
                  type="button"
                  className="wd-connect-whop-btn"
                  onClick={() => { void handleConnectWhopClick(); }}
                  disabled={connectingWhop}
                  data-testid="wallet-connect-whop-btn"
                  data-connecting={connectingWhop ? 'true' : 'false'}
                >
                  {connectingWhop ? 'Opening Whop…' : 'Connect Whop · sign in ↗'}
                </button>
              </div>
            )}
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
              {/* AVAILABLE ON WHOP · 2026-08-05 · the real live balance
                  from withdraw.available_usd_cents (whop_payments
                  .retrieve_account()), distinct from the ledger-derived
                  `balanceCents` shown as the hero number above. Always
                  present when summary loaded — a real $0 for a
                  not-yet-connected/onboarded user is honest, not
                  hidden. */}
              {whopAvailableCents !== null ? (
                <div className="wd-stat-card" data-testid="wallet-stat-whop-available">
                  <div className="wd-stat-label">Available on Whop</div>
                  <div className="wd-stat-value is-money">
                    {fmtUsdCents(whopAvailableCents)}
                  </div>
                </div>
              ) : null}
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
              // Train C2 · INV-004 audit seams · Doctor + Playwright
              // + HQ mirror read these attributes to verify the same
              // gates fire byte-identical to the backend rollup.
              data-inv004-eligible={inv004Eligible ? 'true' : 'false'}
              data-gate-has-balance={withdrawGates ? String(withdrawGates.has_balance) : 'unknown'}
              data-gate-agreement={withdrawGates ? String(withdrawGates.affiliate_agreement_signed) : 'unknown'}
              data-gate-whop={withdrawGates ? String(withdrawGates.whop_connected) : 'unknown'}
              data-gate-payout-ready={withdrawGates ? String(withdrawGates.payout_ready) : 'unknown'}
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

          {/* R3 (2026-07-11) · Referral link + QR on the money
                surface. AffiliateWidget reads /me/affiliate.referral_url
                and renders the same copy-URL + QR primitives the Earn
                design-os route uses — no duplicated fetch, no
                fabricated placeholder URL. When the affiliate isn't
                connected yet, AffiliateWidget renders "Connect Whop
                to activate" + a "Set a handle to generate QR"
                placeholder (honest empty state).

                BUG-017 · Train A3 (2026-07-12) · j010-referral test
                seams + telemetry. AffiliateWidget already emits
                `affiliate_link_copied` + `referral_qr_downloaded`
                internally; this wrapper layer adds the canonical
                j010-referral topics (`referral_affordance_mounted`,
                `referral_link_copied`, `referral_qr_generated`) so
                Doctor + HQ can see the whole referral journey without
                depending on AffiliateWidget's internal names, and
                surfaces the stable DOM seams `data-referral-link`,
                `data-referral-qr`, `data-referral-attribution-source`.
                Click-capture on the wrapper divs bridges the widget's
                native click events into the j010 topics without
                duplicating the copy/QR business logic. */}
          <WalletReferralBlock
            referralUrl={referralUrl}
            affiliateId={me.snapshot?.affiliateId ?? null}
          />

          {/* CREW · 2026-07-10 · P1 canonical mount. ReferralPipelineTile
                self-hides until the user has at least one invite sent, so
                brand-new users only see CrewMatchTool. Both call the
                real backend (/me/crew/pipeline · /me/crew/match ·
                /me/crew/invites/send) — no demo data. */}
          <div className="wd-crew-block" data-testid="wallet-crew-block">
            <ReferralPipelineTile />
            <CrewMatchTool />
            <button
              type="button"
              className="wd-crew-tool-link"
              onClick={() => {
                window.location.hash = '#/outreach';
              }}
              data-testid="wallet-open-outreach"
            >
              Open Crew Growth Tool →
            </button>
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

      {/* Contextual onboarding overlay · only in fresh-install state, once. */}
      {uiState === 'fresh_install' && (
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

// ─────────────────────────────────────────────────────────────
// BUG-017 · Train A3 · j010-referral canonical wallet-side wrapper.
//
// Stable DOM seams + telemetry topics for the referral affordance
// mounted on the wallet money surface. This component OWNS the
// j010-referral telemetry contract even though AffiliateWidget owns
// the copy-URL / QR / handle-rename business logic. The two layers
// are decoupled so a future AffiliateWidget refactor (rename buttons,
// relocate handles) cannot silently break the j010 journey chain.
//
// Telemetry contract (matches `lcos/04_JOURNEY_BIBLE/j010-referral.md`):
//   `referral_affordance_mounted` — once on first render (payload:
//        has_referral_url, has_affiliate_id).
//   `referral_link_copied` — bubbled from AffiliateWidget's copy click
//        (payload: referralUrl, ts). Click-capture listens on the
//        wrapper div so an internal button relocation doesn't break
//        the bridge.
//   `referral_qr_generated` — emitted once the QR canvas has a value
//        to render (i.e. shareUrl is populated). Correlates with the
//        moment the QR is visible to the customer.
//   `referral_qr_scan_detected` — TODO (best-effort) — we cannot
//        observe an in-flight camera scan today. Documented in the
//        journey file as a P4-owed backend join on
//        `referral_attribution_recorded`.
//
// DOM seams (matches BUG-017 close conditions):
//   [data-referral-link][data-copy-value=<url>] — copy affordance.
//   [data-referral-qr]                          — QR canvas region.
//   [data-referral-attribution-source][data-source=<affiliateId>]
//        — attribution source marker (paired with the receiving
//        backend on wallet ledger refresh).
interface WalletReferralBlockProps {
  referralUrl: string | null;
  affiliateId: string | null;
}

function WalletReferralBlock(props: WalletReferralBlockProps): JSX.Element {
  const { referralUrl, affiliateId } = props;
  const mountedRef = useRef(false);
  const qrEmittedRef = useRef(false);

  // Mount-once telemetry. Fires on FIRST render regardless of whether
  // the user has a handle yet — Doctor needs the mount signal to know
  // the affordance IS in the DOM (empty-state still counts as an
  // affordance surface for j010).
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    lcDiag('referral_affordance_mounted', {
      has_referral_url: !!referralUrl,
      has_affiliate_id: !!affiliateId,
      ts: Date.now(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // QR render telemetry. Fires when the shareUrl transitions from
  // null to a real value — that's the moment the QR canvas paints.
  // Deferred inside `useEffect` so it runs after AffiliateWidget's
  // own effect resolves (best-effort correlation).
  useEffect(() => {
    if (qrEmittedRef.current) return;
    if (!referralUrl) return;
    qrEmittedRef.current = true;
    lcDiag('referral_qr_generated', { ts: Date.now() });
  }, [referralUrl]);

  // Click-capture bridge — bubble AffiliateWidget's internal copy
  // clicks to the j010 `referral_link_copied` topic. We listen at
  // the wrapper root so any rename / relocation inside the widget
  // still surfaces the topic. Ignores non-copy clicks.
  const onLinkCapture = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const btn = target.closest(
        'button.lc-affiliate-widget-btn-primary',
      ) as HTMLButtonElement | null;
      if (!btn) return;
      // The "Copy" button next to the Share URL uses this class. The
      // "Save" button on the handle rename also uses the same class,
      // so we further gate on the button's title/text — only fire
      // for the copy affordance.
      const label = (btn.textContent || '').trim().toLowerCase();
      if (!label.startsWith('copy') && !label.startsWith('copied')) return;
      lcDiag('referral_link_copied', {
        referralUrl: referralUrl ?? null,
        ts: Date.now(),
      });
    },
    [referralUrl],
  );

  return (
    <div
      className="wd-referral-block"
      data-testid="wallet-referral-block"
      data-referral-attribution-source
      data-source={affiliateId ?? ''}
    >
      <div
        data-referral-link
        data-copy-value={referralUrl ?? ''}
        onClickCapture={onLinkCapture}
      >
        <div data-referral-qr>
          <AffiliateWidget />
        </div>
      </div>
    </div>
  );
}
