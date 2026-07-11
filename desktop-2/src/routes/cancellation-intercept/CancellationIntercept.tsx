/**
 * Port · cancellation-intercept · retention flow
 * Source: 05_html-mockups/approved/cancellation-intercept.html
 *
 * Fires when user clicks "Cancel subscription" in Settings → Plan.
 * 3 states per D2 v1.1 slug map:
 *   cancel-attempt · paused-then-back · already-cancelled
 *
 * §13a Pricing swap: legacy 100 → 99.99 across every render slot.
 * §13b Voice: no "bounty" · uses "clippers" / "skill share".
 * §13c Whop lockup: exact SVG at /brand/whop/whop_logo_lockup_white.svg.
 * §13d Halo bleed math: 16px resting · 28px peak · 40px clearance
 *   (modal has 48px top padding, pill @ -14px + 28px peak = 42px
 *    effective bleed · never clips).
 * §13g Kade per state:
 *   cancel-attempt    → kade-hover     ("wait, don't leave")
 *   paused-then-back  → kade-success   (they chose to stay)
 *   already-cancelled → kade-idle      (neutral post-cancel)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { DemoOverlay } from '../../components/demo-overlay';
import { renderInline } from '../../components/safe-inline';
import { SafeImg } from '../../components/safe';
// Chapter 6 · behavioural events. Canonical lcDiag rail — no parallel telemetry.
import { lcDiag } from '../../lib/diagnosticLogger';
// R2 (2026-07-11) · money-surface rule + no-fixture-data guard.
// PER_STATE used to hardcode "15 clippers · $742.50/mo · $247.50
// balance · 4 days next payout" — every user saw the same lie. Wire
// both hooks so every string in the retention flow reflects the
// signed-in user's real ledger + crew pipeline.
import {
  fmtUsdCents,
  fmtRelativeTime,
  useWalletLedger,
} from '../../lib/wallet';
import { useCrewPipeline } from '../../design-os/earn/useCrewPipeline';
import './CancellationIntercept.css';

export type CancelState = 'cancel-attempt' | 'paused-then-back' | 'already-cancelled';

interface StateConfig {
  eyebrow: string;
  h1: string;
  sub: string;
  coach: string;
  keepLabel: string;
  quietLabel: string;
  showLossTable: boolean;
  kadePose: string;
}

/** R2 (2026-07-11) · Real-data replacement for the deleted PER_STATE
 *  fixture block. Each state's copy is composed from the user's
 *  wallet ledger + crew pipeline. Uses honest "no data yet" phrasing
 *  when the hooks return zero or unavailable — no fabricated clipper
 *  count, MRR, or balance. */
interface RealValues {
  clipperCountDisplay: string;   // "15" or "—"
  clipperCount: number;          // 15 or 0
  mrrDisplay: string;            // "$742.50/mo" or "your MRR"
  balanceDisplay: string;        // "$247.50" or "your balance"
  nextPayoutDisplay: string;     // "4 days" or "your next payout"
}

function stateConfig(state: CancelState, v: RealValues): StateConfig {
  switch (state) {
    case 'cancel-attempt':
      return {
        eyebrow: `Hold up · you're about to lose money`,
        h1: `Cancel $99.99 · lose <span class="ci-money">${v.mrrDisplay}</span> in ledger drops`,
        sub: `Your <b>$99.99/mo</b> subscription is what makes the affiliate flywheel <b class="ci-life">for LIFE</b> work. Cancel = <b>Whop stops splitting</b> from your ${v.clipperCountDisplay} clippers · balance stays but new drops freeze.`,
        coach: `"Hey — you built this. <b>${v.clipperCountDisplay} clippers</b> are subbed under you. That's <b>${v.mrrDisplay} dropping every month, for LIFE</b>. Cancel your $99.99 → the flywheel just stops. Don't do it."`,
        keepLabel: 'Keep my $99.99 · keep earning',
        quietLabel: 'Cancel anyway',
        showLossTable: v.clipperCount > 0,
        kadePose: 'kade-hover',
      };
    case 'paused-then-back':
      return {
        eyebrow: 'Smart · you saved the flywheel',
        h1: `<span class="ci-money">$99.99/mo stays active</span> · drops keep coming`,
        sub: `Nothing changed. Your <b>${v.clipperCountDisplay} clippers</b> keep paying <b class="ci-life">$50/mo each, for LIFE</b>. Next payout in <b>${v.nextPayoutDisplay}</b>. See your wallet if you want to withdraw the ${v.balanceDisplay} you've already earned.`,
        coach: `"That's the move. Every drop from here is pure margin. <b>Don't let the $99.99 lapse</b> — it's the only thing between you and losing ${v.mrrDisplay}. Come back to me if you ever get itchy."`,
        keepLabel: 'Back to my clips',
        quietLabel: 'See wallet',
        showLossTable: false,
        kadePose: 'kade-success',
      };
    case 'already-cancelled':
      return {
        eyebrow: 'Cancelled · your flywheel froze',
        h1: `$99.99 lapsed · <span class="ci-money">${v.clipperCountDisplay} clippers</span> stopped paying you`,
        sub: `Your ledger balance of <b>${v.balanceDisplay}</b> is safe · you can still withdraw. But <b>new drops stopped</b>. Reactivate any time to resume — same ${v.clipperCountDisplay} clippers, same 50% split.`,
        coach: `"Alright — respected. If you change your mind, <b>reactivating in the next 30 days</b> restores your affiliate custom-commission with Whop and drops resume. After 30 days it's a fresh start."`,
        keepLabel: 'Reactivate my $99.99/mo',
        quietLabel: `Withdraw balance · ${v.balanceDisplay}`,
        showLossTable: false,
        kadePose: 'kade-idle',
      };
  }
}

/** Zero-earning-history state · no fabricated numbers, no loss table.
 *  Rendered when useCrewPipeline says `earning_count === 0`. */
function zeroStateConfig(state: CancelState): StateConfig {
  switch (state) {
    case 'cancel-attempt':
      return {
        eyebrow: `Cancel $99.99/mo?`,
        h1: `You haven't started earning yet · but you can`,
        sub: `Your <b>$99.99/mo</b> subscription unlocks the affiliate flywheel — every clipper you invite pays you $50/mo <b class="ci-life">for LIFE</b>. Cancel = the flywheel never spins up.`,
        coach: `"Hey — I get it, you haven't earned yet. But that's because you haven't invited anyone. Cancel and the door closes. Send one invite before you go."`,
        keepLabel: 'Keep my $99.99 · send my first invite',
        quietLabel: 'Cancel anyway',
        showLossTable: false,
        kadePose: 'kade-hover',
      };
    case 'paused-then-back':
      return {
        eyebrow: 'Smart · you kept the flywheel',
        h1: `<span class="ci-money">$99.99/mo stays active</span> · start inviting`,
        sub: `Nothing changed. Send your first invite from the Wallet tab and every clipper who subs pays you <b class="ci-life">$50/mo for LIFE</b>.`,
        coach: `"Good call. Now go build. Every invite you send is a slot on the flywheel."`,
        keepLabel: 'Back to my clips',
        quietLabel: 'See wallet',
        showLossTable: false,
        kadePose: 'kade-success',
      };
    case 'already-cancelled':
      return {
        eyebrow: 'Cancelled',
        h1: `$99.99 lapsed · flywheel closed`,
        sub: `You didn't have any active clippers when you cancelled, so nothing was paying out anyway. Reactivate any time to open the flywheel again.`,
        coach: `"Respected. If you change your mind, <b>reactivating in the next 30 days</b> keeps your affiliate slot warm. After 30 days it's a fresh start."`,
        keepLabel: 'Reactivate my $99.99/mo',
        quietLabel: 'Back to app',
        showLossTable: false,
        kadePose: 'kade-idle',
      };
  }
}

export interface CancellationInterceptProps {
  showScrubber?: boolean;
  onKeep?: () => void;
  onQuiet?: () => void;
}

export function CancellationIntercept(props: CancellationInterceptProps) {
  const [state, setState] = useState<CancelState>('cancel-attempt');
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const showScrubber = props.showScrubber ?? tryImportMetaDev();

  // R2 (2026-07-11) · real data replaces the fixture PER_STATE. Both
  // hooks return an honest loading/null when the JWT is missing or the
  // backend is unreachable — we render a skeleton in those cases
  // instead of the old lie-in-brackets fixture ("15 clippers · $742.50").
  const wallet = useWalletLedger();
  const crew = useCrewPipeline();

  const isLoading =
    wallet.uiState === 'loading' || crew.loading;

  // Zero-earning-history: the crew hook resolved and reports the user
  // has never had a paying referral. Render an honest "you haven't
  // earned yet" branch instead of a $0 / 0 clippers loss table.
  const hasCrewData = !crew.loading && crew.data !== null;
  const earningCount = crew.data?.earning_count ?? 0;
  const showZeroState = hasCrewData && earningCount === 0;

  const balanceCents = wallet.summary?.balance_cents ?? 0;
  const nextPayoutIso = wallet.summary?.next_payout_at ?? null;
  const monthlyEarningsCents = crew.data?.monthly_earnings_cents ?? 0;

  // Honest formatters · when a real value is missing/zero, prefer a
  // plain-English placeholder over a fabricated "$0.00". Only the
  // hard zero-earning-history branch renders the zero-state copy.
  const clipperCountDisplay = hasCrewData
    ? String(earningCount)
    : '—';
  const mrrDisplay = hasCrewData && monthlyEarningsCents > 0
    ? `${fmtUsdCents(monthlyEarningsCents)}/mo`
    : 'your MRR';
  const balanceDisplay = wallet.summary && balanceCents > 0
    ? fmtUsdCents(balanceCents)
    : 'your balance';
  const nextPayoutDisplay = nextPayoutIso
    ? fmtRelativeTime(nextPayoutIso)
    : 'your next payout';

  const cfg = showZeroState
    ? zeroStateConfig(state)
    : stateConfig(state, {
        clipperCountDisplay,
        clipperCount: earningCount,
        mrrDisplay,
        balanceDisplay,
        nextPayoutDisplay,
      });

  // ── Behavioural HQ events (Chapter 6) ───────────────────────────
  const mountedRef = useRef(false);
  const stateSeenRef = useRef<Set<CancelState>>(new Set());
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    lcDiag('cancellation_intercept_viewed', { first_view: true, state });
    stateSeenRef.current.add(state);
    lcDiag('cancellation_intercept_state_viewed', {
      state,
      first_view_of_state: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!mountedRef.current) return;
    const firstView = !stateSeenRef.current.has(state);
    if (firstView) stateSeenRef.current.add(state);
    lcDiag('cancellation_intercept_state_viewed', {
      state,
      first_view_of_state: firstView,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // ── Founder video events (Chapter 6) ────────────────────────────
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
          surface: 'cancellation-intercept',
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
    if (!v) return;
    const onEnded = () => {
      if (videoFinishedRef.current) return;
      videoFinishedRef.current = true;
      lcDiag('founder_video_finished', {
        surface: 'cancellation-intercept',
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
          surface: 'cancellation-intercept',
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

  // ── CTA events (Chapter 6) · save vs. proceed-to-cancel ─────────
  const onKeep = useCallback(() => {
    lcDiag('cancellation_save_clicked', {
      cta_id: 'keep',
      cta_label: cfg.keepLabel,
      state,
    });
    if (state === 'cancel-attempt') setState('paused-then-back');
    props.onKeep?.();
  }, [state, props, cfg.keepLabel]);

  // AU-D-audit high-risk AMBER #1 · await backend confirmation before
  // transitioning to already-cancelled. Prior behaviour set state
  // locally BEFORE the /me/trial/cancel POST returned — user read
  // "Cancelled" while parent toast said "Whop refused". Now we invoke
  // the parent handler, await its result (Promise-safe when sync),
  // and only transition on success. Failure preserves the current
  // state + emits a diag event so HQ sees the refusal reason.
  const [quietBusy, setQuietBusy] = useState(false);
  const [quietError, setQuietError] = useState<string | null>(null);
  const onQuiet = useCallback(async () => {
    lcDiag('cancellation_intercept_cta_clicked', {
      cta_id: 'quiet',
      cta_label: cfg.quietLabel,
      state,
    });
    if (state !== 'cancel-attempt') {
      // In the terminal states, quiet is a re-navigation only.
      props.onQuiet?.();
      return;
    }
    setQuietBusy(true);
    setQuietError(null);
    try {
      // Promise.resolve wraps sync + async handlers uniformly.
      await Promise.resolve(props.onQuiet?.());
      setState('already-cancelled');
    } catch (exc) {
      const reason = exc instanceof Error ? exc.message : String(exc);
      // Sanitize is import-cheap — keeps bearer/JWT/emails out of UI.
      const { sanitizeError } = await import('../../components/SectionWithFallback');
      const safe = typeof sanitizeError === 'function' ? sanitizeError(reason) : reason;
      setQuietError(safe.slice(0, 240));
      lcDiag('cancellation_save_failed', { reason: safe.slice(0, 240) });
    } finally {
      setQuietBusy(false);
    }
  }, [state, props, cfg.quietLabel]);

  return (
    <div className="ci-root">
      {showScrubber && (
        <div className="ci-scrubber" role="tablist" aria-label="Cancel intercept state">
          <span className="ci-scrubber-label">STATE</span>
          {(['cancel-attempt', 'paused-then-back', 'already-cancelled'] as CancelState[]).map((s, i) => (
            <button
              key={s}
              type="button"
              className="ci-scrubber-btn"
              data-active={state === s}
              onClick={() => setState(s)}
            >
              {i + 1} · {s.replace(/-/g, ' ')}
            </button>
          ))}
          <span className="ci-scrubber-note">Fires on Settings · Plan · Cancel</span>
        </div>
      )}

      <div className="ci-scrim">
        <div className="ci-scrim-blur" aria-hidden="true" />
        <div className="ci-scrim-label">
          Settings · Plan · <b>You clicked Cancel my $99.99 subscription</b>
        </div>

        <div className="ci-modal" data-state={state}>
          {/* §13c Whop lockup · exact SVG */}
          <div className="ci-whop-pill">
            Powered by
            <SafeImg src="/brand/whop/whop_logo_lockup_white.svg" fallback="hide" alt="Whop" />
          </div>

          {/* §13g Kade avatar per state */}
          <div className="ci-kade" aria-hidden="true">
            <img
              src={`/brand/kade/${cfg.kadePose}.webp`}
              alt=""
              onError={(e) => (e.currentTarget.style.display = 'none')}
            />
          </div>

          <div className="ci-eyebrow">{cfg.eyebrow}</div>
          {isLoading ? (
            <>
              {/* R2 (2026-07-11) · loading skeleton · no fixture strings.
                  Prior version rendered "$742.50/mo · 15 clippers" for
                  every user. Now we wait for real wallet + crew data. */}
              <div
                className="ci-h1"
                data-testid="cancellation-intercept-loading"
                aria-busy="true"
                style={{ opacity: 0.4 }}
              >
                Checking your ledger…
              </div>
              <p className="ci-sub" style={{ opacity: 0.4 }}>
                Pulling your affiliate flywheel numbers so we don't guess.
              </p>
            </>
          ) : (
            <>
              <h1 className="ci-h1">{renderInline(cfg.h1)}</h1>
              <p className="ci-sub">{renderInline(cfg.sub)}</p>
            </>
          )}

          {/* R2 (2026-07-11) · loss table renders REAL affiliate numbers
              from useCrewPipeline + useWalletLedger. Zero-earning-history
              users (`earning_count === 0`) skip the table entirely — no
              lying "$0 / 0 clippers" theatre. Loading users see nothing
              here until the fetches resolve. */}
          {!isLoading && !showZeroState && cfg.showLossTable && (
            <div className="ci-loss-table" data-testid="cancellation-intercept-loss-table">
              <div className="ci-loss-row">
                <span className="ci-loss-row-label">Active clippers paying you</span>
                <span className="ci-loss-row-value">{clipperCountDisplay}</span>
              </div>
              <div className="ci-loss-row">
                <span className="ci-loss-row-label">Your take · per clipper</span>
                <span className="ci-loss-row-value">$50/mo</span>
              </div>
              <div className="ci-loss-row">
                <span className="ci-loss-row-label">Balance you keep (still withdrawable)</span>
                <span className="ci-loss-row-value">{balanceDisplay}</span>
              </div>
              <div className="ci-loss-row is-total">
                <span className="ci-loss-row-label">Monthly income you walk away from</span>
                <span className="ci-loss-row-value">{mrrDisplay}</span>
              </div>
            </div>
          )}
          {!isLoading && showZeroState && state === 'cancel-attempt' && (
            <div
              className="ci-loss-table"
              data-testid="cancellation-intercept-zero-state"
              data-zero-state="true"
            >
              <div className="ci-loss-row">
                <span className="ci-loss-row-label">Clippers paying you today</span>
                <span className="ci-loss-row-value">0</span>
              </div>
              <div className="ci-loss-row is-total">
                <span className="ci-loss-row-label">
                  You haven't earned yet · send a first invite before you cancel
                </span>
                <span className="ci-loss-row-value">—</span>
              </div>
            </div>
          )}

          <div className="ci-coach">
            <div className="ci-coach-thumb" onClick={toggleMute}>
              <video ref={videoRef} autoPlay muted playsInline loop preload="auto">
                <source src="/brand/founder/founder-hook.mp4" type="video/mp4" />
              </video>
            </div>
            <div>
              <div className="ci-coach-eyebrow">Daniel · founder{muted ? ' · click for sound' : ' · playing'}</div>
              <div className="ci-coach-script">{renderInline(cfg.coach)}</div>
              <button type="button" className="ci-coach-audio" onClick={toggleMute}>
                {muted ? 'Click for sound' : 'Mute'}
              </button>
            </div>
          </div>

          <div className="ci-cta-row">
            <button type="button" className="ci-cta-keep" onClick={onKeep} disabled={quietBusy}>
              <span>{cfg.keepLabel}</span>
            </button>
            <button type="button" className="ci-cta-quiet" onClick={onQuiet} disabled={quietBusy}>
              {quietBusy ? "Confirming with Whop…" : cfg.quietLabel}
            </button>
          </div>
          {quietError && state === 'cancel-attempt' && (
            <div className="ci-cta-error" role="alert" data-testid="cancellation-quiet-error">
              Cancel didn't go through · {quietError}
            </div>
          )}
        </div>
      </div>

      {/* Port #8c · #5 · contextual demo overlay · shows on the initial
          cancel-attempt state so a confused user gets a walkthrough
          before deciding. Dismissed once (localStorage:
          demo-shown-cancellation) → collapses to "?" pill for later
          re-watch. paused-then-back and already-cancelled hide the
          overlay entirely (decision already made). */}
      {state === 'cancel-attempt' && (
        <DemoOverlay
          mp4Src="/demos/05-cancellation-save.mp4"
          kadePosterSrc="/brand/kade/kade-hover.webp"
          title="Cancellation save walkthrough"
          storageKey="demo-shown-cancellation"
          hint={<><strong>60 sec</strong> · tap to unmute · ✕ to dismiss</>}
        />
      )}
    </div>
  );
}

function tryImportMetaDev(): boolean {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  } catch { return false; }
}
