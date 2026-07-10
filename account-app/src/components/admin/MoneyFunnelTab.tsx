/**
 * MoneyFunnelTab · Chapter 6 (2026-07-10).
 *
 * Read-only HQ panel that surfaces the money-surface funnel: 5-tile top
 * row, per-surface breakdown (8 rows, one per approved mockup), and a
 * recent-events feed.
 *
 * Honest-empty-state:
 *   The behavioural events pipeline logs to stdout only (see
 *   `junior-backend/app/routes/telemetry_ingest.py::post_diagnostic`).
 *   Until the persisted events table lands, the four event-derived tiles
 *   and both event-derived tables return 0 and set
 *   `events_pipeline_flowing: false`. This panel renders an honest
 *   banner explaining that state — NEVER fabricates numbers.
 *
 * Perf contract (mirrored from StatePuppeteerTab)
 *   - no `backdrop-filter: blur()`
 *   - no infinite CSS animations
 *   - transitions ≤ 100ms
 *   - no polling · manual refresh only
 *   - transform / opacity only for interactive state feedback
 *
 * NO `*_rendered` events emitted from this panel.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ─── Types (loose · backend is source of truth) ──────────────────────
type Pipeline = "section" | "design-os" | "all";

interface FunnelTile {
  key: string;
  label: string;
  value: number;
  source: string;
  honest_note?: string | null;
}

interface FunnelSummary {
  since: string;
  until: string;
  pipeline: Pipeline;
  events_pipeline_flowing: boolean;
  tiles: FunnelTile[];
}

interface SurfaceRow {
  surface: string;
  view_count: number;
  video_finish_count: number;
  cta_click_count: number;
  fallback_trip_count: number;
}

interface PerSurfaceResponse {
  since: string;
  until: string;
  events_pipeline_flowing: boolean;
  rows: SurfaceRow[];
}

interface RecentEventItem {
  topic: string;
  ts_iso: string;
  session_id: string | null;
  data_preview: string;
}

interface RecentEventsResponse {
  events_pipeline_flowing: boolean;
  events: RecentEventItem[];
}

const DEFAULT_WINDOW_DAYS = 7;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

// ─── Component ───────────────────────────────────────────────────────
export function MoneyFunnelTab(): React.ReactElement {
  const [since, setSince] = useState<string>(isoDaysAgo(DEFAULT_WINDOW_DAYS));
  const [until, setUntil] = useState<string>(new Date().toISOString());
  const [pipeline, setPipeline] = useState<Pipeline>("section");

  const [summary, setSummary] = useState<FunnelSummary | null>(null);
  const [perSurface, setPerSurface] = useState<PerSurfaceResponse | null>(null);
  const [recent, setRecent] = useState<RecentEventsResponse | null>(null);

  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const q = new URLSearchParams({ since, until, pipeline }).toString();
      const [sumRes, surfRes, evRes] = await Promise.all([
        fetch(`/api/admin/money-funnel/summary?${q}`, { cache: "no-store" }),
        fetch(
          `/api/admin/money-funnel/per-surface?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`,
          { cache: "no-store" },
        ),
        fetch(`/api/admin/money-funnel/recent-events?limit=20`, { cache: "no-store" }),
      ]);
      if (!sumRes.ok) throw new Error(`summary · ${sumRes.status}`);
      if (!surfRes.ok) throw new Error(`per-surface · ${surfRes.status}`);
      if (!evRes.ok) throw new Error(`recent-events · ${evRes.status}`);
      const [sumJson, surfJson, evJson] = (await Promise.all([
        sumRes.json(),
        surfRes.json(),
        evRes.json(),
      ])) as [FunnelSummary, PerSurfaceResponse, RecentEventsResponse];
      setSummary(sumJson);
      setPerSurface(surfJson);
      setRecent(evJson);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setBusy(false);
    }
  }, [since, until, pipeline]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flowing = useMemo(
    () => Boolean(summary?.events_pipeline_flowing),
    [summary],
  );

  return (
    <section
      className="lc-hq-money-funnel rounded-3xl border border-line bg-paper-warm/40 p-5 sm:p-6"
      style={{ contain: "layout paint style" }}
      data-testid="money-funnel-tab"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            Money Funnel · Chapter 6
          </div>
          <p className="mt-1 font-sans text-[12px] text-text-secondary">
            5-tile funnel · 8-row per-surface breakdown · last 20 behavioural
            events. Read-only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            data-testid="money-funnel-refresh"
            className="rounded-full border border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] transition hover:border-fuchsia disabled:opacity-50"
            style={{ transitionDuration: "100ms" }}
          >
            {busy ? "Loading…" : "Refresh"}
          </button>
        </div>
      </header>

      {/* Filter row */}
      <div
        className="mt-4 flex flex-wrap items-end gap-3"
        data-testid="money-funnel-filters"
      >
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          Since
          <input
            type="datetime-local"
            value={since.slice(0, 16)}
            onChange={(e) => setSince(new Date(e.target.value).toISOString())}
            className="rounded border border-line bg-paper px-2 py-1 font-mono text-[11px] text-text-primary"
            data-testid="money-funnel-since"
          />
        </label>
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          Until
          <input
            type="datetime-local"
            value={until.slice(0, 16)}
            onChange={(e) => setUntil(new Date(e.target.value).toISOString())}
            className="rounded border border-line bg-paper px-2 py-1 font-mono text-[11px] text-text-primary"
            data-testid="money-funnel-until"
          />
        </label>
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          Pipeline
          <select
            value={pipeline}
            onChange={(e) => setPipeline(e.target.value as Pipeline)}
            className="rounded border border-line bg-paper px-2 py-1 font-mono text-[11px] text-text-primary"
            data-testid="money-funnel-pipeline"
          >
            <option value="section">section</option>
            <option value="design-os">design-os</option>
            <option value="all">all</option>
          </select>
        </label>
      </div>

      {/* Honest banner when events pipeline isn't persisted yet */}
      {summary && !flowing && (
        <div
          role="status"
          data-testid="money-funnel-honest-banner"
          className="mt-4 rounded-xl border border-fuchsia bg-fuchsia-soft px-4 py-3 font-mono text-[11px] text-fuchsia-deep"
        >
          Behavioural events pipeline logs to stdout only (see
          <code className="mx-1">/telemetry/diagnostic</code>). Tiles + tables
          show 0 until the persisted events table lands. New users tile is
          real — sourced from <code>users.created_at</code>.
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-fuchsia bg-fuchsia-soft px-4 py-3 font-mono text-[11px] text-fuchsia-deep"
          data-testid="money-funnel-error"
        >
          {error}
        </div>
      )}

      {/* 5-tile funnel top row */}
      {summary && (
        <div
          className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
          data-testid="money-funnel-tiles"
        >
          {summary.tiles.map((t) => {
            const isFallback = t.key === "section_fallback_trips";
            const nonZero = t.value > 0;
            const highlight = isFallback && nonZero;
            return (
              <div
                key={t.key}
                data-testid={`money-funnel-tile-${t.key}`}
                className="rounded-2xl border border-line p-4"
                style={
                  highlight
                    ? { background: "rgba(217, 155, 45, 0.10)", borderColor: "rgba(217, 155, 45, 0.42)" }
                    : undefined
                }
              >
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-tertiary">
                  {t.label}
                </div>
                <div className="mt-2 font-sans text-[22px] leading-none text-text-primary">
                  {t.value.toLocaleString()}
                </div>
                <div className="mt-2 truncate font-mono text-[9px] text-text-tertiary" title={t.source}>
                  {t.source}
                </div>
                {t.honest_note && (
                  <div className="mt-1 font-mono text-[9px] text-fuchsia-deep">
                    honest zero
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Per-surface breakdown table */}
      {perSurface && (
        <div className="mt-8">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            Per-surface breakdown · 8 approved money surfaces
          </div>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table
              className="w-full font-mono text-[11px]"
              data-testid="money-funnel-per-surface"
            >
              <thead>
                <tr className="border-b border-line bg-paper/40 text-text-tertiary">
                  <th className="p-2 text-left uppercase tracking-[0.1em]">Surface</th>
                  <th className="p-2 text-right uppercase tracking-[0.1em]">Views</th>
                  <th className="p-2 text-right uppercase tracking-[0.1em]">Video finishes</th>
                  <th className="p-2 text-right uppercase tracking-[0.1em]">CTA clicks</th>
                  <th className="p-2 text-right uppercase tracking-[0.1em]">Fallback trips</th>
                </tr>
              </thead>
              <tbody>
                {perSurface.rows.map((r) => (
                  <tr
                    key={r.surface}
                    className="border-b border-line last:border-b-0"
                    data-testid={`money-funnel-per-surface-row-${r.surface}`}
                  >
                    <td className="p-2 text-text-primary">{r.surface}</td>
                    <td className="p-2 text-right">{r.view_count.toLocaleString()}</td>
                    <td className="p-2 text-right">{r.video_finish_count.toLocaleString()}</td>
                    <td className="p-2 text-right">{r.cta_click_count.toLocaleString()}</td>
                    <td
                      className="p-2 text-right"
                      style={r.fallback_trip_count > 0 ? { color: "var(--lc-warn, #d99b2d)" } : undefined}
                    >
                      {r.fallback_trip_count.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent behavioural events feed */}
      {recent && (
        <div className="mt-8">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            Recent behavioural events · latest 20
          </div>
          {recent.events.length === 0 ? (
            <div
              className="rounded-xl border border-dashed border-line p-4 font-mono text-[11px] text-text-tertiary"
              data-testid="money-funnel-recent-events-empty"
            >
              No persisted events yet. Client emits stream to stdout at{" "}
              <code>/telemetry/diagnostic</code> — tail Railway logs for
              <code className="mx-1">[LC-CLIENT-DIAG]</code> lines.
            </div>
          ) : (
            <ul
              className="divide-y divide-line rounded-xl border border-line"
              data-testid="money-funnel-recent-events-feed"
            >
              {recent.events.map((ev, i) => (
                <li key={`${ev.ts_iso}-${i}`} className="flex items-baseline gap-3 p-2 font-mono text-[11px]">
                  <span className="text-text-tertiary">{ev.ts_iso}</span>
                  <span className="text-fuchsia-deep">{ev.topic}</span>
                  <span className="truncate text-text-primary" title={ev.data_preview}>
                    {ev.data_preview}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
