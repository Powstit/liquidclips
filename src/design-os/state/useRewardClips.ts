/**
 * useRewardClips · Phase 6L-D
 *
 * Shared data layer for every surface that reads reward-clip rows.
 * Mirrors the `useCommunity` template:
 *   - Real-RPC → HTTP → mock fallback (one swap point in sidecar-stub).
 *   - Grouped views computed once via useMemo.
 *   - Per-status / per-campaign indexes for fast filter chips + future
 *     campaign-submission drill-downs.
 *
 * Architecture alignment (locked by clarification):
 *   Campaign → Submission → Approval → Reward → Payout
 *
 * RewardClip is the **submission row** in tomorrow's Campaign model.
 * This hook is the seam where the rename happens — call sites read
 * `submissions` instead of `clips`, the row shape doesn't change.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { earn } from "../engine/sidecar-stub";
import { bus } from "../bridge";
import {
  statusToFilter,
  type EarnFilterKey,
  type RewardClip,
  type RewardClipStatus,
} from "../earn/types";

type Source = "real-rpc" | "real-http" | "mock";

export interface RewardClipsApi {
  /** Raw rows (newest createdAt first when backend returns sorted). */
  clips: ReadonlyArray<RewardClip>;
  /** Alias for forward-compat with the Campaign model. */
  submissions: ReadonlyArray<RewardClip>;
  /** Rows grouped by status (draft / generated / submitted / approved / denied / paid). */
  byStatus: Readonly<Record<string, RewardClip[]>>;
  /** Rows grouped by filter bucket (all / pending / approved / paid / rejected / draft). */
  byFilter: Readonly<Record<EarnFilterKey, RewardClip[]>>;
  /** Rows grouped by campaign id (`__none` bucket for unassociated). */
  byCampaign: Readonly<Record<string, RewardClip[]>>;
  /** Total clicks across all tracking links — drives the summary RPM math. */
  totalClicks: number;
  loading: boolean;
  error: string | null;
  /** Source of the last successful load. */
  source: Source;
  /** Re-fetch. */
  reload: () => Promise<void>;
}

export function useRewardClips(): RewardClipsApi {
  const [clips, setClips] = useState<RewardClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<Source>("mock");

  const reload = useCallback(async () => {
    setError(null);
    try {
      const r = await earn.listRewardClips();
      setClips(r.clips);
      setSource(r.source);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      bus.emit("toast", { kind: "error", title: "Couldn't load earnings", body: msg });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  /* ============================================================
     Derived views
     ============================================================ */

  const byStatus = useMemo<Record<string, RewardClip[]>>(() => {
    const acc: Record<string, RewardClip[]> = {
      draft: [], generated: [], submitted: [], approved: [], denied: [], paid: [],
    };
    for (const c of clips) {
      const k = (c.status ?? "draft") as RewardClipStatus;
      if (!acc[k]) acc[k] = [];
      acc[k].push(c);
    }
    return acc;
  }, [clips]);

  const byFilter = useMemo<Record<EarnFilterKey, RewardClip[]>>(() => {
    const acc: Record<EarnFilterKey, RewardClip[]> = {
      all: [...clips], pending: [], approved: [], paid: [], rejected: [], draft: [],
    };
    for (const c of clips) {
      const k = statusToFilter(c.status);
      acc[k].push(c);
    }
    return acc;
  }, [clips]);

  const byCampaign = useMemo<Record<string, RewardClip[]>>(() => {
    const acc: Record<string, RewardClip[]> = {};
    for (const c of clips) {
      const k = c.campaignId ?? "__none";
      if (!acc[k]) acc[k] = [];
      acc[k].push(c);
    }
    return acc;
  }, [clips]);

  const totalClicks = useMemo(
    () => clips.reduce((acc, c) => acc + (c.trackingLink?.clickCount ?? 0), 0),
    [clips],
  );

  return {
    clips,
    submissions: clips,
    byStatus,
    byFilter,
    byCampaign,
    totalClicks,
    loading,
    error,
    source,
    reload,
  };
}

export type { EarnFilterKey };
