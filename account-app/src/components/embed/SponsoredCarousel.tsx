"use client";

// SURFACE: sponsored carousel (embed port of desktop SponsoredBannerCarousel)
// MAP TAGS: (O #5) discovery | (O #5 — see what's locked) upgrade overlay
// See desktop/docs/UI_MAP_embed_surfaces.md — the contract.
//
// 1:1 visual port of `desktop/src/components/earn/SponsoredBannerCarousel.tsx`.
// Same SponsoredCampaign shape, same split:
//   • Featured (video) — full-width autoplay card per campaign
//   • Sponsored Rewards (image) — 4:1 banner carousel with 6s auto-advance
//
// Click-through does NOT open external URLs (the webview's `connectSrc` won't
// load whop.com, and we don't want the embed to swallow navigation). Instead
// we postMessage `lc:nav` to the desktop parent — desktop reads the campaign
// id and routes natively (browse panel / system browser, owner's choice).

import { useCallback, useEffect, useRef, useState } from "react";
import { EMBED_MSG } from "@/lib/embed-auth";

// Mirror of `desktop/src/lib/backend.ts` — keep in lockstep with the server
// shape. Trimmed of the fields the embed never reads, but the wire fields are
// preserved verbatim so a stale prop doesn't break decoding.
export type SponsoredCampaign = {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  subtitle: string | null;
  type: "public" | "coming_soon" | "funded" | "invite_only" | "recurring";
  status: "coming_soon" | "partially_funded" | "funded" | "live" | "closed";
  rpm_cents: number;
  budget_cents: number;
  funded_pct: number;
  duration_label: string | null;
  whop_url: string;
  banner_url: string | null;
  eligibility: string[];
  visibility_tiers: string[];
  min_lc_score: number;
  cta_text: string;
  sort_order: number;
};

const AUTO_ADVANCE_MS = 6000;

type Tier = "free" | "solo" | "pro" | "agency" | "growth" | "channel" | "autopilot" | null;

export function SponsoredCarousel({
  campaigns,
  tier = null,
}: {
  campaigns: SponsoredCampaign[];
  tier?: Tier;
}) {
  const isVisible = useCallback(
    (c: SponsoredCampaign): boolean => {
      const t = tier ?? "free";
      return !c.visibility_tiers?.length || c.visibility_tiers.includes(t);
    },
    [tier],
  );

  const go = useCallback((c: SponsoredCampaign) => {
    // Bounce to the desktop parent — never load whop.com inside the embed.
    try {
      window.parent.postMessage(
        { type: EMBED_MSG.NAV_CAMPAIGN, target: "campaign", id: c.id },
        "*",
      );
    } catch {
      /* outside an iframe — no-op */
    }
  }, []);

  if (!campaigns || campaigns.length === 0) return null;

  const videoCampaigns = campaigns.filter(
    (c) => c.banner_url && isVideoUrl(c.banner_url),
  );
  const imageCampaigns = campaigns.filter(
    (c) => !c.banner_url || !isVideoUrl(c.banner_url),
  );

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

/* ── Video card ──────────────────────────────────────────────────── */

function VideoCard({
  c,
  locked,
  onClick,
}: {
  c: SponsoredCampaign;
  locked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="library-card group relative w-full overflow-hidden rounded-3xl bg-transparent text-left p-2"
    >
      <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-br" />
      <div className="relative w-full overflow-hidden rounded-2xl">
        <video
          src={c.banner_url ?? undefined}
          autoPlay
          loop
          muted
          playsInline
          className={`block h-auto w-full ${locked ? "opacity-50 grayscale" : ""}`}
          draggable={false}
        />
        {locked && <LockedOverlay />}
      </div>
      <div className="flex items-center justify-between gap-3 px-3 pt-3 font-mono text-[10px] uppercase tracking-[0.14em]">
        <div className="flex flex-wrap items-center gap-3 text-text-tertiary">
          <span className="text-fuchsia">{c.brand ?? c.name}</span>
          {c.subtitle && (
            <>
              <span>·</span>
              <span className="normal-case tracking-normal text-text-secondary">
                {c.subtitle}
              </span>
            </>
          )}
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1 ${
            locked ? "text-text-tertiary" : "text-fuchsia"
          }`}
        >
          {locked ? "Upgrade →" : c.cta_text}
        </span>
      </div>
    </button>
  );
}

/* ── Image banner carousel ───────────────────────────────────────── */

function BannerCarousel({
  campaigns,
  isVisible,
  onGo,
}: {
  campaigns: SponsoredCampaign[];
  isVisible: (c: SponsoredCampaign) => boolean;
  onGo: (c: SponsoredCampaign) => void;
}) {
  const [idx, setIdx] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  // Pauses autoplay when the carousel scrolls offscreen — webview heights are
  // unpredictable and we don't want a 6s timer firing in a hidden surface.
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

  useEffect(() => {
    if (campaigns.length < 2) return;
    const el = trackRef.current;
    if (!el) return;
    let hoverPaused = false;
    const onEnter = () => {
      hoverPaused = true;
    };
    const onLeave = () => {
      hoverPaused = false;
    };
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

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const child = el.children[idx] as HTMLElement | undefined;
    if (child) {
      child.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "start",
      });
    }
  }, [idx]);

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader label="sponsored rewards" count={campaigns.length} icon="flame" />
      <div className="relative">
        {campaigns.length > 1 && (
          <>
            <button
              type="button"
              onClick={() =>
                setIdx((i) => (i - 1 + campaigns.length) % campaigns.length)
              }
              aria-label="Previous campaign"
              className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full border border-line bg-paper-elev/90 p-2 text-text-secondary backdrop-blur-sm transition-colors hover:border-fuchsia hover:text-fuchsia"
            >
              <ChevronLeftIcon />
            </button>
            <button
              type="button"
              onClick={() => setIdx((i) => (i + 1) % campaigns.length)}
              aria-label="Next campaign"
              className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full border border-line bg-paper-elev/90 p-2 text-text-secondary backdrop-blur-sm transition-colors hover:border-fuchsia hover:text-fuchsia"
            >
              <ChevronRightIcon />
            </button>
          </>
        )}

        <div
          ref={trackRef}
          className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth rounded-3xl"
          style={{ scrollbarWidth: "none" }}
        >
          {campaigns.map((c) => (
            <CarouselSlide
              key={c.id}
              c={c}
              locked={!isVisible(c)}
              onClick={() => onGo(c)}
            />
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
  c,
  locked,
  onClick,
}: {
  c: SponsoredCampaign;
  locked: boolean;
  onClick: () => void;
}) {
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
        <div
          className="relative w-full overflow-hidden rounded-2xl"
          style={{ aspectRatio: "4 / 1" }}
        >
          {/* The embed renders plain <img>, not next/image — banner_url points
              at the backend's own static handler and Vercel image-optimization
              isn't worth the egress for a 4:1 banner that won't be resized. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={c.banner_url}
            alt={c.name}
            className={`h-full w-full object-cover ${
              locked ? "opacity-50 grayscale" : ""
            }`}
            loading="lazy"
            draggable={false}
          />
          {locked && <LockedOverlay />}
        </div>
      ) : (
        <div className="px-6 py-7">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia">
            {c.brand ?? "campaign"}
          </p>
          <h3 className="mt-1 font-display text-[20px] font-semibold tracking-[-0.015em] text-ink">
            {c.name}
          </h3>
          {c.subtitle && (
            <p className="mt-1 font-sans text-[13px] text-text-secondary">
              {c.subtitle}
            </p>
          )}
        </div>
      )}
    </button>
  );
}

/* ── helpers ─────────────────────────────────────────────────────── */

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(url);
}

function LockedOverlay() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-paper/50 backdrop-blur-sm">
      <div className="relative flex flex-col items-center gap-2 px-6 py-4 text-center">
        <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
        <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
        <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
        <span aria-hidden="true" className="library-card-corner library-card-corner-br" />
        <LockIcon />
        <p className="font-display text-[15px] font-semibold text-ink">
          Growth tier required
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia">
          Upgrade to unlock →
        </p>
      </div>
    </div>
  );
}

function SectionHeader({
  label,
  count,
  icon,
}: {
  label: string;
  count: number;
  icon: "flame" | "play";
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-fuchsia">
        {icon === "play" ? <PlayCircleIcon /> : <FlameIcon />}
        {label}
      </div>
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
        {count > 0 ? `${count} live` : "loading…"}
      </span>
    </div>
  );
}

// Inline SVG icons — account-app doesn't ship lucide-react and we don't want
// to pull a 200kb runtime icon dep just for the embed. Shapes match the
// lucide originals used in desktop/src/components/earn/SponsoredBannerCarousel.

function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-fuchsia">
      <rect width="18" height="11" x="3" y="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function PlayCircleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polygon points="10 8 16 12 10 16 10 8" />
    </svg>
  );
}

function FlameIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}
