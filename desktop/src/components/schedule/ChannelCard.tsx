// Channel card — one per social handle on Channels sub-tab (Schedule v2).
//
// Shows status dot, label, handle, total-posts counter, and hover-actions
// (rename · refresh · pause · delete). Click rename opens an inline input.

import { useState } from "react";
import { Pause, Play, RefreshCw, Trash2, Loader2 } from "lucide-react";
import { PlatformIcon, type PlatformId } from "../PlatformIcon";
import type { Channel } from "./types";
import { prettyPlatform } from "./types";

const STATUS_STYLES: Record<Channel["status"], { dot: string; label: string }> = {
  active:       { dot: "bg-fuchsia",   label: "active" },
  pending_link: { dot: "bg-[#F59E0B]", label: "needs linking" },
  error:        { dot: "bg-[#DC2626]", label: "reconnect" },
  paused:       { dot: "bg-text-tertiary", label: "paused" },
  deleted:      { dot: "bg-text-tertiary", label: "deleted" },
};

export function ChannelCard({
  channel,
  onRename,
  onRefresh,
  onTogglePause,
  onDelete,
  onLinkNow,
}: {
  channel: Channel;
  onRename: (label: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onTogglePause: () => Promise<void>;
  onDelete: () => Promise<void>;
  onLinkNow: () => void;          // opens Tauri WebView via parent
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(channel.label);
  const [busy, setBusy] = useState(false);
  const statusStyle = STATUS_STYLES[channel.status];

  async function commitRename() {
    if (!draft.trim() || draft.trim() === channel.label) {
      setRenaming(false);
      setDraft(channel.label);
      return;
    }
    setBusy(true);
    try {
      await onRename(draft.trim());
      setRenaming(false);
    } finally {
      setBusy(false);
    }
  }

  const platformIconId =
    (["tiktok", "instagram", "youtube", "x"].includes(channel.platform)
      ? (channel.platform === "instagram" ? "instagram" : channel.platform)
      : null) as PlatformId | null;

  return (
    <div
      data-hot={channel.status === "active" ? "true" : "false"}
      className="library-card group relative flex flex-col gap-3 bg-transparent p-4"
    >
      <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-br" />
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink text-paper">
          {platformIconId ? (
            <PlatformIcon id={platformIconId} className="h-4 w-4" />
          ) : (
            <span className="font-mono text-[14px]">{channel.platform[0]?.toUpperCase()}</span>
          )}
        </span>
        <div className="flex-1 min-w-0">
          {renaming ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void commitRename()}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commitRename();
                if (e.key === "Escape") { setRenaming(false); setDraft(channel.label); }
              }}
              disabled={busy}
              className="w-full rounded-md border border-fuchsia bg-paper px-2 py-1 font-sans text-[14px] font-medium text-ink focus:outline-none"
            />
          ) : (
            <button
              onClick={() => setRenaming(true)}
              className="w-full truncate text-left font-sans text-[14px] font-medium text-ink hover:text-fuchsia-deep"
              title="Click to rename"
            >
              {channel.label}
            </button>
          )}
          <p className="mt-0.5 truncate font-mono text-[11px] text-text-tertiary">
            {channel.handle ?? prettyPlatform(channel.platform)}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-secondary">
          <span className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot}`} aria-hidden />
          {statusStyle.label}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
          {channel.total_posts} posts
        </span>
      </div>

      {/* Hover row of actions */}
      <div className="flex items-center justify-between pt-3 opacity-60 transition-opacity group-hover:opacity-100">
        <div className="flex items-center gap-1">
          <ActionButton
            label="refresh"
            icon={<RefreshCw className="h-3 w-3" />}
            onClick={async () => { setBusy(true); try { await onRefresh(); } finally { setBusy(false); } }}
            disabled={busy}
          />
          <ActionButton
            label={channel.status === "paused" ? "resume" : "pause"}
            icon={channel.status === "paused" ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            onClick={async () => { setBusy(true); try { await onTogglePause(); } finally { setBusy(false); } }}
            disabled={busy || channel.status === "deleted"}
          />
        </div>
        <button
          onClick={async () => {
            if (!confirm(`Delete "${channel.label}"? This soft-deletes — Ayrshare profile is preserved if you want to re-link later.`)) return;
            setBusy(true);
            try { await onDelete(); } finally { setBusy(false); }
          }}
          disabled={busy}
          className="rounded-md p-1.5 text-text-tertiary hover:bg-[#DC2626]/10 hover:text-[#DC2626] disabled:opacity-40"
          title="Delete channel"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
        </button>
      </div>

      {channel.status === "pending_link" && (
        <button
          onClick={onLinkNow}
          className="absolute inset-0 rounded-2xl bg-fuchsia/95 text-paper opacity-0 transition-opacity hover:opacity-100"
        >
          <span className="grid h-full place-items-center font-sans text-[13px] font-medium">
            Finish linking →
          </span>
        </button>
      )}
    </div>
  );
}

function ActionButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-secondary hover:bg-paper-elev hover:text-ink disabled:opacity-40"
    >
      {icon} {label}
    </button>
  );
}
