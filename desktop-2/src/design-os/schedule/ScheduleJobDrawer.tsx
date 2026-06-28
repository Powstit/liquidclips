/**
 * ScheduleJobDrawer · Phase 6J-A
 *
 * Opens when a ScheduleJobRow is clicked. Surfaces full job context +
 * reschedule / cancel / retry actions via the existing <Drawer> chrome.
 *
 * No real publishing yet. Real Ayrshare hooks land in a later phase.
 */

import { useEffect, useState } from "react";
import { Drawer, GlassCard } from "../components";
import { AccountChipState } from "../export/AccountChipState";
import type { TargetAccount } from "../export/types";
import type { ScheduledJob } from "../state/useSchedule";
import {
  platformLabel,
  startAssistedHandoff,
  type AssistedScheduleRecord,
} from "./assistedSchedule";
import "./ScheduleJobDrawer.css";

export interface ScheduleJobDrawerProps {
  job: ScheduledJob | null;
  open: boolean;
  onClose: () => void;
  onReschedule: (id: string, scheduledFor: string) => Promise<unknown>;
  onCancel: (id: string) => Promise<unknown>;
  onRetry: (id: string) => Promise<unknown>;
  hideBrand?: boolean;
}

function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

function jobToTargetAccount(j: ScheduledJob): TargetAccount {
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

export function ScheduleJobDrawer({
  job, open, onClose, onReschedule, onCancel, onRetry, hideBrand,
}: ScheduleJobDrawerProps) {
  const [localTime, setLocalTime] = useState<string>("");
  const [working, setWorking] = useState<"reschedule" | "cancel" | "retry" | "handoff" | null>(null);

  /* Reset the input every time the drawer opens on a new job so it shows
   * the job's actual scheduled time (not a stale value from a prior open). */
  useEffect(() => {
    if (open && job) setLocalTime(isoToLocalInput(job.scheduledFor));
    if (!open) setWorking(null);
  }, [open, job]);

  if (!job) {
    return (
      <Drawer
        open={false}
        onClose={onClose}
        eyebrow="Posting reminder"
        title=""
        width={460}
        id="schedule-job-drawer"
      >
        <div />
      </Drawer>
    );
  }

  const target = jobToTargetAccount(job);
  const isFuture = job.status === "scheduled" || job.status === "draft" || job.status === "retrying" || job.status === "uploading";
  const isFailed = job.status === "failed";
  const isCancelled = job.status === "cancelled";
  const dirty = !!job && localTime !== isoToLocalInput(job.scheduledFor);

  const handleReschedule = async () => {
    if (!dirty || working) return;
    setWorking("reschedule");
    const iso = new Date(localTime).toISOString();
    try {
      await onReschedule(job.id, iso);
    } finally {
      setWorking(null);
    }
  };

  const handleCancel = async () => {
    if (working) return;
    setWorking("cancel");
    try { await onCancel(job.id); } finally { setWorking(null); }
  };

  const handleRetry = async () => {
    if (working) return;
    setWorking("retry");
    try { await onRetry(job.id); } finally { setWorking(null); }
  };

  const handleHandoff = async () => {
    if (working || job.deliveryMode !== "assisted" || !job.outputPath) return;
    setWorking("handoff");
    try {
      await startAssistedHandoff(job as AssistedScheduleRecord);
    } finally {
      setWorking(null);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      dirty={dirty}
      onDirtyClose={onClose}
      eyebrow={job.deliveryMode === "assisted" ? "Assisted posting" : "Schedule"}
      title={job.clipTitle}
      width={460}
      id="schedule-job-drawer"
    >
      <div className="lc-sjd">
        {/* Account header */}
        <header className="lc-sjd-head">
          <AccountChipState account={target} variant="row" hideBrand={hideBrand} />
        </header>

        {/* Status line */}
        <div className={`lc-sjd-status is-${job.status}`}>
          <span className="lc-sjd-status-dot" aria-hidden="true" />
          <span className="lc-sjd-status-label">{job.status.toUpperCase()}</span>
          {job.retryCount > 0 && (
            <span className="lc-sjd-retry">Retry × {job.retryCount}</span>
          )}
        </div>

        {/* Failure card */}
        {isFailed && job.error && (
          <GlassCard density="default" className="lc-sjd-warn">
            <span className="lc-sjd-warn-eb">Last error</span>
            <span className="lc-sjd-warn-body">{job.error}</span>
          </GlassCard>
        )}

        {/* Posted card */}
        {job.status === "posted" && job.postUrl && (
          <GlassCard density="quiet" className="lc-sjd-posted">
            <span className="lc-sjd-posted-eb">Live</span>
            <a className="lc-sjd-posted-url" href={job.postUrl} target="_blank" rel="noopener noreferrer">
              {job.postUrl.replace(/^https?:\/\//, "")}
            </a>
          </GlassCard>
        )}

        {/* Clip + campaign context */}
        <GlassCard density="quiet" className="lc-sjd-ctx">
          <div className="lc-sjd-ctx-row">
            <span className="lc-sjd-ctx-key">Clip</span>
            <span className="lc-sjd-ctx-val">{job.clipTitle}</span>
          </div>
          <div className="lc-sjd-ctx-row">
            <span className="lc-sjd-ctx-key">Project</span>
            <span className="lc-sjd-ctx-val mono">{job.projectSlug}</span>
          </div>
          {job.campaignName && (
            <div className="lc-sjd-ctx-row">
              <span className="lc-sjd-ctx-key">Campaign</span>
              <span className="lc-sjd-ctx-val">{job.campaignName}</span>
            </div>
          )}
        </GlassCard>

        {/* Caption override · Phase 6J-D · labels the platform so users see
         *  which caption is attached to this job (per-target captions land
         *  with distinct copy per platform). */}
        {job.captionOverride && (
          <GlassCard density="quiet" className="lc-sjd-caption">
            <span className="lc-sjd-caption-eb">
              {job.platform === "x" ? "X" : job.platform[0].toUpperCase() + job.platform.slice(1)}
              {" "}caption
            </span>
            <p className="lc-sjd-caption-body">{job.captionOverride}</p>
          </GlassCard>
        )}

        {job.deliveryMode === "assisted" && job.outputPath && !isCancelled && (
          <GlassCard density="default" className="lc-sjd-handoff">
            <div className="lc-sjd-handoff-copy">
              <span className="lc-sjd-caption-eb">Assisted posting</span>
              <p className="lc-sjd-caption-body">
                Junior opens {platformLabel(job.platform)}, copies your caption,
                and reveals the video. You choose the file and press Post.
              </p>
            </div>
            <button
              type="button"
              className="lc-sjd-btn lc-sjd-btn-handoff"
              onClick={handleHandoff}
              disabled={working !== null}
            >
              {working === "handoff" ? "Preparing…" : `Open ${platformLabel(job.platform)} handoff`}
            </button>
          </GlassCard>
        )}

        {/* Reschedule control */}
        {!isCancelled && job.status !== "posted" && (
          <div className="lc-sjd-resched">
            <label htmlFor="lc-sjd-time" className="lc-sjd-resched-eb">
              {job.deliveryMode === "assisted" ? "Reminder time" : "Scheduled time"}
            </label>
            <input
              id="lc-sjd-time"
              type="datetime-local"
              className="lc-sjd-time-input"
              value={localTime}
              onChange={(e) => setLocalTime(e.target.value)}
              disabled={working !== null}
            />
            <button
              type="button"
              className="lc-sjd-btn"
              onClick={handleReschedule}
              disabled={!dirty || working !== null}
            >
              {working === "reschedule" ? "Saving…" : job.deliveryMode === "assisted" ? "Move reminder" : "Reschedule"}
            </button>
          </div>
        )}

        {/* Action footer */}
        <footer className="lc-sjd-foot">
          {isFailed && (
            <button
              type="button"
              className="lc-sjd-btn lc-sjd-btn-retry"
              onClick={handleRetry}
              disabled={working !== null}
            >
              {working === "retry" ? "Retrying…" : "Retry now"}
            </button>
          )}
          {isFuture && (
            <button
              type="button"
              className="lc-sjd-btn lc-sjd-btn-danger"
              onClick={handleCancel}
              disabled={working !== null}
            >
              {working === "cancel" ? "Cancelling…" : "Cancel job"}
            </button>
          )}
          {isCancelled && (
            <span className="lc-sjd-tag">Cancelled · history retained</span>
          )}
        </footer>
      </div>
    </Drawer>
  );
}
