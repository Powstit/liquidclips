import { useCallback, useEffect, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { backend, type ScheduleDto } from "../lib/backend";
import { sidecar, humanError } from "../lib/sidecar";
import { PlatformIcon, type PlatformId } from "./PlatformIcon";
import { HudChip } from "./cockpit/HudChip";

const KNOWN_PLATFORMS: PlatformId[] = ["youtube", "tiktok", "instagram", "x"];

// Monochrome platform mark — uses the shared PlatformIcon glyph set (no emoji).
// Falls back to a neutral bullet for anything unrecognised.
function PlatformGlyph({ platform }: { platform: string }) {
  if ((KNOWN_PLATFORMS as string[]).includes(platform)) {
    return <PlatformIcon id={platform as PlatformId} className="h-3.5 w-3.5" />;
  }
  return <span aria-hidden>•</span>;
}

// Cockpit language — transparent surfaces, fuchsia HUD bracket-corner spans,
// one accent (fuchsia) everywhere except destructive (Retry on failure stays red).
// Status text colour is the only differentiator on the row body.
const STATUS_TEXT_CLASS: Record<ScheduleDto["status"], string> = {
  pending: "text-text-secondary",
  uploading: "text-fuchsia",
  scheduled: "text-fuchsia",
  published: "text-fuchsia",
  failed: "text-[#DC2626]",
  canceled: "text-text-tertiary line-through opacity-60",
};

const STATUS_LABEL: Record<ScheduleDto["status"], string> = {
  pending: "queued",
  uploading: "uploading",
  scheduled: "scheduled",
  published: "posted",
  failed: "failed",
  canceled: "canceled",
};

type FilterKey = "all" | "queued" | "posted" | "failed";

const FILTER_LABEL: Record<FilterKey, string> = {
  all: "all",
  queued: "queued",
  posted: "posted",
  failed: "failed",
};

function matchesFilter(row: ScheduleDto, filter: FilterKey): boolean {
  if (filter === "all") return true;
  if (filter === "queued") return row.status === "pending" || row.status === "uploading" || row.status === "scheduled";
  if (filter === "posted") return row.status === "published";
  if (filter === "failed") return row.status === "failed";
  return true;
}

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

function liveUrl(row: ScheduleDto): string | null {
  return row.live_url || row.post_url || null;
}

/**
 * Inline schedule list. Lives inside the Upload tab — the modal/drawer
 * variant was retired when posting moved out of the global header and into
 * a dedicated IA surface (0.4.27). When the user is signed out we surface
 * a short prompt instead of the list.
 *
 * Cockpit pass (sprint #3, v0.6.38): transparent surfaces, four fuchsia HUD
 * bracket-corner spans per row, HudChip status filters, single-fuchsia accent.
 * Destructive red is reserved for the Retry button after a failure.
 */
export function ScheduleQueue() {
  const [items, setItems] = useState<ScheduleDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [retrying, setRetrying] = useState<string | null>(null);

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

  async function retry(row: ScheduleDto) {
    const { value: jwt } = await sidecar.licenseJwtRead();
    if (!jwt) return;
    setRetrying(row.id);
    try {
      await backend.schedules.retry(jwt, row.id);
      void load();
    } catch (e) {
      setError(humanError(e));
    } finally {
      setRetrying(null);
    }
  }

  const visible = items?.filter((r) => matchesFilter(r, filter)) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        {(Object.keys(FILTER_LABEL) as FilterKey[]).map((key) => (
          <HudChip key={key} active={filter === key} onClick={() => setFilter(key)}>
            {FILTER_LABEL[key]}
          </HudChip>
        ))}
      </div>

      {error && (
        <div className="relative bg-transparent p-4 font-mono text-[12px] text-text-secondary">
          <span aria-hidden className="library-card-corner library-card-corner-tl" />
          <span aria-hidden className="library-card-corner library-card-corner-tr" />
          <span aria-hidden className="library-card-corner library-card-corner-bl" />
          <span aria-hidden className="library-card-corner library-card-corner-br" />
          <span className="relative z-10">{error}</span>
        </div>
      )}

      {!error && items === null && (
        <p className="font-mono text-[12px] text-text-tertiary">
          Reading queue<span className="blink">_</span>
        </p>
      )}

      {!error && items?.length === 0 && (
        <div className="relative bg-transparent px-5 py-10 text-center">
          <span aria-hidden className="library-card-corner library-card-corner-tl" />
          <span aria-hidden className="library-card-corner library-card-corner-tr" />
          <span aria-hidden className="library-card-corner library-card-corner-bl" />
          <span aria-hidden className="library-card-corner library-card-corner-br" />
          <div className="relative z-10">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary">
              no scheduled posts yet
            </p>
            <p className="mt-2 font-sans text-[13px] text-text-secondary">
              Finish a Workspace project, then use <span className="font-medium text-ink">Drip across</span> or
              <span className="font-medium text-ink"> Schedule</span> to queue posts here.
            </p>
          </div>
        </div>
      )}

      {!error && items && items.length > 0 && visible?.length === 0 && (
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary">
          nothing in this slice
        </p>
      )}

      {visible?.map((row) => {
        const url = liveUrl(row);
        return (
          <div
            key={row.id}
            className="library-card relative bg-transparent p-4"
            data-hot={row.status === "published" ? "true" : "false"}
          >
            <span aria-hidden className="library-card-corner library-card-corner-tl" />
            <span aria-hidden className="library-card-corner library-card-corner-tr" />
            <span aria-hidden className="library-card-corner library-card-corner-bl" />
            <span aria-hidden className="library-card-corner library-card-corner-br" />

            <div className="relative z-10">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em]">
                  <span className="inline-flex items-center gap-1.5 text-ink">
                    <PlatformGlyph platform={row.platform} />
                    {row.platform}
                  </span>
                  <span className="text-text-tertiary">·</span>
                  <span className={STATUS_TEXT_CLASS[row.status]}>{STATUS_LABEL[row.status]}</span>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                  {whenAbsolute(row.scheduled_for)}
                </span>
              </div>

              <h3 className="mt-2 font-display text-[16px] font-semibold leading-tight tracking-[-0.01em] text-ink">
                {row.clip_title}
              </h3>

              {row.status === "published" && url && (
                <button
                  onClick={() => void openExternal(url)}
                  className="mt-2 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-fuchsia hover:text-fuchsia-bright"
                >
                  <PlatformGlyph platform={row.platform} />
                  <span className="underline decoration-dashed underline-offset-4">open live post</span>
                </button>
              )}

              {row.error && (
                <p className="mt-2 font-mono text-[11px] text-[#DC2626]">{row.error}</p>
              )}

              <div className="mt-3 flex items-center gap-3">
                {row.status === "failed" && (
                  <button
                    onClick={() => void retry(row)}
                    disabled={retrying === row.id}
                    className="rounded-full border border-[#DC2626] bg-transparent px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[#DC2626] hover:bg-[#DC2626]/10 disabled:opacity-50"
                  >
                    {retrying === row.id ? "retrying…" : "retry"}
                  </button>
                )}
                {(row.status === "pending" || row.status === "scheduled" || row.status === "failed") && (
                  <button
                    onClick={() => void cancel(row)}
                    className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary hover:text-ink"
                  >
                    cancel
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
