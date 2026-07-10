/**
 * Port · catalog-carousel · F9 YouTube catalog surface
 * Source: 05_html-mockups/approved/catalog-carousel.html
 *
 * 6 states per D2 v1.1 slug map:
 *   empty · loading · partial · ready · error · focused
 *
 * Kade pose per state (§13g locked table):
 *   empty      → kade-idle
 *   loading    → kade-generating-captions
 *   partial    → kade-cutting-clips
 *   ready      → kade-success
 *   focused    → kade-earn-mode
 *   error      → kade-error
 *
 * Voice per §13b: no "bounty" · use skill/clip job/paid post.
 * Paid-user Library surface · not a paywall · no Whop pill or
 * pricing tokens land in this route.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { renderInline } from '../../components/safe-inline';
// Chapter 6 · behavioural events. Canonical lcDiag rail — no parallel telemetry.
import { lcDiag } from '../../lib/diagnosticLogger';
import './CatalogCarousel.css';

export type CatalogState = 'empty' | 'loading' | 'partial' | 'ready' | 'error' | 'focused';

interface Tile {
  id: string;
  title: string;
  publishedAt: string;
  views: string;
  duration: string;
  clipCount: number;
  thumbnail: string;
  loading?: boolean;
}

interface StateConfig {
  title: string;
  sub: string;
  badge: string;
  kadePose: string;
}

const PER_STATE: Record<CatalogState, StateConfig> = {
  'empty':    { title: 'Nothing to clip yet',                                          sub: `We'll rescan when you post more`,                                          badge: 'No result', kadePose: 'kade-idle' },
  'loading':  { title: 'Scanning your channel…',                                       sub: 'Pulling latest videos from YouTube',                                        badge: 'Loading',   kadePose: 'kade-generating-captions' },
  'partial':  { title: '6 of 10 loaded',                                               sub: '<strong>60%</strong> done · fetching the rest',                            badge: 'Unlocked',  kadePose: 'kade-cutting-clips' },
  'ready':    { title: 'Your library · pick a video to clip',                          sub: '<strong>10</strong> recent videos · <strong>fresh scan</strong> · updated 3 min ago', badge: 'Unlocked', kadePose: 'kade-success' },
  'focused':  { title: 'Your library · pick a video to clip',                          sub: '<strong>10</strong> recent videos · use arrows or click to pick',           badge: 'Unlocked',  kadePose: 'kade-earn-mode' },
  'error':    { title: `YouTube's not responding`,                                     sub: 'Refresh in a minute · your videos are safe',                                badge: 'Retry',     kadePose: 'kade-error' },
};

// Ship-lens P1-004 fix (2026-07-10) · DEMO_TILES fixture deleted.
// Previously shipped 10 fictional MKBHD/CES/Apple videos (all pointing at
// Rick Astley's dQw4w9WgXcQ thumbnail) as the default when the `tiles`
// prop was absent — so any user landing on CampaignsSection (which
// renders <CatalogCarousel /> with no tiles prop) saw ten videos
// pretending to be their own YouTube library. That's fixture data on
// a customer surface — the honest empty state (mockup's `empty`
// config) fires instead when no real library is passed.
//
// Real library data will arrive via `tiles` prop from the parent when
// Layer 4 (F7) lands the /yt/batch-lookup wire; until then, the
// carousel renders the honest empty state per the approved mockup.

const FOCUS_TILE_ID = 'v3';   // Focus tile id preserved for the mockup's `focused` state fixture wiring.

export interface CatalogCarouselProps {
  showScrubber?: boolean;
  onClipClick?: (tile: Tile) => void;
  /** Optional injected fetcher · Layer 4 (F7) will pass the real
   *  `POST /yt/batch-lookup` response. For QA the default demo tiles
   *  land. */
  tiles?: Tile[];
}

export function CatalogCarousel(props: CatalogCarouselProps) {
  const [state, setState] = useState<CatalogState>('ready');
  const railRef = useRef<HTMLDivElement>(null);
  const showScrubber = props.showScrubber ?? tryImportMetaDev();

  // Ship-lens P1-004 fix (2026-07-10) · honest empty default. If no
  // real tiles prop is passed, force the mockup's `empty` state
  // instead of pretending a demo library exists. The scrubber
  // (dev-only) still lets QA cycle through every state manually.
  const tiles = props.tiles ?? [];
  const hasTiles = tiles.length > 0;
  // Force `empty` when no real tiles are available and the parent
  // hasn't overridden via the scrubber. `ready` / `focused` /
  // `partial` all pretend content exists — collapse them to `empty`
  // when there truly is none.
  const effectiveState: CatalogState =
    !hasTiles && (state === 'ready' || state === 'focused' || state === 'partial')
      ? 'empty'
      : state;
  const cfg = PER_STATE[effectiveState];

  const focusedId = effectiveState === 'focused' ? FOCUS_TILE_ID : null;

  // ── Behavioural HQ events (Chapter 6) ───────────────────────────
  // Catalog is a tool-adjacent money surface. Approved mockup has no
  // <video> tag → skip founder_video_started/finished (per spec).
  const mountedRef = useRef(false);
  const stateSeenRef = useRef<Set<CatalogState>>(new Set());
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    lcDiag('catalog_carousel_viewed', { first_view: true, state });
    stateSeenRef.current.add(state);
    lcDiag('catalog_carousel_state_viewed', {
      state,
      first_view_of_state: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!mountedRef.current) return;
    const firstView = !stateSeenRef.current.has(state);
    if (firstView) stateSeenRef.current.add(state);
    lcDiag('catalog_carousel_state_viewed', {
      state,
      first_view_of_state: firstView,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const scrollBy = useCallback((delta: number) => {
    railRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);

  const centerFocused = useCallback(() => {
    const el = railRef.current?.querySelector<HTMLElement>(`[data-tile-id="${FOCUS_TILE_ID}"]`);
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, []);

  const orderedStates = useMemo<CatalogState[]>(
    () => ['empty', 'loading', 'partial', 'ready', 'error', 'focused'],
    [],
  );

  return (
    <div className="cat-root">
      {showScrubber && (
        <div className="cat-scrubber" role="tablist" aria-label="Catalog state">
          <span className="cat-scrubber-label">STATE</span>
          {orderedStates.map((s, i) => (
            <button
              key={s}
              type="button"
              className="cat-scrubber-btn"
              data-active={state === s}
              onClick={() => {
                setState(s);
                if (s === 'focused') {
                  window.requestAnimationFrame(() => centerFocused());
                }
              }}
            >
              {i + 1} · {s}
            </button>
          ))}
          <span className="cat-scrubber-note">1200 × auto · F9 catalog · 1280×820</span>
        </div>
      )}

      <div className="cat-stage">
        {/* Header · Kade + title + mode badge */}
        <div className="cat-header">
          <div className="cat-kade-thumb">
            <img
              src={`/brand/kade/${cfg.kadePose}.webp`}
              alt=""
              onError={(e) => (e.currentTarget.style.display = 'none')}
            />
          </div>
          <div>
            <div className="cat-header-title">{cfg.title}</div>
            <div className="cat-header-sub">{renderInline(cfg.sub)}</div>
          </div>
          <div className="cat-mode-badge">{cfg.badge}</div>
        </div>

        {/* Shell */}
        <div className="cat-shell" data-state={effectiveState}>
          <span className="cat-hud-tr" aria-hidden="true" />
          <span className="cat-hud-br" aria-hidden="true" />
          <div className="cat-scanlines" aria-hidden="true" />

          {/* Banners */}
          <div className="cat-banner cat-banner-empty">
            <div className="cat-banner-icon">i</div>
            <div className="cat-banner-body">
              We scanned your channel and didn't find anything clippable yet.
              Post a couple more videos and we'll rescan — <strong>no charge</strong>.
            </div>
          </div>
          <div className="cat-banner cat-banner-error">
            <div className="cat-banner-icon">!</div>
            <div className="cat-banner-body">
              YouTube's not responding right now.
              Refresh in a minute or two — <strong>your videos are safe</strong>, we just can't fetch previews.
            </div>
          </div>

          <div className="cat-rail-wrap">
            <button type="button" className="cat-arrow cat-arrow-prev" aria-label="scroll left" onClick={() => scrollBy(-500)}>‹</button>
            <button type="button" className="cat-arrow cat-arrow-next" aria-label="scroll right" onClick={() => scrollBy(500)}>›</button>

            <div className="cat-rail" ref={railRef} tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft')  scrollBy(-260);
                if (e.key === 'ArrowRight') scrollBy( 260);
              }}
            >
              {tiles.map((t) => (
                <div
                  key={t.id}
                  className="cat-tile"
                  data-tile-id={t.id}
                  data-focused={focusedId === t.id}
                  data-loading={t.loading ? 'true' : 'false'}
                  onClick={() => {
                    lcDiag('catalog_row_clicked', {
                      catalog_id: t.id,
                      clip_count: t.clipCount,
                      state,
                    });
                    props.onClipClick?.(t);
                  }}
                >
                  <div className="cat-tile-thumb">
                    <img className="cat-thumb-img" src={t.thumbnail} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
                    <span className="cat-duration-chip">{t.duration}</span>
                    <span className="cat-clip-count">{t.clipCount} clips</span>
                    <div className="cat-play-overlay" />
                  </div>
                  <div className="cat-tile-body">
                    <div className="cat-tile-title">{t.title}</div>
                    <div className="cat-tile-meta">
                      {t.publishedAt}
                      <span className="cat-tile-meta-sep" />
                      {t.views}
                    </div>
                    <button type="button" className="cat-tile-cta" onClick={(e) => {
                      e.stopPropagation();
                      lcDiag('catalog_carousel_cta_clicked', {
                        cta_id: 'open-in-editor',
                        cta_label: 'Open in editor',
                        catalog_id: t.id,
                        state,
                      });
                      props.onClipClick?.(t);
                    }}>
                      Open in editor
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="cat-below-strip">
          <div><strong>Tip:</strong> hover a tile to preview · click to open in editor · use arrows to browse</div>
          <div className="cat-divider" />
          <div>Fresh scan · <strong>3 min ago</strong></div>
        </div>
      </div>
    </div>
  );
}

function tryImportMetaDev(): boolean {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  } catch { return false; }
}
