import { useCallback, useEffect, useState } from "react";
import { backend, type NotificationDto } from "../lib/backend";
import { sidecar } from "../lib/sidecar";

const CATEGORY_LABELS: Record<NotificationDto["category"], string> = {
  system_update: "update",
  post_published: "post",
  post_failed: "post failed",
  drip_summary: "drip",
  quota_warning: "quota",
  billing: "billing",
  affiliate: "affiliate",
  founder: "founder",
  junior_message: "junior",
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
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function markRead(n: NotificationDto) {
    if (n.read_at) return;
    const { value: jwt } = await sidecar.licenseJwtRead();
    if (!jwt) return;
    await backend.notifications.markRead(jwt, n.id);
    setItems((cur) =>
      cur?.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)) ?? null,
    );
  }

  async function markAllRead() {
    const { value: jwt } = await sidecar.licenseJwtRead();
    if (!jwt) return;
    await backend.notifications.markAllRead(jwt);
    const now = new Date().toISOString();
    setItems((cur) => cur?.map((x) => ({ ...x, read_at: x.read_at ?? now })) ?? null);
  }

  async function dismiss(n: NotificationDto) {
    const { value: jwt } = await sidecar.licenseJwtRead();
    if (!jwt) return;
    await backend.notifications.dismiss(jwt, n.id);
    setItems((cur) => cur?.filter((x) => x.id !== n.id) ?? null);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-[560px] flex-col overflow-y-auto bg-paper shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-paper/85 px-6 py-4 backdrop-blur-[20px]">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
            inbox
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void markAllRead()}
              disabled={!items || items.every((x) => x.read_at)}
              className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary hover:border-fuchsia hover:text-ink disabled:opacity-40"
            >
              Mark all read
            </button>
            <button
              onClick={onClose}
              className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary hover:border-fuchsia hover:text-ink"
            >
              Close
            </button>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-3 px-6 py-6">
          {error && (
            <div className="rounded-2xl border border-line bg-paper-warm/50 p-4 font-mono text-[12px] text-text-secondary">
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
    return (
      <div
        onClick={onClick}
        className={`relative rounded-3xl border p-6 transition-colors ${
          unread
            ? "border-fuchsia-soft bg-fuchsia-soft/30 cursor-pointer hover:border-fuchsia"
            : "border-line bg-paper-warm/30 cursor-pointer"
        }`}
      >
        <div className="flex items-center gap-2">
          <span
            className="inline-grid h-[26px] w-[26px] place-items-center rounded-md bg-fuchsia font-mono text-[15px] font-bold leading-none text-white"
            aria-hidden
          >
            /
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep">
            junior · {timeAgo(n.created_at)}
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

  return (
    <div
      onClick={onClick}
      className={`relative cursor-pointer rounded-2xl border p-4 transition-colors ${
        unread ? "border-line bg-paper hover:border-fuchsia" : "border-line/50 bg-paper-warm/20"
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
            className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary hover:text-[#DC2626]"
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
