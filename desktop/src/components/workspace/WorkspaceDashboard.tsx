// v0.6.4 — Stickiness Dashboard.
//
// Replaces the v0.6.3 Workspace empty state (painted Studio Deck +
// LiquidLiftBanner + Minecraft card + SponsoredClipsCarousel + DropZone).
//
// Why: empty drop zone optimised for first-time-user "drop a video" funnel
// but did nothing to pull repeat users back. Stickiness pattern (Whop /
// Hootsuite / clipper community) surfaces money + rank + live opportunity
// the moment you open the app — closes the dopamine loop on every launch.
//
// Surfaces (top → bottom):
//   1. RankStrip          — me + rank + lifetime + pending, two-stream split
//   2. AffiliateStrip     — link + copy + share + referral count + earnings
//   3. LiveCampaignsRow   — 3 hot whop bounties, RPM + spots + countdown
//   4. ActiveClipsList    — last 5 user submissions w/ views + status
//   5. LeaderboardPreview — top 5 today + caller row (Whop ranking)
//   6. DropCta            — secondary, bottom, "cut more clips"
//
// All data sources already exist server-side. No new endpoints needed.

import { useCallback, useEffect, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  CalendarClock,
  ChevronRight,
  Copy as CopyIcon,
  Crown,
  Link as LinkIcon,
  Trophy,
  Upload as UploadIcon,
  Wallet,
} from "lucide-react";
import {
  meStatus,
  meAffiliate,
  leaderboardGet,
  type MeStatus,
  type AffiliateMeResponse,
  type LeaderboardResponse,
} from "../../lib/backend";
import { sidecar, type LocalScheduleItem } from "../../lib/sidecar";
import { useSubmissions } from "../../lib/submissions";
import { fmtUsd } from "../../lib/payoutsAggregations";
// v0.6.35 — SponsoredRewardsRow removed from the Workspace dashboard. The
// banner row now lives only in Earn (SponsoredBannerCarousel). Keeping the
// import removed so a stale re-render can't sneak it back in.

type Props = {
  /** v0.6.5 — retained on the prop type for App.tsx API stability; the
   *  in-dashboard DropCta was retired and the unified entry box above
   *  the dashboard owns "drop a video" now. */
  onOpenDrop: () => void;
  /** Click handler when the user taps a campaign card — routes to Earn
   *  with that bounty preselected. */
  onOpenCampaign: (bountyId: string) => void;
  /** "See full leaderboard" / "View all clips" both deep-link Earn. */
  onOpenEarn: () => void;
  /** Tapping the affiliate strip opens the partner dashboard externally. */
  onOpenAffiliate?: () => void;
  /** v0.6.18 — user's resolved tier so sponsored banners gate correctly.
   *  Null until /sync resolves; treated as "free" inside the row. */
  userTier?: "free" | "solo" | "pro" | "agency" | null;
};

export function WorkspaceDashboard({
  onOpenDrop: _onOpenDrop,
  onOpenCampaign: _onOpenCampaign,
  onOpenEarn,
  onOpenAffiliate,
  userTier: _userTier,
}: Props) {
  return (
    <div className="flex w-full max-w-[960px] flex-col gap-5">
      <RankStrip />
      <AffiliateStrip onOpenAffiliate={onOpenAffiliate} />
      {/* v0.6.35 — Sponsored Rewards row removed from this surface; it now
          lives only inside Earn → SponsoredBannerCarousel so the home /
          cockpit can stay calm. `userTier` kept as a prop on this dashboard
          for the few callers that still mount it (in case a future Sprint
          re-exposes per-tier signals here). */}
      <ScheduledClipsBlock onOpenEarn={onOpenEarn} />
      <ActiveClipsList onOpenEarn={onOpenEarn} />
      <LeaderboardPreview onOpenEarn={onOpenEarn} />
    </div>
  );
}

/* ── 1. Rank strip ─────────────────────────────────────────────────── */

function RankStrip() {
  const [me, setMe] = useState<MeStatus | null>(null);
  const [aff, setAff] = useState<AffiliateMeResponse | null>(null);
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);

  useEffect(() => {
    void meStatus().then(setMe).catch(() => setMe(null));
    void meAffiliate().then(setAff).catch(() => setAff(null));
    void leaderboardGet().then(setBoard).catch(() => setBoard(null));
  }, []);

  const email = me?.email ?? null;
  const displayName = email
    ? email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "Welcome";
  const initials = email
    ? email
        .split("@")[0]
        .split(/[._-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase() ?? "")
        .join("") || "—"
    : "—";

  const rank = board?.caller_rank;
  const total = board?.total_ranked;
  const affEarnings = Number(aff?.affiliate?.total_referral_earnings_usd ?? "0") || 0;
  // Clipping earnings = (placeholder) lifetime view-based payouts. The
  // sub-tab "Clipping" surfaces local-tracker totals; the strip pulls from
  // /me until a dedicated lifetime endpoint lands. For now we show "0 paid"
  // when nothing's logged so the strip never lies.
  const clippingEarnings = 0;
  const lifetimeTotal = clippingEarnings + affEarnings;

  return (
    <section className="lc-rank-strip relative overflow-hidden rounded-3xl border border-fuchsia/30 bg-paper-elev px-6 py-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div
            aria-hidden="true"
            className="lc-rank-avatar grid h-14 w-14 place-items-center rounded-2xl border-2 border-paper bg-gradient-to-br from-fuchsia to-fuchsia-deep font-display text-[20px] font-bold text-white"
          >
            {initials}
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
              <Crown className="h-3 w-3 text-fuchsia" />
              {rank != null && total != null ? (
                <span>
                  rank · #{rank.toLocaleString()} of {total.toLocaleString()}
                </span>
              ) : (
                <span>welcome to liquid clips</span>
              )}
            </div>
            <h2 className="font-display text-[20px] font-semibold leading-tight tracking-[-0.015em] text-ink">
              {displayName}
            </h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Stat label="lifetime" value={fmtUsd(lifetimeTotal)} accent />
          <Stat label="clipping" value={fmtUsd(clippingEarnings)} />
          <Stat label="affiliate" value={fmtUsd(affEarnings)} />
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col items-start">
      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-text-tertiary">{label}</span>
      <span
        className={`font-display text-[18px] font-bold leading-none tracking-[-0.02em] ${
          accent ? "text-fuchsia" : "text-ink"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/* ── 2. Affiliate strip ────────────────────────────────────────────── */

function AffiliateStrip({ onOpenAffiliate }: { onOpenAffiliate?: () => void }) {
  const [aff, setAff] = useState<AffiliateMeResponse | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void meAffiliate().then(setAff).catch(() => setAff(null));
  }, []);

  const block = aff?.affiliate;
  const url = block?.referral_url ?? null;
  const referrals = block?.total_referrals_count ?? 0;
  const earnings = Number(block?.total_referral_earnings_usd ?? "0") || 0;
  const ready = Boolean(url);

  const handleCopy = useCallback(async () => {
    if (!url) return;
    try {
      await writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* silent — clipboard sandboxing */
    }
  }, [url]);

  return (
    <section className="rounded-2xl border border-line bg-paper-elev/80 px-5 py-4">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-fuchsia">
        <LinkIcon className="h-3 w-3" />
        your affiliate link
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <code className="flex-1 truncate rounded-lg border border-line bg-ink/40 px-3 py-2 font-mono text-[12px] text-ink">
          {url ?? (ready ? "—" : "Sign in to claim your link")}
        </code>
        <button
          onClick={() => void handleCopy()}
          disabled={!ready}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper-elev px-3.5 py-2 font-sans text-[12px] font-medium text-ink transition-colors hover:border-fuchsia hover:text-fuchsia disabled:opacity-40"
        >
          <CopyIcon className="h-3 w-3" />
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          onClick={onOpenAffiliate}
          disabled={!ready}
          className="rounded-full border border-line bg-paper-elev px-3.5 py-2 font-sans text-[12px] font-medium text-ink transition-colors hover:border-fuchsia hover:text-fuchsia disabled:opacity-40"
        >
          Share ↗
        </button>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
        <span>{referrals} referral{referrals === 1 ? "" : "s"}</span>
        <span>·</span>
        <span className="text-fuchsia">{fmtUsd(earnings)} earned</span>
      </div>
    </section>
  );
}

/* ── 3. Live campaigns row — RETIRED in v0.7.0 ─────────────────────── */
/* Replaced by SponsoredRewardsRow which pulls from junior-backend
   /campaigns (Liquid Clips owned campaign records) instead of Whop's
   generic affiliate listing. The old LiveCampaignsRow + CampaignCard
   were deleted here to keep TS strict-unused checks clean. */

/* ── 4. Active clips ───────────────────────────────────────────────── */

function ActiveClipsList({ onOpenEarn }: { onOpenEarn: () => void }) {
  const { submissions } = useSubmissions();
  const recent = [...submissions]
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
    .slice(0, 5);

  return (
    <section className="flex flex-col gap-3">
      <Header glyph={UploadIcon} label="your active clips" trailing={
        submissions.length > 5 ? (
          <button
            onClick={onOpenEarn}
            className="inline-flex items-center gap-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary transition-colors hover:text-fuchsia"
          >
            view all <ChevronRight className="h-3 w-3" />
          </button>
        ) : null
      } />
      {recent.length === 0 ? (
        <EmptyHint text="No clips logged yet. Submit one and it'll appear here with live view counts and earnings." />
      ) : (
        <div className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper-elev">
          {recent.map((s) => (
            <ClipRow key={s.id} clip={s} />
          ))}
        </div>
      )}
    </section>
  );
}

function ClipRow({ clip }: { clip: ReturnType<typeof useSubmissions>["submissions"][number] }) {
  const earnings = Number(clip.actual_payout || clip.estimated_payout || "0") || 0;
  const isPaid = clip.status === "paid";
  const isPending = clip.status === "submitted" || clip.status === "approved";
  const statusLabel =
    clip.status === "paid"
      ? "paid"
      : clip.status === "approved"
      ? "approved · pending pay"
      : clip.status === "rejected"
      ? "rejected"
      : "in review";
  const statusColor = isPaid
    ? "text-[#34D399]"
    : isPending
    ? "text-fuchsia"
    : clip.status === "rejected"
    ? "text-[#DC2626]"
    : "text-text-tertiary";

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-paper-warm font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia">
        {clip.platform.slice(0, 2).toUpperCase()}
      </div>
      <div className="flex flex-1 flex-col">
        <p className="line-clamp-1 font-sans text-[13px] font-medium text-ink">
          {clip.post_url || clip.clip_path.split("/").pop() || "Untitled clip"}
        </p>
        <p className={`font-mono text-[10px] uppercase tracking-[0.12em] ${statusColor}`}>
          {statusLabel}
        </p>
      </div>
      <div className="flex flex-col items-end">
        <span className="font-mono text-[11px] text-text-tertiary">
          {clip.views.toLocaleString()} views
        </span>
        <span className="font-display text-[14px] font-semibold leading-none tracking-[-0.015em] text-fuchsia">
          {fmtUsd(earnings)}
        </span>
      </div>
    </div>
  );
}

/* ── 5. Leaderboard preview ────────────────────────────────────────── */

function LeaderboardPreview({ onOpenEarn }: { onOpenEarn: () => void }) {
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void leaderboardGet()
      .then((b) => {
        if (cancelled) return;
        setBoard(b);
      })
      .catch(() => setBoard(null))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const top = board?.entries?.slice(0, 5) ?? [];
  const caller = board?.caller_entry ?? null;
  const callerInTop = caller && top.some((e) => e.is_caller);

  return (
    <section className="flex flex-col gap-3">
      <Header glyph={Trophy} label="leaderboard · this week" trailing={
        <button
          onClick={onOpenEarn}
          className="inline-flex items-center gap-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary transition-colors hover:text-fuchsia"
        >
          full board <ChevronRight className="h-3 w-3" />
        </button>
      } />
      {loading ? (
        <SkeletonRow />
      ) : top.length === 0 ? (
        <EmptyHint text="Leaderboard refresh pending. Check back in a minute or open the full board." />
      ) : (
        <div className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper-elev">
          {top.map((e) => (
            <BoardRow key={e.rank} entry={e} />
          ))}
          {!callerInTop && caller ? (
            <>
              <div className="flex items-center justify-center bg-paper-warm/40 px-4 py-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-text-tertiary">
                · · ·
              </div>
              <BoardRow entry={caller} />
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}

function BoardRow({ entry }: { entry: { rank: number; display_handle: string; lifetime_earnings_usd: string; paid_referrals: number; is_caller: boolean } }) {
  const earned = Number(entry.lifetime_earnings_usd) || 0;
  return (
    <div
      className={`flex items-center gap-3 px-4 py-2.5 ${
        entry.is_caller ? "bg-fuchsia/10" : ""
      }`}
    >
      <span
        className={`w-8 shrink-0 font-mono text-[12px] font-semibold ${
          entry.rank === 1 ? "text-fuchsia" : "text-text-tertiary"
        }`}
      >
        #{entry.rank}
      </span>
      <span className={`flex-1 truncate font-sans text-[13px] ${entry.is_caller ? "font-semibold text-ink" : "text-ink"}`}>
        {entry.display_handle}{entry.is_caller ? " (you)" : ""}
      </span>
      {entry.paid_referrals > 0 ? (
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          {entry.paid_referrals} refs
        </span>
      ) : null}
      <span className="font-display text-[14px] font-semibold leading-none tracking-[-0.015em] text-fuchsia">
        {fmtUsd(earned)}
      </span>
    </div>
  );
}

/* ── 5b. Scheduled clips ──────────────────────────────────────────── */

function ScheduledClipsBlock({ onOpenEarn: _onOpenEarn }: { onOpenEarn: () => void }) {
  const [items, setItems] = useState<LocalScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void sidecar
      .localScheduleList()
      .then((r) => {
        if (cancelled) return;
        const pending = (r.items ?? []).filter((i) => i.status === "pending");
        // Soonest first.
        pending.sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));
        setItems(pending.slice(0, 5));
      })
      .catch(() => setItems([]))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <Header
        glyph={CalendarClock}
        label="scheduled"
        trailing={
          items.length > 0 ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
              {items.length} queued
            </span>
          ) : null
        }
      />
      {loading ? (
        <SkeletonRow />
      ) : items.length === 0 ? (
        <EmptyHint text="Nothing queued. When you Schedule a clip from the cards above, it lands here with a live countdown." />
      ) : (
        <div className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper-elev">
          {items.map((it) => (
            <ScheduledRow key={it.id} item={it} />
          ))}
        </div>
      )}
    </section>
  );
}

function ScheduledRow({ item }: { item: LocalScheduleItem }) {
  const due = relativeFuture(item.scheduled_for);
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-paper-warm font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia">
        {item.platform.slice(0, 2).toUpperCase()}
      </div>
      <div className="flex flex-1 flex-col">
        <p className="line-clamp-1 font-sans text-[13px] font-medium text-ink">
          {item.clip_title}
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          {item.platform} · scheduled
        </p>
      </div>
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia">
        {due}
      </span>
    </div>
  );
}

function relativeFuture(iso: string): string {
  const target = new Date(iso).getTime();
  const now = Date.now();
  const ms = target - now;
  if (ms <= 0) return "due now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `in ${days}d`;
  const d = new Date(target);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ── shared bits ───────────────────────────────────────────────────── */

function Header({
  glyph: Glyph,
  label,
  trailing,
}: {
  glyph: typeof Wallet;
  label: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-fuchsia">
        <Glyph className="h-3 w-3" />
        {label}
      </div>
      {trailing}
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="h-[120px] animate-pulse rounded-2xl border border-line bg-paper-elev/40" />
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-line bg-paper-elev/40 px-5 py-4 font-sans text-[12px] leading-relaxed text-text-secondary">
      {text}
    </p>
  );
}
