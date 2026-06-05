// Channel picker — single- or multi-select chips of the user's channels,
// grouped by platform. Used by PublishModal and (eventually) the calendar
// click-cell flow.
//
// For v1 of Schedule v2 we keep it single-select per call (one publish =
// one channel) since each Ayrshare profile fires its own request anyway.
// Multi-select for batch-publish is a follow-up.

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { PlatformIcon, type PlatformId } from "../PlatformIcon";
import { HudChip } from "../cockpit/HudChip";
import * as backend from "../../lib/backend";
import type { Channel } from "./types";

export function ChannelPicker({
  value,
  onChange,
  filterPlatform,
  disabled,
  onAddChannel,
}: {
  value: string | null;                   // selected channel_id
  onChange: (channelId: string | null) => void;
  /** Optional filter — only show channels for this platform. */
  filterPlatform?: string;
  disabled?: boolean;
  /** v0.6.39 — PublishModal passes this to surface a "+ Add channel"
   *  affordance inline so the user can link a new account without
   *  abandoning the publish flow. Accepted but not yet rendered (Round
   *  3 redesigned the picker chrome and didn't add the button — wire
   *  in a follow-up pass). Kept as a prop so the call site stays valid. */
  onAddChannel?: () => void;
}) {
  // Reference the prop once so noUnusedLocals is happy until the affordance
  // lands in a follow-up. The handler still flows through if a future
  // child element calls it.
  void onAddChannel;
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void backend.listChannels().then((cs) => {
      if (cancelled) return;
      const usable = cs.filter((c) => c.status === "active" || c.status === "pending_link");
      setChannels(usable);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!filterPlatform) return channels;
    return channels.filter((c) => c.platform === filterPlatform);
  }, [channels, filterPlatform]);

  const grouped = useMemo(() => {
    const out: Record<string, Channel[]> = {};
    for (const c of filtered) {
      (out[c.platform] ||= []).push(c);
    }
    return out;
  }, [filtered]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 font-mono text-[11px] text-text-tertiary">
        <Loader2 className="h-3 w-3 animate-spin" /> loading channels…
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="relative bg-transparent px-4 py-3 font-sans text-[12px] text-text-secondary">
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />
        No channels added yet. Open <strong>Schedule → Channels</strong> to add one.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {Object.entries(grouped).map(([platform, list]) => (
        <div key={platform} className="flex flex-col gap-2">
          <p className="font-mono text-[9px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
            {platform}
          </p>
          <div className="flex flex-wrap gap-2">
            {list.map((c) => (
              <ChannelChip
                key={c.id}
                channel={c}
                selected={value === c.id}
                onClick={() => onChange(value === c.id ? null : c.id)}
                disabled={disabled || c.status !== "active"}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ChannelChip({
  channel,
  selected,
  onClick,
  disabled,
}: {
  channel: Channel;
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  const id = ((channel.platform as string) === "twitter" ? "x" : channel.platform) as PlatformId;
  const known = ["youtube", "tiktok", "instagram", "x"].includes(id);
  return (
    <HudChip
      active={selected}
      onClick={onClick}
      disabled={disabled}
      title={channel.status === "pending_link" ? "Finish linking this channel before publishing" : channel.handle ?? channel.label}
      trailing={channel.status === "pending_link" ? (
        <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-[#F59E0B]">
          link
        </span>
      ) : undefined}
    >
      {known ? <PlatformIcon id={id} className="h-3 w-3" /> : (
        <span className="font-mono text-[9px]">{channel.platform[0]?.toUpperCase()}</span>
      )}
      <span className="truncate max-w-[140px] normal-case tracking-normal">{channel.label}</span>
    </HudChip>
  );
}
