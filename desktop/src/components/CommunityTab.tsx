// v0.7.55 — Liquid Clips Community (locked architecture pass).
//
// Replaces the hand-coded PINNED + FEED with dynamic tier-gated rooms
// fetched from /community/channels. Daniel's locked architecture:
//
//   Announcements          admin-only post; everyone reads.
//   Free Clipper Lobby     onboarding, $1 RPM, 100 free clips.
//   Premium Rewards HQ     paid clippers, high-RPM campaign drops.
//   Affiliate Growth Room  paid clippers, 50% MRR strategy only.
//   Uncle Daniel Clips     controlled training content; free + paid.
//   Viral Reaction         viral source ideas, layouts; paid only.
//   DDB Beauty             $10 RPM beauty campaign; paid only.
//   DDB Fashion            fashion-house assets; paid only.
//   Sponsor Campaigns      external SaaS/brand campaigns; paid only.
//
// Card states:
//   • open       → tap routes browse panel to whop_channel_id chat feed.
//   • coming     → whop_channel_id is null; greyed CTA, no nav.
//   • locked     → free user looking at a paid room; preview copy +
//                   upgrade CTA. Hidden entirely when
//                   is_locked_preview_enabled=false.
//
// Brand kit: library-card + four library-card-corner-* spans.
// Vocabulary stays inside fuchsia / ink / paper-elev / line / mono +
// display fonts. No ad-hoc colors.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell,
  Crown,
  Flame,
  MessageCircle,
  Sparkles,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { openBrowsePanel, WHOP_COMMUNITY_URL } from "../lib/browse";
import { humanError } from "../lib/sidecar";
import { openAuthPanel } from "./auth/useAuthPanel";
import { useTier } from "../lib/useTier";

const PREMIUM_TIERS = new Set([
  "solo",
  "pro",
  "agency",
  "growth",
  "channel",
  "autopilot",
]);

// Backend URL — resolves to the prod backend via VITE_BACKEND_URL or
// the canonical liquidclips.app fallback (mirrors lib/backend.ts).
const BACKEND_URL: string =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ??
  "https://api.liquidclips.app";

type Channel = {
  id: string;
  slug: string;
  name: string;
  purpose: string | null;
  whop_channel_id: string | null;
  required_tier: "free" | "free_paid" | "paid" | "paid_admin" | string;
  business_unit: string | null;
  mission_lane: string | null;
  is_admin_only: boolean;
  is_locked_preview_enabled: boolean;
  section: "announcements" | "free_lobby" | "paid_core" | "mission" | string;
  sort_order: number;
};

type SectionKey = "announcements" | "free_lobby" | "paid_core" | "mission";

const SECTION_META: Record<SectionKey, { label: string; sub: string; Icon: LucideIcon }> = {
  announcements: {
    label: "announcements",
    sub: "admin-only posts · everyone reads",
    Icon: Bell,
  },
  free_lobby: {
    label: "free clipper lobby",
    sub: "onboarding · open to everyone signed in",
    Icon: Sparkles,
  },
  paid_core: {
    label: "premium rooms",
    sub: "paid clippers only · campaign HQ + affiliate growth",
    Icon: Crown,
  },
  mission: {
    label: "mission rooms",
    sub: "brand + sponsor lanes · paid clippers",
    Icon: Trophy,
  },
};

// Whop chat feed URLs follow chat.whop.com/<channel_id>. We open them in
// the in-app browse panel so the user never leaves Liquid Clips.
function whopChatUrl(channelId: string): string {
  return `https://whop.com/c/${channelId}`;
}

export function CommunityTab() {
  const { tier } = useTier();
  const isPremium = !!tier && PREMIUM_TIERS.has(tier);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchChannels = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`${BACKEND_URL}/community/channels`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { channels?: Channel[] };
      setChannels(Array.isArray(j.channels) ? j.channels : []);
    } catch (e) {
      setError(humanError(e));
    }
  }, []);

  useEffect(() => {
    void fetchChannels();
  }, [fetchChannels]);

  // Group + sort. Hide rooms a free user can't even preview.
  const grouped = useMemo(() => {
    if (!channels) return null;
    const buckets: Record<SectionKey, Channel[]> = {
      announcements: [],
      free_lobby: [],
      paid_core: [],
      mission: [],
    };
    for (const c of channels) {
      const k = (c.section as SectionKey) in buckets ? (c.section as SectionKey) : "mission";
      const locked = !isPremium && (c.required_tier === "paid" || c.required_tier === "paid_admin");
      if (locked && !c.is_locked_preview_enabled) continue;
      buckets[k].push(c);
    }
    for (const k of Object.keys(buckets) as SectionKey[]) {
      buckets[k].sort((a, b) => a.sort_order - b.sort_order);
    }
    return buckets;
  }, [channels, isPremium]);

  return (
    <div className="flex w-full max-w-[920px] flex-col gap-8">
      <Header
        sub={
          tier
            ? isPremium
              ? `signed in as ${tier} · every room unlocked`
              : `signed in as free · upgrade to unlock premium rooms`
            : `signed in · loading tier`
        }
      />

      {error && (
        <div className="rounded-2xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-danger)]">
            couldn&apos;t load rooms
          </p>
          <pre className="mt-2 max-h-[120px] overflow-auto rounded-lg border border-line bg-paper-warm/40 p-2.5 font-mono text-[11px] text-text-secondary">
            {error}
          </pre>
          <button
            onClick={() => void fetchChannels()}
            className="mt-3 rounded-full border border-line bg-paper px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:border-fuchsia hover:text-fuchsia"
          >
            Retry
          </button>
        </div>
      )}

      {!grouped && !error && (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[150px] animate-pulse rounded-2xl border border-line bg-paper-elev/40"
            />
          ))}
        </div>
      )}

      {grouped &&
        (Object.keys(SECTION_META) as SectionKey[]).map((key) => {
          const rooms = grouped[key];
          if (!rooms || rooms.length === 0) return null;
          return (
            <Section
              key={key}
              section={key}
              rooms={rooms}
              isPremium={isPremium}
            />
          );
        })}
    </div>
  );
}

function Header({ sub }: { sub: string }) {
  return (
    <header className="flex flex-col gap-2">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-fuchsia">
        <MessageCircle className="h-3 w-3" />
        community rooms
      </div>
      <h1 className="font-display text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink">
        Tier-gated rooms by purpose.
      </h1>
      <p className="font-sans text-[14px] leading-relaxed text-text-secondary">
        Free Clipper Lobby for onboarding. Premium Rewards HQ for the
        high-RPM drops. Affiliate Growth Room for 50% MRR strategy. Mission
        rooms for each Daniel-owned brand and sponsor campaign.
      </p>
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
        {sub}
      </p>
    </header>
  );
}

function Section({
  section,
  rooms,
  isPremium,
}: {
  section: SectionKey;
  rooms: Channel[];
  isPremium: boolean;
}) {
  const { label, sub, Icon } = SECTION_META[section];
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-fuchsia">
          <Icon className="h-3 w-3" />
          {label}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
          {sub}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {rooms.map((c) => (
          <ChannelCard key={c.id} c={c} isPremium={isPremium} />
        ))}
      </div>
    </section>
  );
}

function ChannelCard({ c, isPremium }: { c: Channel; isPremium: boolean }) {
  const locked =
    !isPremium && (c.required_tier === "paid" || c.required_tier === "paid_admin");
  // v0.7.55 P1-002 — `coming` was previously "no whop_channel_id at
  // all", which left every paid clipper staring at "Coming soon" pills
  // because the seed ships every room with null whop_channel_id (the
  // chat feeds are provisioned later). Now: free users still see
  // "Coming soon"; paid users get a working fallback to the main
  // Liquid Clips forums URL so they always have somewhere to land. The
  // room-specific chat feed lights up automatically once the admin
  // patches in a whop_channel_id from Admin HQ.
  const coming = !c.whop_channel_id;
  const fallbackToForums = coming && !locked;

  const openRoom = () => {
    if (c.whop_channel_id) {
      void openBrowsePanel(whopChatUrl(c.whop_channel_id));
    } else if (fallbackToForums) {
      void openBrowsePanel(WHOP_COMMUNITY_URL);
    }
  };

  const upgrade = () => {
    void openAuthPanel("upgrade");
  };

  return (
    <article
      className="library-card group relative flex flex-col gap-3 bg-transparent p-5"
      data-hot={locked ? "false" : "true"}
    >
      <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-br" />

      <div className="relative z-10 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="grid h-10 w-10 shrink-0 place-items-center text-fuchsia">
            <RoomIcon section={c.section as SectionKey} />
          </div>
          <div className="flex flex-col">
            <h3 className="font-display text-[16px] font-semibold leading-tight tracking-[-0.01em] text-ink">
              {c.name}
            </h3>
            <Tags c={c} />
          </div>
        </div>
        <TierPill required_tier={c.required_tier} adminOnly={c.is_admin_only} />
      </div>

      <p className="relative z-10 font-sans text-[13px] leading-relaxed text-text-secondary">
        {c.purpose ?? "—"}
      </p>

      <div className="relative z-10 mt-1 flex flex-wrap items-center justify-between gap-2">
        {locked ? (
          <>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
              upgrade to unlock this room
            </span>
            <button
              type="button"
              onClick={upgrade}
              className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-4 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-fuchsia-bright"
            >
              Upgrade →
            </button>
          </>
        ) : fallbackToForums ? (
          <>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
              dedicated chat coming · open community for now
            </span>
            <button
              type="button"
              onClick={openRoom}
              className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia/40 bg-fuchsia-soft/20 px-4 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-fuchsia-deep transition-colors hover:border-fuchsia hover:bg-fuchsia hover:text-white"
            >
              Open community →
            </button>
          </>
        ) : coming ? (
          <>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
              Whop chat feed not provisioned yet
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary">
              Coming soon
            </span>
          </>
        ) : (
          <>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
              opens in-app · Whop session authed
            </span>
            <button
              type="button"
              onClick={openRoom}
              className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia/40 bg-fuchsia-soft/20 px-4 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-fuchsia-deep transition-colors hover:border-fuchsia hover:bg-fuchsia hover:text-white"
            >
              Open chat →
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function Tags({ c }: { c: Channel }) {
  const pieces: string[] = [];
  if (c.business_unit) pieces.push(c.business_unit.replace(/_/g, " "));
  if (c.mission_lane) pieces.push(c.mission_lane.replace(/_/g, " "));
  if (pieces.length === 0) return null;
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
      {pieces.join(" · ")}
    </span>
  );
}

function TierPill({
  required_tier,
  adminOnly,
}: {
  required_tier: string;
  adminOnly: boolean;
}) {
  if (adminOnly) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-text-tertiary">
        admin only
      </span>
    );
  }
  if (required_tier === "free" || required_tier === "free_paid") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-text-secondary">
        open
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-2.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-white shadow-[0_8px_28px_-12px_rgba(255,26,140,0.55)]">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-white" />
      premium
    </span>
  );
}

function RoomIcon({ section }: { section: SectionKey }) {
  if (section === "announcements") return <Bell className="h-5 w-5" strokeWidth={1.75} />;
  if (section === "free_lobby") return <Sparkles className="h-5 w-5" strokeWidth={1.75} />;
  if (section === "paid_core") return <Crown className="h-5 w-5" strokeWidth={1.75} />;
  return <Flame className="h-5 w-5" strokeWidth={1.75} />;
}
