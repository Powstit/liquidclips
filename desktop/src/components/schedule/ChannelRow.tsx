// v0.7.32 — ChannelRow.
//
// One row per linked channel. Mirrors the mockup `ch-row` pattern from
// docs/cockpit-handoffs-demo.html L150-160:
//   dot · platform glyph · name · handle (right-aligned) · toggle pill
//
// Replaces the 327-line ChannelCard library-card pattern. Same callbacks land
// (rename was the only one that doesn't survive the cut — click the label for
// the title rename surface in a future detail panel if we add one).
//
// Status semantics:
//   active       → toggle ON, fuchsia dot, handle = @handle
//   paused       → toggle OFF, dim dot,    handle = "paused"
//   pending_link → toggle OFF, amber dot,  handle = "finish linking → "
//   unlinked     → toggle OFF, amber dot,  handle = "disconnected · reconnect"
//   error        → toggle OFF, red dot,    handle = "reconnect"
//   deleted      → row hidden (manager filters before mount)
import { useEffect, useRef, useState } from "react";
import type { Channel } from "../../lib/backend";
import { PlatformBadge, type PlatformId } from "../PlatformBadge";
import { isEffectivelyActive } from "./channelStatus";

type StatusTone = "ok" | "warn" | "danger" | "muted";

type StatusMeta = {
  tone: StatusTone;
  microcopy: string | null;
  on: boolean;
  primaryAction: "toggle" | "link";
};

function classifyStatus(channel: Channel): StatusMeta {
  switch (channel.status) {
    case "active":
      return { tone: "ok", microcopy: null, on: true, primaryAction: "toggle" };
    case "paused":
      return { tone: "muted", microcopy: "paused", on: false, primaryAction: "toggle" };
    case "pending_link":
      return { tone: "warn", microcopy: "finish linking →", on: false, primaryAction: "link" };
    case "unlinked":
      return { tone: "warn", microcopy: "disconnected · reconnect", on: false, primaryAction: "link" };
    case "error":
      return { tone: "danger", microcopy: "reconnect", on: false, primaryAction: "link" };
    case "deleted":
      // Unreachable in practice — ChannelsManager.handleDelete (line ~232)
      // filters the deleted channel out of state before re-render, so a
      // `deleted` row never mounts. The mapping is here to keep the switch
      // exhaustive against the Channel.status enum union.
      return { tone: "muted", microcopy: "deleted", on: false, primaryAction: "toggle" };
  }
}

// v0.7.32 — defensive stale-status override. Backend reconcile_channels_against_ayrshare
// is the real self-heal (runs on every /sync). The UI keeps a belt-and-suspenders
// override so the user never sees a publishable channel as un-routable while
// the backend catches up. Shared with ChannelPicker via ./channelStatus.ts.
function classifyStatusWithAyrshareOverride(
  channel: Channel,
  ayrshareLinkedPlatforms: readonly string[],
): StatusMeta {
  const base = classifyStatus(channel);
  if (base.tone === "ok") return base;
  if (!isEffectivelyActive(channel, ayrshareLinkedPlatforms)) return base;
  return { tone: "ok", microcopy: null, on: true, primaryAction: "toggle" };
}

function toPlatformId(p: string): PlatformId | null {
  const lc = p.toLowerCase();
  if (lc === "twitter") return "x";
  if (["youtube", "tiktok", "instagram", "x", "linkedin", "facebook"].includes(lc)) {
    return lc as PlatformId;
  }
  return null;
}

const TONE_DOT: Record<StatusTone, string> = {
  ok: "bg-fuchsia shadow-[0_0_8px_rgba(255,26,140,0.7)]",
  warn: "bg-[#F59E0B] shadow-[0_0_8px_rgba(245,158,11,0.7)]",
  danger: "bg-[#DC2626] shadow-[0_0_8px_rgba(220,38,38,0.7)]",
  muted: "bg-text-tertiary",
};

const TONE_HANDLE: Record<StatusTone, string> = {
  ok: "text-text-tertiary",
  warn: "text-[#F59E0B]",
  danger: "text-[#DC2626]",
  muted: "text-text-tertiary",
};

export function ChannelRow({
  channel,
  onTogglePause,
  onLinkNow,
  onDelete,
  ayrshareLinkedPlatforms,
}: {
  channel: Channel;
  onTogglePause: () => Promise<void>;
  onLinkNow: () => void;
  onDelete: () => Promise<void>;
  /** v0.7.32 — defensive UI fallback. List of platforms the Ayrshare
   *  profile-level connection reports as linked. When the per-channel
   *  `status` is stale (pending_link / unlinked / error) but Ayrshare
   *  says the platform is linked, the row renders as ACTIVE. The real
   *  self-heal lives in backend reconcile_channels_against_ayrshare on
   *  every /sync; this override is the UI's belt-and-suspenders so the
   *  user never sees a publishable channel as un-routable. Optional —
   *  call sites without the snapshot just render the raw DB state. */
  ayrshareLinkedPlatforms?: readonly string[];
}) {
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // v0.7.32 — unmount-race guard. The toggle / delete RPCs can race the
  // parent re-render (ChannelsManager filters deleted/reordered channels
  // out of state). If the row unmounts mid-await, the trailing setBusy /
  // setConfirmingDelete would land on an unmounted component → React warn.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const meta = classifyStatusWithAyrshareOverride(channel, ayrshareLinkedPlatforms ?? []);
  const platformId = toPlatformId(channel.platform);
  // v0.7.32 — guard double-prefix in case the backend ever returns the handle
  // with a leading "@" (TikTok occasionally does this in their handle field).
  // Strip every leading "@" + trim whitespace; if the result is empty (e.g.
  // raw "@" or "   "), fall back to the platform label instead of rendering
  // a naked "@".
  const cleanedHandle = channel.handle
    ? channel.handle.replace(/^@+/, "").trim()
    : "";
  const displayHandle = cleanedHandle ? `@${cleanedHandle}` : channel.platform;

  async function handlePrimary() {
    if (busy) return;
    if (meta.primaryAction === "link") {
      onLinkNow();
      return;
    }
    setBusy(true);
    try {
      await onTogglePause();
    } catch {
      /* parent surfaces error */
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function handleConfirmDelete() {
    setBusy(true);
    try {
      await onDelete();
    } catch {
      /* parent surfaces error */
    } finally {
      if (mounted.current) {
        setBusy(false);
        setConfirmingDelete(false);
      }
    }
  }

  if (confirmingDelete) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-[#DC2626]/40 bg-[#DC2626]/8 px-3 py-2.5">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#DC2626]">
          Delete {channel.label}?
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setConfirmingDelete(false)}
            disabled={busy}
            className="rounded-full border border-line bg-paper-elev px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-secondary hover:text-ink disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleConfirmDelete()}
            disabled={busy}
            className="rounded-full border border-[#DC2626]/40 bg-[#DC2626]/12 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#DC2626] hover:bg-[#DC2626]/20 disabled:opacity-40"
          >
            {busy ? "deleting…" : "Confirm"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group flex items-center gap-3 rounded-md border px-3 py-2.5 transition-colors ${
        meta.on
          ? "border-fuchsia bg-fuchsia/[0.05]"
          : "border-line/60 bg-transparent hover:border-line"
      }`}
    >
      {/* status dot */}
      <span
        aria-hidden
        className={`inline-block h-2 w-2 shrink-0 rounded-full ${TONE_DOT[meta.tone]}`}
      />

      {/* brand glyph — uses the new PlatformBadge brand-glyph component at sm */}
      {platformId && (
        <div className="shrink-0" style={{ marginLeft: -2 }}>
          <PlatformBadge platforms={[platformId]} size="sm" />
        </div>
      )}

      {/* label + handle / microcopy */}
      <div className="flex min-w-0 flex-1 items-baseline gap-3">
        <span className="truncate font-sans text-[13px] font-medium text-ink">
          {channel.label}
        </span>
        <span
          className={`ml-auto truncate font-mono text-[10px] tracking-[0.04em] ${TONE_HANDLE[meta.tone]}`}
          title={meta.microcopy ?? displayHandle}
        >
          {meta.microcopy ?? displayHandle}
        </span>
      </div>

      {/* delete affordance — appears on hover, behind a confirm so a misclick
          on the trash icon doesn't silently nuke a working channel */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setConfirmingDelete(true);
        }}
        disabled={busy}
        className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-tertiary opacity-0 transition-opacity hover:bg-[#DC2626]/10 hover:text-[#DC2626] group-hover:flex group-hover:opacity-100"
        title={`Delete ${channel.label}`}
        aria-label={`Delete ${channel.label}`}
      >
        ×
      </button>

      {/* pill toggle — primary affordance */}
      <button
        type="button"
        onClick={() => void handlePrimary()}
        disabled={busy}
        className="relative h-[18px] w-[32px] shrink-0 rounded-full transition-colors disabled:opacity-40"
        style={{
          backgroundColor: meta.on ? "var(--color-fuchsia)" : "rgba(255,255,255,0.08)",
        }}
        title={
          meta.primaryAction === "link"
            ? `Open the linking flow for ${channel.label}`
            : meta.on
              ? `Pause ${channel.label}`
              : `Resume ${channel.label}`
        }
        aria-pressed={meta.on}
      >
        <span
          aria-hidden
          className="absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-[left] duration-150"
          style={{ left: meta.on ? 16 : 2 }}
        />
      </button>
    </div>
  );
}
