/**
 * RewardClipRow · Phase 6L-D
 *
 * One row per reward clip / submission. Compact visual chrome — leans on
 * existing brand stamps (`/brand/reward/stamp-*.svg`) for status so we
 * stay aligned with the Phase 6M-A audit recommendation: reuse existing
 * art, don't generate.
 */

import { GlassCard } from "../components";
import type { RewardClip, RewardClipStatus } from "./types";
import "./RewardClipRow.css";

export interface RewardClipRowProps {
  clip: RewardClip;
  onOpen: () => void;
  rpmUsd: number;
}

const STATUS_LABEL: Record<RewardClipStatus, string> = {
  draft:     "Draft",
  generated: "Draft · link minted",
  submitted: "Pending review",
  approved:  "Approved",
  denied:    "Rejected",
  paid:      "Paid",
};

/* Map every status to a shipped `/brand/reward/` stamp · no new art. */
const STATUS_STAMP: Record<RewardClipStatus, string | null> = {
  draft:     null,
  generated: null,
  submitted: "/brand/reward/stamp-needs-changes.svg",
  approved:  "/brand/reward/stamp-approved.svg",
  denied:    "/brand/reward/stamp-rejected.svg",
  paid:      "/brand/reward/stamp-payout.svg",
};

function relTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function fmtUsd(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

export function RewardClipRow({ clip, onOpen, rpmUsd }: RewardClipRowProps) {
  const status = (clip.status ?? "draft") as RewardClipStatus;
  const stamp = STATUS_STAMP[status];
  const clicks = clip.trackingLink?.clickCount ?? 0;
  const earned = (clicks / 1000) * rpmUsd;

  return (
    <GlassCard density="default" className={`lc-rcr is-${status}`} hoverLift>
      <div
        className="lc-rcr-body"
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        aria-label={`Open submission · ${clip.whopRewardTitle ?? clip.whopRewardId}`}
      >
        <div className="lc-rcr-stamp-wrap" aria-hidden="true">
          {stamp ? (
            <img src={stamp} alt="" className="lc-rcr-stamp" />
          ) : (
            <span className="lc-rcr-stamp-placeholder">—</span>
          )}
        </div>

        <div className="lc-rcr-mid">
          <div className="lc-rcr-title-row">
            <span className="lc-rcr-title">
              {clip.whopRewardTitle ?? "Untitled reward"}
            </span>
            {clip.campaignId && (
              <span className="lc-rcr-camp" title={`Campaign · ${clip.campaignId}`}>
                {clip.campaignId}
              </span>
            )}
          </div>
          <div className="lc-rcr-meta">
            {clip.platform && (
              <span className="lc-rcr-platform">{clip.platform.toUpperCase()}</span>
            )}
            {clip.accountLabel && (
              <>
                <span className="lc-rcr-dot" aria-hidden="true">·</span>
                <span className="lc-rcr-handle">{clip.accountLabel}</span>
              </>
            )}
            <span className="lc-rcr-dot" aria-hidden="true">·</span>
            <span className="lc-rcr-time">{relTime(clip.updatedAt)}</span>
          </div>
        </div>

        <div className="lc-rcr-right">
          <span className={`lc-rcr-status is-${status}`}>{STATUS_LABEL[status]}</span>
          <span className="lc-rcr-numbers">
            <span className="lc-rcr-clicks">{clicks.toLocaleString()} clicks</span>
            <span className="lc-rcr-earned">{fmtUsd(earned)}</span>
            {/* UX-4 · Whop attribution per row · keeps the boundary visible
                anywhere money is shown. */}
            <span className="lc-rcr-via">via Whop</span>
          </span>
        </div>
      </div>
    </GlassCard>
  );
}
