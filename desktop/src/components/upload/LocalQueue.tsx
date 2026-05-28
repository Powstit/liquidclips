import { useCallback, useEffect, useMemo, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Clock, Send, X, CheckCircle2, ExternalLink, Copy } from "lucide-react";
import { sidecar, type LocalScheduleItem } from "../../lib/sidecar";
import { PlatformIcon, type PlatformId } from "../PlatformIcon";

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
export function LocalQueue() {
  const [items, setItems] = useState<LocalScheduleItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { items } = await sidecar.localScheduleList();
      setItems(items);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    // Re-render every 30s so the "in 12 min" / "5 min ago" labels stay live
    // and items naturally roll out of "Upcoming" into "Due now" without a
    // user interaction. Cheap — we're just reading a JSON file.
    const id = window.setInterval(load, 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const groups = useMemo(() => groupByStatus(items ?? []), [items]);

  async function copyAndOpen(item: LocalScheduleItem) {
    setBusyId(item.id);
    try {
      const caption = item.caption || item.clip_title;
      if (caption) {
        try {
          await writeText(caption);
        } catch (e) {
          console.warn("clipboard write failed:", e);
        }
      }
      const url = COMPOSER_URL[item.platform] ?? null;
      if (url) await openExternal(url);
    } finally {
      setBusyId(null);
    }
  }

  async function markPosted(item: LocalScheduleItem) {
    setBusyId(item.id);
    try {
      await sidecar.localScheduleMarkPosted(item.id);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(item: LocalScheduleItem) {
    if (!confirm(`Cancel the ${PLATFORM_LABEL[item.platform] ?? item.platform} post of "${item.clip_title}"?`)) return;
    setBusyId(item.id);
    try {
      await sidecar.localScheduleCancel(item.id);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(item: LocalScheduleItem) {
    setBusyId(item.id);
    try {
      await sidecar.localScheduleRemove(item.id);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-line bg-paper-warm/50 p-4 font-mono text-[12px] text-text-secondary">
        Couldn't read the local schedule — {error}
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
      <div className="rounded-2xl border border-dashed border-line bg-paper-warm/30 px-5 py-8 text-center">
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

  return (
    <div className="flex flex-col gap-5">
      {groups.due.length > 0 && (
        <Group
          title="Due now"
          tone="fuchsia"
          items={groups.due}
          busyId={busyId}
          onCopyOpen={copyAndOpen}
          onMarkPosted={markPosted}
          onCancel={cancel}
        />
      )}
      {groups.upcoming.length > 0 && (
        <Group
          title="Upcoming"
          tone="neutral"
          items={groups.upcoming}
          busyId={busyId}
          onCopyOpen={copyAndOpen}
          onMarkPosted={markPosted}
          onCancel={cancel}
        />
      )}
      {groups.posted.length > 0 && (
        <Group
          title="Posted"
          tone="dim"
          items={groups.posted}
          busyId={busyId}
          onRemove={remove}
        />
      )}
      {groups.canceled.length > 0 && (
        <Group
          title="Canceled"
          tone="dim"
          items={groups.canceled}
          busyId={busyId}
          onRemove={remove}
        />
      )}
    </div>
  );
}

// ── grouping ────────────────────────────────────────────────────────────

function groupByStatus(items: LocalScheduleItem[]) {
  const now = Date.now();
  const due: LocalScheduleItem[] = [];
  const upcoming: LocalScheduleItem[] = [];
  const posted: LocalScheduleItem[] = [];
  const canceled: LocalScheduleItem[] = [];
  for (const it of items) {
    if (it.status === "posted") posted.push(it);
    else if (it.status === "canceled") canceled.push(it);
    else if (new Date(it.scheduled_for).getTime() <= now) due.push(it);
    else upcoming.push(it);
  }
  // Soonest-first within each pending group; most-recent-first for posted/canceled.
  due.sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime());
  upcoming.sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime());
  posted.sort((a, b) => (b.posted_at || "").localeCompare(a.posted_at || ""));
  canceled.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  return { due, upcoming, posted, canceled };
}

// ── group ───────────────────────────────────────────────────────────────

function Group({
  title,
  tone,
  items,
  busyId,
  onCopyOpen,
  onMarkPosted,
  onCancel,
  onRemove,
}: {
  title: string;
  tone: "fuchsia" | "neutral" | "dim";
  items: LocalScheduleItem[];
  busyId: string | null;
  onCopyOpen?: (item: LocalScheduleItem) => void;
  onMarkPosted?: (item: LocalScheduleItem) => void;
  onCancel?: (item: LocalScheduleItem) => void;
  onRemove?: (item: LocalScheduleItem) => void;
}) {
  const titleCls =
    tone === "fuchsia"
      ? "text-fuchsia-deep"
      : tone === "neutral"
      ? "text-text-secondary"
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
            onCopyOpen={onCopyOpen}
            onMarkPosted={onMarkPosted}
            onCancel={onCancel}
            onRemove={onRemove}
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
  onCopyOpen,
  onMarkPosted,
  onCancel,
  onRemove,
}: {
  item: LocalScheduleItem;
  busy: boolean;
  urgent: boolean;
  onCopyOpen?: (item: LocalScheduleItem) => void;
  onMarkPosted?: (item: LocalScheduleItem) => void;
  onCancel?: (item: LocalScheduleItem) => void;
  onRemove?: (item: LocalScheduleItem) => void;
}) {
  const platformLabel = PLATFORM_LABEL[item.platform] ?? item.platform;
  const isKnownPlatform =
    item.platform === "youtube" || item.platform === "tiktok" || item.platform === "instagram" || item.platform === "x";

  return (
    <div
      className={`rounded-2xl border p-4 ${
        urgent
          ? "border-fuchsia-soft bg-fuchsia-soft/25 shadow-[var(--glow-sm)]"
          : item.status === "posted"
          ? "border-line bg-paper-warm/30"
          : item.status === "canceled"
          ? "border-line bg-paper opacity-60 line-through decoration-text-tertiary"
          : "border-line bg-paper-warm/40"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink">
          {isKnownPlatform && <PlatformIcon id={item.platform as PlatformId} className="h-3.5 w-3.5" />}
          <span>{platformLabel}</span>
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

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(item.status === "pending") && onCopyOpen && (
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
        {item.status === "pending" && onMarkPosted && (
          <button
            onClick={() => onMarkPosted(item)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3.5 py-2 font-sans text-[12px] font-medium text-text-secondary hover:border-fuchsia hover:text-fuchsia-deep disabled:opacity-50"
            title="Mark as posted once you've actually published it on the platform."
          >
            <Send className="h-3.5 w-3.5" strokeWidth={2} />
            Mark posted
          </button>
        )}
        {item.status === "pending" && onCancel && (
          <button
            onClick={() => onCancel(item)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 font-sans text-[12px] font-medium text-text-tertiary hover:text-[#DC2626] disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
            Cancel
          </button>
        )}
        {item.status === "posted" && item.post_url && (
          <button
            onClick={() => void (async () => {
              const { open } = await import("@tauri-apps/plugin-shell");
              await open(item.post_url!);
            })()}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3.5 py-2 font-sans text-[12px] font-medium text-text-secondary hover:border-fuchsia hover:text-fuchsia-deep"
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
            Open post
          </button>
        )}
        {(item.status === "posted" || item.status === "canceled") && onRemove && (
          <button
            onClick={() => onRemove(item)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 font-sans text-[12px] font-medium text-text-tertiary hover:text-ink disabled:opacity-50"
            title="Remove this row from your local history."
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
