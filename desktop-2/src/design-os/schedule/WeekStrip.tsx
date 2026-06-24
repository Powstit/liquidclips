/**
 * WeekStrip · Phase 6J-A
 *
 * Compact 7-day strip above the day-column list. Each cell shows the
 * weekday + day-of-month + a per-status dot row sized to the day's load.
 *
 * Click a cell to scroll the day-column list to it (the list owns
 * scroll · WeekStrip just emits the day-key).
 */

import type { ScheduledJob } from "../state/useSchedule";
import "./WeekStrip.css";

export interface WeekStripProps {
  jobsByDay: Readonly<Record<string, ScheduledJob[]>>;
  /** YYYY-MM-DD key of the day to highlight (today by default). */
  activeKey?: string;
  onPick: (dayKey: string) => void;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildWeek(): { key: string; date: Date }[] {
  const now = new Date();
  const day = now.getDay();
  const start = new Date(now);
  start.setDate(now.getDate() - day);
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i);
    return { key: dayKey(d), date: d };
  });
}

const WK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function WeekStrip({ jobsByDay, activeKey, onPick }: WeekStripProps) {
  const week = buildWeek();
  const todayKey = dayKey(new Date());

  return (
    <div className="lc-ws" role="tablist" aria-label="Week strip">
      {week.map(({ key, date }) => {
        const list = jobsByDay[key] ?? [];
        const counts = {
          scheduled: list.filter((j) => j.status === "scheduled").length,
          posted:    list.filter((j) => j.status === "posted").length,
          failed:    list.filter((j) => j.status === "failed").length,
          retrying:  list.filter((j) => j.status === "retrying").length,
          other:     list.filter((j) => j.status === "draft" || j.status === "uploading" || j.status === "cancelled").length,
        };
        const total = list.length;
        const isToday = key === todayKey;
        const isActive = key === activeKey;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`lc-ws-cell ${isToday ? "is-today" : ""} ${isActive ? "is-active" : ""}`}
            onClick={() => onPick(key)}
          >
            <span className="lc-ws-wk">{WK[date.getDay()]}</span>
            <span className="lc-ws-dom">{date.getDate()}</span>
            <span className="lc-ws-count" aria-label={`${total} jobs`}>
              {total}
            </span>
            <span className="lc-ws-dots" aria-hidden="true">
              {counts.scheduled > 0 && <span className="lc-ws-dot is-scheduled" />}
              {counts.posted    > 0 && <span className="lc-ws-dot is-posted" />}
              {counts.retrying  > 0 && <span className="lc-ws-dot is-retrying" />}
              {counts.failed    > 0 && <span className="lc-ws-dot is-failed" />}
              {counts.other     > 0 && <span className="lc-ws-dot is-other" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
