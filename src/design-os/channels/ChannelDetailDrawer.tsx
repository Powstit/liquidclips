/**
 * ChannelDetailDrawer · Phase 6I-C
 *
 * Opens when a ChannelTile is clicked. Right-side <Drawer>. Renders:
 *   - header row: AccountChipState (row variant) with platform · handle ·
 *     status · brand badge
 *   - status-detail line (e.g. "token expired 1d ago", "OAuth in flight")
 *   - 2-metric stat row: Last publish / This month
 *   - recent-posts list (newest first)
 *   - Refresh / Reconnect button (re-uses channels.refresh from 6I-A)
 *   - Disconnect CTA at the bottom that opens the <DisconnectConfirmDrawer>
 *
 * Reuses everything Phase 6H + 6I-A/B shipped. Zero new infra.
 */

import { useState } from "react";
import { Drawer, GlassCard } from "../components";
import { AccountChipState } from "../export/AccountChipState";
import { useChannels } from "../state/useChannels";
import {
  channelToTargetAccount,
  type SidecarChannel,
  type ChannelPost,
} from "../engine/sidecar-stub";
import { DisconnectConfirmDrawer } from "./DisconnectConfirmDrawer";
import { bus } from "../bridge";
import "./ChannelDetailDrawer.css";

export interface ChannelDetailDrawerProps {
  channel: SidecarChannel | null;
  open: boolean;
  onClose: () => void;
  /** When true (Clipper UI), suppress brand badge in the row header. */
  hideBrand?: boolean;
}

export function ChannelDetailDrawer({
  channel, open, onClose, hideBrand,
}: ChannelDetailDrawerProps) {
  const channels = useChannels();
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  if (!channel) {
    return (
      <Drawer
        open={open}
        onClose={onClose}
        eyebrow="Channel"
        title="Loading…"
        width={460}
        id="channel-detail-drawer"
      >
        <p className="lc-cdd-loading">Looking up channel…</p>
      </Drawer>
    );
  }

  const targetAccount = channelToTargetAccount(channel);
  const isExpired = channel.status === "expired";
  const isFailed = channel.status === "failed";
  const isPending = channel.status === "pending-link";

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await channels.refresh(channel.id);
    } finally {
      setRefreshing(false);
    }
  };

  const onDisconnectComplete = (ok: boolean) => {
    setDisconnectOpen(false);
    if (ok) onClose();
  };

  return (
    <>
      <Drawer
        open={open && !disconnectOpen}
        onClose={onClose}
        eyebrow="Channel"
        title={channel.label}
        width={460}
        id="channel-detail-drawer"
      >
        <div className="lc-cdd">
          {/* Header row · canonical AccountChipState */}
          <header className="lc-cdd-head">
            <AccountChipState
              account={targetAccount}
              variant="row"
              hideBrand={hideBrand}
            />
          </header>

          {/* Status detail line */}
          <StatusDetail channel={channel} />

          {/* 2-metric stat row */}
          <GlassCard density="quiet" className="lc-cdd-stats">
            <div className="lc-cdd-stat">
              <span className="lc-cdd-stat-eb">Last publish</span>
              <span className="lc-cdd-stat-v">
                {channel.lastPublishAt ? relTime(channel.lastPublishAt) : "—"}
              </span>
            </div>
            <div className="lc-cdd-stat">
              <span className="lc-cdd-stat-eb">This month</span>
              <span className="lc-cdd-stat-v">
                {channel.monthlyPostCount ?? 0}
                {(channel.monthlyPostCount ?? 0) === 1 ? " post" : " posts"}
              </span>
            </div>
          </GlassCard>

          {/* Token expiry warning */}
          {(isExpired || isFailed) && (
            <GlassCard density="default" className="lc-cdd-warn">
              <span className="lc-cdd-warn-eb">
                {isExpired ? "Token expired" : "Connection failed"}
              </span>
              <span className="lc-cdd-warn-body">
                {isExpired && channel.tokenExpiresAt
                  ? `Token expired ${relTime(channel.tokenExpiresAt)}. Re-link to keep publishing.`
                  : isFailed
                    ? "Last publish attempt failed · re-link or retry to restore connection."
                    : "Reconnect required."}
              </span>
            </GlassCard>
          )}

          {/* Pending-link · OAuth in flight */}
          {isPending && (
            <GlassCard density="default" className="lc-cdd-pending">
              <span className="lc-cdd-pending-eb">Linking</span>
              <span className="lc-cdd-pending-body">
                OAuth handshake in flight · waiting for webhook confirmation.
              </span>
            </GlassCard>
          )}

          {/* Recent posts */}
          <RecentPosts posts={channel.recentPosts ?? []} platform={channel.platform} />

          {/* Action row */}
          <footer className="lc-cdd-foot">
            <button
              type="button"
              className="lc-cdd-btn lc-cdd-btn-quiet"
              onClick={() => void onRefresh()}
              disabled={refreshing || isPending}
            >
              {refreshing
                ? "Refreshing…"
                : isExpired || isFailed
                  ? "Reconnect"
                  : "Refresh"}
            </button>
            <button
              type="button"
              className="lc-cdd-btn lc-cdd-btn-danger"
              onClick={() => setDisconnectOpen(true)}
              disabled={isPending}
            >
              Disconnect
            </button>
          </footer>
        </div>
      </Drawer>

      <DisconnectConfirmDrawer
        channel={channel}
        open={disconnectOpen}
        onResolve={onDisconnectComplete}
        onCancel={() => setDisconnectOpen(false)}
      />
    </>
  );
}

/* ============================================================
   Small helpers
   ============================================================ */

function StatusDetail({ channel }: { channel: SidecarChannel }) {
  let copy = "";
  switch (channel.status) {
    case "connected":   copy = `Connected · profileKey ${channel.ayrshareProfileKey ?? "—"}`; break;
    case "expired":     copy = `Expired · token expired ${channel.tokenExpiresAt ? relTime(channel.tokenExpiresAt) : "recently"}`; break;
    case "failed":      copy = "Failed · most recent publish errored out"; break;
    case "locked":      copy = "Locked · plan tier doesn't include this slot"; break;
    case "pending-link":copy = "Linking · OAuth handshake in flight"; break;
  }
  return (
    <p className="lc-cdd-status-detail">
      <span className={`lc-cdd-status-dot is-${channel.status}`} aria-hidden="true" />
      {copy}
    </p>
  );
}

function RecentPosts({ posts, platform }: { posts: ChannelPost[]; platform: string }) {
  if (posts.length === 0) {
    return (
      <GlassCard density="quiet" className="lc-cdd-posts">
        <header className="lc-cdd-posts-head">
          <span className="lc-cdd-posts-eb">Recent posts</span>
          <span className="lc-cdd-posts-sub">0</span>
        </header>
        <p className="lc-cdd-posts-empty">No recent posts on {platform}.</p>
      </GlassCard>
    );
  }
  return (
    <GlassCard density="quiet" className="lc-cdd-posts">
      <header className="lc-cdd-posts-head">
        <span className="lc-cdd-posts-eb">Recent posts</span>
        <span className="lc-cdd-posts-sub">{posts.length}</span>
      </header>
      <ul className="lc-cdd-posts-list">
        {posts.slice(0, 6).map((p) => (
          <li key={p.id} className={`lc-cdd-post is-${p.status}`}>
            <span className="lc-cdd-post-time">{relTime(p.ts)}</span>
            <span className="lc-cdd-post-title" title={p.title}>{p.title}</span>
            <span className="lc-cdd-post-status">{p.status}</span>
            {p.postUrl && (
              <button
                type="button"
                className="lc-cdd-post-link"
                onClick={() => bus.emit("toast", { kind: "info", title: "Post URL", body: p.postUrl! })}
                aria-label="Show post URL"
              >
                ↗
              </button>
            )}
            {p.error && <span className="lc-cdd-post-err" title={p.error}>{p.error}</span>}
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}

function relTime(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 0) {
      const fwd = -ms;
      if (fwd < 3600_000) return `in ${Math.floor(fwd / 60_000)}m`;
      if (fwd < 86_400_000) return `in ${Math.floor(fwd / 3600_000)}h`;
      return `in ${Math.floor(fwd / 86_400_000)}d`;
    }
    if (ms < 60_000) return "moments ago";
    if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3600_000)}h ago`;
    return `${Math.floor(ms / 86_400_000)}d ago`;
  } catch { return iso.slice(0, 10); }
}
