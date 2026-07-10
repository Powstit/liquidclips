/**
 * Port · Learn tab (route)
 * Source: 05_html-mockups/approved/demo-video-placement.html (grid view)
 *
 * 7 demo cards in a 3-col responsive grid. Videos are hydrated at
 * /demos/*.mp4 · Kade posters fall back until video autoplays (per
 * claude-2's fix: poster pointer-events: none · z-index: 0 · video
 * z-index: 1 · .is-playing hides poster on first `playing` event).
 *
 * Route: /learn · nav label: "Learn" · nav badge: /brand/nav-badges/learn.png
 *
 * §13c Whop lockup in header · §13d halo bleed 16/28/40 · §13e
 * app-native 1280×820 viewport (3-col at 370px + 18px gap) · §13g
 * Kade posters from the mapped 7 only.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SafeImg } from '../../components/safe';
// Chapter 6 · behavioural events. Canonical lcDiag rail — no parallel telemetry.
import { lcDiag } from '../../lib/diagnosticLogger';
import './LearnTab.css';

interface Demo {
  num: string;
  title: string;
  where: string;
  description: string;
  mp4: string;
  poster: string;
}

const DEMOS: Demo[] = [
  {
    num: '01',
    title: 'Pick a video to clip',
    where: 'Build tab · hero',
    description: 'Drop a video · pick the moments that matter · watch the clip land in your library.',
    mp4: '/demos/01-clipping.mp4',
    poster: '/brand/kade/kade-cutting-clips.webp',
  },
  {
    num: '02',
    title: 'Login & activation',
    where: 'First-launch onboarding',
    description: 'One tap to sign in · the app catches your activation · no browser bounce.',
    mp4: '/demos/02-login-activation.mp4',
    poster: '/brand/kade/kade-reading-brief.webp',
  },
  {
    num: '03',
    title: 'The money moment',
    where: 'Post-payment · sync-mail',
    description: 'Link your email · we find clippers you already know · $50/mo each, for LIFE.',
    mp4: '/demos/03-money-moment.mp4',
    poster: '/brand/kade/kade-earn-mode.webp',
  },
  {
    num: '04',
    title: 'Wallet & payouts',
    where: 'Earn tab · wallet detail',
    description: `See every $50 drop · lifetime totals · streaks · payouts unlock when the withdrawal rail goes live · we'll DM you.`,
    mp4: '/demos/04-wallet-payouts.mp4',
    poster: '/brand/kade/kade-success.webp',
  },
  {
    num: '05',
    title: 'Cancellation save',
    where: 'Settings · Plan · Cancel',
    description: `Hit cancel by accident? We show what you'd walk away from · then let you keep it.`,
    mp4: '/demos/05-cancellation-save.mp4',
    poster: '/brand/kade/kade-hover.webp',
  },
  {
    num: '06',
    title: 'In-app browser',
    where: 'Sovereign workbench',
    description: 'Whop · Gmail · YouTube all live inside the app · one continuous surface, no popup blockers.',
    mp4: '/demos/06-in-app-browser.mp4',
    poster: '/brand/kade/kade-community-mode.webp',
  },
  {
    num: '07',
    title: 'Cold email preview card',
    where: 'Campaign builder · preview',
    description: `See exactly what the recipient sees before you send · 100 clips ready · $99.99 unlock.`,
    mp4: '/demos/07-cold-email-preview.mp4',
    poster: '/brand/kade/kade-campaign-mode.webp',
  },
];

export function LearnTab() {
  // Chapter 6 · single first-mount event for the Learn surface. Per-card
  // events fire from within <LearnCard/> below.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    lcDiag('learn_tab_viewed', { first_view: true, card_count: DEMOS.length });
  }, []);

  return (
    <div className="lt-root">
      <div className="lt-stage">
        <div className="lt-header">
          <div className="lt-whop-pill">
            Powered by
            <SafeImg src="/brand/whop/whop_logo_lockup_white.svg" fallback="hide" alt="Whop" />
          </div>
          <div className="lt-eyebrow">Learn · 7 demos</div>
          <h1 className="lt-title">Every corner of the app, in a clip</h1>
          <p className="lt-sub">
            Tap any card to unmute + play from the start.
            The full flow from clipping to cash · under 30 seconds each.
          </p>
        </div>

        <div className="lt-grid">
          {DEMOS.map((d) => (
            <LearnCard key={d.num} demo={d} />
          ))}
        </div>
      </div>
    </div>
  );
}

interface LearnCardProps {
  demo: Demo;
}

/**
 * Ship-lens P1-001 fix (2026-07-10) · typed state union.
 * Every user-facing surface must expose a scrubber-visible state
 * grammar as `data-state=<union>` on the primary rendered node.
 * Approved mockup (docs/mockups/approved/demo-video-placement.html)
 * exposes per-card states: idle (before first click), playing,
 * focused (unmuted from-start), error (video load failed).
 */
type LearnCardState = "idle" | "playing" | "focused" | "error";

function LearnCard({ demo }: LearnCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [hasError, setHasError] = useState(false);
  // Chapter 6 · one founder_video_started + founder_video_finished per
  // card per session. Each card = one demo of a real money surface, so
  // engagement is captured at the surface_of_demo grain.
  const videoStartedRef = useRef(false);
  const videoFinishedRef = useRef(false);

  // Derive the typed card state from the primitive flags · the CSS
  // `.lt-card` node exposes it via `data-state` so ship-lens can grep
  // the surface's state grammar.
  const cardState: LearnCardState =
    hasError ? "error"
    : isFocused ? "focused"
    : isPlaying ? "playing"
    : "idle";

  const onCardClick = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    lcDiag('learn_tab_cta_clicked', {
      cta_id: 'card',
      cta_label: demo.title,
      demo_num: demo.num,
      surface_of_demo: `learn-demo-${demo.num}`,
    });
    if (!isFocused) {
      v.muted = false;
      v.currentTime = 0;
      void v.play();
      setIsFocused(true);
      if (!videoStartedRef.current) {
        videoStartedRef.current = true;
        lcDiag('founder_video_started', {
          surface: `learn-demo-${demo.num}`,
          video_file: demo.mp4.split('/').pop() ?? demo.mp4,
        });
      }
    } else {
      if (v.paused) {
        void v.play();
      } else {
        v.pause();
      }
    }
  }, [isFocused, demo.num, demo.mp4, demo.title]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onEnded = () => {
      if (videoFinishedRef.current) return;
      videoFinishedRef.current = true;
      lcDiag('founder_video_finished', {
        surface: `learn-demo-${demo.num}`,
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
          surface: `learn-demo-${demo.num}`,
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
  }, [demo.num]);

  return (
    <div
      className={`lt-card ${isFocused ? 'is-focused' : ''} ${hasError ? 'is-error' : ''}`}
      data-state={cardState}
      onClick={onCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onCardClick(); }}
    >
      <div className={`lt-video-slot ${isPlaying ? 'is-playing' : ''}`}>
        <div className="lt-poster-fallback">
          <img src={demo.poster} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
        </div>
        <video
          ref={videoRef}
          muted
          playsInline
          loop
          autoPlay
          preload="metadata"
          poster={demo.poster}
          onPlaying={() => { setIsPlaying(true); setHasError(false); }}
          onPause={() => setIsPlaying(false)}
          onError={() => setHasError(true)}
        >
          <source src={demo.mp4} type="video/mp4" />
        </video>
        <div className="lt-num-badge">{demo.num}</div>
        <div className="lt-play-badge" aria-hidden="true" />
      </div>
      <div className="lt-meta">
        <div className="lt-meta-title">{demo.title}</div>
        <div className="lt-meta-where">{demo.where}</div>
        <div className="lt-meta-desc">{demo.description}</div>
        <div className="lt-meta-hint">Thumbnail slot ready · Daniel to drop custom art</div>
      </div>
    </div>
  );
}
