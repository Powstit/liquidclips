/**
 * ScheduleFilters · Phase 6J-A
 *
 * Compact filter chips above the week/list view. Each chip toggles which
 * jobs are visible in the list. Single selection · "all" is the default.
 *
 * Counts are derived from the live job list so users see at-a-glance load.
 */

import type { ScheduledJob } from "../state/useSchedule";
import "./ScheduleFilters.css";

export type ScheduleFilterKey =
  | "all"
  | "scheduled"
  | "posted"
  | "failed"
  | "retrying"
  | "today"
  | "week";

export interface ScheduleFiltersProps {
  active: ScheduleFilterKey;
  onChange: (k: ScheduleFilterKey) => void;
  jobs: ReadonlyArray<ScheduledJob>;
}

function isToday(iso: string): boolean {
  const d = new Date(iso); const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function isThisWeek(iso: string): boolean {
  const d = new Date(iso); const n = new Date();
  const day = n.getDay(); // 0 = Sunday
  const start = new Date(n); start.setDate(n.getDate() - day); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(start.getDate() + 7);
  return d >= start && d < end;
}

const FILTERS: { key: ScheduleFilterKey; label: string }[] = [
  { key: "all",       label: "All" },
  { key: "scheduled", label: "Scheduled" },
  { key: "posted",    label: "Posted" },
  { key: "failed",    label: "Failed" },
  { key: "retrying",  label: "Retrying" },
  { key: "today",     label: "Today" },
  { key: "week",      label: "This week" },
];

export function ScheduleFilters({ active, onChange, jobs }: ScheduleFiltersProps) {
  const count = (k: ScheduleFilterKey): number => {
    switch (k) {
      case "all":       return jobs.length;
      case "scheduled": return jobs.filter((j) => j.status === "scheduled").length;
      case "posted":    return jobs.filter((j) => j.status === "posted").length;
      case "failed":    return jobs.filter((j) => j.status === "failed").length;
      case "retrying":  return jobs.filter((j) => j.status === "retrying").length;
      case "today":     return jobs.filter((j) => isToday(j.scheduledFor)).length;
      case "week":      return jobs.filter((j) => isThisWeek(j.scheduledFor)).length;
    }
  };

  return (
    <div className="lc-sf" role="tablist" aria-label="Schedule filters">
      {FILTERS.map((f) => {
        const c = count(f.key);
        const isActive = active === f.key;
        return (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`lc-sf-chip is-${f.key} ${isActive ? "is-active" : ""}`}
            onClick={() => onChange(f.key)}
          >
            <span className="lc-sf-label">{f.label}</span>
            <span className="lc-sf-count">{c}</span>
          </button>
        );
      })}
    </div>
  );
}

export function applyScheduleFilter(
  jobs: ReadonlyArray<ScheduledJob>,
  filter: ScheduleFilterKey,
): ScheduledJob[] {
  switch (filter) {
    case "all":       return [...jobs];
    case "scheduled": return jobs.filter((j) => j.status === "scheduled");
    case "posted":    return jobs.filter((j) => j.status === "posted");
    case "failed":    return jobs.filter((j) => j.status === "failed");
    case "retrying":  return jobs.filter((j) => j.status === "retrying");
    case "today":     return jobs.filter((j) => isToday(j.scheduledFor));
    case "week":      return jobs.filter((j) => isThisWeek(j.scheduledFor));
  }
}
