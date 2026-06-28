/**
 * ScheduleEmptyState · Phase 6J-A
 *
 * Rendered when filter or hook returns zero rows. Visual: GlassCard +
 * Kade-style instructional copy + single CTA pointing back to Channels.
 */

import { GlassCard } from "../components";
import "./ScheduleEmptyState.css";

export interface ScheduleEmptyStateProps {
  /** Filter label that produced the empty state (e.g. "Failed"). */
  filterLabel?: string;
  /** When non-null, the user has zero jobs at all (not a filter miss). */
  totalJobs?: number;
}

export function ScheduleEmptyState({ filterLabel, totalJobs }: ScheduleEmptyStateProps) {
  const isAllEmpty = (totalJobs ?? 0) === 0;
  return (
    <GlassCard density="quiet" className="lc-se">
      <span className="lc-se-eb">Nothing here yet</span>
      <h2 className="lc-se-h">
        {isAllEmpty
          ? "No posting reminders."
          : `No ${(filterLabel ?? "matching").toLowerCase()} jobs.`}
      </h2>
      <p className="lc-se-body">
        {isAllEmpty
          ? "Choose a rendered clip and set a time. Junior will notify you, copy the caption, reveal the video, and open the platform."
          : "Try a different filter, or schedule a fresh clip from Export."}
      </p>
    </GlassCard>
  );
}
