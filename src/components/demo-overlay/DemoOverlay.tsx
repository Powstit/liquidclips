/**
 * DemoOverlay · shared component for Section B Port #8b/#8c
 *
 * Small floating video-card that appears bottom-right of the parent
 * route. When dismissed, collapses to a "?" pill that re-opens the
 * overlay on click.
 *
 * Poster-fallback pattern mirrors Learn tab (#8a) with claude-2's
 * fixes:
 *   - .do-poster-fallback { pointer-events: none; z-index: 0 }
 *   - <video> { z-index: 1 }
 *   - .do-video-slot.is-playing .do-poster-fallback { opacity: 0 }
 *   - autoplay muted on mount · click to unmute + restart
 *
 * Persistence via localStorage · once dismissed, the overlay stays
 * pill-only for that route until parent explicitly resets the key.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import './DemoOverlay.css';

export interface DemoOverlayProps {
  mp4Src: string;
  kadePosterSrc: string;
  title: string;
  /** localStorage key that remembers dismissal per-route. */
  storageKey: string;
  /** Optional callback fired when the user dismisses. */
  onDismiss?: () => void;
  /** `fixed` (default) pins bottom-right of viewport. `inline` renders
   *  in parent flow (for two-panel layouts like sync-mail). */
  position?: 'fixed' | 'inline';
  /** Optional compact layout (280px vs 360px width). */
  compact?: boolean;
  /** Override initial visibility. When true, ignores storageKey and
   *  shows the overlay regardless. Parent uses this to force-show. */
  forceShow?: boolean;
  /** Short hint below the title. */
  hint?: ReactNode;
}

export function DemoOverlay(props: DemoOverlayProps) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (props.forceShow) return false;
    try {
      return localStorage.getItem(props.storageKey) === '1';
    } catch { return false; }
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const onDismiss = useCallback(() => {
    try { localStorage.setItem(props.storageKey, '1'); } catch { /* noop */ }
    setDismissed(true);
    props.onDismiss?.();
  }, [props]);

  const onReopen = useCallback(() => {
    try { localStorage.removeItem(props.storageKey); } catch { /* noop */ }
    setDismissed(false);
  }, [props.storageKey]);

  const onCardClick = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!isFocused) {
      v.muted = false;
      v.currentTime = 0;
      void v.play();
      setIsFocused(true);
    } else {
      if (v.paused) void v.play();
      else v.pause();
    }
  }, [isFocused]);

  useEffect(() => {
    if (dismissed) return;
    const v = videoRef.current;
    if (v) {
      v.muted = true;
      void v.play().catch(() => undefined);
    }
  }, [dismissed]);

  if (dismissed) {
    return (
      <button
        type="button"
        className="do-pill"
        onClick={onReopen}
        aria-label={`Re-open demo: ${props.title}`}
        title={`Re-open demo: ${props.title}`}
      >
        ?
      </button>
    );
  }

  return (
    <div
      className="do-overlay"
      role="dialog"
      aria-label={`Demo: ${props.title}`}
      data-position={props.position ?? 'fixed'}
      data-compact={props.compact ? 'true' : 'false'}
    >
      <div className={`do-video-slot ${isPlaying ? 'is-playing' : ''}`} onClick={onCardClick}>
        <div className="do-poster-fallback">
          <img src={props.kadePosterSrc} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
        </div>
        <video
          ref={videoRef}
          muted
          playsInline
          loop
          autoPlay
          preload="metadata"
          poster={props.kadePosterSrc}
          onPlaying={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        >
          <source src={props.mp4Src} type="video/mp4" />
        </video>
        <button
          type="button"
          className="do-dismiss"
          onClick={(e) => { e.stopPropagation(); onDismiss(); }}
          aria-label="Dismiss demo"
          title="Dismiss demo"
        >
          ✕
        </button>
      </div>
      <div className="do-meta">
        <div className="do-title">{props.title}</div>
        <div className="do-hint">{props.hint ?? <><strong>Tap</strong> to unmute · <strong>✕</strong> to dismiss</>}</div>
      </div>
    </div>
  );
}
