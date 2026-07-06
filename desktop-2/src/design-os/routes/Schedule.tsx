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
import { ExternalLink } from "lucide-react";
import { DesignOSAppShell } from "../components/AppShell";
import { EngineErrorBoundary } from "../components/EngineErrorBoundary";
import { presets } from "../motion";
import { BakeErrorStrip } from "../engine/BakeErrorStrip";
import { useTierCaps } from "../state/useTierCaps";
import { useSchedule } from "../state/useSchedule";
import { EngineSessionProvider, useEngineSession } from "../state/useEngineSession";
import { useKadeFromSession } from "../state/useKadeFromSession";
import { ROUTE_REGISTRY } from "../routing/routeRegistry";
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
import type { Platform } from "../engine/types";
import { platformComposerUrl, platformLabel } from "../schedule/assistedSchedule";
import { useBrowseOverlay } from "../../state/browseOverlay";
// ag-15 (2026-07-06) · Sovereign-Operator Protocol · wrap the monthly-
// post cap-warning banner so a bad tier resolve doesn't take out the
// Schedule route. Backend enforcement lives in publish.py:111
// _enforce_monthly_post_cap; the client mirror is here.
import { Watchdog } from "../../lib/watchdog";
import "./SimPage.css";
import "./Schedule.css";

const FILTER_LABEL: Record<ScheduleFilterKey, string> = {
  all: "All", scheduled: "Scheduled", posted: "Posted", failed: "Failed",
  retrying: "Retrying", today: "Today", week: "This week",
};

function ScheduleBody() {
  const session = useEngineSession();
  const tier = useTierCaps();
  useKadeFromSession("schedule");

  const spec = ROUTE_REGISTRY["schedule"];

  const sched = useSchedule();
  const openBrowser = useBrowseOverlay((state) => state.openWith);
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
        className="sim-stage lc-schedule-stage"
        variants={presets.routeEnter}
        initial="initial"
        animate="animate"
      >
        {/* PHASE 1 · viewport discipline · WeekStrip + DayColumnList now
            land in the first viewport. Tier + cap pills survive as
            compact status; 80px H1 + sub-copy cut (route identity is in
            TopHud + ConsoleNav). */}
        <div className="lc-route-head" data-kade-anchor data-route-title="Schedule">
          <div className="lc-schedule-heading">
            {/* Ship-lens Batch 4 (Heading + touch sweep · 2026-07-06) ·
             *  primary route heading now <h1> for screen-reader nav. */}
            <h1 className="lc-route-head-eb">Schedule</h1>
            <span className="lc-schedule-heading-copy">
              Review posting reminders and provider results.
            </span>
          </div>
          <div className="lc-route-head-pills">
            <span
              className="lc-runtime-tag is-live"
              title={sched.source === "assisted-local"
                ? "Saved on this Mac. Liquid Clips prepares the browser handoff at posting time."
                : `Source: ${sched.source} · provider queue reachable.`}
            >
              {sched.source === "assisted-local" ? "Assisted · this Mac" : "Automatic · provider"}
            </span>
            {/* 2026-07-05 · Wave 4 polish · removed "Auto-post · coming soon"
                permanent tag. Users couldn't tell it apart from real
                Live/Offline pills. Assisted-local IS the shipping
                behaviour; automatic-provider gets its own explicit
                status pill when the feature actually ships. */}
            <span className="lc-schedule-tier-tag">{tier.tier.toUpperCase()}</span>
            <Watchdog
              id="agency/ag-15/monthly-post-cap"
              label="Monthly post cap banner"
              cluster="agency"
              source="src/design-os/routes/Schedule.tsx:cap-tag (backend publish.py:111)"
            >
              <span className="lc-schedule-cap-tag" title="Monthly post cap usage">
                {sched.scheduledThisMonth} / {tier.caps.monthlyPosts} posts this month
              </span>
            </Watchdog>
          </div>
        </div>

        <div className="lc-schedule-login-strip">
          <div className="lc-schedule-login-copy">
            {/* Ship-lens Batch 4 (Heading + touch sweep · 2026-07-06) ·
             *  secondary section heading now <h2> (h1 is the route
             *  title above). Preserves heading hierarchy. */}
            <h2 className="lc-route-head-eb">Platform login</h2>
            <span>Sign in once here so the posting handoff is ready later.</span>
          </div>
          <div className="lc-schedule-login-actions">
            {(["tiktok", "instagram", "youtube"] as Platform[]).map((platform) => (
              <button
                key={platform}
                type="button"
                className="lc-schedule-login-btn"
                onClick={() => openBrowser(platformComposerUrl(platform), "read-only")}
              >
                {platformLabel(platform)}
                <ExternalLink size={12} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>

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
              onCancel={(j) => {
                // Ship-lens Batch 4 (Heading + touch sweep · 2026-07-06)
                // · confirm before cancelling · destructive (no undo,
                // removes the scheduled reminder from local storage).
                if (window.confirm(`Cancel this scheduled post?\n\nThe reminder for ${j.accountLabel ?? "this account"} will be removed.`)) {
                  void sched.cancelJob(j.id);
                }
              }}
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
    // Watchdog Rollout · mo-06 (2026-07-06) · calendar view of scheduled
    // posts. WeekStrip + DayColumnList render assisted-schedule rows
    // from localStorage via useSchedule (subscribes to
    // subscribeAssistedSchedule). A crash inside filter/day-grouping
    // renders KadeRepairScreen instead of taking out the whole route.
    <Watchdog
      id="money/mo-06/calendar-view"
      label="Schedule calendar view"
      cluster="money"
      source="src/design-os/routes/Schedule.tsx:ScheduleRoute"
    >
      <EngineSessionProvider resetOnRouteEnter>
        <ScheduleBody />
      </EngineSessionProvider>
    </Watchdog>
  );
}
