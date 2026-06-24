/**
 * useSchedule · Phase 6J-A foundation
 *
 * Shared data layer for the Schedule route + every surface that needs to
 * know what is queued / posted / failing:
 *   - Schedule route · week strip + day column + drawer
 *   - Channels route · "monthly posts" + "needs attention" (future hook)
 *   - Campaign route · per-campaign rollup (Phase 7+)
 *   - ClipCard · "queued/posted/failed" pill (read-only)
 *
 * Reads from `schedule.listScheduledClips()` in sidecar-stub
 * (real-Tauri-first / mock-fallback). Real Ayrshare lands later.
 *
 * Reuses:
 *   - useChannels()      · to enrich rows with current account state and to
 *                          surface "channel still failing" warnings on retry
 *   - useTierCaps()      · to gate "Schedule clip" + show monthly-post cap
 *   - AccountChipState   · NOT imported here — components render that
 *                          themselves from the row's account snapshot
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  schedule as scheduleApi,
  type ScheduledJob,
  type ScheduleClipParams,
  type ScheduledJobStatus,
} from "../engine/sidecar-stub";
import { useChannels } from "./useChannels";
import { useTierCaps } from "./useTierCaps";

export interface ScheduleApi {
  /** Raw list as returned by the sidecar (newest createdAt first). */
  jobs: ReadonlyArray<ScheduledJob>;
  /** Jobs grouped by YYYY-MM-DD (local day · stable insertion order). */
  jobsByDay: Readonly<Record<string, ScheduledJob[]>>;
  /** Jobs grouped by status. */
  jobsByStatus: Readonly<Record<ScheduledJobStatus, ScheduledJob[]>>;
  /** Jobs grouped by account id. */
  jobsByAccount: Readonly<Record<string, ScheduledJob[]>>;
  /** Jobs grouped by campaign id ("__none" bucket for jobs with no campaign). */
  jobsByCampaign: Readonly<Record<string, ScheduledJob[]>>;
  /** Total jobs scheduled / posted this calendar month (drives tier-cap UI). */
  scheduledThisMonth: number;
  /** Tier-cap check · true when monthlyPosts cap is hit. */
  isAtMonthlyCap: boolean;
  /** Loading state for initial fetch. */
  loading: boolean;
  /** Last error from a list/schedule/cancel/reschedule/retry call. */
  error: string | null;
  /** Where the last list resolved from · drives the route honesty pill. */
  source: "real-rpc" | "real-http" | "mock";
  /* ---- Actions ---- */
  scheduleClip: (p: ScheduleClipParams) => Promise<ScheduledJob[]>;
  cancelJob: (id: string) => Promise<boolean>;
  rescheduleJob: (id: string, scheduledFor: string) => Promise<ScheduledJob | null>;
  retryJob: (id: string) => Promise<ScheduledJob | null>;
  reload: () => Promise<void>;
}

const STATUS_BUCKETS: ScheduledJobStatus[] = [
  "draft", "scheduled", "uploading", "posted", "failed", "retrying", "cancelled",
];

function localDayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function useSchedule(): ScheduleApi {
  const tier = useTierCaps();
  /* useChannels is held so a channel disconnect/reconnect triggers a
   * Schedule re-render via React's normal update path — rows that show
   * channel state need to react to it. */
  useChannels();

  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"real-rpc" | "real-http" | "mock">("mock");

  const reload = useCallback(async () => {
    setError(null);
    try {
      const r = await scheduleApi.listScheduledClips();
      setJobs(r.jobs);
      setSource(r.source);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  /* ============================================================
     Derived views
     ============================================================ */

  const jobsByDay = useMemo(() => {
    const acc: Record<string, ScheduledJob[]> = {};
    /* Sort jobs by scheduledFor ascending so each day's list is chronological. */
    const sorted = [...jobs].sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor));
    for (const j of sorted) {
      const k = localDayKey(j.scheduledFor);
      if (!acc[k]) acc[k] = [];
      acc[k].push(j);
    }
    return acc;
  }, [jobs]);

  const jobsByStatus = useMemo(() => {
    const acc: Record<ScheduledJobStatus, ScheduledJob[]> = {
      draft: [], scheduled: [], uploading: [], posted: [], failed: [], retrying: [], cancelled: [],
    };
    for (const j of jobs) acc[j.status].push(j);
    return acc;
  }, [jobs]);

  const jobsByAccount = useMemo(() => {
    const acc: Record<string, ScheduledJob[]> = {};
    for (const j of jobs) {
      for (const aid of j.targetAccountIds) {
        if (!acc[aid]) acc[aid] = [];
        acc[aid].push(j);
      }
    }
    return acc;
  }, [jobs]);

  const jobsByCampaign = useMemo(() => {
    const acc: Record<string, ScheduledJob[]> = {};
    for (const j of jobs) {
      const k = j.campaignId ?? "__none";
      if (!acc[k]) acc[k] = [];
      acc[k].push(j);
    }
    return acc;
  }, [jobs]);

  const scheduledThisMonth = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    return jobs.filter((j) => {
      if (j.status === "cancelled" || j.status === "draft") return false;
      const d = new Date(j.scheduledFor);
      return d.getFullYear() === y && d.getMonth() === m;
    }).length;
  }, [jobs]);

  const isAtMonthlyCap = scheduledThisMonth >= tier.caps.monthlyPosts;

  /* ============================================================
     Actions · optimistic local update then re-sync
     ============================================================ */

  const scheduleClip = useCallback(async (p: ScheduleClipParams): Promise<ScheduledJob[]> => {
    if (isAtMonthlyCap) {
      const msg = `Monthly post cap reached at ${tier.tier.toUpperCase()} · ${scheduledThisMonth} of ${tier.caps.monthlyPosts}.`;
      setError(msg);
      return [];
    }
    try {
      const r = await scheduleApi.scheduleClip(p);
      await reload();
      return r.jobs;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return [];
    }
  }, [isAtMonthlyCap, reload, scheduledThisMonth, tier]);

  const cancelJob = useCallback(async (id: string): Promise<boolean> => {
    try {
      const r = await scheduleApi.cancelScheduledJob(id);
      if (r.ok) {
        setJobs((cur) => cur.map((j) => j.id === id ? { ...j, status: "cancelled" } : j));
      }
      return r.ok;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, []);

  const rescheduleJob = useCallback(async (id: string, scheduledFor: string): Promise<ScheduledJob | null> => {
    try {
      const r = await scheduleApi.rescheduleJob(id, scheduledFor);
      if (r.job) {
        const next = r.job;
        setJobs((cur) => cur.map((j) => j.id === id ? next : j));
      }
      return r.job;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  const retryJob = useCallback(async (id: string): Promise<ScheduledJob | null> => {
    try {
      const r = await scheduleApi.retryScheduledJob(id);
      if (r.job) {
        const retrying = r.job;
        setJobs((cur) => cur.map((j) => j.id === id ? retrying : j));
        /* Re-pull after the mock retry window so the final posted/failed
         * state is reflected end-to-end. */
        setTimeout(() => { void reload(); }, 2400);
      }
      return r.job;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [reload]);

  return {
    jobs,
    jobsByDay,
    jobsByStatus,
    jobsByAccount,
    jobsByCampaign,
    scheduledThisMonth,
    isAtMonthlyCap,
    loading,
    error,
    source,
    scheduleClip,
    cancelJob,
    rescheduleJob,
    retryJob,
    reload,
  };
}

export { type ScheduledJob, type ScheduledJobStatus, type ScheduleClipParams, STATUS_BUCKETS };
