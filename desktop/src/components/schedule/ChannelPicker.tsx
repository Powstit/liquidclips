// ship-lens v0.7.7: fix #7 — surface error / expired / paused channels with a recovery hint instead of silently dropping them and rendering "No channels added yet."
//
// Channel picker — single- or multi-select chips of the user's channels,
// grouped by platform. Used by PublishModal and (eventually) the calendar
// click-cell flow.
//
// For v1 of Schedule v2 we keep it single-select per call (one publish =
// one channel) since each Ayrshare profile fires its own request anyway.
// Multi-select for batch-publish is a follow-up.

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Plus, RefreshCw, PauseCircle, Link2 } from "lucide-react";
import { PlatformIcon, type PlatformId } from "../PlatformIcon";
import * as backend from "../../lib/backend";
import { humanError } from "../../lib/sidecar";
import type { Channel } from "./types";

export function ChannelPicker({
  value,
  onChange,
  filterPlatform,
  disabled,
  onAddChannel,
  onManageChannels,
}: {
  value: string | null;                   // selected channel_id
  onChange: (channelId: string | null) => void;
  /** Optional filter — only show channels for this platform. */
  filterPlatform?: string;
  disabled?: boolean;
  /** Optional "+ Add channel" affordance — rendered at the bottom of the
   *  picker. Wired by PublishModal to close the modal and open Settings
   *  → Channels so the user can link a new account without abandoning the
   *  publish flow. */
  onAddChannel?: () => void;
  /** ship-lens v0.7.7 #7 — Route the user to the ChannelsManager surface
   *  when a non-active channel needs attention (reconnect after Ayrshare
   *  token expiry, resume after pause, finish OAuth on pending_link).
   *  Falls back to `onAddChannel` when not provided so existing callers
   *  keep working without code churn. */
  onManageChannels?: () => void;
}) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cs = await backend.listChannels();
        if (cancelled) return;
        // ship-lens v0.7.7 #7 — Keep every non-deleted channel. Active rows
        // are clickable; pending_link / error / paused rows render as
        // disabled chips with a recovery hint so the user knows the row
        // exists and what to do next, instead of seeing "No channels added
        // yet" when there are in fact several waiting on action.
        const visible = cs.filter((c) => c.status !== "deleted");
        setChannels(visible);
      } catch (e) {
        if (cancelled) return;
        setLoadError(humanError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
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

  if (loadError) {
    // Distinct from the "no channels added yet" empty state — surface the
    // failure with a recovery path instead of pretending the user has zero
    // channels.
    return (
      <div className="flex flex-col items-start gap-3">
        <div className="flex items-start gap-2 rounded-xl border border-[#DC2626]/40 bg-[#DC2626]/5 px-4 py-3">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#DC2626] mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <p className="font-sans text-[12px] font-medium text-[#DC2626]">
              Couldn't load channels — open <strong>Schedule → Loadout</strong> to add one
            </p>
            <p className="font-mono text-[10px] text-[#DC2626]/80">
              {loadError}
            </p>
          </div>
        </div>
        {onAddChannel && <AddChannelButton onClick={onAddChannel} />}
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="rounded-xl border border-dashed border-line bg-paper-warm/40 px-4 py-3 font-sans text-[12px] text-text-secondary">
          No channels added yet. Open <strong>Schedule → Channels</strong> to add one.
        </p>
        {onAddChannel && <AddChannelButton onClick={onAddChannel} />}
      </div>
    );
  }

  // ship-lens v0.7.7 #7 — Count needs-attention channels so the picker can
  // render a single inline hint above the chips (e.g. "1 needs reconnecting")
  // — pure signal, no decoration.
  const needsAttention = filtered.filter((c) => c.status !== "active").length;
  const manageHandler = onManageChannels ?? onAddChannel;

  return (
    <div className="flex flex-col gap-3">
      {needsAttention > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-[#F59E0B]/40 bg-[#F59E0B]/5 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-[#F59E0B]" />
          <div className="flex flex-col gap-0.5">
            <p className="font-sans text-[11px] font-medium text-[#F59E0B]">
              {needsAttention === 1
                ? "1 channel needs attention before it can publish"
                : `${needsAttention} channels need attention before they can publish`}
            </p>
            {manageHandler && (
              <button
                type="button"
                onClick={manageHandler}
                className="self-start font-mono text-[10px] uppercase tracking-[0.12em] text-[#F59E0B]/90 underline-offset-2 hover:underline"
              >
                Open Schedule → Channels
              </button>
            )}
          </div>
        </div>
      )}
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
      {onAddChannel && <AddChannelButton onClick={onAddChannel} />}
    </div>
  );
}

function AddChannelButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 inline-flex items-center gap-1.5 self-start rounded-full border border-dashed border-fuchsia/40 bg-transparent px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia transition-colors hover:border-fuchsia hover:text-fuchsia-bright"
    >
      <Plus className="h-3 w-3" strokeWidth={2.25} />
      Add channel
    </button>
  );
}

/** ship-lens v0.7.7 #7 — Per-status copy + icon shown on disabled chips. The
 *  "active" branch is rendered without any badge so the happy-path chip stays
 *  visually quiet. */
type ChipState =
  | { kind: "active" }
  | { kind: "pending"; label: string; tooltip: string }
  | { kind: "reconnect"; label: string; tooltip: string }
  | { kind: "paused"; label: string; tooltip: string }
  | { kind: "unknown"; label: string; tooltip: string };

function chipStateFor(status: Channel["status"]): ChipState {
  switch (status) {
    case "active":
      return { kind: "active" };
    case "pending_link":
      return {
        kind: "pending",
        label: "link",
        tooltip: "Finish linking this channel before publishing",
      };
    case "error":
      return {
        kind: "reconnect",
        label: "reconnect",
        tooltip: "This channel needs to be reconnected — open Schedule → Channels",
      };
    case "paused":
      return {
        kind: "paused",
        label: "paused",
        tooltip: "Paused — resume in Schedule → Channels before publishing",
      };
    default:
      return {
        kind: "unknown",
        label: status,
        tooltip: `Status: ${status}`,
      };
  }
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
  const state = chipStateFor(channel.status);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={state.kind === "active" ? channel.handle ?? channel.label : state.tooltip}
      className={`group inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-sans text-[12px] font-medium transition-colors ${
        selected
          ? "border-fuchsia bg-fuchsia text-paper"
          : "border-line bg-paper text-ink hover:border-fuchsia/50"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <span className={`grid h-5 w-5 place-items-center rounded-full ${selected ? "bg-paper text-fuchsia" : "bg-ink text-paper"}`}>
        {known ? <PlatformIcon id={id} className="h-2.5 w-2.5" /> : (
          <span className="font-mono text-[9px]">{channel.platform[0]?.toUpperCase()}</span>
        )}
      </span>
      <span className="truncate max-w-[140px]">{channel.label}</span>
      {state.kind === "pending" && (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#F59E0B]/20 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.08em] text-[#F59E0B]">
          <Link2 className="h-2.5 w-2.5" strokeWidth={2.5} />
          {state.label}
        </span>
      )}
      {state.kind === "reconnect" && (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#DC2626]/20 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.08em] text-[#DC2626]">
          <RefreshCw className="h-2.5 w-2.5" strokeWidth={2.5} />
          {state.label}
        </span>
      )}
      {state.kind === "paused" && (
        <span className="inline-flex items-center gap-1 rounded-full bg-text-tertiary/20 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.08em] text-text-tertiary">
          <PauseCircle className="h-2.5 w-2.5" strokeWidth={2.5} />
          {state.label}
        </span>
      )}
      {state.kind === "unknown" && (
        <span className="rounded-full bg-text-tertiary/20 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.08em] text-text-tertiary">
          {state.label}
        </span>
      )}
    </button>
  );
}
