"use client";

// v0.7.54 — cinematic 2-col hero carousel. Replaces the prior video-grid +
// 4:1 banner-row split with a single carousel where each slide is the
// editorial format from demo-pages.html (lines 338-438): left brand block
// (logo · name · huge $RPM · pool · subtitle), right full-bleed banner
// image or video, arrows + dots. One carousel for every campaign — the
// "live" counter in the section header doubles as the "N LIVE" pill from
// the demo.
//
// ship-lens v0.7.8: E3 — `coming_soon` campaigns render a fuchsia "Coming
// soon" ribbon on the banner and swap the CTA copy to "Notify me".
//
// SURFACE: sponsored carousel (embed port of desktop SponsoredBannerCarousel)
// MAP TAGS: (O #5) discovery | (O #5 — see what's locked) upgrade overlay
// See desktop/docs/UI_MAP_embed_surfaces.md — the contract.
//
// Click-through never opens external URLs from inside the webview. Each
// slide posts `lc:nav` (or `lc:nav target=notify` for coming-soon slides)
// to the desktop parent, which routes natively.

import { useCallback, useEffect, useRef, useState } from "react";
import { EMBED_MSG } from "@/lib/embed-auth";

// Mirror of `desktop/src/lib/backend.ts` — keep in lockstep with the server
// shape. Trimmed of the fields the embed never reads, but the wire fields are
// preserved verbatim so a stale prop doesn't break decoding.
//
// v0.7.55 (Uncle Daniel funnel) — added tier-aware payout ladder fields:
// base/premium RPM, banner copy per tier, mission classification, and
// the per-caller derived `your_rpm_cents` + `is_premium_caller` from the
// backend. New fields all optional / nullable so older campaign rows
// without the ladder still render through the legacy `rpm_cents` path.
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
  // Funnel fields.
  base_rpm_cents?: number;
  premium_rpm_cents?: number;
  premium_bonus_cents?: number;
  free_banner_text?: string | null;
  premium_banner_text?: string | null;
  mission_type?: "uncle_daniel" | "viral_reaction" | "software_proof" | null;
  mission_lane?: string | null;
  requires_membership?: boolean;
  watermark_allowed?: boolean;
  whop_campaign_id?: string | null;
  whop_campaign_url?: string | null;
  your_rpm_cents?: number | null;
  is_premium_caller?: boolean | null;
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
    try {
      window.parent.postMessage(
        {
          type: EMBED_MSG.NAV_CAMPAIGN,
          target: isComingSoon(c) ? "notify" : "campaign",
          id: c.id,
        },
        "*",
      );
    } catch {
      /* outside an iframe — no-op */
    }
  }, []);

  const [idx, setIdx] = useState(0);
  // Pause autoplay when the carousel scrolls offscreen — webview heights are
  // unpredictable and we don't want a 6s timer firing in a hidden surface.
  const [onscreen, setOnscreen] = useState(true);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = hostRef.current;
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
    let hoverPaused = false;
    const el = hostRef.current;
    if (!el) return;
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

  // v0.7.54 P0-002 — clamp idx back into range when the campaigns list
  // shrinks under us (client re-fetch, Strict Mode race, hot-reload).
  // Pre-fix: `campaigns[idx]` returned undefined and HeroSlide dereferenced
  // `c.banner_url` → crash. Effect must precede the early-return so the
  // setIdx fires on the same tick the list shrinks.
  useEffect(() => {
    if (idx >= campaigns.length && campaigns.length > 0) {
      setIdx(0);
    }
  }, [campaigns.length, idx]);

  if (!campaigns || campaigns.length === 0) return null;

  const current = campaigns[Math.min(idx, campaigns.length - 1)];
  // v0.7.54 P1-004 — "live" excludes both coming-soon AND closed. P2-004
  // — when the count is 0 but the list is non-empty (every campaign is
  // coming-soon or closed), say so honestly instead of "loading…".
  const liveCount = campaigns.filter(
    (c) => !isComingSoon(c) && c.status !== "closed",
  ).length;
  const liveLabel =
    liveCount > 0 ? `${liveCount} live` : "all upcoming";

  return (
    <section ref={hostRef} className="flex flex-col gap-5">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-fuchsia">
          <FlameIcon />
          sponsored rewards
        </div>
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
          {liveLabel}
        </span>
      </header>

      <div className="relative">
        <HeroSlide
          c={current}
          locked={!isVisible(current)}
          onClick={() => go(current)}
        />

        {campaigns.length > 1 && (
          <>
            <button
              type="button"
              onClick={() =>
                setIdx((i) => (i - 1 + campaigns.length) % campaigns.length)
              }
              aria-label="Previous campaign"
              className="absolute left-3 top-1/2 z-10 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-line bg-paper/70 text-text-secondary backdrop-blur transition-colors hover:border-fuchsia hover:bg-paper-elev hover:text-ink"
            >
              <ChevronLeftIcon />
            </button>
            <button
              type="button"
              onClick={() => setIdx((i) => (i + 1) % campaigns.length)}
              aria-label="Next campaign"
              className="absolute right-3 top-1/2 z-10 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-line bg-paper/70 text-text-secondary backdrop-blur transition-colors hover:border-fuchsia hover:bg-paper-elev hover:text-ink"
            >
              <ChevronRightIcon />
            </button>
          </>
        )}
      </div>

      {campaigns.length > 1 && (
        <div className="flex items-center justify-center gap-2">
          {campaigns.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setIdx(i)}
              aria-label={`Show ${c.name}`}
              className={`h-1.5 rounded-full transition-all ${
                i === idx ? "w-8 bg-fuchsia" : "w-1.5 bg-line hover:bg-text-tertiary"
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/* ── Cinematic 2-col hero slide ──────────────────────────────────── */

function HeroSlide({
  c,
  locked,
  onClick,
}: {
  c: SponsoredCampaign;
  locked: boolean;
  onClick: () => void;
}) {
  const comingSoon = isComingSoon(c);
  // v0.7.54 P1-004 — backend emits 5 statuses (coming_soon ·
  // partially_funded · funded · live · closed). Pre-fix collapsed to
  // (comingSoon ? "Coming soon" : "LIVE") so a `closed` campaign rendered
  // as a fuchsia LIVE pill with a pulse dot. Three-way classification
  // matches the wire: comingSoon → pill, closed → muted "Closed" pill,
  // everything else (live / partially_funded / funded) → "LIVE".
  const closed = c.status === "closed";
  const isVideo = !!c.banner_url && isVideoUrl(c.banner_url);
  // v0.7.55 (Uncle Daniel funnel) — tier-aware payout ladder.
  // `your_rpm_cents` is the backend-derived per-caller value; when it's
  // present we render the explicit ladder instead of the legacy single
  // RPM headline. `is_premium_caller` drives which side of the ladder
  // is the "yours" row.
  const baseRpm = Math.max(0, Math.round((c.base_rpm_cents || 0) / 100));
  const premiumRpm = Math.max(0, Math.round((c.premium_rpm_cents || 0) / 100));
  const bonusRpm = Math.max(0, Math.round((c.premium_bonus_cents || 0) / 100));
  const hasLadder = baseRpm > 0 && premiumRpm > 0;
  const isPremium = c.is_premium_caller === true;
  // Legacy headline fallback — used when ladder fields aren't seeded yet
  // (older campaigns). Existing demo + design stays intact for those rows.
  const rpm = Math.max(0, Math.round((c.rpm_cents || 0) / 100));
  const budget = Math.max(0, Math.round((c.budget_cents || 0) / 100));
  // Banner copy from the tier-specific column; fall back to subtitle so
  // legacy campaigns without funnel copy still read sensibly.
  const bannerText =
    (isPremium ? c.premium_banner_text : c.free_banner_text) ?? c.subtitle ?? null;

  return (
    <article
      className="library-card relative overflow-hidden rounded-3xl"
      data-hot={comingSoon ? "false" : "true"}
    >
      <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-br" />

      <div className="grid min-h-[360px] grid-cols-1 md:grid-cols-[1fr_1.1fr]">
        {/* LEFT — brand block + reward stats */}
        <div className="relative flex flex-col justify-center gap-6 px-8 py-10 md:px-12">
          {comingSoon ? (
            <span className="inline-flex w-fit items-center gap-1.5 self-start rounded-full border border-fuchsia/40 bg-fuchsia-soft/30 px-3 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-fuchsia-deep">
              Coming soon
            </span>
          ) : closed ? (
            <span className="inline-flex w-fit items-center gap-1.5 self-start rounded-full border border-line bg-paper-elev px-3 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">
              Closed
            </span>
          ) : (
            <span className="inline-flex w-fit items-center gap-1.5 self-start rounded-full bg-fuchsia px-3 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-white shadow-[0_8px_28px_-12px_rgba(255,26,140,0.55)]">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-white pulse-dot" />
              LIVE
            </span>
          )}

          <div className="flex flex-col gap-1">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-fuchsia">
              {c.brand ?? "campaign"}
            </span>
            <h2 className="font-display text-[32px] font-semibold italic leading-tight tracking-[-0.025em] text-ink md:text-[36px]">
              {c.name}
            </h2>
          </div>

          {hasLadder ? (
            <PayoutLadder
              baseRpm={baseRpm}
              premiumRpm={premiumRpm}
              bonusRpm={bonusRpm}
              isPremium={isPremium}
              budget={budget}
            />
          ) : (
            <div className="flex items-baseline gap-3">
              {rpm > 0 ? (
                <>
                  <span className="font-display text-[56px] font-bold leading-none tracking-[-0.03em] text-fuchsia md:text-[68px]">
                    ${rpm} RPM
                  </span>
                  {budget > 0 && (
                    <span className="font-mono text-[13px] text-ink-soft md:text-[14px]">
                      · ${budget.toLocaleString()} pool
                    </span>
                  )}
                </>
              ) : (
                <span className="font-display text-[44px] font-bold leading-none tracking-[-0.03em] text-fuchsia md:text-[52px]">
                  50% MRR
                </span>
              )}
            </div>
          )}

          {bannerText && (
            <p className="max-w-[420px] font-sans text-[14px] leading-relaxed text-ink-soft md:text-[15px]">
              {bannerText}
            </p>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onClick}
              disabled={locked || closed}
              className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-5 py-2 font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-white transition-all hover:bg-fuchsia-bright disabled:cursor-not-allowed disabled:opacity-50"
            >
              {locked
                ? "Upgrade to unlock →"
                : closed
                  ? "Campaign closed"
                  : comingSoon
                    ? "Notify me →"
                    : !hasLadder
                      ? c.cta_text || "Open campaign →"
                      : isPremium
                        ? "Submit through Whop →"
                        : `Upgrade to unlock $${premiumRpm} RPM + 50% MRR →`}
            </button>
            {c.duration_label && (
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                {c.duration_label}
              </span>
            )}
          </div>
        </div>

        {/* RIGHT — full-bleed banner image/video */}
        <div className="relative min-h-[220px] overflow-hidden md:min-h-0">
          {c.banner_url ? (
            isVideo ? (
              <video
                src={c.banner_url}
                autoPlay
                loop
                muted
                playsInline
                className={`absolute inset-0 h-full w-full object-cover ${
                  locked ? "opacity-50 grayscale" : ""
                }`}
                draggable={false}
              />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={c.banner_url}
                alt={c.name}
                className={`absolute inset-0 h-full w-full object-cover ${
                  locked ? "opacity-50 grayscale" : ""
                }`}
                loading="lazy"
                draggable={false}
              />
            )
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-fuchsia/20 via-paper-elev to-paper" />
          )}
          {/* Vignette over the image edge so it blends into the left brand
              block — matches the demo's subtle paper→transparent fade. */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-paper/85 via-paper/15 to-transparent md:from-paper/70 md:via-paper/0" />
          {locked && <LockedOverlay />}
        </div>
      </div>
    </article>
  );
}

/* ── helpers ─────────────────────────────────────────────────────── */

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(url);
}

/** v0.7.8 fix E3 — coming-soon is encoded on the wire two ways depending on
 *  which factory emitted the record:
 *   • `type === "coming_soon"` — set when the backend treats the campaign
 *     itself as pre-launch (it doesn't go live until a future date).
 *   • `status === "coming_soon"` — set when the campaign exists but its
 *     funding/scheduling hasn't crossed the threshold yet.
 *  Either signal is enough to flip the surface to coming-soon UX. */
function isComingSoon(c: SponsoredCampaign): boolean {
  return c.type === "coming_soon" || c.status === "coming_soon";
}

/* ── Payout ladder (v0.7.55 Uncle Daniel funnel) ─────────────────── */

// Two-row ladder. The user's current tier row is the giant fuchsia
// headline; the other row is the locked-or-unlocked secondary line.
// For premium clippers the bonus row also surfaces "50% MRR unlocked".
function PayoutLadder({
  baseRpm,
  premiumRpm,
  bonusRpm,
  isPremium,
  budget,
}: {
  baseRpm: number;
  premiumRpm: number;
  bonusRpm: number;
  isPremium: boolean;
  budget: number;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3">
        <span className="font-display text-[56px] font-bold leading-none tracking-[-0.03em] text-fuchsia md:text-[68px]">
          ${isPremium ? premiumRpm : baseRpm} RPM
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary">
          your rate
        </span>
        {budget > 0 && (
          <span className="font-mono text-[12px] text-ink-soft md:text-[13px]">
            · ${budget.toLocaleString()} pool
          </span>
        )}
      </div>
      {isPremium ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia/40 bg-fuchsia-soft/30 px-3 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-fuchsia-deep">
            +50% MRR unlocked
          </span>
          {bonusRpm > 0 && (
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
              includes ${bonusRpm} premium bonus
            </span>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper-elev px-3 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">
            <LockOutlineIcon />
            +${bonusRpm} RPM premium
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
            unlock at ${premiumRpm} total + 50% MRR
          </span>
        </div>
      )}
    </div>
  );
}

function LockOutlineIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="11" x="3" y="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function LockedOverlay() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-paper/55 backdrop-blur-sm">
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

/* ── inline icons ────────────────────────────────────────────────── */

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

function FlameIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C9 6 6 9 6 13a6 6 0 0 0 12 0c0-2-1-4-2-5 0 2-1 3-2 3 1-3-1-6-2-9z" />
    </svg>
  );
}
