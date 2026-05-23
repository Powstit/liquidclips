import { useCallback, useEffect, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { backend, type ScheduleDto } from "../lib/backend";
import { sidecar } from "../lib/sidecar";

const PLATFORM_GLYPH: Record<string, string> = {
  youtube: "▶",
  tiktok: "♪",
  x: "𝕏",
};

const STATUS_STYLE: Record<ScheduleDto["status"], string> = {
  pending: "border-line bg-paper-warm/40 text-text-secondary",
  uploading: "border-fuchsia bg-fuchsia/15 text-fuchsia-deep",
  scheduled: "border-fuchsia/40 bg-fuchsia-soft/30 text-fuchsia-deep",
  published: "border-fuchsia bg-fuchsia/10 text-fuchsia-deep",
  failed: "border-[#DC2626]/40 bg-[#DC2626]/10 text-[#DC2626]",
  canceled: "border-line bg-paper text-text-tertiary line-through opacity-60",
};

const STATUS_LABEL: Record<ScheduleDto["status"], string> = {
  pending: "queued",
  uploading: "uploading",
  scheduled: "scheduled",
  published: "live",
  failed: "failed",
  canceled: "canceled",
};

function whenAbsolute(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" });
}

export function ScheduleQueue({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<ScheduleDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { value: jwt } = await sidecar.licenseJwtRead();
      if (!jwt) {
        setError(
          "No license JWT — sign in at account.jnremployee.com and paste the JWT into Settings → API keys to see your queue.",
        );
        return;
      }
      const list = await backend.schedules.list(jwt, { limit: 100 });
      setItems(list);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(load, 30_000);  // refresh every 30 s
    return () => window.clearInterval(id);
  }, [load]);

  async function cancel(row: ScheduleDto) {
    if (!confirm(`Cancel the ${row.platform} post of "${row.clip_title}"?`)) return;
    const { value: jwt } = await sidecar.licenseJwtRead();
    if (!jwt) return;
    await backend.schedules.cancel(jwt, row.id);
    void load();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-[680px] flex-col overflow-y-auto bg-paper shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-paper/85 px-6 py-4 backdrop-blur-[20px]">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
            schedule queue
          </div>
          <button
            onClick={onClose}
            className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-secondary hover:border-fuchsia hover:text-ink"
          >
            Close
          </button>
        </header>

        <div className="flex flex-1 flex-col gap-3 px-6 py-6">
          {error && (
            <div className="rounded-2xl border border-line bg-paper-warm/50 p-4 font-mono text-[12px] text-text-secondary">
              {error}
            </div>
          )}
          {!error && items === null && (
            <p className="font-mono text-[12px] text-text-tertiary">
              Reading queue<span className="blink">_</span>
            </p>
          )}
          {!error && items?.length === 0 && (
            <p className="font-mono text-[12px] text-text-tertiary">
              No scheduled posts. Use Drip across ▾ or Schedule one on the results screen.
            </p>
          )}
          {items?.map((row) => (
            <div
              key={row.id}
              className={`rounded-2xl border p-4 ${STATUS_STYLE[row.status]}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em]">
                  <span className="text-ink">{PLATFORM_GLYPH[row.platform] ?? "•"} {row.platform}</span>
                  <span className="text-text-tertiary">·</span>
                  <span>{STATUS_LABEL[row.status]}</span>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
                  {whenAbsolute(row.scheduled_for)}
                </span>
              </div>
              <h3 className="mt-2 font-display text-[16px] font-semibold leading-tight tracking-[-0.01em] text-ink">
                {row.clip_title}
              </h3>
              {row.error && (
                <p className="mt-1 font-mono text-[11px] text-[#DC2626]">{row.error}</p>
              )}
              <div className="mt-3 flex items-center gap-3">
                {row.post_url && row.status === "published" && (
                  <button
                    onClick={() => void openExternal(row.post_url!)}
                    className="rounded-full bg-fuchsia px-3 py-1.5 font-sans text-[12px] font-medium text-paper hover:bg-ink"
                  >
                    Open post →
                  </button>
                )}
                {(row.status === "pending" || row.status === "scheduled" || row.status === "failed") && (
                  <button
                    onClick={() => void cancel(row)}
                    className="rounded-full border border-line bg-paper px-3 py-1.5 font-sans text-[12px] font-medium text-text-secondary hover:border-[#DC2626] hover:text-[#DC2626]"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
