// v0.7.0 (Sprint 2) — Sponsored rewards on the Earn page.
//
// Two visually-separated sections:
//   (1) Featured Video — full-width autoplay card(s) for video campaigns
//       (e.g. the 50% MRR affiliate program with its kade-oasis loop).
//   (2) Banner Carousel — uniform 4:1 image banners with auto-advance + dots
//       for image-only campaigns. Workspace home page keeps its own combined
//       SponsoredRewardsRow; this file only owns the Earn surface.
//
// Splitting them stops the carousel snapping between different heights when
// you mix a 16:9 video into the 4:1 banner rhythm.

import { useCallback, useEffect, useRef, useState } from "react";
import { openSmart as openExternal } from "../../lib/openSmart";
import { ChevronLeft, ChevronRight, Flame, Lock, PlayCircle } from "lucide-react";
import { backend, type SponsoredCampaign } from "../../lib/backend";
import { humanError } from "../../lib/sidecar";

type Props = {
  tier?: "free" | "solo" | "pro" | "agency" | null;
  onUpgrade?: () => void;
};

const AUTO_ADVANCE_MS = 6000;

export function SponsoredBannerCarousel({ tier = null, onUpgrade }: Props) {
  const [campaigns, setCampaigns] = useState<SponsoredCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  // PREVENTS — silent fetch failure. The previous behaviour rendered
  // nothing forever; now the user sees an honest tile with retry.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const refetch = useCallback((): void => { setReloadTick((n) => n + 1); }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void backend
      .campaignsList()
      .then((c) => { if (!cancelled) setCampaigns(c); })
      .catch((e: unknown) => {
        if (!cancelled) {
          setCampaigns([]);
          setLoadError(humanError(e));
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadTick]);

  if (loading) {
    return (
      <section className="flex flex-col gap-2">
        <SectionHeader label="featured" count={0} icon="play" />
        <div className="h-[180px] animate-pulse rounded-2xl border border-line bg-paper-elev/40" />
      </section>
    );
  }
  if (loadError && campaigns.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <SectionHeader label="featured" count={0} icon="play" />
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-paper-elev/40 px-5 py-4">
          <p className="flex-1 font-sans text-[13px] text-text-secondary">
            Couldn&apos;t load campaigns &mdash; {loadError}
          </p>
          <button
            type="button"
            onClick={refetch}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:border-fuchsia hover:text-fuchsia"
          >
            Retry
          </button>
        </div>
      </section>
    );
  }
  if (campaigns.length === 0) return null;

  function isVisible(c: SponsoredCampaign): boolean {
    const t = tier ?? "free";
    return !c.visibility_tiers?.length || c.visibility_tiers.includes(t);
  }

  function go(c: SponsoredCampaign) {
    if (!isVisible(c)) { onUpgrade?.(); return; }
    void openExternal(c.whop_url).catch(() => undefined);
  }

  const videoCampaigns = campaigns.filter((c) => c.banner_url && isVideoUrl(c.banner_url));
  const imageCampaigns = campaigns.filter((c) => !c.banner_url || !isVideoUrl(c.banner_url));

  return (
    <div className="flex flex-col gap-6">
      {videoCampaigns.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeader label="featured" count={videoCampaigns.length} icon="play" />
          <div className="flex flex-col gap-3">
            {videoCampaigns.map((c) => (
              <VideoCard
                key={c.id}
                c={c}
                locked={!isVisible(c)}
                onClick={() => go(c)}
              />
            ))}
          </div>
        </section>
      )}

      {imageCampaigns.length > 0 && (
        <BannerCarousel
          campaigns={imageCampaigns}
          isVisible={isVisible}
          onGo={go}
        />
      )}
    </div>
  );
}

/* ── Video card (top section) ─────────────────────────────────────── */

function VideoCard({
  c, locked, onClick,
}: { c: SponsoredCampaign; locked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="library-card group relative w-full overflow-hidden rounded-3xl bg-transparent text-left p-2"
    >
      {/* v0.6.38 — Cockpit chrome on the sponsored video card: transparent
          bg, fuchsia HUD bracket corners. The video frame fills the inside;
          brackets ride at the outer edges of the card padding. */}
      <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-br" />
      <div className="relative w-full overflow-hidden rounded-2xl">
        <video
          src={c.banner_url!}
          autoPlay
          loop
          muted
          playsInline
          className={`block h-auto w-full ${locked ? "opacity-50 grayscale" : ""}`}
          draggable={false}
          onError={(e) => { (e.currentTarget as HTMLVideoElement).style.display = "none"; }}
        />
        {locked && (
          <div className="absolute inset-0 grid place-items-center bg-paper/50 backdrop-blur-sm">
            <div className="relative flex flex-col items-center gap-2 px-6 py-4 text-center">
              <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
              <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
              <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
              <span aria-hidden="true" className="library-card-corner library-card-corner-br" />
              <Lock className="h-6 w-6 text-fuchsia" />
              <p className="font-display text-[15px] font-semibold text-ink">Growth tier required</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia">Upgrade to unlock →</p>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 px-3 pt-3 font-mono text-[10px] uppercase tracking-[0.14em]">
        <div className="flex flex-wrap items-center gap-3 text-text-tertiary">
          <span className="text-fuchsia">{c.brand ?? c.name}</span>
          {c.subtitle && (
            <>
              <span>·</span>
              <span className="normal-case tracking-normal text-text-secondary">{c.subtitle}</span>
            </>
          )}
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1 ${locked ? "text-text-tertiary" : "text-fuchsia"}`}>
          {locked ? "Upgrade →" : c.cta_text}
        </span>
      </div>
    </button>
  );
}

/* ── Image banner carousel (lower section) ────────────────────────── */

function BannerCarousel({
  campaigns, isVisible, onGo,
}: {
  campaigns: SponsoredCampaign[];
  isVisible: (c: SponsoredCampaign) => boolean;
  onGo: (c: SponsoredCampaign) => void;
}) {
  const [idx, setIdx] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  // PREVENTS — autoplay burning CPU + scrolling the offscreen carousel
  // every 6s when the user has scrolled away from it. IntersectionObserver
  // pauses the timer until the carousel is back in view.
  const [onscreen, setOnscreen] = useState(true);

  useEffect(() => {
    const el = trackRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setOnscreen(e.isIntersecting);
      },
      { threshold: 0.1 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Auto-advance — pauses when user hovers the track OR scrolls it offscreen.
  useEffect(() => {
    if (campaigns.length < 2) return;
    const el = trackRef.current;
    if (!el) return;
    let hoverPaused = false;
    const onEnter = () => { hoverPaused = true; };
    const onLeave = () => { hoverPaused = false; };
    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);
    const interval = window.setInterval(() => {
      if (hoverPaused || !onscreen) return;
      setIdx((i) => (i + 1) % campaigns.length);
    }, AUTO_ADVANCE_MS);
    return () => {
      window.clearInterval(interval);
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [campaigns.length, onscreen]);

  // Scroll-snap to the active slide whenever idx changes.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const child = el.children[idx] as HTMLElement | undefined;
    if (child) child.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  }, [idx]);

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader label="sponsored rewards" count={campaigns.length} icon="flame" />
      <div className="relative">
        {campaigns.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => setIdx((i) => (i - 1 + campaigns.length) % campaigns.length)}
              aria-label="Previous campaign"
              className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full border border-line bg-paper-elev/90 p-2 text-text-secondary backdrop-blur-sm transition-colors hover:border-fuchsia hover:text-fuchsia"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setIdx((i) => (i + 1) % campaigns.length)}
              aria-label="Next campaign"
              className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full border border-line bg-paper-elev/90 p-2 text-text-secondary backdrop-blur-sm transition-colors hover:border-fuchsia hover:text-fuchsia"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}

        <div
          ref={trackRef}
          className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth rounded-3xl"
          style={{ scrollbarWidth: "none" }}
        >
          {campaigns.map((c) => (
            <CarouselSlide key={c.id} c={c} locked={!isVisible(c)} onClick={() => onGo(c)} />
          ))}
        </div>
      </div>

      {campaigns.length > 1 && (
        <div className="flex items-center justify-center gap-1.5">
          {campaigns.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setIdx(i)}
              aria-label={`Show ${c.name}`}
              className={`h-1.5 rounded-full transition-all ${
                i === idx ? "w-6 bg-fuchsia" : "w-1.5 bg-line hover:bg-text-tertiary"
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CarouselSlide({
  c, locked, onClick,
}: { c: SponsoredCampaign; locked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="library-card group relative w-full shrink-0 snap-start overflow-hidden rounded-3xl bg-transparent p-2 text-left"
    >
      <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-br" />
      {c.banner_url ? (
        <div className="relative w-full overflow-hidden rounded-2xl" style={{ aspectRatio: "4 / 1" }}>
          <img
            src={c.banner_url}
            alt={c.name}
            className={`h-full w-full object-cover ${locked ? "opacity-50 grayscale" : ""}`}
            loading="lazy"
            draggable={false}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          {locked && (
            <div className="absolute inset-0 grid place-items-center bg-paper/50 backdrop-blur-sm">
              <div className="relative flex flex-col items-center gap-2 px-6 py-4 text-center">
                <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
                <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
                <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
                <span aria-hidden="true" className="library-card-corner library-card-corner-br" />
                <Lock className="h-6 w-6 text-fuchsia" />
                <p className="font-display text-[15px] font-semibold text-ink">Growth tier required</p>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia">Upgrade to unlock →</p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="px-6 py-7">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia">{c.brand ?? "campaign"}</p>
          <h3 className="mt-1 font-display text-[20px] font-semibold tracking-[-0.015em] text-ink">{c.name}</h3>
          {c.subtitle && <p className="mt-1 font-sans text-[13px] text-text-secondary">{c.subtitle}</p>}
        </div>
      )}
    </button>
  );
}

/* ── helpers ─────────────────────────────────────────────────────── */

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(url);
}

function SectionHeader({
  label, count, icon,
}: { label: string; count: number; icon: "flame" | "play" }) {
  const Icon = icon === "play" ? PlayCircle : Flame;
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-fuchsia">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
        {count > 0 ? `${count} live` : "loading…"}
      </span>
    </div>
  );
}
