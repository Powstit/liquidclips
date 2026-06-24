/**
 * ChannelTile · Phase 6I-B
 *
 * One tile per connected channel. Composes the canonical AccountChipState
 * (variant="tile") with a small metrics row beneath it (last publish +
 * monthly post count). Brand badge is part of AccountChipState's tile
 * variant — no parallel implementation here.
 *
 * Reuses everything the Phase 6I-A foundation shipped:
 *   - useChannels / useTierCaps (caller decides what to pass)
 *   - AccountChipState as the only state→visual map
 *   - channelToTargetAccount adapter from sidecar-stub
 *
 * No OAuth. No disconnect confirmation. No connection-health panel.
 * Those land in later 6I-x steps.
 */

import { GlassCard } from "../components";
import { AccountChipState } from "../export/AccountChipState";
import { channelToTargetAccount, type SidecarChannel } from "../engine/sidecar-stub";
import "./ChannelTile.css";

export interface ChannelTileProps {
  channel: SidecarChannel;
  /** Optional click handler (e.g. open connection-health drawer in 6I-x). */
  onClick?: (channel: SidecarChannel) => void;
  /** When true (Clipper UI), hide brand badge on the chip. */
  hideBrand?: boolean;
}

export function ChannelTile({ channel, onClick, hideBrand }: ChannelTileProps) {
  const target = channelToTargetAccount(channel);

  return (
    <GlassCard density="default" className="lc-cht" hoverLift>
      <AccountChipState
        account={target}
        variant="tile"
        hideBrand={hideBrand}
        onClick={onClick ? () => onClick(channel) : undefined}
      />

      <footer className="lc-cht-foot">
        <div className="lc-cht-row">
          <span className="lc-cht-row-k">Last publish</span>
          <span className="lc-cht-row-v">
            {channel.lastPublishAt ? relTime(channel.lastPublishAt) : "—"}
          </span>
        </div>
        <div className="lc-cht-row">
          <span className="lc-cht-row-k">This month</span>
          <span className="lc-cht-row-v">
            {channel.monthlyPostCount ?? 0} {(channel.monthlyPostCount ?? 0) === 1 ? "post" : "posts"}
          </span>
        </div>
        {channel.tokenExpiresAt && channel.status === "expired" && (
          <div className="lc-cht-row lc-cht-row-warn">
            <span className="lc-cht-row-k">Token</span>
            <span className="lc-cht-row-v">expired {relTime(channel.tokenExpiresAt)}</span>
          </div>
        )}
      </footer>
    </GlassCard>
  );
}

function relTime(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 0) {
      const fwd = -ms;
      if (fwd < 3600_000) return `in ${Math.floor(fwd / 60_000)}m`;
      return `in ${Math.floor(fwd / 3600_000)}h`;
    }
    if (ms < 60_000) return "moments ago";
    if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3600_000)}h ago`;
    return `${Math.floor(ms / 86_400_000)}d ago`;
  } catch {
    return iso.slice(0, 10);
  }
}
