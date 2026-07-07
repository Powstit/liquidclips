/**
 * WhopRewardCard · Phase 6N-E v1
 *
 * Reusable read-only card showing the Whop reward snapshot. Used in:
 *   - Step 1 of the agency creation flow (preview after paste)
 *   - Step 8 review screen
 *   - CampaignPageShell new §2 reward section (clipper-facing)
 *
 * Honest about state · 10 reward states surfaced explicitly. Clipboard
 * copy on the reward id so the agency / clipper can hand it back to
 * Whop without retyping.
 */

import { useState } from "react";
import { GlassCard } from "../components";
import { bus } from "../bridge";
import type { WhopRewardSnapshot, WhopRewardSnapshotStatus, WhopRewardState } from "../engine/sidecar-stub";
import "./WhopRewardCard.css";

export interface WhopRewardCardProps {
  rewardId: string | null;
  rewardUrl?: string | null;
  rewardState: WhopRewardState;
  /** URL-first · separate enrichment outcome from reward state. */
  snapshotStatus?: WhopRewardSnapshotStatus;
  snapshot: WhopRewardSnapshot | null;
  syncedAt?: string | null;
  lastError?: string | null;
  onRefresh?: () => void;
  refreshing?: boolean;
  variant?: "compact" | "full";
}

// URL-first patch · "live / funded" copy is qualified with "via Whop
// snapshot" so the agency never confuses what we know directly vs what
// we pulled from the bonus enrichment fetch.
const STATE_LABEL: Record<WhopRewardState, string> = {
  unlinked: "Unlinked",
  pending_reward: "Pending reward",
  connected: "Connected · awaiting Whop",
  live: "Live · via Whop snapshot",
  funded: "Funded · via Whop snapshot",
  partially_funded: "Partial · via Whop snapshot",
  capacity_reached: "Capacity reached · via Whop snapshot",
  closed: "Closed · via Whop snapshot",
  unreachable: "Whop snapshot unavailable",
  not_visible: "No Whop snapshot",
  stale: "Refreshing…",
};

function fmtMoney(amount: number | undefined, currency: string | undefined): string {
  if (amount === undefined || amount === null) return "—";
  const cur = (currency ?? "USD").toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: cur,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${cur} ${amount.toFixed(0)}`;
  }
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diff = Date.now() - Date.parse(iso);
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export function WhopRewardCard({
  rewardId,
  rewardUrl,
  rewardState,
  snapshotStatus,
  snapshot,
  syncedAt,
  onRefresh,
  refreshing = false,
  variant = "full",
}: WhopRewardCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!rewardId) return;
    try {
      await navigator.clipboard.writeText(rewardId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      bus.emit("toast", { kind: "success", title: "Copied", body: `${rewardId} on your clipboard.` });
    } catch {
      bus.emit("toast", { kind: "error", title: "Couldn't copy", body: "Browser blocked clipboard access." });
    }
  };

  /* URL-first patch · no-enrichment empty state.
     Whop Clipping Rewards are URL-first. When the bonus enrichment
     fetch can't reach the snapshot we render a NEUTRAL state · NOT a
     failure. The URL is the source of truth · agency proceeds with
     manual brief. */
  if (rewardState === "unreachable" || rewardState === "not_visible" || snapshotStatus === "unreachable" || snapshotStatus === "not_enriched") {
    return (
      <GlassCard density="default" className={`lc-wrc lc-wrc-${rewardState}`}>
        <div className="lc-wrc-error">
          <span className={`lc-wrc-pill is-${rewardState}`}>{STATE_LABEL[rewardState]}</span>
          <p className="lc-wrc-error-body">
            {snapshotStatus === "unreachable" || rewardState === "unreachable"
              ? "Whop's reward snapshot is temporarily unavailable · no problem. Your URL is the source of truth · use the brief field below to mirror the Whop reward rules."
              : "No enrichment available for this Whop Clipping Reward · this is normal for URL-shareable rewards. Your URL is the source of truth · mirror the reward rules in the brief field."}
          </p>
          {rewardUrl && (
            <button
              type="button"
              className="lc-wrc-open-whop"
              onClick={() => bus.emit("browse:open", { url: rewardUrl, mirror: "whop" })}
            >
              Open Whop reward to copy rules ↗
            </button>
          )}
          {onRefresh && (
            <button type="button" className="lc-wrc-refresh" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? "Refreshing…" : "Try snapshot again"}
            </button>
          )}
        </div>
      </GlassCard>
    );
  }

  if (rewardState === "unlinked" || !snapshot) {
    return (
      <GlassCard density="quiet" className="lc-wrc lc-wrc-unlinked">
        <span className="lc-wrc-pill is-unlinked">Unlinked</span>
        <p className="lc-wrc-empty">No Whop reward URL pasted yet.</p>
      </GlassCard>
    );
  }

  return (
    <GlassCard density="default" className={`lc-wrc is-${variant} lc-wrc-${rewardState}`}>
      <header className="lc-wrc-head">
        <div className="lc-wrc-head-left">
          <span className={`lc-wrc-pill is-${rewardState}`}>{STATE_LABEL[rewardState]}</span>
          {snapshot.bountyType && (
            <span className="lc-wrc-meta">{snapshot.bountyType}</span>
          )}
          {snapshot.businessGoalType && (
            <span className="lc-wrc-meta">{snapshot.businessGoalType.replace(/_/g, " ")}</span>
          )}
        </div>
        {onRefresh && (
          <button type="button" className="lc-wrc-refresh-icon" onClick={onRefresh} disabled={refreshing} title="Refresh from Whop">
            {refreshing ? "↻" : "↻"}
          </button>
        )}
      </header>

      <h3 className="lc-wrc-title">{snapshot.title ?? "Whop reward"}</h3>

      {rewardId && (
        <div className="lc-wrc-id-row">
          <span className="lc-wrc-id-label">ID</span>
          <code className="lc-wrc-id-code">{rewardId}</code>
          <button
            type="button"
            className={`lc-wrc-copy ${copied ? "is-copied" : ""}`}
            onClick={handleCopy}
            title="Copy reward id"
            aria-label="Copy reward id to clipboard"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="3" y="3" width="9" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
              <rect x="5.5" y="0.7" width="9" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="rgba(8,8,14,.9)" />
            </svg>
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
      )}

      <div className="lc-wrc-stats">
        <Stat label="Payout per submission" value={fmtMoney(snapshot.baseUnitAmount, snapshot.currency)} />
        <Stat label="Pool" value={fmtMoney(snapshot.budgetAmount, snapshot.currency)} />
        <Stat label="Paid out" value={fmtMoney(snapshot.totalPaid, snapshot.currency)} />
        <Stat label="Spots remaining" value={String(snapshot.spotsRemaining ?? "—")} />
      </div>

      {variant === "full" && snapshot.description && (
        <p className="lc-wrc-desc">{snapshot.description}</p>
      )}

      <footer className="lc-wrc-foot">
        <span className="lc-wrc-synced">Snapshot from {relTime(syncedAt)}</span>
        <span className="lc-wrc-source">Whop URL · source of truth</span>
      </footer>
    </GlassCard>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="lc-wrc-stat">
      <span className="lc-wrc-stat-label">{label}</span>
      <span className="lc-wrc-stat-value">{value}</span>
    </div>
  );
}
