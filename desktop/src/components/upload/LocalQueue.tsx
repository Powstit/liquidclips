import { useCallback, useEffect, useMemo, useState } from "react";
import { useVisibilityInterval } from "../../lib/useVisibilityInterval";
import { openSmart as openExternal } from "../../lib/openSmart";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { relaunch } from "@tauri-apps/plugin-process";
import { AlertTriangle, Clock, Send, X, CheckCircle2, ExternalLink, Copy, RefreshCw } from "lucide-react";
import { sidecar, humanError, type LocalScheduleItem } from "../../lib/sidecar";
import { PlatformIcon, type PlatformId } from "../PlatformIcon";
import { HudChip } from "../cockpit/HudChip";

// 6 hours past scheduled_for + still pending = the sidecar most likely missed
// the reminder window (laptop asleep, app closed). Surface these explicitly
// so they don't hide silently inside "Due now."
const MISSED_REMINDER_THRESHOLD_MS = 6 * 60 * 60 * 1000;

// Heuristic: an RPC rejection that mentions sidecar/spawn/EPIPE/ENOENT is the
// helper-not-running case, not a transient list failure. We surface a
// distinct restart affordance instead of pretending the queue is unreadable.
function isSidecarDown(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("sidecar") ||
    msg.includes("spawn") ||
    msg.includes("epipe") ||
    msg.includes("enoent") ||
    msg.includes("not running") ||
    msg.includes("not ready") ||
    msg.includes("connection refused")
  );
}

// Web composer URLs per platform. Liquid Clips copies the caption to the user's
// clipboard and opens the platform's upload/composer page in the browser —
// the user pastes + posts manually. This is the "Liquid Clips reminds, you post"
// product position: no auth tokens, no posting API, runs offline.
//
// Notes:
//   • Instagram has no public web composer URL — instagram.com lands on
//     the feed, where the user clicks the create button themselves. Still
//     better than nothing.
//   • YouTube uses the full uploader (not Shorts-specific) — short videos
//     auto-detect as Shorts when they meet the requirements.
const COMPOSER_URL: Record<string, string> = {
  youtube: "https://www.youtube.com/upload",
  tiktok: "https://www.tiktok.com/upload",
  instagram: "https://www.instagram.com/",
  x: "https://x.com/compose/post",
};

const PLATFORM_LABEL: Record<string, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  x: "X",
};

function whenAbsolute(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  });
}

function whenRelative(iso: string): string {
  const due = new Date(iso).getTime();
  const now = Date.now();
  const diff = due - now;
  const past = diff < 0;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60_000);
  if (mins < 1) return past ? "just now" : "in <1 min";
  if (mins < 60) return past ? `${mins} min ago` : `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return past ? `${hours} hr ago` : `in ${hours} hr`;
  const days = Math.round(hours / 24);
  return past ? `${days}d ago` : `in ${days}d`;
}

/**
 * Local-schedule list — the home of "Assisted Autopost." Pulls from the
 * sidecar's $CLIPS_HOME/.schedule.json store, groups items by status
 * (Due now → Upcoming → Posted), and gives each pending item a one-click
 * "copy caption, open platform" affordance.
 *
 * No backend, no Postiz; runs offline. The 30s refresh tick is enough — the
 * sidecar is the only writer, so we never race ourselves.
 */
type ToastState = { kind: "error" | "info"; message: string } | null;

export function LocalQueue() {
  const [items, setItems] = useState<LocalScheduleItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidecarDown, setSidecarDown] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Inline transient feedback (clipboard failure, openExternal failure, action
  // errors). Auto-dismiss after 6s so it doesn't pile up.
  const [toast, setToastState] = useState<ToastState>(null);
  // Pending inline "are you sure?" for cancel — replaces native confirm().
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  // Captions surfaced as selectable text when clipboard.writeText fails — the
  // user can long-press / triple-click to copy manually.
  const [exposedCaption, setExposedCaption] = useState<{
    id: string;
    caption: string;
  } | null>(null);
  // Track per-action retry copy on missed-reminder rows.
  const [retryHintId, setRetryHintId] = useState<string | null>(null);

  function setToast(t: ToastState) {
    setToastState(t);
    if (t) {
      window.setTimeout(() => setToastState((cur) => (cur === t ? null : cur)), 6000);
    }
  }

  const load = useCallback(async () => {
    try {
      const { items } = await sidecar.localScheduleList();
      setItems(items);
      setError(null);
      setSidecarDown(false);
    } catch (e) {
      if (isSidecarDown(e)) {
        // Distinct "helper isn't running" state — restart is the recovery.
        setSidecarDown(true);
        setError(null);
      } else {
        setError(humanError(e));
        setSidecarDown(false);
      }
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  // v0.7.48 — Visibility-aware polling: pauses in background tabs.
  useVisibilityInterval(() => void load(), 30_000);

  const groups = useMemo(() => groupByStatus(items ?? []), [items]);

  async function copyAndOpen(item: LocalScheduleItem) {
    setBusyId(item.id);
    setRetryHintId(null);
    try {
      const caption = item.caption || item.clip_title;
      if (caption) {
        try {
          await writeText(caption);
          // Clear any prior exposed-caption state for this row on success.
          setExposedCaption((cur) => (cur?.id === item.id ? null : cur));
        } catch (e) {
          console.warn("clipboard write failed:", e);
          // The user needs the caption — surface it inline as selectable
          // text so they can copy it by hand. Don't pretend it worked.
          setExposedCaption({ id: item.id, caption });
          setToast({
            kind: "error",
            message: "Couldn't copy caption — long-press the text below to select.",
          });
        }
      }
      const url = COMPOSER_URL[item.platform] ?? null;
      if (url) {
        try {
          await openExternal(url);
        } catch (e) {
          // Browser launch failure (sandbox denial, no default browser, etc.)
          // is silent on macOS otherwise — the user clicks and nothing happens.
          setToast({
            kind: "error",
            message: `Couldn't open ${PLATFORM_LABEL[item.platform] ?? item.platform} — ${humanError(e)}`,
          });
        }
      }
    } finally {
      setBusyId(null);
    }
  }

  async function markPosted(item: LocalScheduleItem) {
    setBusyId(item.id);
    try {
      await sidecar.localScheduleMarkPosted(item.id);
      await load();
    } catch (e) {
      setRetryHintId(item.id);
      setToast({ kind: "error", message: `Couldn't mark posted — ${humanError(e)}` });
    } finally {
      setBusyId(null);
    }
  }

  async function confirmCancel(item: LocalScheduleItem) {
    setBusyId(item.id);
    try {
      await sidecar.localScheduleCancel(item.id);
      setConfirmCancelId(null);
      await load();
    } catch (e) {
      setRetryHintId(item.id);
      setToast({ kind: "error", message: `Couldn't cancel reminder — ${humanError(e)}` });
    } finally {
      setBusyId(null);
    }
  }

  function requestCancel(item: LocalScheduleItem) {
    // Inline confirm — replaces native confirm() which is a modal trap on
    // some setups and not styleable.
    setConfirmCancelId(item.id);
  }

  async function remove(item: LocalScheduleItem) {
    setBusyId(item.id);
    try {
      await sidecar.localScheduleRemove(item.id);
      await load();
    } catch (e) {
      setRetryHintId(item.id);
      setToast({ kind: "error", message: `Couldn't remove row — ${humanError(e)}` });
    } finally {
      setBusyId(null);
    }
  }

  async function handleRestart() {
    try {
      await relaunch();
    } catch (e) {
      setToast({
        kind: "error",
        message: `Couldn't restart automatically — quit and reopen Liquid Clips manually. (${humanError(e)})`,
      });
    }
  }

  if (sidecarDown) {
    return (
      <div className="relative flex flex-col gap-3 bg-transparent p-4 text-text-secondary">
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia-deep">
          <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.25} />
          helper not running
        </div>
        <p className="font-sans text-[13px] leading-snug text-ink">
          Liquid Clips helper isn&rsquo;t running yet &mdash; your reminders are safe but can&rsquo;t be shown here.
          Restart Liquid Clips.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleRestart()}
            className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-4 py-2 font-sans text-[12px] font-medium text-paper hover:bg-fuchsia-bright"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.25} />
            Restart Liquid Clips
          </button>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-2 font-sans text-[12px] font-medium text-text-secondary hover:text-ink"
          >
            Try again
          </button>
        </div>
        {toast && (
          <p
            className={`mt-1 font-mono text-[11px] ${
              toast.kind === "error" ? "text-[var(--color-danger)]" : "text-text-secondary"
            }`}
          >
            {toast.message}
          </p>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className="relative flex flex-col gap-3 bg-transparent p-4 font-mono text-[12px] text-text-secondary">
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />
        <span>Couldn&rsquo;t read the local schedule &mdash; {error}</span>
        <button
          onClick={() => void load()}
          className="inline-flex w-fit items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 font-sans text-[12px] font-medium text-text-secondary hover:text-ink"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
          Retry
        </button>
      </div>
    );
  }

  if (items === null) {
    return (
      <p className="font-mono text-[12px] text-text-tertiary">
        Reading local queue<span className="blink">_</span>
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <div className="relative bg-transparent px-5 py-8 text-center">
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
          nothing scheduled locally yet
        </p>
        <p className="mt-2 max-w-[420px] mx-auto font-sans text-[13px] text-text-secondary">
          From a finished Workspace project, hit{" "}
          <span className="font-medium text-ink">Drip across ▾</span> to fill this with optimally-timed
          reminders. Liquid Clips tells you when to post, you keep control of the actual post.
        </p>
      </div>
    );
  }

  const rowProps = {
    busyId,
    confirmCancelId,
    exposedCaptionId: exposedCaption?.id ?? null,
    exposedCaption: exposedCaption?.caption ?? null,
    retryHintId,
    onCopyOpen: copyAndOpen,
    onMarkPosted: markPosted,
    onRequestCancel: requestCancel,
    onConfirmCancel: confirmCancel,
    onAbortCancel: () => setConfirmCancelId(null),
    onRemove: remove,
    onRetry: (item: LocalScheduleItem) => {
      // Generic retry: re-run load. Per-action retries are usually transient
      // (sidecar JSON-RPC stutter) so a single load() refresh + clear of the
      // hint is enough.
      setRetryHintId(null);
      void load();
      // Quieten the warning if it was only about this row.
      if (busyId === item.id) setBusyId(null);
    },
  };

  return (
    <div className="flex flex-col gap-5">
      {toast && (
        <div
          role="status"
          className={`relative rounded-xl border px-3 py-2 font-sans text-[12px] ${
            toast.kind === "error"
              ? "border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-ink"
              : "border-line bg-paper text-ink"
          }`}
        >
          {toast.message}
        </div>
      )}
      {groups.missed.length > 0 && (
        <Group
          title="Missed reminders"
          tone="warn"
          items={groups.missed}
          {...rowProps}
          markAsMissed
        />
      )}
      {groups.due.length > 0 && (
        <Group
          title="Due now"
          tone="fuchsia"
          items={groups.due}
          {...rowProps}
        />
      )}
      {groups.upcoming.length > 0 && (
        <Group
          title="Upcoming"
          tone="neutral"
          items={groups.upcoming}
          {...rowProps}
        />
      )}
      {groups.posted.length > 0 && (
        <Group
          title="Posted"
          tone="dim"
          items={groups.posted}
          {...rowProps}
        />
      )}
      {groups.canceled.length > 0 && (
        <Group
          title="Canceled"
          tone="dim"
          items={groups.canceled}
          {...rowProps}
        />
      )}
    </div>
  );
}

// ── grouping ────────────────────────────────────────────────────────────

function groupByStatus(items: LocalScheduleItem[]) {
  const now = Date.now();
  const missed: LocalScheduleItem[] = [];
  const due: LocalScheduleItem[] = [];
  const upcoming: LocalScheduleItem[] = [];
  const posted: LocalScheduleItem[] = [];
  const canceled: LocalScheduleItem[] = [];
  for (const it of items) {
    if (it.status === "posted") posted.push(it);
    else if (it.status === "canceled") canceled.push(it);
    else {
      const scheduledMs = new Date(it.scheduled_for).getTime();
      const overdueBy = now - scheduledMs;
      if (overdueBy > MISSED_REMINDER_THRESHOLD_MS) {
        // Pending but >6h past — the user almost certainly missed the
        // reminder window (laptop asleep, app closed). Surface as a
        // distinct group instead of letting it rot in "Due now."
        missed.push(it);
      } else if (scheduledMs <= now) {
        due.push(it);
      } else {
        upcoming.push(it);
      }
    }
  }
  // Soonest-first within each pending group; most-recent-first for posted/canceled.
  due.sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime());
  upcoming.sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime());
  // Missed: most-overdue first so the user sees the worst offenders at the top.
  missed.sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime());
  posted.sort((a, b) => (b.posted_at || "").localeCompare(a.posted_at || ""));
  canceled.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  return { missed, due, upcoming, posted, canceled };
}

// ── group ───────────────────────────────────────────────────────────────

type RowProps = {
  busyId: string | null;
  confirmCancelId: string | null;
  exposedCaptionId: string | null;
  exposedCaption: string | null;
  retryHintId: string | null;
  onCopyOpen: (item: LocalScheduleItem) => void;
  onMarkPosted: (item: LocalScheduleItem) => void;
  onRequestCancel: (item: LocalScheduleItem) => void;
  onConfirmCancel: (item: LocalScheduleItem) => Promise<void>;
  onAbortCancel: () => void;
  onRemove: (item: LocalScheduleItem) => void;
  onRetry: (item: LocalScheduleItem) => void;
};

function Group({
  title,
  tone,
  items,
  markAsMissed = false,
  busyId,
  confirmCancelId,
  exposedCaptionId,
  exposedCaption,
  retryHintId,
  onCopyOpen,
  onMarkPosted,
  onRequestCancel,
  onConfirmCancel,
  onAbortCancel,
  onRemove,
  onRetry,
}: RowProps & {
  title: string;
  tone: "fuchsia" | "neutral" | "dim" | "warn";
  items: LocalScheduleItem[];
  /** Renders the row in "missed reminder" mode — pill + Mark posted /
   *  Dismiss pair instead of the standard pending actions. */
  markAsMissed?: boolean;
}) {
  const titleCls =
    tone === "fuchsia"
      ? "text-fuchsia-deep"
      : tone === "neutral"
      ? "text-text-secondary"
      : tone === "warn"
      ? "text-fuchsia-deep"
      : "text-text-tertiary";
  return (
    <section>
      <div className={`mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] ${titleCls}`}>
        <span>{title}</span>
        <span className="text-text-tertiary">·</span>
        <span className="text-text-tertiary tabular-nums">{items.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((it) => (
          <Row
            key={it.id}
            item={it}
            busy={busyId === it.id}
            urgent={tone === "fuchsia"}
            missed={markAsMissed}
            confirmCancelOpen={confirmCancelId === it.id}
            exposedCaption={exposedCaptionId === it.id ? exposedCaption : null}
            retryHint={retryHintId === it.id}
            onCopyOpen={onCopyOpen}
            onMarkPosted={onMarkPosted}
            onRequestCancel={onRequestCancel}
            onConfirmCancel={onConfirmCancel}
            onAbortCancel={onAbortCancel}
            onRemove={onRemove}
            onRetry={onRetry}
          />
        ))}
      </div>
    </section>
  );
}

// ── row ─────────────────────────────────────────────────────────────────

function Row({
  item,
  busy,
  urgent,
  missed,
  confirmCancelOpen,
  exposedCaption,
  retryHint,
  onCopyOpen,
  onMarkPosted,
  onRequestCancel,
  onConfirmCancel,
  onAbortCancel,
  onRemove,
  onRetry,
}: {
  item: LocalScheduleItem;
  busy: boolean;
  urgent: boolean;
  missed: boolean;
  confirmCancelOpen: boolean;
  exposedCaption: string | null;
  retryHint: boolean;
  onCopyOpen: (item: LocalScheduleItem) => void;
  onMarkPosted: (item: LocalScheduleItem) => void;
  onRequestCancel: (item: LocalScheduleItem) => void;
  onConfirmCancel: (item: LocalScheduleItem) => Promise<void>;
  onAbortCancel: () => void;
  onRemove: (item: LocalScheduleItem) => void;
  onRetry: (item: LocalScheduleItem) => void;
}) {
  const platformLabel = PLATFORM_LABEL[item.platform] ?? item.platform;
  const isKnownPlatform =
    item.platform === "youtube" || item.platform === "tiktok" || item.platform === "instagram" || item.platform === "x";

  return (
    <div
      data-hot={urgent ? "true" : "false"}
      className={`library-card relative bg-transparent p-4 ${
        item.status === "canceled" ? "opacity-60 line-through decoration-text-tertiary" : ""
      }`}
    >
      <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
      <span aria-hidden="true" className="library-card-corner library-card-corner-br" />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink">
          {isKnownPlatform && <PlatformIcon id={item.platform as PlatformId} className="h-3.5 w-3.5" />}
          <span>{platformLabel}</span>
          {missed && (
            <>
              <span className="text-text-tertiary">·</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-fuchsia-deep/15 px-2 py-0.5 text-fuchsia-deep">
                <AlertTriangle className="h-3 w-3" strokeWidth={2.25} /> missed
              </span>
            </>
          )}
          {item.status === "posted" && (
            <>
              <span className="text-text-tertiary">·</span>
              <span className="inline-flex items-center gap-1 text-text-secondary">
                <CheckCircle2 className="h-3 w-3 text-fuchsia" strokeWidth={2.25} /> posted
              </span>
            </>
          )}
          {item.status === "canceled" && (
            <>
              <span className="text-text-tertiary">·</span>
              <span className="text-text-tertiary">canceled</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
          <Clock className="h-3 w-3" strokeWidth={2} />
          <span>{whenRelative(item.scheduled_for)}</span>
          <span className="text-text-tertiary">·</span>
          <span>{whenAbsolute(item.scheduled_for)}</span>
        </div>
      </div>

      <h3 className="mt-2 font-display text-[15px] font-semibold leading-tight tracking-[-0.01em] text-ink">
        {item.clip_title}
      </h3>

      {item.caption && (
        <p className="mt-1 line-clamp-2 font-sans text-[12px] leading-snug text-text-secondary">
          {item.caption}
        </p>
      )}

      {exposedCaption && (
        // Clipboard write failed — surface the text so the user can copy
        // it manually. Selectable, no truncation, mono so the user can
        // tell where line breaks land.
        <div className="mt-2 rounded-lg border border-fuchsia-deep/40 bg-fuchsia-deep/10 p-2">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep">
            select and copy manually
          </p>
          <p className="select-text whitespace-pre-wrap break-words font-mono text-[12px] text-ink">
            {exposedCaption}
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {missed && (
          <>
            <HudChip
              active={false}
              onClick={() => onMarkPosted(item)}
              disabled={busy}
              title="If you've already posted this manually, clear it out of the queue."
            >
              <Send className="h-3 w-3" strokeWidth={2} />
              Mark as posted
            </HudChip>
            {!confirmCancelOpen && (
              <button
                onClick={() => onRequestCancel(item)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 font-sans text-[12px] font-medium text-text-tertiary hover:text-ink disabled:opacity-50"
                title="Dismiss this missed reminder."
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
                Dismiss
              </button>
            )}
          </>
        )}
        {item.status === "pending" && !missed && (
          <button
            onClick={() => onCopyOpen(item)}
            disabled={busy}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 font-sans text-[13px] font-medium text-paper transition-all disabled:opacity-50 ${
              urgent
                ? "bg-fuchsia hover:bg-fuchsia-bright hover:shadow-[var(--glow-md)]"
                : "bg-fuchsia/90 hover:bg-fuchsia-bright"
            }`}
            title="Copy your caption to the clipboard and open the platform's upload page. You paste and post."
          >
            <Copy className="h-3.5 w-3.5" strokeWidth={2.25} />
            Copy &amp; open {platformLabel}
          </button>
        )}
        {item.status === "pending" && !missed && (
          <HudChip
            active={false}
            onClick={() => onMarkPosted(item)}
            disabled={busy}
            title="Mark as posted once you've actually published it on the platform."
          >
            <Send className="h-3 w-3" strokeWidth={2} />
            Mark posted
          </HudChip>
        )}
        {item.status === "pending" && !missed && !confirmCancelOpen && (
          <button
            onClick={() => onRequestCancel(item)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 font-sans text-[12px] font-medium text-text-tertiary hover:text-[var(--color-danger)] disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
            Cancel
          </button>
        )}
        {confirmCancelOpen && (
          // Inline confirm — replaces window.confirm(), which is a non-
          // styleable modal trap on Tauri and surfaces no context.
          <div className="flex flex-wrap items-center gap-2 rounded-full border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-1.5">
            <span className="font-sans text-[12px] text-ink">
              {missed ? "Dismiss this missed reminder?" : `Cancel this ${platformLabel} reminder?`}
            </span>
            <button
              onClick={() => void onConfirmCancel(item)}
              disabled={busy}
              className="rounded-full bg-[var(--color-danger)] px-3 py-1 font-sans text-[12px] font-medium text-paper hover:bg-[var(--color-danger)]/90 disabled:opacity-50"
            >
              {busy ? "canceling…" : missed ? "Yes, dismiss" : "Yes, cancel"}
            </button>
            <button
              onClick={onAbortCancel}
              disabled={busy}
              className="rounded-full px-3 py-1 font-sans text-[12px] font-medium text-text-secondary hover:text-ink"
            >
              Keep it
            </button>
          </div>
        )}
        {item.status === "posted" && item.post_url && (
          <HudChip
            active={false}
            onClick={() => void (async () => {
              const { open } = await import("@tauri-apps/plugin-shell");
              await open(item.post_url!);
            })()}
          >
            <ExternalLink className="h-3 w-3" strokeWidth={2} />
            Open post
          </HudChip>
        )}
        {(item.status === "posted" || item.status === "canceled") && (
          <button
            onClick={() => onRemove(item)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 font-sans text-[12px] font-medium text-text-tertiary hover:text-ink disabled:opacity-50"
            title="Remove this row from your local history."
          >
            Clear
          </button>
        )}
        {retryHint && (
          // Last action failed — give the user a one-click retry rather
          // than make them re-trigger from scratch. The error itself was
          // toasted above the list.
          <button
            onClick={() => onRetry(item)}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-danger)] bg-transparent px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
          >
            <RefreshCw className="h-3 w-3" strokeWidth={2.25} />
            retry
          </button>
        )}
      </div>
    </div>
  );
}
