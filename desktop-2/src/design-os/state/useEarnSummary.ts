/**
 * useEarnSummary · Phase 6L-D
 *
 * Lightweight summary on top of `useRewardClips()`. Derived in this hook
 * rather than re-fetching, so the route stays consistent with the rows
 * underneath. When the real backend exposes a `/me/earn/summary` route
 * later, swap the body of `derive` for an `earn.summary()` call — no
 * consumer changes.
 *
 * RPM tier comes from `useTierCaps()` per the locked tier matrix
 * (free $1 / pro $3 / agency $5). Future Campaigns may override per-row
 * but the lifetime aggregate stays on the user-tier.
 */

import { useMemo } from "react";
import { useRewardClips } from "./useRewardClips";
import { useTierCaps } from "./useTierCaps";
import { RPM_TIERS, type EarnSummary } from "../earn/types";

function rpmForTier(t: "clipper" | "pro" | "growth" | "agency") {
  if (t === "agency") return RPM_TIERS.agency;
  // Growth uses the pro RPM band until a dedicated growth RPM tier ships
  // in the backend earn schema. Conservative · prevents Growth getting
  // less reward than Pro by accident.
  if (t === "pro" || t === "growth") return RPM_TIERS.pro;
  return RPM_TIERS.free;
}

export interface EarnSummaryApi {
  summary: EarnSummary;
  loading: boolean;
  error: string | null;
}

export function useEarnSummary(): EarnSummaryApi {
  const clips = useRewardClips();
  const tier = useTierCaps();

  const summary = useMemo<EarnSummary>(() => {
    const rpm = rpmForTier(tier.tier);
    const totalClicks = clips.totalClicks;
    const totalEarnedUsd = (totalClicks / 1000) * rpm.rpmUsd;
    const approvedClips = clips.byStatus.approved ?? [];
    const pendingPayoutsUsd = approvedClips.reduce(
      (acc, c) => acc + ((c.trackingLink?.clickCount ?? 0) / 1000) * rpm.rpmUsd,
      0,
    );
    return {
      totalEarnedUsd: Math.round(totalEarnedUsd * 100) / 100,
      pendingPayoutsUsd: Math.round(pendingPayoutsUsd * 100) / 100,
      approvedCount: approvedClips.length,
      rejectedCount: (clips.byStatus.denied ?? []).length,
      pendingCount: (clips.byStatus.submitted ?? []).length,
      paidCount: (clips.byStatus.paid ?? []).length,
      rpm,
      totalClicks,
      updatedAt: new Date().toISOString(),
    };
  }, [clips, tier.tier]);

  return {
    summary,
    loading: clips.loading,
    error: clips.error,
  };
}
