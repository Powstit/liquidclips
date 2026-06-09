import { useCallback, useEffect, useState } from "react";
import { backend, type NotificationDto } from "../lib/backend";
import { sidecar, humanError } from "../lib/sidecar";

const CATEGORY_LABELS: Record<NotificationDto["category"], string> = {
  system_update: "update",
  post_published: "post",
  post_failed: "post failed",
  drip_summary: "drip",
  quota_warning: "quota",
  billing: "billing",
  affiliate: "affiliate",
  founder: "founder",
  junior_message: "liquid clips",
  pipeline_event: "pipeline",
};

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = (Date.now() - then) / 1000;
  if (diff < 60) return `${Math.max(1, Math.floor(diff))}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function NotificationSheet({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Inline error surface for the row-level actions (markRead / markAllRead /
  // dismiss). Without this the user clicks "dismiss" on a stale row, the RPC
  // 401s in the background, and nothing visible changes — they mash the
  // button trying to figure out why. A small banner + retry restores the
  // feedback loop.
  const [actionError, setActionError] = useState<{ message: string; retry: () => void } | null>(null);

  const load = useCallback(async () => {
    try {
      const { value: jwt } = await sidecar.licenseJwtRead();
      if (!jwt) {
        setError(
          "Sign in to Liquid Clips to enable your inbox — use the Sign in button in the top bar."
        );
        return;
      }
      const list = await backend.notifications.list(jwt, { limit: 50 });
      setItems(list);
      setError(null);
    } catch (e) {
      setError(humanError(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function markRead(n: NotificationDto) {
    if (n.read_at) return;
    try {
      const { value: jwt } = await sidecar.licenseJwtRead();
      if (!jwt) return;
      await backend.notifications.markRead(jwt, n.id);
      setItems((cur) =>
        cur?.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)) ?? null,
      );
      setActionError(null);
    } catch (e) {
      setActionError({ message: humanError(e), retry: () => void markRead(n) });
    }
  }

  async function markAllRead() {
    try {
      const { value: jwt } = await sidecar.licenseJwtRead();
      if (!jwt) return;
      await backend.notifications.markAllRead(jwt);
      const now = new Date().toISOString();
      setItems((cur) => cur?.map((x) => ({ ...x, read_at: x.read_at ?? now })) ?? null);
      setActionError(null);
    } catch (e) {
      setActionError({ message: humanError(e), retry: () => void markAllRead() });
    }
  }

  async function dismiss(n: NotificationDto) {
    try {
      const { value: jwt } = await sidecar.licenseJwtRead();
      if (!jwt) return;
      await backend.notifications.dismiss(jwt, n.id);
      setItems((cur) => cur?.filter((x) => x.id !== n.id) ?? null);
      setActionError(null);
    } catch (e) {
      setActionError({ message: humanError(e), retry: () => void dismiss(n) });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-paper/85 backdrop-blur-md" onClick={onClose}>
      <div
        className="relative flex h-full w-full max-w-[560px] flex-col overflow-y-auto bg-transparent"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Fuchsia HUD bracket corners on the sheet itself — frame as cockpit
            drawer, not solid panel. */}
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tl" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-tr" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-bl" />
        <span aria-hidden="true" className="cockpit-tile-corner cockpit-tile-corner-br" />

        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line/60 bg-paper/85 px-6 py-4 backdrop-blur-md">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
            inbox
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void markAllRead()}
              disabled={!items || items.every((x) => x.read_at)}
              className="rounded-full bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary transition-colors hover:text-fuchsia disabled:opacity-40"
            >
              Mark all read
            </button>
            <button
              onClick={onClose}
              className="rounded-full bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary transition-colors hover:text-fuchsia"
            >
              Close
            </button>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-3 px-6 py-6">
          {error && (
            <div className="relative bg-transparent p-4 font-mono text-[12px] text-text-secondary">
              <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
              <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
              <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
              <span aria-hidden="true" className="library-card-corner library-card-corner-br" />
              {error}
            </div>
          )}
          {!error && items === null && (
            <p className="font-mono text-[12px] text-text-tertiary">
              Reading inbox<span className="blink">_</span>
            </p>
          )}
          {!error && items?.length === 0 && (
            <p className="font-mono text-[12px] text-text-tertiary">No notifications yet.</p>
          )}
          {items?.map((n) => (
            <NotificationRow key={n.id} n={n} onClick={() => markRead(n)} onDismiss={() => dismiss(n)} />
          ))}
        </div>

        {/* Row-action error banner — sits at the bottom of the sheet so it
            doesn't shove inbox content around when it appears. Retry button
            calls the original action with the same args. */}
        {actionError && (
          <div
            role="alert"
            className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-[var(--color-danger)]/40 bg-paper/95 px-6 py-3 font-mono text-[11px] text-[var(--color-danger)] backdrop-blur-md"
          >
            <span className="min-w-0 flex-1 truncate">{actionError.message}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={actionError.retry}
                className="rounded-full border border-[var(--color-danger)]/50 bg-transparent px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger)]/10"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => setActionError(null)}
                aria-label="Dismiss error"
                className="rounded-full bg-transparent px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary transition-colors hover:text-ink"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NotificationRow({
  n, onClick, onDismiss,
}: {
  n: NotificationDto;
  onClick: () => void;
  onDismiss: () => void;
}) {
  const unread = !n.read_at;
  const isJunior = n.category === "junior_message";

  if (isJunior) {
    // Branded "liquid clips" inbox hero — gets the fuchsia bracket frame so
    // it reads as a cockpit broadcast, not a system notification.
    return (
      <div
        onClick={onClick}
        className="relative cursor-pointer bg-transparent p-6 transition-opacity hover:opacity-95"
      >
        <span aria-hidden="true" className="library-card-corner library-card-corner-tl" />
        <span aria-hidden="true" className="library-card-corner library-card-corner-tr" />
        <span aria-hidden="true" className="library-card-corner library-card-corner-bl" />
        <span aria-hidden="true" className="library-card-corner library-card-corner-br" />
        <div className="flex items-center gap-2">
          <span
            className="inline-grid h-[26px] w-[26px] place-items-center rounded-md bg-fuchsia font-mono text-[15px] font-bold leading-none text-white"
            aria-hidden
          >
            /
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep">
            liquid clips · {timeAgo(n.created_at)}
          </span>
          {unread && <span className="ml-auto inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />}
        </div>
        <h3 className="mt-3 font-display text-[20px] font-semibold leading-[1.2] tracking-[-0.015em] text-ink">
          {n.title}
        </h3>
        <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink">{n.body}</p>
      </div>
    );
  }

  // Quiet system rows — no card chrome; just a hairline divider so they
  // recede behind the cockpit drawer brackets and the Junior hero rows.
  return (
    <div
      onClick={onClick}
      className={`relative cursor-pointer border-t border-line/60 bg-transparent p-4 transition-colors first:border-t-0 ${
        unread ? "" : "opacity-70"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          {CATEGORY_LABELS[n.category]} · {timeAgo(n.created_at)}
        </span>
        <div className="flex items-center gap-2">
          {unread && <span className="inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary hover:text-[var(--color-danger)]"
          >
            dismiss
          </button>
        </div>
      </div>
      <h3 className="mt-1 font-display text-[16px] font-semibold leading-[1.2] tracking-[-0.01em] text-ink">
        {n.title}
      </h3>
      <p className="mt-1 line-clamp-2 font-sans text-[13px] leading-relaxed text-text-secondary">{n.body}</p>
    </div>
  );
}
