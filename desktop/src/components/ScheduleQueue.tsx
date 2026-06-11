import { useCallback, useEffect, useRef, useState } from "react";
import { useVisibilityInterval } from "../lib/useVisibilityInterval";
import { openSmart as openExternal } from "../lib/openSmart";
import { RefreshCw } from "lucide-react";
import { backend, type ScheduleDto } from "../lib/backend";
import { sidecar, humanError } from "../lib/sidecar";
import { PlatformIcon, type PlatformId } from "./PlatformIcon";
import { HudChip } from "./cockpit/HudChip";
import { ConfirmDialog } from "./ConfirmDialog";

/** Compact "5 min ago" style stamp for the stale-data caption. */
function timeSince(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

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
  failed: "text-[var(--color-danger)]",
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
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  /** Wall-clock ms of the last successful refresh. Drives the "showing
   *  cached data" caption when a refresh later fails — otherwise the user
   *  has no idea whether the rows below are live or stale. */
  const [lastSuccessfulLoad, setLastSuccessfulLoad] = useState<number | null>(null);
  /** Per-row inline retry indicator after a cancel failure. */
  const [cancelError, setCancelError] = useState<Record<string, string>>({});
  /** Tick once a minute so the "showing cached data" caption keeps updating
   *  even when the network is wedged and refreshes never succeed. */
  const [, setTick] = useState(0);
  // Branded confirm replaces window.confirm() — the native dialog blocked
  // the Tauri webview thread on cancel and broke the cockpit voice.
  const [confirmCancelRow, setConfirmCancelRow] = useState<ScheduleDto | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  const loadGen = useRef(0);
  const load = useCallback(async () => {
    const myGen = ++loadGen.current;
    try {
      const { value: jwt } = await sidecar.licenseJwtRead();
      if (!jwt) {
        if (loadGen.current !== myGen) return;
        setError(
          "Sign in to Liquid Clips to see your queue — use the Sign in button in the top bar.",
        );
        return;
      }
      const list = await backend.schedules.list(jwt, { limit: 100 });
      if (loadGen.current !== myGen) return;
      // Sort by scheduled time ascending so the queue reads chronologically.
      const sorted = [...list].sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime());
      setItems(sorted);
      setError(null);
      setCancelError({}); // clear stale per-row cancel errors on fresh load
      setLastSuccessfulLoad(Date.now());
    } catch (e) {
      if (loadGen.current !== myGen) return;
      setError(humanError(e));
    }
  }, []);

  // v0.7.48 — Visibility-aware polling: pauses when user switches tabs
  // so background tabs don't burn CPU on refreshes they can't see.
  useEffect(() => { void load(); }, [load]);
  useVisibilityInterval(() => void load(), 30_000);

  // Re-render the "X ago" caption once a minute so stale-data warnings
  // don't lie about how stale the data is.
  // v0.7.48 — Visibility-aware tick: pauses in background tabs.
  useVisibilityInterval(() => setTick((t) => t + 1), 60_000);

  function cancel(row: ScheduleDto) {
    setConfirmCancelRow(row);
  }

  async function performCancel(row: ScheduleDto) {
    // Whole body wrapped in try/catch so a backend reject, JWT read failure,
    // or network blip surfaces as a per-row error chip instead of an
    // unhandled rejection.
    setCancelBusy(true);
    try {
      const { value: jwt } = await sidecar.licenseJwtRead();
      if (!jwt) {
        setCancelError((cur) => ({ ...cur, [row.id]: "Sign in to cancel scheduled posts." }));
        return;
      }
      await backend.schedules.cancel(jwt, row.id);
      setCancelError((cur) => {
        const next = { ...cur };
        delete next[row.id];
        return next;
      });
      void load();
    } catch (e) {
      const msg = humanError(e);
      setCancelError((cur) => ({ ...cur, [row.id]: msg }));
    } finally {
      setCancelBusy(false);
      setConfirmCancelRow(null);
    }
  }

  async function retry(row: ScheduleDto) {
    setRetrying((s) => new Set(s).add(row.id));
    try {
      const { value: jwt } = await sidecar.licenseJwtRead();
      if (!jwt) {
        setCancelError((cur) => ({ ...cur, [row.id]: "Sign in to retry failed posts." }));
        return;
      }
      await backend.schedules.retry(jwt, row.id);
      void load();
    } catch (e) {
      setCancelError((cur) => ({ ...cur, [row.id]: humanError(e) }));
    } finally {
      setRetrying((s) => { const n = new Set(s); n.delete(row.id); return n; });
    }
  }

  const visible = items?.filter((r) => matchesFilter(r, filter)) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <ConfirmDialog
        open={confirmCancelRow !== null}
        tone="destructive"
        title="Cancel scheduled post?"
        body={
          confirmCancelRow ? (
            <>
              Cancel the {confirmCancelRow.platform} post of &ldquo;
              {confirmCancelRow.clip_title}&rdquo;? The slot will be freed up
              but you can re-queue the same clip later.
            </>
          ) : (
            <>Cancel this scheduled post?</>
          )
        }
        confirmLabel="Cancel post"
        busy={cancelBusy}
        onCancel={() => { if (!cancelBusy) setConfirmCancelRow(null); }}
        onConfirm={() => {
          if (!confirmCancelRow) return;
          void performCancel(confirmCancelRow);
        }}
      />
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
          <div className="relative z-10 flex flex-col gap-2">
            <span>{error}</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => void load()}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-text-secondary hover:text-ink"
              >
                <RefreshCw className="h-3 w-3" strokeWidth={2} />
                retry
              </button>
              {lastSuccessfulLoad !== null && items && items.length > 0 && (
                // Don't lie about freshness — if the refresh failed but we
                // still have rows from earlier, tell the user they're stale.
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                  last successful refresh: {timeSince(lastSuccessfulLoad)} &mdash; showing cached data
                </span>
              )}
            </div>
          </div>
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
        <div className="relative bg-transparent px-5 py-10">
          <span aria-hidden className="library-card-corner library-card-corner-tl" />
          <span aria-hidden className="library-card-corner library-card-corner-tr" />
          <span aria-hidden className="library-card-corner library-card-corner-bl" />
          <span aria-hidden className="library-card-corner library-card-corner-br" />
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-tertiary">
            nothing in this slice
          </p>
        </div>
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
                  onClick={() => void openExternal(url).catch(() => {})}
                  className="mt-2 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-fuchsia hover:text-fuchsia-bright"
                >
                  <PlatformGlyph platform={row.platform} />
                  <span className="underline decoration-dashed underline-offset-4">open live post</span>
                </button>
              )}

              {row.error && (
                <p className="mt-2 font-mono text-[11px] text-[var(--color-danger)]">{row.error}</p>
              )}

              <div className="mt-3 flex items-center gap-3">
                {row.status === "failed" && (
                  <button
                    onClick={() => void retry(row)}
                    disabled={retrying.has(row.id)}
                    className="rounded-full border border-[var(--color-danger)] bg-transparent px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 disabled:opacity-50"
                  >
                    {retrying.has(row.id) ? "retrying…" : "retry"}
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
                {cancelError[row.id] && (
                  // The cancel RPC rejected for this specific row — keep the
                  // visible affordance so the user can re-try without
                  // hunting for the action elsewhere.
                  <button
                    onClick={() => void cancel(row)}
                    className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-danger)] underline decoration-dashed underline-offset-4 hover:text-fuchsia-deep"
                    title={cancelError[row.id]}
                  >
                    Cancel failed &mdash; retry
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
