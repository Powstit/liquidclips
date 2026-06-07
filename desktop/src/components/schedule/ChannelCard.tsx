// Channel card — one per social handle on Channels sub-tab (Schedule v2).
//
// Shows status dot, label, handle, total-posts counter, and hover-actions
// (rename · refresh · pause · delete). Click rename opens an inline input.

import { useState } from "react";
import { BarChart3, Pause, Play, RefreshCw, Trash2, Loader2, Stethoscope } from "lucide-react";
import { PlatformIcon, type PlatformId } from "../PlatformIcon";
import type { Channel } from "./types";
import { prettyPlatform } from "./types";
import { diagnoseChannel, humanizeBackendError } from "../../lib/backend";

// ship-lens v0.7.8 P1 — `unlinked` added so the new status (platform-side
// revoke) lights up here too instead of falling back to `undefined` and
// blanking the status dot. Distinct copy from `pending_link` ("needs
// linking") because the user did finish OAuth once; the platform later
// revoked us.
const STATUS_STYLES: Record<Channel["status"], { dot: string; label: string }> = {
  active:       { dot: "bg-fuchsia",   label: "active" },
  pending_link: { dot: "bg-[#F59E0B]", label: "needs linking" },
  unlinked:     { dot: "bg-[#DC2626]", label: "disconnected — reconnect" },
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
  onOpenAnalytics,
}: {
  channel: Channel;
  onRename: (label: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onTogglePause: () => Promise<void>;
  onDelete: () => Promise<void>;
  onLinkNow: () => void;          // opens Tauri WebView via parent
  /** Analytics Phase 1 — when wired, the posts-count pill becomes a deep-link
   *  to Schedule → Analytics. Optional; falls back to plain text when the
   *  host doesn't pass it. */
  onOpenAnalytics?: (channelId: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(channel.label);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const statusStyle = STATUS_STYLES[channel.status];
  // Diagnose panel — only used on pending_link channels. `null` = panel closed,
  // string = inline result. Loading flips `diagnosing`.
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<string | null>(null);
  const [diagnoseError, setDiagnoseError] = useState<string | null>(null);

  async function runDiagnose() {
    setDiagnosing(true);
    setDiagnoseError(null);
    try {
      const result = await diagnoseChannel(channel.id);
      setDiagnosis(result.recommended_action);
    } catch (e) {
      setDiagnoseError(humanizeBackendError(e));
      setDiagnosis(null);
    } finally {
      setDiagnosing(false);
    }
  }

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
    } catch {
      // Parent surfaces the error in the banner; keep rename input open so
      // the user can correct or cancel.
    } finally {
      setBusy(false);
    }
  }

  // Wrap an async action so a rejection from the parent handler doesn't bubble
  // as an unhandled promise rejection AND doesn't leave the card stuck in
  // `busy`. The parent banner surfaces the error.
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch {
      /* error already surfaced by parent's setError */
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
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary">
            {channel.total_posts} posts
          </span>
          {/* Analytics Phase 1 — deep-link to Schedule → Analytics. TODO:
              pre-filter the analytics view by this channel.id once
              AnalyticsView accepts a `channelFilter` prop (see
              src/components/schedule/AnalyticsView.tsx:29 — would thread
              through SchedulePage:54 sub state). Today it just flips the
              tab so the user lands on the right surface; they can scan the
              channel row in the table themselves. */}
          {onOpenAnalytics && (
            <button
              type="button"
              onClick={() => onOpenAnalytics(channel.id)}
              className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary hover:text-fuchsia-deep"
              title="View analytics"
            >
              <BarChart3 className="h-3 w-3" />
              analytics →
            </button>
          )}
        </div>
      </div>

      {/* Hover row of actions — flips to inline confirm-delete mode when the
          user clicks the trash icon. Replaces the native window.confirm()
          which broke the cockpit aesthetic and trapped keyboard users. */}
      {confirmingDelete ? (
        <div className="flex items-center justify-between gap-2 pt-3">
          <p className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-secondary">
            delete this channel?
          </p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              disabled={busy}
              className="rounded-md border border-line bg-paper px-2.5 py-1 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-secondary hover:border-fuchsia/40 hover:text-ink disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                void run(async () => { await onDelete(); }).then(() => setConfirmingDelete(false));
              }}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-[#DC2626]/40 bg-[#DC2626]/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-[#DC2626] hover:bg-[#DC2626]/20 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              Confirm
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between pt-3 opacity-60 transition-opacity group-hover:opacity-100">
          <div className="flex items-center gap-1">
            <ActionButton
              label="refresh"
              icon={<RefreshCw className="h-3 w-3" />}
              onClick={() => void run(async () => { await onRefresh(); })}
              disabled={busy}
            />
            <ActionButton
              label={channel.status === "paused" ? "resume" : "pause"}
              icon={channel.status === "paused" ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
              onClick={() => void run(async () => { await onTogglePause(); })}
              disabled={busy || channel.status === "deleted"}
            />
          </div>
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            disabled={busy}
            className="rounded-md p-1.5 text-text-tertiary hover:bg-[#DC2626]/10 hover:text-[#DC2626] disabled:opacity-40"
            title="Delete channel"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          </button>
        </div>
      )}

      {channel.status === "pending_link" && (
        // Persistent "Finish linking" pill — was previously opacity-0 hover-only
        // which left keyboard + touch users with no way to discover the action.
        // The "Diagnose" link beside it probes the live Ayrshare + webhook state
        // so the user (or admin) can see WHY the link hasn't completed instead
        // of clicking "Finish linking" in a loop.
        <div className="absolute right-3 top-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void runDiagnose()}
            disabled={diagnosing}
            className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-secondary hover:text-fuchsia-deep disabled:opacity-40"
            title="Probe the channel's live link state"
          >
            {diagnosing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Stethoscope className="h-3 w-3" />}
            Diagnose
          </button>
          <button
            type="button"
            onClick={onLinkNow}
            className="inline-flex items-center gap-1 rounded-full bg-fuchsia px-3 py-1 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-paper shadow-[0_4px_12px_rgba(255,26,140,0.35)] hover:bg-fuchsia-bright focus:outline-none focus:ring-2 focus:ring-fuchsia/40"
          >
            Finish linking →
          </button>
        </div>
      )}

      {channel.status === "pending_link" && (diagnosis !== null || diagnoseError !== null) && (
        // Inline result panel — shows the backend's recommended_action plus a
        // "Refresh now" button that fires onRefresh (the parent's refreshChannel
        // wrapper) so the user can immediately retry without leaving the card.
        <div
          role="status"
          className="rounded-xl border border-fuchsia/30 bg-fuchsia/10 px-3 py-2"
        >
          {diagnoseError ? (
            <p className="font-sans text-[12px] text-[#DC2626]">{diagnoseError}</p>
          ) : (
            <p className="font-sans text-[12px] text-ink">{diagnosis}</p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void run(async () => { await onRefresh(); })}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-full border border-fuchsia/40 bg-paper px-2.5 py-1 font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-fuchsia hover:bg-fuchsia/10 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Refresh now
            </button>
            <button
              type="button"
              onClick={() => { setDiagnosis(null); setDiagnoseError(null); }}
              className="font-mono text-[10px] uppercase tracking-[var(--tracking-eyebrow)] text-text-tertiary hover:text-ink"
            >
              Dismiss
            </button>
          </div>
        </div>
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
