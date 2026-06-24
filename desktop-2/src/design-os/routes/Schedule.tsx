/**
 * ScheduleRoute · Phase 6J-A
 *
 * Replaces the SimPage stub. First real Schedule surface.
 *
 * Reuses:
 *   - useSchedule          · Phase 6J-A data layer
 *   - useChannels          · enriches rows via useSchedule
 *   - useTierCaps          · monthly-post cap awareness
 *   - AccountChipState     · chip variant inside ScheduleJobRow
 *   - Drawer               · ScheduleJobDrawer chrome
 *   - EngineErrorBoundary  · wraps every surface
 *   - BakeErrorStrip       · surfaces publish failures
 *
 * Builds inside this route only:
 *   - WeekStrip · 7-day overview with per-status dots
 *   - ScheduleFilters · 7 chip filters
 *   - DayColumnList · day-grouped ScheduleJobRow stack
 *   - ScheduleEmptyState · empty/no-match path
 *   - ScheduleJobDrawer · detail + reschedule/cancel/retry
 *
 * Out of scope (per the Phase 6J-A brief):
 *   - Campaign orchestration · per-row campaign editor
 *   - Drag-to-reschedule
 *   - Real Ayrshare wiring
 *   - Bulk-scheduling UI
 */

import { useMemo, useState } from "react";
import { motion as fm } from "framer-motion";
import { DesignOSAppShell } from "../components/AppShell";
import { EngineErrorBoundary } from "../components/EngineErrorBoundary";
import { presets } from "../motion";
import { BakeErrorStrip } from "../engine/BakeErrorStrip";
import { useRuntimeInfo } from "../engine/runtimeInfo";
import { useTierCaps } from "../state/useTierCaps";
import { useSchedule } from "../state/useSchedule";
import { EngineSessionProvider, useEngineSession } from "../state/useEngineSession";
import { useKadeFromSession } from "../state/useKadeFromSession";
import { ROUTE_REGISTRY } from "../routing/routeRegistry";
import { ROUTE_HERO } from "../copy/copyMap";
import {
  WeekStrip,
  ScheduleFilters,
  applyScheduleFilter,
  DayColumnList,
  ScheduleJobDrawer,
  ScheduleEmptyState,
  type ScheduleFilterKey,
} from "../schedule";
import type { ScheduledJob } from "../state/useSchedule";
import "./SimPage.css";
import "./Schedule.css";

const FILTER_LABEL: Record<ScheduleFilterKey, string> = {
  all: "All", scheduled: "Scheduled", posted: "Posted", failed: "Failed",
  retrying: "Retrying", today: "Today", week: "This week",
};

function ScheduleBody() {
  const session = useEngineSession();
  const runtime = useRuntimeInfo();
  const tier = useTierCaps();
  useKadeFromSession("schedule");

  const spec = ROUTE_REGISTRY["schedule"];
  const hero = ROUTE_HERO["schedule"];

  const sched = useSchedule();
  const [filter, setFilter] = useState<ScheduleFilterKey>("all");
  const [activeJob, setActiveJob] = useState<ScheduledJob | null>(null);

  const filtered = useMemo(() => applyScheduleFilter(sched.jobs, filter), [sched.jobs, filter]);
  const filteredByDay = useMemo(() => {
    const acc: Record<string, ScheduledJob[]> = {};
    const sorted = [...filtered].sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor));
    for (const j of sorted) {
      const d = new Date(j.scheduledFor);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!acc[k]) acc[k] = [];
      acc[k].push(j);
    }
    return acc;
  }, [filtered]);
  const filteredDayKeys = useMemo(
    () => Object.keys(filteredByDay).sort(),
    [filteredByDay],
  );

  const todayKey = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);
  const [activeDayKey, setActiveDayKey] = useState<string>(todayKey);

  const handlePickDay = (k: string) => {
    setActiveDayKey(k);
    const el = document.querySelector(`[data-day-key="${k}"]`);
    if (el && "scrollIntoView" in el) {
      (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <DesignOSAppShell
      world={spec.world}
      route="schedule"
      defaultKade={session.kade}
      kadePlacement={spec.kadePlacement}
    >
      <fm.div
        className="sim-stage"
        variants={presets.routeEnter}
        initial="initial"
        animate="animate"
      >
        <fm.div
          className="sim-welcome"
          data-kade-anchor
          variants={presets.staggerContainer}
          initial="initial"
          animate="animate"
        >
          <fm.span className="sim-eb" variants={presets.staggerItem}>
            {hero.eyebrow}
            {sched.source !== "mock" ? (
              <span
                className="lc-runtime-tag is-live"
                title={`Source: ${sched.source} · /schedules backend reachable.`}
              >
                Live · backend
              </span>
            ) : runtime.mode === "mock" && (
              <span className="lc-runtime-tag" title="Mock schedule queue · pass a license JWT via localStorage.lc.license.jwt.v1 (or run inside Tauri) to flip to real-http.">
                Studio preview
              </span>
            )}
            <span className="lc-schedule-tier-tag">{tier.tier.toUpperCase()}</span>
            <span className="lc-schedule-cap-tag" title="Monthly post cap usage">
              {sched.scheduledThisMonth} / {tier.caps.monthlyPosts} posts this month
            </span>
          </fm.span>
          <fm.h1 className="sim-h1" variants={presets.staggerItem}>
            {hero.h1}
          </fm.h1>
          <fm.p className="sim-sub" variants={presets.staggerItem}>
            {hero.sub}
          </fm.p>
        </fm.div>

        {/* Surfaces publish/bake/regen/thumbnail errors when they fire on this route */}
        <BakeErrorStrip />

        {/* Week strip */}
        <EngineErrorBoundary route="schedule" component="WeekStrip">
          <WeekStrip
            jobsByDay={sched.jobsByDay}
            activeKey={activeDayKey}
            onPick={handlePickDay}
          />
        </EngineErrorBoundary>

        {/* Filter chips */}
        <EngineErrorBoundary route="schedule" component="ScheduleFilters">
          <ScheduleFilters active={filter} onChange={setFilter} jobs={sched.jobs} />
        </EngineErrorBoundary>

        {/* Day column list · empty state · loading */}
        {sched.loading && (
          <div className="lc-schedule-loading">Loading schedule…</div>
        )}

        {!sched.loading && filtered.length === 0 && (
          <EngineErrorBoundary route="schedule" component="ScheduleEmptyState">
            <ScheduleEmptyState
              filterLabel={FILTER_LABEL[filter]}
              totalJobs={sched.jobs.length}
            />
          </EngineErrorBoundary>
        )}

        {!sched.loading && filtered.length > 0 && (
          <EngineErrorBoundary route="schedule" component="DayColumnList">
            <DayColumnList
              jobsByDay={filteredByDay}
              dayKeys={filteredDayKeys}
              hideBrand={tier.tier === "clipper"}
              onOpen={(j) => setActiveJob(j)}
              onCancel={(j) => { void sched.cancelJob(j.id); }}
              onRetry={(j) => { void sched.retryJob(j.id); }}
            />
          </EngineErrorBoundary>
        )}

        {/* Detail drawer */}
        <EngineErrorBoundary route="schedule" component="ScheduleJobDrawer">
          <ScheduleJobDrawer
            job={activeJob}
            open={activeJob !== null}
            onClose={() => setActiveJob(null)}
            onReschedule={async (id, when) => {
              const next = await sched.rescheduleJob(id, when);
              if (next) setActiveJob(next);
            }}
            onCancel={async (id) => {
              await sched.cancelJob(id);
              setActiveJob((cur) => cur ? { ...cur, status: "cancelled" } : cur);
            }}
            onRetry={async (id) => {
              const next = await sched.retryJob(id);
              if (next) setActiveJob(next);
            }}
            hideBrand={tier.tier === "clipper"}
          />
        </EngineErrorBoundary>
      </fm.div>
    </DesignOSAppShell>
  );
}

export function ScheduleRoute() {
  return (
    <EngineSessionProvider resetOnRouteEnter>
      <ScheduleBody />
    </EngineSessionProvider>
  );
}
