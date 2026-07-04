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

import { useCallback, useRef, useState } from 'react';
import { DemoOverlay } from '../../components/demo-overlay';
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

const PER_STATE: Record<CancelState, StateConfig> = {
  'cancel-attempt': {
    eyebrow: `Hold up · you're about to lose money`,
    h1: `Cancel $99.99 · lose <span class="ci-money">$742.50/mo</span> in ledger drops`,
    sub: `Your <b>$99.99/mo</b> subscription is what makes the affiliate flywheel <b class="ci-life">for LIFE</b> work. Cancel = <b>Whop stops splitting</b> from your 15 clippers · balance stays but new drops freeze.`,
    coach: `"Hey — you built this. <b>15 clippers</b> are subbed under you. That's <b>$742.50 dropping every month, for LIFE</b>. Cancel your $99.99 → the flywheel just stops. Don't do it."`,
    keepLabel: 'Keep my $99.99 · keep earning',
    quietLabel: 'Cancel anyway',
    showLossTable: true,
    kadePose: 'kade-hover',
  },
  'paused-then-back': {
    eyebrow: 'Smart · you saved the flywheel',
    h1: `<span class="ci-money">$99.99/mo stays active</span> · drops keep coming`,
    sub: `Nothing changed. Your <b>15 clippers</b> keep paying <b class="ci-life">$50/mo each, for LIFE</b>. Next payout in <b>4 days</b>. See your wallet if you want to withdraw the $247.50 you've already earned.`,
    coach: `"That's the move. Every drop from here is pure margin. <b>Don't let the $99.99 lapse</b> — it's the only thing between you and losing $742.50/mo. Come back to me if you ever get itchy."`,
    keepLabel: 'Back to my clips',
    quietLabel: 'See wallet',
    showLossTable: false,
    kadePose: 'kade-success',
  },
  'already-cancelled': {
    eyebrow: 'Cancelled · your flywheel froze',
    h1: `$99.99 lapsed · <span class="ci-money">15 clippers</span> stopped paying you`,
    sub: `Your ledger balance of <b>$247.50</b> is safe · you can still withdraw. But <b>new drops stopped</b>. Reactivate any time to resume — same 15 clippers, same 50% split.`,
    coach: `"Alright — respected. If you change your mind, <b>reactivating in the next 30 days</b> restores your affiliate custom-commission with Whop and drops resume. After 30 days it's a fresh start."`,
    keepLabel: 'Reactivate my $99.99/mo',
    quietLabel: 'Withdraw balance · $247.50',
    showLossTable: false,
    kadePose: 'kade-idle',
  },
};

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

  const cfg = PER_STATE[state];

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

  const onKeep = useCallback(() => {
    if (state === 'cancel-attempt') setState('paused-then-back');
    props.onKeep?.();
  }, [state, props]);

  const onQuiet = useCallback(() => {
    if (state === 'cancel-attempt') setState('already-cancelled');
    props.onQuiet?.();
  }, [state, props]);

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
            <img src="/brand/whop/whop_logo_lockup_white.svg" alt="Whop" />
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
          <h1 className="ci-h1" dangerouslySetInnerHTML={{ __html: cfg.h1 }} />
          <p className="ci-sub" dangerouslySetInnerHTML={{ __html: cfg.sub }} />

          {cfg.showLossTable && (
            <div className="ci-loss-table">
              <div className="ci-loss-row">
                <span className="ci-loss-row-label">Active clippers paying you</span>
                <span className="ci-loss-row-value">15</span>
              </div>
              <div className="ci-loss-row">
                <span className="ci-loss-row-label">Your take · per clipper</span>
                <span className="ci-loss-row-value">$50/mo</span>
              </div>
              <div className="ci-loss-row">
                <span className="ci-loss-row-label">Balance you keep (still withdrawable)</span>
                <span className="ci-loss-row-value">$247.50</span>
              </div>
              <div className="ci-loss-row is-total">
                <span className="ci-loss-row-label">Monthly income you walk away from</span>
                <span className="ci-loss-row-value">$742.50/mo</span>
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
              <div className="ci-coach-script" dangerouslySetInnerHTML={{ __html: cfg.coach }} />
              <button type="button" className="ci-coach-audio" onClick={toggleMute}>
                {muted ? 'Click for sound' : 'Mute'}
              </button>
            </div>
          </div>

          <div className="ci-cta-row">
            <button type="button" className="ci-cta-keep" onClick={onKeep}>
              <span>{cfg.keepLabel}</span>
            </button>
            <button type="button" className="ci-cta-quiet" onClick={onQuiet}>
              {cfg.quietLabel}
            </button>
          </div>
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
