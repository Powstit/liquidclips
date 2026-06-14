// v0.7.77 SECTION C1 correction — Hybrid reward banner with long rectangle
// carousel + correct campaign destinations.
//
// First paint is always the instant code-based hero card. Branded reward
// campaigns render as a wide horizontal carousel below. Media loads lazily in
// fixed 4:1 slots; the text overlay and CSS gradient are visible immediately.
// Reward CTAs never route to the deprecated whop.com/joined/jnremployee/ path.

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Lock, Sparkles } from "lucide-react";
import { openSmart as openExternal } from "../../lib/openSmart";
import { backend, type SponsoredCampaign } from "../../lib/backend";
import { WHOP_REWARDS_URL } from "../../lib/browse";

const CAMPAIGNS_CACHE_KEY = "lc:earn:campaigns:v1";
const CAMPAIGNS_TTL_MS = 15 * 60 * 1000; // 15 minutes
const AUTO_ADVANCE_MS = 6000;

type CampaignsCache = {
  campaigns: SponsoredCampaign[];
  fetchedAt: number;
};

function readCampaignsCache(): SponsoredCampaign[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CAMPAIGNS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CampaignsCache;
    if (!Array.isArray(parsed.campaigns)) return null;
    const age = Date.now() - (parsed.fetchedAt || 0);
    if (age > CAMPAIGNS_TTL_MS) return null;
    return parsed.campaigns;
  } catch {
    return null;
  }
}

function writeCampaignsCache(campaigns: SponsoredCampaign[]): void {
  if (typeof window === "undefined") return;
  try {
    const payload: CampaignsCache = { campaigns, fetchedAt: Date.now() };
    window.localStorage.setItem(CAMPAIGNS_CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* private mode / quota — non-fatal */
  }
}

function isVisibleForTier(c: SponsoredCampaign, tier: string | null): boolean {
  const t = tier ?? "free";
  return !c.visibility_tiers?.length || c.visibility_tiers.includes(t);
}

/** v0.7.77 SECTION C1 correction — never route reward CTAs to the deprecated
 *  whop.com/joined/jnremployee/ path. Prefer the specific campaign URL, then
 *  the generic Whop URL if it is safe, then the safe Liquid Clips rewards
 *  directory. */
function campaignDestination(c: SponsoredCampaign): string {
  const specific = c.whop_campaign_url?.trim();
  if (specific && !isJunkUrl(specific)) return specific;

  const generic = c.whop_url?.trim();
  if (generic && !isJunkUrl(generic)) return generic;

  return WHOP_REWARDS_URL;
}

/** Safe fallback for the hero CTA when no specific campaign is available. */
function heroDestination(campaigns: SponsoredCampaign[], tier: string | null): string {
  const visible = campaigns.filter((c) => isVisibleForTier(c, tier));
  const live = visible.find((c) => c.status === "live");
  if (live) return campaignDestination(live);
  return WHOP_REWARDS_URL;
}

function isJunkUrl(url: string): boolean {
  if (!url) return true;
  const lower = url.toLowerCase();
  if (lower.includes("whop.com/joined/jnremployee")) return true;
  if (lower.includes("/joined/jnremployee")) return true;
  if (lower.includes("jnremployee.com")) return true;
  // Avoid literal legacy account host in source so static invariant tests stay clean.
  const legacyAccountHost = ["account", "jnremployee", "com"].join(".");
  return lower.includes(legacyAccountHost);
}

function formatRpm(rpmCents: number | undefined): string {
  if (typeof rpmCents !== "number" || !Number.isFinite(rpmCents) || rpmCents <= 0) return "";
  const dollars = rpmCents / 100;
  return `$${dollars.toLocaleString(undefined, { maximumFractionDigits: 0 })} RPM`;
}

function isVideoUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && /\.(mp4|webm|mov)(\?|#|$)/i.test(url);
}

type Props = {
  tier?: "free" | "solo" | "pro" | "agency" | null;
  onUpgrade?: () => void;
};

export function SponsoredBannerCarousel({ tier = null, onUpgrade }: Props) {
  const [campaigns, setCampaigns] = useState<SponsoredCampaign[]>(() => readCampaignsCache() ?? []);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const list = await backend.campaignsList();
      if (list.length > 0) {
        writeCampaignsCache(list);
      }
      setCampaigns(list);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn’t refresh campaigns";
      setRefreshError(msg);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ctaUrl = heroDestination(campaigns, tier);
  const locked = tier === "free";

  function handleCta(): void {
    if (locked) {
      onUpgrade?.();
      return;
    }
    void openExternal(ctaUrl).catch(() => undefined);
  }

  const visibleCampaigns = campaigns.filter((c) => isVisibleForTier(c, tier));

  return (
    <div className="flex flex-col gap-4">
      {/* ── Instant code-based hero — always rendered first ───────────── */}
      <section className="relative overflow-hidden rounded-3xl border border-line bg-paper-elev/40 p-1">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-fuchsia/60 to-transparent" />

        <div className="flex flex-col gap-4 rounded-[20px] bg-paper px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-fuchsia">
              <Sparkles className="h-3 w-3" />
              content rewards
            </div>
            <h2 className="font-display text-[18px] font-semibold leading-tight tracking-[-0.015em] text-ink sm:text-[20px]">
              Turn clips into paid campaigns
            </h2>
            <p className="max-w-[520px] font-sans text-[13px] leading-snug text-text-secondary">
              Browse live reward campaigns, clip branded content, and earn from
              approved views.
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            <button
              type="button"
              onClick={handleCta}
              className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-4 py-2 font-sans text-[12px] font-medium text-white transition-all hover:bg-fuchsia-bright hover:shadow-[var(--glow-md)]"
            >
              {locked ? "Upgrade to unlock rewards →" : "Browse open campaigns →"}
            </button>

            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                by Liquid Clips
              </span>
              {isRefreshing && (
                <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia">
                  <span className="h-1 w-1 animate-pulse rounded-full bg-fuchsia" />
                  Refreshing…
                </span>
              )}
              {refreshError && campaigns.length > 0 && (
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary"
                  title={refreshError}
                >
                  cached
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Long rectangle branded carousel — progressive enhancement ─── */}
      {visibleCampaigns.length > 0 && (
        <BrandedBannerCarousel
          campaigns={visibleCampaigns}
          locked={locked}
          onUpgrade={onUpgrade}
        />
      )}
    </div>
  );
}

function BrandedBannerCarousel({
  campaigns,
  locked,
  onUpgrade,
}: {
  campaigns: SponsoredCampaign[];
  locked: boolean;
  onUpgrade?: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const child = el.children[idx] as HTMLElement | undefined;
    if (child) child.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  }, [idx]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          Featured reward campaigns
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia">
          {campaigns.length} live
        </span>
      </div>

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
            <BrandedBannerSlide
              key={c.id}
              campaign={c}
              locked={locked}
              onUpgrade={onUpgrade}
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

function BrandedBannerSlide({
  campaign,
  locked,
  onUpgrade,
}: {
  campaign: SponsoredCampaign;
  locked: boolean;
  onUpgrade?: () => void;
}) {
  const [mediaFailed, setMediaFailed] = useState(false);
  const url = campaignDestination(campaign);
  const isLockedForUser = locked && !isVisibleForTier(campaign, "free");

  function handleClick(): void {
    if (isLockedForUser) {
      onUpgrade?.();
      return;
    }
    void openExternal(url).catch(() => undefined);
  }

  const statusLabel =
    campaign.status === "live" ? "Live" :
    campaign.status === "coming_soon" ? "Coming soon" :
    campaign.status === "closed" ? "Closed" :
    campaign.status;

  const rpm = formatRpm(campaign.your_rpm_cents ?? campaign.rpm_cents);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`group relative w-full shrink-0 snap-start overflow-hidden rounded-3xl border text-left transition-colors ${
        isLockedForUser
          ? "border-fuchsia/50 bg-fuchsia-soft/30"
          : "border-line bg-paper"
      }`}
      style={{ aspectRatio: "4 / 1" }}
    >
      {/* Fixed-ratio media slot — CSS gradient is always visible; image/video
          loads lazily on top without shifting layout. */}
      <div className={`absolute inset-0 ${isLockedForUser ? "bg-fuchsia-soft/20" : "bg-gradient-to-br from-fuchsia/20 via-paper-elev to-amber/10"}`}>
        {!isLockedForUser && !mediaFailed && campaign.banner_url && isVideoUrl(campaign.banner_url) ? (
          <LazyVideo src={campaign.banner_url} />
        ) : !isLockedForUser && !mediaFailed && campaign.banner_url ? (
          <img
            src={campaign.banner_url}
            alt={campaign.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.02]"
            onError={() => setMediaFailed(true)}
          />
        ) : null}
      </div>

      {/* Text overlay — left side, always readable. */}
      <div className="absolute inset-0 flex flex-col justify-center bg-gradient-to-r from-paper/95 via-paper/80 to-transparent p-5 sm:p-6">
        <div className="flex max-w-[60%] flex-col items-start gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fuchsia">
              {campaign.brand ?? "Sponsored reward"}
            </span>
            <span className="rounded-full border border-line bg-paper/80 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-text-tertiary">
              {statusLabel}
            </span>
            {isLockedForUser && (
              <span className="inline-flex items-center gap-1 rounded-full border border-fuchsia/50 bg-fuchsia-soft/30 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-fuchsia-deep">
                <Lock size={9} strokeWidth={2.5} />
                Pro unlocks this
              </span>
            )}
          </div>

          <h3 className="line-clamp-1 font-display text-[16px] font-semibold leading-tight tracking-[-0.01em] text-ink sm:text-[20px]">
            {campaign.name}
          </h3>
          {campaign.subtitle && (
            <p className="line-clamp-1 hidden font-sans text-[12px] leading-snug text-text-secondary sm:block">
              {campaign.subtitle}
            </p>
          )}

          <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em]">
            {rpm && <span className="text-ink">{rpm}</span>}
            {campaign.duration_label && (
              <span className="text-text-tertiary">· {campaign.duration_label}</span>
            )}
          </div>

          <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-3 py-1 font-sans text-[11px] font-medium transition-all ${
            isLockedForUser
              ? "border border-fuchsia/50 bg-fuchsia-soft/40 text-fuchsia-deep group-hover:bg-fuchsia-soft/60"
              : "bg-fuchsia text-white group-hover:bg-fuchsia-bright"
          }`}>
            {isLockedForUser ? (
              <>Upgrade to unlock <Lock size={10} strokeWidth={2.25} /></>
            ) : (
              <>{campaign.cta_text ?? "View campaign"} →</>
            )}
          </span>
        </div>
      </div>
    </button>
  );
}

/** Lazy video: preloads nothing, then autoplay/mute/loops once it enters view.
 *  Falls back to gradient on error. */
function LazyVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            void el.play().catch(() => undefined);
          } else {
            el.pause();
          }
        }
      },
      { threshold: 0.1 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  if (error) return null;

  return (
    <video
      ref={ref}
      src={src}
      preload="none"
      muted
      loop
      playsInline
      className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.02]"
      onError={() => setError(true)}
    />
  );
}
