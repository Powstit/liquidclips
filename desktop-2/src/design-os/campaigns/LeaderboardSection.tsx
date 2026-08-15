/**
 * LeaderboardSection · Phase 6L-C
 *
 * Affiliate-earnings preview rail. Consumes
 * `useCommunity().leaderboardPreview` (already shipped in 6L-A · real RPC
 * → HTTP → mock top-5 fallback). Reuses the existing `public/brand/
 * leaderboard/` assets — no new art.
 *
 * Caller-row behaviour:
 *   - When the caller appears in the top 5 → highlighted row + a
 *     `top_100_leaderboard` achievement unlock fires the first time it
 *     happens (localStorage-deduped via `recordAchievement`).
 *   - When the caller is OUTSIDE the visible top 5 → caller row pins at
 *     the bottom as a separated "your rank" row.
 *
 * Refresh tag · the legacy `/leaderboard/earnings` endpoint caches via
 * a 6h cron. Surface the cadence as a "refreshes every 6h" pill so
 * users understand stale rank.
 *
 * 2026-08-15 · moved from design-os/community/ — Campaigns and Earn are
 * its only real consumers; Community's own route never mounted it.
 */

import { useEffect } from "react";
import { GlassCard } from "../components";
import { useCommunity } from "../state/useCommunity";
import { recordAchievement } from "../community/achievements";
import type { LeaderboardPreviewRow } from "../community/types";
import { SafeImg } from "../../components/safe";
// Watchdog Rollout · mo-11 (2026-07-06) · leaderboard top-5 earners.
// A crash inside the row-slice / caller-pin computation or achievement
// unlock effect renders KadeRepairScreen instead of blanking the
// Earn / Community rail. See docs/PROTOCOL_SELF_HEALING_NODES.md.
import { Watchdog } from "../../lib/watchdog";
import "./LeaderboardSection.css";

const RANK_BADGE: Record<1 | 2 | 3, string> = {
  1: "/brand/leaderboard/rank-1-gold.svg",
  2: "/brand/leaderboard/rank-2-silver.svg",
  3: "/brand/leaderboard/rank-3-bronze.svg",
};

const CROWN_BADGE = "/brand/leaderboard/badge-crown.svg";

function fmtUsd(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function rankAsset(rank: number): string {
  if (rank === 1 || rank === 2 || rank === 3) return RANK_BADGE[rank];
  return "/brand/leaderboard/rank-numeric.svg";
}

function RankBadge({ rank }: { rank: number }) {
  return (
    <span className="lc-lbs-rank-wrap" aria-hidden="true">
      <SafeImg src={rankAsset(rank)} fallback="hide" alt="" className="lc-lbs-rank-img" />
      {rank > 3 && <span className="lc-lbs-rank-num">{rank}</span>}
    </span>
  );
}

function Row({ row }: { row: LeaderboardPreviewRow }) {
  return (
    <div className={`lc-lbs-row ${row.isCaller ? "is-caller" : ""}`}>
      <RankBadge rank={row.rank} />
      <div className="lc-lbs-mid">
        <span className="lc-lbs-handle">{row.displayHandle}</span>
        <span className="lc-lbs-sub">
          {row.paidReferrals} {row.paidReferrals === 1 ? "referral" : "referrals"}
        </span>
      </div>
      <span className="lc-lbs-earn">{fmtUsd(row.lifetimeEarningsUsd)}</span>
      {row.isCaller && (
        <SafeImg src={CROWN_BADGE} fallback="hide" alt="" className="lc-lbs-caller-crown" aria-hidden="true" />
      )}
    </div>
  );
}

export function LeaderboardSection() {
  return (
    <Watchdog
      id="money/mo-11/leaderboard-top5"
      label="Leaderboard top-5 earners"
      cluster="money"
      source="src/design-os/campaigns/LeaderboardSection.tsx:LeaderboardSection"
    >
      <LeaderboardSectionBody />
    </Watchdog>
  );
}

function LeaderboardSectionBody() {
  const community = useCommunity();
  const rows = community.leaderboardPreview;

  /* ============================================================
     top_100_leaderboard unlock · fires the first time the caller
     appears in the visible top 5 (proxy for top 100 in the preview).
     ============================================================ */
  const callerRow = rows.find((r) => r.isCaller);
  useEffect(() => {
    if (callerRow) {
      void recordAchievement("top_100_leaderboard");
    }
  }, [callerRow]);

  if (rows.length === 0) {
    return (
      <GlassCard density="quiet" className="lc-lbs-empty">
        <span className="lc-lbs-empty-eb">Leaderboard</span>
        <span className="lc-lbs-empty-body">
          Top 5 affiliate earners surface here when the leaderboard refreshes.
        </span>
      </GlassCard>
    );
  }

  /* Caller pinned separately when outside the visible window. The preview
   * slice is top-5 only, so we mirror legacy behaviour: when the caller is
   * in the top 5, no extra row is needed. */
  const top5 = rows.slice(0, 5);
  const callerInTop5 = top5.some((r) => r.isCaller);
  const callerOutside = !callerInTop5 ? callerRow ?? null : null;

  return (
    <GlassCard density="default" className="lc-lbs">
      <header className="lc-lbs-head">
        <div className="lc-lbs-head-left">
          <span className="lc-lbs-eb">Leaderboard preview</span>
          <span className="lc-lbs-sub">Top 5 affiliate earners · this month</span>
        </div>
        <span className="lc-lbs-refresh" title="Cache refreshes every 6 hours via cron.">
          Refreshes 6h
        </span>
      </header>

      <div className="lc-lbs-rows">
        {top5.map((row) => (
          <Row key={`${row.rank}-${row.displayHandle}`} row={row} />
        ))}
      </div>

      {callerOutside && (
        <>
          <div className="lc-lbs-divider" aria-hidden="true">
            <span className="lc-lbs-divider-line" />
            <span className="lc-lbs-divider-label">Your rank</span>
            <span className="lc-lbs-divider-line" />
          </div>
          <div className="lc-lbs-rows">
            <Row row={callerOutside} />
          </div>
        </>
      )}
    </GlassCard>
  );
}
