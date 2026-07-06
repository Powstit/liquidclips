/**
 * RewardClipDrawer · Phase 6L-D
 *
 * Read-only · the full reward-clip view. Aligned with the future Campaign
 * model:
 *   Campaign → Submission → Approval → Reward → Payout
 *
 * Each block in the drawer maps cleanly to one of those stages so when
 * Campaigns land in Phase 6N, the drawer slots in as
 * `<SubmissionDrawer>` without prop migration.
 *
 * Re-uses:
 *   - existing Drawer chrome
 *   - existing `/brand/reward/*` stamps for status
 *   - existing `/brand/leaderboard/badge-trophy.svg` for the paid badge
 */

import { Drawer, GlassCard } from "../components";
import { bus } from "../bridge";
import { useCampaigns } from "../state/useCampaigns";
import type { RewardClip, RewardClipStatus } from "./types";
// Watchdog Rollout · mo-09 + mo-19 (2026-07-06) · reward-clip statuses
// + first-touch tracking-link display. Both journeys render inside
// this drawer (status stamp + timeline for mo-09 · tracking link block
// for mo-19). A single wrap covers both subtrees per shared-component
// rule. See docs/PROTOCOL_SELF_HEALING_NODES.md.
import { Watchdog } from "../../lib/watchdog";

export interface RewardClipDrawerProps {
  clip: RewardClip | null;
  open: boolean;
  onClose: () => void;
  rpmUsd: number;
}

const STATUS_LABEL: Record<RewardClipStatus, string> = {
  draft:     "Draft",
  generated: "Draft · tracking link minted",
  submitted: "Pending review",
  approved:  "Approved · payout queued",
  denied:    "Rejected",
  paid:      "Paid · cleared",
};

const STATUS_STAMP: Record<RewardClipStatus, string | null> = {
  draft:     null,
  generated: null,
  submitted: "/brand/reward/stamp-needs-changes.svg",
  approved:  "/brand/reward/stamp-approved.svg",
  denied:    "/brand/reward/stamp-rejected.svg",
  paid:      "/brand/reward/stamp-payout.svg",
};

function fmtUsd(n: number): string {
  if (n >= 10000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

function shortIso(iso: string): string {
  try {
    const d = new Date(iso);
    const dateLabel = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${dateLabel} · ${hh}:${mm}`;
  } catch { return iso; }
}

interface TimelineStage {
  key: "created" | "submitted" | "approved" | "paid" | "denied";
  label: string;
  iso: string | null;
  active: boolean;
}

function buildTimeline(clip: RewardClip): TimelineStage[] {
  const stages: TimelineStage[] = [
    { key: "created",   label: "Created",           iso: clip.createdAt, active: true },
    { key: "submitted", label: "Submitted to Whop", iso: clip.whopSubmissionId ? clip.updatedAt : null, active: clip.status === "submitted" || clip.status === "approved" || clip.status === "paid" || clip.status === "denied" },
    { key: "approved",  label: "Approved",          iso: (clip.status === "approved" || clip.status === "paid") ? clip.updatedAt : null, active: clip.status === "approved" || clip.status === "paid" },
    { key: "paid",      label: "Paid",              iso: clip.status === "paid" ? clip.updatedAt : null, active: clip.status === "paid" },
  ];
  if (clip.status === "denied") {
    stages.push({ key: "denied", label: "Rejected", iso: clip.updatedAt, active: true });
  }
  return stages;
}

export function RewardClipDrawer({ clip, open, onClose, rpmUsd }: RewardClipDrawerProps) {
  const camps = useCampaigns();
  const linkedCampaign = clip?.campaignId ? camps.getById(clip.campaignId) : null;
  if (!clip) {
    return (
      <Drawer
        open={false}
        onClose={onClose}
        eyebrow="Submission"
        title=""
        width={480}
        id="reward-clip-drawer"
      >
        <div />
      </Drawer>
    );
  }

  const status = (clip.status ?? "draft") as RewardClipStatus;
  const stamp = STATUS_STAMP[status];
  const clicks = clip.trackingLink?.clickCount ?? 0;
  const earned = (clicks / 1000) * rpmUsd;
  const timeline = buildTimeline(clip);

  const handleOpenTracking = () => {
    if (!clip.trackingLink) return;
    bus.emit("browse:open", {
      url: clip.trackingLink.shortUrl,
      source: "earn",
      title: clip.whopRewardTitle ?? "Tracking link",
      mirror: "whop",
    });
  };

  return (
    <Watchdog
      id="money/mo-09/reward-clip-statuses"
      label="Reward-clip drawer (statuses + tracking link)"
      cluster="money"
      source="src/design-os/earn/RewardClipDrawer.tsx:RewardClipDrawer"
    >
      <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Submission"
      title={clip.whopRewardTitle ?? "Untitled reward"}
      width={480}
      id="reward-clip-drawer"
    >
      <div className="lc-rcd">
        {/* Hero · status stamp + status copy */}
        <header className={`lc-rcd-hero is-${status}`}>
          {stamp ? (
            <img src={stamp} alt="" className="lc-rcd-hero-stamp" />
          ) : (
            <span className="lc-rcd-hero-glyph" aria-hidden="true">⏱</span>
          )}
          <div className="lc-rcd-hero-text">
            <span className="lc-rcd-hero-eb">{STATUS_LABEL[status]}</span>
            <span className="lc-rcd-hero-money">{fmtUsd(earned)}</span>
            <span className="lc-rcd-hero-clicks">
              {clicks.toLocaleString()} clicks · {clip.trackingLink ? "tracked" : "no tracking link"}
            </span>
          </div>
        </header>

        {/* Campaign · platform · account context */}
        <GlassCard density="quiet" className="lc-rcd-ctx">
          <div className="lc-rcd-ctx-row">
            <span className="lc-rcd-ctx-k">Campaign</span>
            <span className="lc-rcd-ctx-v">
              {linkedCampaign
                ? `${linkedCampaign.title}`
                : clip.campaignId ?? "—"}
              {linkedCampaign && (
                <span className="lc-rcd-camp-slug"> · {linkedCampaign.slug}</span>
              )}
            </span>
          </div>
          <div className="lc-rcd-ctx-row">
            <span className="lc-rcd-ctx-k">Reward</span>
            <span className="lc-rcd-ctx-v">{clip.whopRewardTitle ?? "—"}</span>
          </div>
          <div className="lc-rcd-ctx-row">
            <span className="lc-rcd-ctx-k">Platform</span>
            <span className="lc-rcd-ctx-v">{clip.platform ?? "—"}</span>
          </div>
          <div className="lc-rcd-ctx-row">
            <span className="lc-rcd-ctx-k">Account</span>
            <span className="lc-rcd-ctx-v">{clip.accountLabel ?? "—"}</span>
          </div>
          <div className="lc-rcd-ctx-row">
            <span className="lc-rcd-ctx-k">Clip index</span>
            <span className="lc-rcd-ctx-v mono">#{clip.clipIdx}</span>
          </div>
          <div className="lc-rcd-ctx-row">
            <span className="lc-rcd-ctx-k">Whop submission</span>
            <span className="lc-rcd-ctx-v mono">{clip.whopSubmissionId ?? "—"}</span>
          </div>
        </GlassCard>

        {/* Tracking link */}
        {clip.trackingLink && (
          <GlassCard density="quiet" className="lc-rcd-tl">
            <span className="lc-rcd-tl-eb">Tracking link</span>
            <button
              type="button"
              className="lc-rcd-tl-url"
              onClick={handleOpenTracking}
              title="Open in browser"
            >
              {clip.trackingLink.shortUrl.replace(/^https?:\/\//, "")}
            </button>
            <div className="lc-rcd-tl-meta">
              <span>{clip.trackingLink.clickCount.toLocaleString()} clicks</span>
              <span className="lc-rcd-tl-dot" aria-hidden="true">·</span>
              <span>{clip.trackingLink.disabled ? "disabled" : "live"}</span>
            </div>
          </GlassCard>
        )}

        {/* Approval / payout timeline · approval history view */}
        <section className="lc-rcd-timeline-section">
          <span className="lc-rcd-timeline-eb">Approval history</span>
          <ol className="lc-rcd-timeline">
            {timeline.map((stage) => (
              <li key={stage.key} className={`lc-rcd-stage is-${stage.key} ${stage.active ? "is-active" : ""}`}>
                <span className="lc-rcd-stage-dot" aria-hidden="true" />
                <div className="lc-rcd-stage-mid">
                  <span className="lc-rcd-stage-label">{stage.label}</span>
                  <span className="lc-rcd-stage-time">
                    {stage.iso ? shortIso(stage.iso) : "—"}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Read-only notice · write paths land in 6L-D sub-step */}
        <GlassCard density="quiet" className="lc-rcd-readonly">
          <span className="lc-rcd-readonly-body">
            Read-only view · re-submit / patch lands in a later phase.
          </span>
        </GlassCard>

        {/* Close */}
        <footer className="lc-rcd-foot">
          <button type="button" className="lc-rcd-btn" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </Drawer>
    </Watchdog>
  );
}
