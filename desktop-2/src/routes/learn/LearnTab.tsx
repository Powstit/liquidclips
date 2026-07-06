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

import { useCallback, useRef, useState } from 'react';
import { SafeImg } from '../../components/safe';
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

function LearnCard({ demo }: LearnCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const onCardClick = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!isFocused) {
      v.muted = false;
      v.currentTime = 0;
      void v.play();
      setIsFocused(true);
    } else {
      if (v.paused) {
        void v.play();
      } else {
        v.pause();
      }
    }
  }, [isFocused]);

  return (
    <div
      className={`lt-card ${isFocused ? 'is-focused' : ''}`}
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
          onPlaying={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
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
