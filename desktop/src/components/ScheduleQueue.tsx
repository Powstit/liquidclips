import { useCallback, useEffect, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { backend, type ScheduleDto } from "../lib/backend";
import { sidecar, humanError } from "../lib/sidecar";
import { PlatformIcon, type PlatformId } from "./PlatformIcon";

const KNOWN_PLATFORMS: PlatformId[] = ["youtube", "tiktok", "instagram", "x"];

// Monochrome platform mark — uses the shared PlatformIcon glyph set (no emoji).
// Falls back to a neutral bullet for anything unrecognised.
function PlatformGlyph({ platform }: { platform: string }) {
  if ((KNOWN_PLATFORMS as string[]).includes(platform)) {
    return <PlatformIcon id={platform as PlatformId} className="h-3.5 w-3.5" />;
  }
  return <span aria-hidden>•</span>;
}

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
  return d.toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  });
}

/**
 * Inline schedule list. Lives inside the Upload tab — the modal/drawer
 * variant was retired when posting moved out of the global header and into
 * a dedicated IA surface (0.4.27). When the user is signed out we surface
 * a short prompt instead of the list.
 */
export function ScheduleQueue() {
  const [items, setItems] = useState<ScheduleDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { value: jwt } = await sidecar.licenseJwtRead();
      if (!jwt) {
        setError(
          "Sign in to Liquid Clips to see your queue — use the Sign in button in the top bar.",
        );
        return;
      }
      const list = await backend.schedules.list(jwt, { limit: 100 });
      setItems(list);
      setError(null);
    } catch (e) {
      setError(humanError(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(load, 30_000); // refresh every 30 s
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
    <div className="flex flex-col gap-3">
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
        <div className="rounded-2xl border border-dashed border-line bg-paper-warm/30 px-5 py-8 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            no scheduled posts yet
          </p>
          <p className="mt-2 font-sans text-[13px] text-text-secondary">
            Finish a Workspace project, then use <span className="font-medium text-ink">Drip across ▾</span> or
            <span className="font-medium text-ink"> Schedule</span> to queue posts here.
          </p>
        </div>
      )}
      {items?.map((row) => (
        <div key={row.id} className={`rounded-2xl border p-4 ${STATUS_STYLE[row.status]}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em]">
              <span className="inline-flex items-center gap-1.5 text-ink">
                <PlatformGlyph platform={row.platform} />
                {row.platform}
              </span>
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
                className="rounded-full bg-fuchsia px-3 py-1.5 font-sans text-[12px] font-medium text-white hover:bg-fuchsia-bright"
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
  );
}
