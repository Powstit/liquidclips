/**
 * DayColumnList · Phase 6J-A
 *
 * Renders the filtered job list grouped by day. Each day header is a
 * scroll anchor (data-day-key) so WeekStrip can scroll into view by key.
 *
 * Empty days are not rendered — week strip still shows them so the user
 * isn't blind to gaps.
 */

import type { ScheduledJob } from "../state/useSchedule";
import { ScheduleJobRow } from "./ScheduleJobRow";
import "./DayColumnList.css";

export interface DayColumnListProps {
  /** Map of YYYY-MM-DD → jobs sorted by scheduledFor asc. */
  jobsByDay: Readonly<Record<string, ScheduledJob[]>>;
  /** Days to render (in order). DerivedFilter passes only matching days. */
  dayKeys: string[];
  onOpen: (job: ScheduledJob) => void;
  onCancel: (job: ScheduledJob) => void;
  onRetry: (job: ScheduledJob) => void;
  hideBrand?: boolean;
}

function dayHeader(key: string): string {
  const [y, m, d] = key.split("-").map((n) => Number(n));
  const date = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((date.getTime() - today.getTime()) / (24 * 3600_000));
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export function DayColumnList({ jobsByDay, dayKeys, onOpen, onCancel, onRetry, hideBrand }: DayColumnListProps) {
  return (
    <div className="lc-dcl">
      {dayKeys.map((key) => {
        const list = jobsByDay[key] ?? [];
        if (list.length === 0) return null;
        return (
          <section key={key} className="lc-dcl-day" data-day-key={key}>
            <header className="lc-dcl-head">
              <span className="lc-dcl-day-label">{dayHeader(key)}</span>
              <span className="lc-dcl-day-count">{list.length} {list.length === 1 ? "post" : "posts"}</span>
            </header>
            <div className="lc-dcl-rows">
              {list.map((job) => (
                <ScheduleJobRow
                  key={job.id}
                  job={job}
                  hideBrand={hideBrand}
                  onOpen={() => onOpen(job)}
                  onCancel={() => onCancel(job)}
                  onRetry={() => onRetry(job)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
