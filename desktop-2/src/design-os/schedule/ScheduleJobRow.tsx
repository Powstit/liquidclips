/**
 * ScheduleJobRow · Phase 6J-A
 *
 * One row per scheduled job. Stays visual:
 *   - AccountChipState (chip variant) carries the account/platform context
 *   - clip title + optional campaign chip on one line
 *   - scheduled time pill + status dot + retry count if relevant
 *   - inline actions: edit time · cancel · retry
 *
 * Click anywhere on the row body opens ScheduleJobDrawer. Action buttons
 * stop propagation so the drawer doesn't fight a quick-action click.
 */

import { GlassCard } from "../components";
import { AccountChipState } from "../export/AccountChipState";
import type { TargetAccount } from "../export/types";
import type { ScheduledJob, ScheduledJobStatus } from "../state/useSchedule";
import "./ScheduleJobRow.css";

export interface ScheduleJobRowProps {
  job: ScheduledJob;
  /** Open the detail drawer. */
  onOpen: () => void;
  /** Quick-action callbacks (drawer reopens them too). */
  onCancel?: () => void;
  onRetry?: () => void;
  /** Whether the row should hide brand badges (Clipper). */
  hideBrand?: boolean;
}

const STATUS_LABEL: Record<ScheduledJobStatus, string> = {
  draft:     "Draft",
  scheduled: "Scheduled",
  uploading: "Uploading",
  posted:    "Posted",
  failed:    "Failed",
  retrying:  "Retrying",
  cancelled: "Cancelled",
};

function jobToTargetAccount(j: ScheduledJob): TargetAccount {
  /* Map job status into the AccountChipState state map so the chip's ring
   * matches the job's lifecycle without the row re-implementing it. */
  return {
    id: j.targetAccountIds[0] ?? `acct-${j.id}`,
    platform: j.platform,
    label: j.accountLabel,
    handle: j.accountHandle,
    state: j.status === "uploading" ? "uploading"
         : j.status === "failed"    ? "failed"
         : j.status === "scheduled" ? "scheduled"
         : j.status === "retrying"  ? "uploading"
         : "connected",
    scheduledFor: j.scheduledFor,
  };
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (sameDay) return `${hh}:${mm}`;
  const dayLabel = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return `${dayLabel} · ${hh}:${mm}`;
}

function relTime(iso: string): string {
  const diff = Date.parse(iso) - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return diff > 0 ? `in ${mins}m` : `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return diff > 0 ? `in ${hrs}h` : `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return diff > 0 ? `in ${days}d` : `${days}d ago`;
}

export function ScheduleJobRow({ job, onOpen, onCancel, onRetry, hideBrand }: ScheduleJobRowProps) {
  const target = jobToTargetAccount(job);
  const isFailed = job.status === "failed";
  const isRetrying = job.status === "retrying";
  const isCancelled = job.status === "cancelled";
  const isPosted = job.status === "posted";
  const isFuture = !isPosted && !isCancelled;

  return (
    <GlassCard density="default" className={`lc-sjr is-${job.status}`} hoverLift>
      <div
        className="lc-sjr-body"
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        aria-label={`Open scheduled job · ${job.clipTitle}`}
      >
        <div className="lc-sjr-left">
          <AccountChipState account={target} variant="chip" hideBrand={hideBrand} />
        </div>

        <div className="lc-sjr-mid">
          <div className="lc-sjr-title-row">
            <span className="lc-sjr-title">{job.clipTitle}</span>
            {job.campaignName && (
              <span className="lc-sjr-camp" title={`Campaign · ${job.campaignName}`}>
                {job.campaignName}
              </span>
            )}
          </div>
          <div className="lc-sjr-meta">
            <span className="lc-sjr-handle">{job.accountHandle}</span>
            <span className="lc-sjr-dot" aria-hidden="true">·</span>
            <span className="lc-sjr-time" title={new Date(job.scheduledFor).toISOString()}>
              {shortTime(job.scheduledFor)} · {relTime(job.scheduledFor)}
            </span>
          </div>
        </div>

        <div className="lc-sjr-right">
          <span className={`lc-sjr-status is-${job.status}`}>
            <span className="lc-sjr-status-dot" aria-hidden="true" />
            {STATUS_LABEL[job.status]}
          </span>
          {(isFailed || isRetrying) && job.retryCount > 0 && (
            <span className="lc-sjr-retry" title={job.error ?? "Retry counter"}>
              {isRetrying ? "Retry " : "x"}{job.retryCount}
            </span>
          )}
        </div>
      </div>

      <div className="lc-sjr-actions" onClick={(e) => e.stopPropagation()}>
        {isFuture && (
          <button type="button" className="lc-sjr-btn" onClick={onOpen} title="Edit scheduled time">
            Edit
          </button>
        )}
        {isFailed && onRetry && (
          <button type="button" className="lc-sjr-btn is-retry" onClick={onRetry} title="Retry now">
            Retry
          </button>
        )}
        {isFuture && onCancel && (
          <button type="button" className="lc-sjr-btn is-danger" onClick={onCancel} title="Cancel job">
            Cancel
          </button>
        )}
      </div>
    </GlassCard>
  );
}
