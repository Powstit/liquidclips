// v0.7.32 — Resolution A: adopt the ch-row pattern from the Routes-modal
// mockup (docs/cockpit-handoffs-demo.html L460-471).
//
// Previously: chip-tile grid grouped by platform with a lucide-react glyph
// inside a colored disc. That shape was a defensible chooser for a modal but
// drifted from the mockup, which renders the SAME ch-row vocabulary in the
// Routes modal as in ChannelsManager:
//   status dot · brand glyph · channel.label · @handle (right-aligned) · pill toggle
//
// Picker semantics are still single-select (value: string | null) — that's
// the contract both call sites depend on (PublishModal:438 sets
// pickedChannelId; GridMasterToolbar:657 renders with value={null} as a
// status-aware empty-state visualisation only). The pill drives that
// single-select pick:
//   on  → value === channel.id (this channel is the routed pick)
//   off → value !== channel.id
// Tap the pill on an off-row → adopt that channel.id. Tap the pill on the
// on-row → clear the pick (null).
//
// Pause / resume / disconnect are NOT exposed in the picker (those live in
// ChannelRow inside ChannelsManager). The needs-attention banner remains so
// non-active rows still surface what's wrong and route to Channels.
//
// ship-lens v0.7.7 #7 (carried forward) — non-active rows render with a
// status microcopy + amber/red dot tone instead of silently dropping out.
// They're not selectable, but they're visible.
//
// Modal scroll: PublishModal (max-w-[640px]) and GridMasterToolbar popover
// don't constrain ChannelPicker height. With 8+ channels in a vertical list
// we cap the list at max-h-[360px] with overflow-y-auto so the modal footer
// stays reachable.

import { useMemo } from "react";
import { AlertTriangle, Plus } from "lucide-react";
import { PlatformBadge, type PlatformId } from "../PlatformBadge";
import { usePlatformConnections } from "../../lib/usePlatformConnections";
import type { Channel } from "./types";
import { isEffectivelyActive } from "./channelStatus";

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
   *  picker. Wired by PublishModal to close the modal and open Schedule
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
  // v0.7.78 — Read channels + Ayrshare connection state from the canonical
  // `usePlatformConnections` hook so ChannelPicker, Schedule, PublishModal,
  // and ClipReadyCard all share one source of truth.
  const { snapshot } = usePlatformConnections();
  const loading = snapshot.kind === "loading";
  const loadError = snapshot.kind === "error" ? snapshot.message : null;
  const channels = useMemo<Channel[]>(
    () => (snapshot.kind === "loaded" ? snapshot.channels.filter((c) => c.status !== "deleted") : []),
    [snapshot],
  );
  const ayrshareLinkedPlatforms = useMemo<readonly string[]>(
    () => (snapshot.kind === "loaded" ? snapshot.ayrshare?.platforms ?? [] : []),
    [snapshot],
  );
  const snapshotLoaded = snapshot.kind !== "loading";

  const filtered = useMemo(() => {
    if (!filterPlatform) return channels;
    return channels.filter((c) => c.platform === filterPlatform);
  }, [channels, filterPlatform]);

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (loadError) {
    // Distinct from the "no channels added yet" empty state — surface the
    // failure with a recovery path instead of pretending the user has zero
    // channels.
    return (
      <div className="flex flex-col items-start gap-3">
        <div className="error-banner items-start">
          <div className="flex flex-col gap-0.5">
            <p className="font-sans text-[13px] font-medium">
              Couldn&apos;t load channels — open <strong>Schedule → Channels</strong> to add one
            </p>
            <p className="font-mono text-[10px] opacity-80">
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
        <div className="empty-state">
          <p className="font-sans text-[13px] text-text-secondary">
            No channels added yet. Open <strong>Schedule → Channels</strong> to add one.
          </p>
        </div>
        {onAddChannel && <AddChannelButton onClick={onAddChannel} />}
      </div>
    );
  }

  // ship-lens v0.7.7 #7 — Count needs-attention channels so the picker can
  // render a single inline hint above the rows (e.g. "1 needs reconnecting")
  // — pure signal, no decoration.
  // v0.7.32 B2 — exclude rows the defensive Ayrshare override would treat
  // as effectively active, so the picker doesn't tell the user a channel
  // "needs attention" when the very next row renders it routable. Gated on
  // `snapshotLoaded` so we don't flash a high count on first render before
  // the snapshot resolves.
  const needsAttention = snapshotLoaded
    ? filtered.filter((c) => !isEffectivelyActive(c, ayrshareLinkedPlatforms)).length
    : 0;
  const manageHandler = onManageChannels ?? onAddChannel;

  return (
    <div className="flex flex-col gap-3">
      {needsAttention > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-fuchsia-deep/40 bg-fuchsia-deep/5 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-fuchsia-deep" />
          <div className="flex flex-col gap-0.5">
            <p className="font-sans text-[11px] font-medium text-fuchsia-deep">
              {needsAttention === 1
                ? "1 channel needs attention before it can publish"
                : `${needsAttention} channels need attention before they can publish`}
            </p>
            {manageHandler && (
              <button
                type="button"
                onClick={manageHandler}
                className="self-start font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep/90 underline-offset-2 hover:underline"
              >
                Open Schedule → Channels
              </button>
            )}
          </div>
        </div>
      )}
      <div className="flex max-h-[360px] flex-col gap-1.5 overflow-y-auto pr-1">
        {filtered.map((c) => (
          <ChannelPickRow
            key={c.id}
            channel={c}
            selected={value === c.id}
            onToggle={() => onChange(value === c.id ? null : c.id)}
            disabled={disabled || !isEffectivelyActive(c, ayrshareLinkedPlatforms)}
            ayrshareLinkedPlatforms={ayrshareLinkedPlatforms}
          />
        ))}
      </div>
      {onAddChannel && <AddChannelButton onClick={onAddChannel} />}
    </div>
  );
}

function AddChannelButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn-secondary mt-2 self-start border-dashed"
    >
      <Plus className="h-3 w-3" strokeWidth={2.25} />
      Add channel
    </button>
  );
}

// Status → tone mirrors ChannelRow.tsx so the two surfaces stay visually
// coherent. Picker doesn't expose pause/resume/link actions (those live in
// ChannelsManager); microcopy here only describes the row's current state so
// the user knows why it's disabled.
type StatusTone = "ok" | "warn" | "danger" | "muted";

function classifyStatus(channel: Channel): {
  tone: StatusTone;
  microcopy: string | null;
} {
  switch (channel.status) {
    case "active":
      return { tone: "ok", microcopy: null };
    case "paused":
      return { tone: "muted", microcopy: "Paused" };
    case "pending_link":
      return { tone: "warn", microcopy: "Finish linking" };
    case "unlinked":
      return { tone: "muted", microcopy: "Disconnected" };
    case "error":
      return { tone: "danger", microcopy: "Connection error" };
    case "deleted":
      // Filtered out before mount; mapping kept for switch exhaustiveness.
      return { tone: "muted", microcopy: "Removed" };
  }
}

const TONE_DOT: Record<StatusTone, string> = {
  ok: "bg-fuchsia shadow-[0_0_8px_rgba(255,26,140,0.7)]",
  warn: "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.7)]",
  danger: "bg-[var(--color-danger)] shadow-[0_0_8px_rgba(220,38,38,0.7)]",
  muted: "bg-text-tertiary",
};

const CHIP_BG: Record<StatusTone, string> = {
  ok: "",
  warn: "bg-amber-400/15",
  danger: "bg-[var(--color-danger)]/15",
  muted: "bg-paper-elev",
};

const CHIP_TEXT: Record<StatusTone, string> = {
  ok: "",
  warn: "text-amber-400",
  danger: "text-[var(--color-danger)]",
  muted: "text-text-secondary",
};

function toPlatformId(p: string): PlatformId | null {
  const lc = p.toLowerCase();
  if (lc === "twitter") return "x";
  if (["youtube", "tiktok", "instagram", "x", "linkedin", "facebook"].includes(lc)) {
    return lc as PlatformId;
  }
  return null;
}

function ChannelPickRow({
  channel,
  selected,
  onToggle,
  disabled,
  ayrshareLinkedPlatforms,
}: {
  channel: Channel;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
  /** v0.7.32 B2 — when Ayrshare reports the platform as linked, render
   *  this row as ok-tone with no microcopy regardless of the stale DB
   *  status, matching the upstream override in ChannelRow.tsx. */
  ayrshareLinkedPlatforms?: readonly string[];
}) {
  const effectivelyActive = isEffectivelyActive(channel, ayrshareLinkedPlatforms ?? []);
  const meta = effectivelyActive
    ? { tone: "ok" as StatusTone, microcopy: null }
    : classifyStatus(channel);
  const platformId = toPlatformId(channel.platform);
  const cleanedHandle = channel.handle
    ? channel.handle.replace(/^@+/, "").trim()
    : "";
  const displayHandle = cleanedHandle ? `@${cleanedHandle}` : channel.platform;
  // ON = this row is the routed pick. Disabled rows can never be on (they
  // can't be picked) so this just reflects `selected && !disabled`.
  const on = selected && !disabled;

  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${
        on
          ? "border-fuchsia bg-fuchsia-soft/20"
          : "border-line/40 bg-paper-elev/40"
      } ${disabled ? "opacity-60" : ""}`}
      title={
        channel.status === "error"
          ? "Reconnect in Schedule → Channels"
          : meta.microcopy ?? channel.handle ?? channel.label
      }
    >
      {/* status dot */}
      <span
        aria-hidden
        className={`inline-block h-2 w-2 shrink-0 rounded-full ${TONE_DOT[meta.tone]}`}
      />

      {/* brand glyph */}
      {platformId ? (
        <div className="shrink-0" style={{ marginLeft: -2 }}>
          <PlatformBadge platforms={[platformId]} size="sm" />
        </div>
      ) : (
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-ink font-mono text-[9px] text-paper">
          {channel.platform[0]?.toUpperCase()}
        </span>
      )}

      {/* label + handle / status chip */}
      <div className="flex min-w-0 flex-1 items-baseline gap-3">
        <span className="truncate font-sans text-[13px] font-medium text-ink">
          {channel.label}
        </span>
        {meta.microcopy ? (
          <span
            className={`ml-auto truncate rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] ${CHIP_BG[meta.tone]} ${CHIP_TEXT[meta.tone]}`}
          >
            {meta.microcopy}
          </span>
        ) : (
          <span className="ml-auto truncate font-mono text-[10px] tracking-[0.04em] text-text-tertiary">
            {displayHandle}
          </span>
        )}
      </div>

      {/* pill toggle — wires to the single-select onToggle from picker props.
          Disabled rows are non-interactive; the pill stays off and unresponsive. */}
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="relative h-[18px] w-[32px] shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          backgroundColor: on ? "var(--color-fuchsia)" : "rgba(255,255,255,0.08)",
        }}
        title={
          disabled
            ? meta.microcopy ?? "Channel not available"
            : on
              ? `Clear route — ${channel.label}`
              : `Route this clip to ${channel.label}`
        }
        aria-pressed={on}
        aria-label={
          on ? `Clear route for ${channel.label}` : `Route to ${channel.label}`
        }
      >
        <span
          aria-hidden
          className="absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-[left] duration-150"
          style={{ left: on ? 16 : 2 }}
        />
      </button>
    </div>
  );
}
