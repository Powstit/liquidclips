// v0.7.0 (Sprint 2) — Sponsored Rewards row.
//
// Replaces v0.6.x `LiveCampaignsRow` (which pulled directly from Whop's
// generic affiliate listing). This pulls Liquid-Clips-owned campaign records
// from `GET /campaigns` and renders full-width branded banners with status
// pills, RPM/budget readout, funding bar, and a CTA that deep-links to the
// configured Whop URL.
//
// Tier-gating: invite-only / restricted campaigns render LOCKED for lower
// tiers with an "Upgrade →" CTA instead of the brief link (Sprint 4
// finalises tier enforcement; here we surface the affordance from
// visibility_tiers).
//
// Banner media: `banner_url` field on the campaign record. If the URL ends
// with .mp4/.webm/.mov we render a muted, looping, autoplay <video>;
// otherwise <img>. Null falls back to the no-image variant.

import { useEffect, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { ChevronRight, Crown, Flame, Lock, Sparkles } from "lucide-react";
import { backend, type SponsoredCampaign } from "../../lib/backend";

type Props = {
  /** User's current tier — drives the locked variant on invite-only banners.
   *  null = unknown (treat as "free" for safety). */
  tier: "free" | "solo" | "pro" | "agency" | null;
  /** Fired when the user clicks an invite-only banner they can't access. */
  onUpgrade?: () => void;
};

export function SponsoredRewardsRow({ tier, onUpgrade }: Props) {
  const [campaigns, setCampaigns] = useState<SponsoredCampaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void backend
      .campaignsList()
      .then((c) => { if (!cancelled) setCampaigns(c); })
      .catch(() => { if (!cancelled) setCampaigns([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <section className="flex flex-col gap-3">
        <Header />
        <div className="h-[180px] animate-pulse rounded-3xl border border-line bg-paper-elev/40" />
      </section>
    );
  }

  if (campaigns.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        <Header />
        <p className="rounded-2xl border border-dashed border-line bg-paper-elev/40 px-5 py-4 font-sans text-[13px] leading-relaxed text-text-secondary">
          No active sponsored campaigns right now. Drop a clip in the workspace and we'll route to whatever lands here.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <Header />
      <div className="flex flex-col gap-3">
        {campaigns.map((c) => (
          <BannerCard
            key={c.id}
            c={c}
            locked={!isVisibleToTier(c, tier)}
            onClick={() => {
              if (!isVisibleToTier(c, tier)) {
                onUpgrade?.();
                return;
              }
              void openExternal(c.whop_url).catch(() => undefined);
            }}
          />
        ))}
      </div>
    </section>
  );
}

/* ── pieces ────────────────────────────────────────────────────────── */

function Header() {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-fuchsia">
        <Flame className="h-3 w-3" />
        sponsored rewards
      </div>
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
        liquid clips owned
      </span>
    </div>
  );
}

function BannerCard({
  c,
  locked,
  onClick,
}: {
  c: SponsoredCampaign;
  locked: boolean;
  onClick: () => void;
}) {
  const rpm = (c.rpm_cents / 100).toFixed(c.rpm_cents % 100 === 0 ? 0 : 2);
  const budget = formatBudget(c.budget_cents);
  const statusInfo = STATUS_META[c.status] ?? STATUS_META.coming_soon;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative w-full overflow-hidden rounded-3xl border-2 text-left transition-all ${
        locked
          ? "border-line bg-paper-elev/40 hover:border-fuchsia/40"
          : "border-fuchsia/50 bg-paper-elev hover:border-fuchsia hover:shadow-[0_0_36px_rgba(255,26,140,0.35)]"
      }`}
    >
      {/* Banner media: full-bleed. Images use a fixed 4:1 frame; videos play
          at their native aspect (full banner width, height auto) so they
          aren't cropped or letterboxed. */}
      {c.banner_url ? (
        <div
          className="relative w-full overflow-hidden"
          style={isVideoUrl(c.banner_url) ? undefined : { aspectRatio: "4 / 1" }}
        >
          {isVideoUrl(c.banner_url) ? (
            <video
              src={c.banner_url}
              autoPlay
              loop
              muted
              playsInline
              className={`block h-auto w-full ${locked ? "opacity-50 grayscale" : ""}`}
              draggable={false}
            />
          ) : (
            <img
              src={c.banner_url}
              alt={c.name}
              className={`h-full w-full object-cover transition-transform group-hover:scale-[1.02] ${locked ? "opacity-50 grayscale" : ""}`}
              loading="lazy"
              draggable={false}
            />
          )}
          {locked && (
            <div className="absolute inset-0 grid place-items-center bg-paper/40 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-fuchsia bg-paper-elev/95 px-6 py-4 text-center">
                <Lock className="h-6 w-6 text-fuchsia" />
                <p className="font-display text-[15px] font-semibold text-ink">
                  Growth tier required
                </p>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia">
                  Upgrade to unlock →
                </p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <NoImageFallback c={c} statusLabel={statusInfo.label} statusBg={statusInfo.bg} statusFg={statusInfo.fg} rpm={rpm} budget={budget} locked={locked} />
      )}

      {/* Stats strip below the banner. v0.7.0 — commission-style campaigns
          (rpm=0 AND budget=0, e.g. the Liquid Clips Affiliate 50% MRR
          banner) show subtitle + CTA instead of $0 RPM / $0 budget. */}
      {c.banner_url && (
        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 font-mono text-[10px] uppercase tracking-[0.14em]">
          <div className="flex flex-wrap items-center gap-3 text-text-tertiary">
            <span className="text-fuchsia">{c.brand ?? c.name}</span>
            {c.rpm_cents === 0 && c.budget_cents === 0 ? (
              c.subtitle && (<><span>·</span><span className="normal-case tracking-normal text-text-secondary">{c.subtitle}</span></>)
            ) : (
              <>
                <span>·</span>
                <span>${rpm} RPM</span>
                <span>·</span>
                <span>{budget} budget</span>
                {c.duration_label && (<><span>·</span><span>{c.duration_label}</span></>)}
              </>
            )}
          </div>
          <span className={`inline-flex shrink-0 items-center gap-1 ${locked ? "text-text-tertiary" : "text-fuchsia"}`}>
            {locked ? "Upgrade →" : c.cta_text}
          </span>
        </div>
      )}
    </button>
  );
}

function NoImageFallback({
  c, statusLabel, statusBg, statusFg, rpm, budget, locked,
}: {
  c: SponsoredCampaign;
  statusLabel: string; statusBg: string; statusFg: string;
  rpm: string; budget: string; locked: boolean;
}) {
  return (
    <div className="relative px-6 py-5">
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-fuchsia/15 text-fuchsia">
          {c.type === "invite_only" ? <Crown className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em]">
            <span className={`rounded-full px-2 py-0.5 ${statusBg} ${statusFg}`}>{statusLabel}</span>
            {c.brand && <span className="text-text-tertiary">{c.brand}</span>}
          </div>
          <h3 className="font-display text-[18px] font-semibold leading-tight tracking-[-0.015em] text-ink">{c.name}</h3>
          {c.subtitle && <p className="font-sans text-[13px] leading-snug text-text-secondary">{c.subtitle}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
            <span>${rpm} RPM</span>
            <span>·</span>
            <span>{budget} budget</span>
            <span>·</span>
            <span>{c.funded_pct}% funded</span>
            {c.duration_label && (<><span>·</span><span>{c.duration_label}</span></>)}
          </div>
        </div>
        <span className={`flex shrink-0 items-center gap-1 self-center font-mono text-[10px] uppercase tracking-[0.14em] ${locked ? "text-text-tertiary" : "text-fuchsia"}`}>
          {locked ? "Upgrade" : c.cta_text} <ChevronRight className="h-3 w-3" />
        </span>
      </div>
    </div>
  );
}

/* ── helpers ───────────────────────────────────────────────────────── */

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|#|$)/i.test(url);
}

function isVisibleToTier(c: SponsoredCampaign, tier: Props["tier"]): boolean {
  const t = tier ?? "free";
  if (!c.visibility_tiers || c.visibility_tiers.length === 0) return true;
  return c.visibility_tiers.includes(t);
}

function formatBudget(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(dollars % 1000 === 0 ? 0 : 1)}k`;
  return `$${dollars.toFixed(0)}`;
}

const STATUS_META: Record<SponsoredCampaign["status"], { label: string; bg: string; fg: string }> = {
  coming_soon:        { label: "● COMING SOON", bg: "bg-[#F59E0B]",       fg: "text-[#0A0A0F]" },
  partially_funded:   { label: "● PARTIAL FUND", bg: "bg-fuchsia",         fg: "text-white"     },
  funded:             { label: "● FULLY FUNDED", bg: "bg-fuchsia",         fg: "text-white"     },
  live:               { label: "● LIVE",         bg: "bg-fuchsia",         fg: "text-white"     },
  closed:             { label: "● CLOSED",       bg: "bg-paper-warm",      fg: "text-text-tertiary" },
};
