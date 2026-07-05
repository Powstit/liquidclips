/**
 * Port · cold-email-preview-embed-card (component)
 * Source: 05_html-mockups/approved/cold-email-preview-embed-card.html
 *
 * Slotted into the campaign-builder hero for SENDER-side preview.
 * The marketing-site version — where the actual recipient lands —
 * is HQ's territory in a future handoff.
 *
 * 7 states per D2 v1.1 slug map:
 *   loading · populated · empty_catalog · critical_countdown ·
 *   already_settled · expired · offline
 *
 * §13a Currency lock — GBP legacy value swapped to USD ($99.99).
 * §13b Voice — no "bounty" · uses "clips" / "unlock" / "skill share".
 * §13g Kade pose per state (all 7 from approved 24):
 *   loading             → kade-generating-captions
 *   populated           → kade-earn-mode
 *   empty_catalog       → kade-idle
 *   critical_countdown  → kade-warning
 *   already_settled     → kade-success
 *   expired             → kade-hover
 *   offline             → kade-error
 * §5 HUD vocabulary — bracket corners + scanline overlay.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DemoOverlay } from '../../components/demo-overlay';
import './EmbedPreviewCard.css';

export type EmbedState =
  | 'loading'
  | 'populated'
  | 'empty_catalog'
  | 'critical_countdown'
  | 'already_settled'
  | 'expired'
  | 'offline';

interface StateConfig {
  balance: string;
  countdown: string;
  ident: string;
  kadePose: string;
}

const PER_STATE: Record<EmbedState, StateConfig> = {
  populated:           { balance: '$99.99', countdown: '47:23:11', ident: 'Order #4471',                   kadePose: 'kade-earn-mode' },
  loading:             { balance: '$99.99', countdown: '——:——:——', ident: 'checking…',                     kadePose: 'kade-generating-captions' },
  critical_countdown:  { balance: '$99.99', countdown: '05:47:22', ident: 'Order #4471 · almost gone',    kadePose: 'kade-warning' },
  already_settled:     { balance: '$99.99', countdown: '00:00:00', ident: 'Order #4471 · paid ✓',         kadePose: 'kade-success' },
  expired:             { balance: '$99.99', countdown: '00:00:00', ident: 'Order #4471 · expired',        kadePose: 'kade-hover' },
  empty_catalog:       { balance: '$0.00',  countdown: '——:——:——', ident: 'Order #4471 · no clips found', kadePose: 'kade-idle' },
  offline:             { balance: '$99.99', countdown: '47:23:11', ident: 'Order #4471 · offline',        kadePose: 'kade-error' },
};

interface CtaConfig {
  key: 'unlock' | 'reactivate' | 'open-desktop' | 'explore' | 'retry';
  label: string;
}

const CTA_BY_STATE: Record<EmbedState, CtaConfig> = {
  populated:          { key: 'unlock',       label: 'Unlock everything · $99.99' },
  loading:            { key: 'unlock',       label: 'Unlock everything · $99.99' },
  critical_countdown: { key: 'unlock',       label: 'Unlock now · $99.99' },
  already_settled:    { key: 'open-desktop', label: 'Open Liquid Clips' },
  expired:            { key: 'reactivate',   label: 'Rescan my channel next quarter' },
  empty_catalog:      { key: 'explore',      label: 'See what we tried' },
  offline:            { key: 'retry',        label: 'Try again' },
};

export interface EmbedPreviewCardProps {
  showScrubber?: boolean;
  initialState?: EmbedState;
  /** Optional handler for the primary CTA click. */
  onCta?: (key: CtaConfig['key'], state: EmbedState) => void;
  /** Optional recipient handle override (defaults to Marques). */
  handle?: string;
  handleSub?: string;
  handleInitials?: string;
}

export function EmbedPreviewCard(props: EmbedPreviewCardProps) {
  const [state, setState] = useState<EmbedState>(props.initialState ?? 'populated');
  const [countdown, setCountdown] = useState<string>(PER_STATE[state].countdown);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const showScrubber = props.showScrubber ?? tryImportMetaDev();

  const cfg = PER_STATE[state];
  const cta = CTA_BY_STATE[state];

  useEffect(() => {
    if (state !== 'populated' || cfg.countdown === '——:——:——') {
      setCountdown(cfg.countdown);
      return;
    }
    setCountdown(cfg.countdown);
    const tick = (ts: number) => {
      if (lastTickRef.current === null) lastTickRef.current = ts;
      const dt = ts - lastTickRef.current;
      if (dt >= 1000) {
        lastTickRef.current = ts;
        setCountdown((prev) => decrementCountdown(prev));
      }
      rafRef.current = window.requestAnimationFrame(tick);
    };
    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      lastTickRef.current = null;
    };
  }, [state, cfg.countdown]);

  // FRAME-04 fix · 2026-07-05 · removed dead useEffect · the previous
  // effect (lines 92-112) already sets countdown on state / cfg.countdown
  // changes. This second effect just triggered an extra render every time.

  // FRAME-05 fix · 2026-07-05 · destructure props.onCta so the useCallback
  // doesn't re-create on every parent render (was depending on the whole
  // `props` object which is a new reference every parent render).
  const propsOnCta = props.onCta;
  const onCta = useCallback(() => {
    propsOnCta?.(cta.key, state);
  }, [cta.key, state, propsOnCta]);

  const orderedStates = useMemo<EmbedState[]>(
    () => ['loading', 'populated', 'empty_catalog', 'critical_countdown', 'already_settled', 'expired', 'offline'],
    [],
  );

  const handle = props.handle ?? '@marquesbrownlee';
  const handleSub = props.handleSub ?? '19.8M subs · YouTube';
  const handleInitials = props.handleInitials ?? 'MB';

  return (
    <div className="epc-root" data-walk={showScrubber ? 'true' : 'false'}>
      {showScrubber && (
        <div className="epc-scrubber" role="tablist" aria-label="Embed card state">
          <span className="epc-scrubber-label">STATE</span>
          {orderedStates.map((s, i) => (
            <button
              key={s}
              type="button"
              className="epc-scrubber-btn"
              data-active={state === s}
              onClick={() => setState(s)}
            >
              {i + 1} · {s.replace(/_/g, ' ')}
            </button>
          ))}
          <span className="epc-scrubber-note">640 × auto · preview card · $USD locked</span>
        </div>
      )}

      <div className="epc-stage">
        <div className="epc-card" data-state={state}>
          <span className="epc-hud-tr" aria-hidden="true" />
          <span className="epc-hud-br" aria-hidden="true" />
          <div className="epc-scanlines" aria-hidden="true" />

          <div className="epc-node-header">
            <div className="epc-node-title">
              <span className="epc-node-glyph" aria-hidden="true" />
              Liquid Clips
            </div>
            <div className="epc-node-ident">{cfg.ident}</div>
          </div>

          <div className="epc-banner epc-banner-expired">
            <div className="epc-banner-icon">!</div>
            <div>
              Time's up. We deleted your 100 clips. No charge.
              The link's dead — but we can rescan next quarter.
            </div>
          </div>
          <div className="epc-banner epc-banner-settled">
            <div className="epc-banner-icon">✓</div>
            <div>
              Paid on July 1. Everything's unlocked — full-quality downloads,
              auto-post, back-catalog scanning. Open the app to grab them.
            </div>
          </div>
          <div className="epc-banner epc-banner-empty">
            <div className="epc-banner-icon">i</div>
            <div>
              We scanned your channel and didn't find anything clippable
              yet. No charge. Post 2–3 longer videos and we'll rescan.
            </div>
          </div>
          <div className="epc-banner epc-banner-offline">
            <div className="epc-banner-icon">·</div>
            <div>
              Connection dropped. Timer might be off.
              Last update was 42 seconds ago.
            </div>
          </div>

          <div className="epc-batch-strip">
            <div className="epc-avatar" aria-hidden="true">{handleInitials}</div>
            <div>
              <div className="epc-handle-line">{handle}</div>
              <div className="epc-handle-sub">{handleSub}</div>
            </div>
            <div className="epc-batch-chip">100 clips ready</div>
          </div>

          <div className="epc-ledger">
            <div className="epc-ledger-rule">──────────────────────────────────────────</div>
            <div className="epc-ledger-row">
              <div className="epc-ledger-label"><span className="epc-ledger-mark">[x]</span> Your 100 clips</div>
              <div className={`epc-ledger-value ${state === 'loading' ? 'epc-skeleton epc-skeleton-line' : ''}`}>locked</div>
            </div>
            <div className="epc-ledger-row">
              <div className="epc-ledger-label"><span className="epc-ledger-mark">[x]</span> Full-quality MP4 downloads</div>
              <div className={`epc-ledger-value ${state === 'loading' ? 'epc-skeleton epc-skeleton-line' : ''}`}>watermarked</div>
            </div>
            <div className="epc-ledger-row">
              <div className="epc-ledger-label"><span className="epc-ledger-mark">[x]</span> Auto-post to TikTok, IG, Shorts</div>
              <div className={`epc-ledger-value ${state === 'loading' ? 'epc-skeleton epc-skeleton-line' : ''}`}>off</div>
            </div>
            <div className="epc-ledger-row">
              <div className="epc-ledger-label"><span className="epc-ledger-mark">[x]</span> Scan your old videos for more</div>
              <div className={`epc-ledger-value ${state === 'loading' ? 'epc-skeleton epc-skeleton-line' : ''}`}>off</div>
            </div>
            <div className="epc-ledger-rule">──────────────────────────────────────────</div>
          </div>

          <div className="epc-balance-row">
            <div>
              <div className="epc-balance-label">Unlock everything</div>
              <div className={`epc-balance-amount ${state === 'loading' ? 'epc-skeleton epc-skeleton-lg' : ''}`}>{cfg.balance}</div>
            </div>
            <div className="epc-countdown-block">
              <div className="epc-countdown-label">Deletes in</div>
              <div className={`epc-countdown-value ${state === 'loading' ? 'epc-skeleton epc-skeleton-lg' : ''}`}>{countdown}</div>
            </div>
          </div>

          <button type="button" className="epc-cta" onClick={onCta}>
            <span className="epc-cta-icon" aria-hidden="true" />
            {cta.label}
          </button>

          <div className="epc-signature">
            <div className="epc-signature-primary">Made by Liquid Clips</div>
            <div>You'll only hear from us once. This link goes dead in 72h.</div>
          </div>

          <img
            className="epc-kade"
            src={`/brand/kade/${cfg.kadePose}.webp`}
            alt=""
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
        </div>

        <div className="epc-below-strip">
          <div>We scanned your channel · <strong>3 days ago</strong></div>
          <div>Link expires in · <strong>72 hours</strong></div>
        </div>
      </div>

      {/* Port #8c · #7 · contextual demo overlay for the campaign-builder
          sender preview. Shows on the dev-walk stage (parent controls
          via `showScrubber` · production campaign-builder host route
          can add a `forceShow`/prop-controlled render). localStorage:
          demo-shown-campaign-builder. */}
      {showScrubber && (
        <DemoOverlay
          mp4Src="/demos/07-cold-email-preview.mp4"
          kadePosterSrc="/brand/kade/kade-campaign-mode.webp"
          title="How the preview card works"
          storageKey="demo-shown-campaign-builder"
          hint={<><strong>60 sec</strong> · walk through every state</>}
        />
      )}
    </div>
  );
}

function decrementCountdown(hhmmss: string): string {
  const parts = hhmmss.split(':').map((n) => Number(n));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return hhmmss;
  let total = parts[0] * 3600 + parts[1] * 60 + parts[2] - 1;
  if (total < 0) total = 0;
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function tryImportMetaDev(): boolean {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  } catch { return false; }
}
