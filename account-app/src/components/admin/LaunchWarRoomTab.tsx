"use client";

/**
 * LaunchWarRoomTab · Phase 1 · Cold-entry Mode B (2026-07-10).
 *
 * Dual-signal HQ control panel for the 16-system launch surface.
 *
 * Per Daniel's non-negotiable correction: DO NOT color a tile green
 * merely because the source code says a journey is wired. Every tile
 * fuses two signals:
 *
 *   Signal 1 · Build readiness — Journey Map classification + proof state
 *   Signal 2 · Live health      — recent failure rate + last successful
 *                                  journey completion + fixture-data flag
 *
 * Tile status matrix:
 *
 *   GREEN — launch-critical journeys wired AND recent live proof healthy
 *   AMBER — intentionally hidden / untested recently / degraded safely
 *   RED   — broken / missing / fixtures / failures / lacking proof
 *
 * Every tile displays:
 *   - system name + status pill
 *   - last successful proof time (or "no telemetry yet")
 *   - latest failure summary + timestamp
 *   - affected journey count
 *   - link to relevant Journey Map rows (filtered)
 *   - link to HQ run/error detail tab where available
 *
 * Honest telemetry state:
 *   The /telemetry/diagnostic pipeline logs to stdout only today.
 *   Event-based signal2 lands AMBER with the note
 *   "no live proof yet · telemetry pipeline pending" until the
 *   persisted events table ships. No fabrication.
 *
 * Wrapped locally in a Watchdog-lite boundary so a tile render error
 * paints a paused placeholder instead of white-screening HQ.
 *
 * Perf contract (matches other HQ tabs):
 *   - 30s auto-refresh · manual refresh button visible
 *   - no polling under 30s · backend caches for 30s
 *   - no backdrop-filter blur · no infinite CSS animations
 */

import { Component, useCallback, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from "react";

// ─── Loose types (backend is the source of truth) ────────────────────

type TileStatus = "green" | "amber" | "red";

interface Signal1 {
  ready: boolean;
  unready_count: number;
  total_journeys: number;
  note: string | null;
}

interface Signal2 {
  last_success_ts: string | null;
  last_failure_ts: string | null;
  last_failure_msg: string | null;
  has_recent_proof: boolean;
  recent_failure_rate: number | null;
  recent_window_hours: number;
  note: string | null;
}

interface Tile {
  system: string;
  tile_status: TileStatus;
  signal1: Signal1;
  signal2: Signal2;
  affected_journey_count: number;
  journey_map_filter: string | null;
  hq_detail_tab: string | null;
}

interface WarRoomSummary {
  generated_at: string;
  events_pipeline_flowing: boolean;
  tiles: Tile[];
  honest_note: string;
}

// ─── Watchdog-lite boundary (account-app hasn't imported the desktop-
//     side Watchdog primitive · same pattern as JourneyMapTab). ─────

class HqWatchdog extends Component<{ id: string; label: string; children: ReactNode }, { err: Error | null }> {
  override state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  override componentDidCatch(err: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error(`[hq-watchdog][${this.props.id}]`, err.message, info.componentStack);
  }
  override render() {
    if (this.state.err) {
      return (
        <div
          className="rounded-2xl border border-fuchsia bg-fuchsia-soft p-4 font-mono text-[11px] text-fuchsia-deep"
          role="alert"
          data-testid="hq-launch-war-room-error"
        >
          {this.props.label} paused · {String(this.state.err.message).slice(0, 200)}
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Public entry point ─────────────────────────────────────────────

export function LaunchWarRoomTab() {
  return (
    <HqWatchdog id="hq/launch-war-room" label="Launch War Room">
      <LaunchWarRoomBody />
    </HqWatchdog>
  );
}

// ─── Body ────────────────────────────────────────────────────────────

function LaunchWarRoomBody() {
  const [summary, setSummary] = useState<WarRoomSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/launch-war-room/summary", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as WarRoomSummary;
      setSummary(json);
      setRefreshedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- triggers async fetch that hydrates React state from backend — canonical external-sync use of useEffect
    void load();
    const id = window.setInterval(() => { void load(); }, 30_000);
    return () => { window.clearInterval(id); };
  }, [load]);

  const totals = useMemo(() => {
    if (!summary) return { green: 0, amber: 0, red: 0, total: 0 };
    let g = 0, a = 0, r = 0;
    for (const t of summary.tiles) {
      if (t.tile_status === "green") g += 1;
      else if (t.tile_status === "amber") a += 1;
      else r += 1;
    }
    return { green: g, amber: a, red: r, total: summary.tiles.length };
  }, [summary]);

  return (
    <div className="mt-3 flex flex-col gap-4" data-testid="hq-launch-war-room-root">
      {/* Header + overall roll-up */}
      <div className="rounded-2xl border border-line bg-paper-warm p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="font-display text-[18px] font-semibold text-ink">Launch War Room</h2>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
              16-system dual-signal readiness · build state × live health · refreshes every 30s
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RollUpChip label="green" value={totals.green} tone="ok" />
            <RollUpChip label="amber" value={totals.amber} tone="pending" />
            <RollUpChip label="red"   value={totals.red}   tone="fail" />
            <button
              type="button"
              onClick={() => { void load(); }}
              disabled={loading}
              className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[11px] uppercase tracking-[0.10em] text-ink hover:border-fuchsia disabled:opacity-40"
              data-testid="hq-launch-war-room-refresh"
            >
              {loading ? "refreshing…" : "refresh"}
            </button>
          </div>
        </div>
        {refreshedAt ? (
          <p className="mt-2 font-mono text-[10px] text-text-tertiary">
            Last refresh · {refreshedAt.toLocaleString(undefined, { hour12: false })}
          </p>
        ) : null}
      </div>

      {/* Honest telemetry banner */}
      {summary && !summary.events_pipeline_flowing ? (
        <div
          className="rounded-2xl border border-fuchsia bg-fuchsia-soft p-3 font-mono text-[11px] text-fuchsia-deep"
          data-testid="hq-launch-war-room-honest-banner"
        >
          {summary.honest_note}
        </div>
      ) : null}

      {error ? (
        <div
          className="rounded-2xl border border-fuchsia bg-fuchsia-soft p-3 font-mono text-[11px] text-fuchsia-deep"
          data-testid="hq-launch-war-room-fetch-error"
        >
          Backend unreachable · {error}
        </div>
      ) : null}

      {/* Tiles grid */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4" data-testid="hq-launch-war-room-tiles">
        {loading && !summary ? (
          Array.from({ length: 16 }).map((_, i) => <TileSkeleton key={i} />)
        ) : summary ? (
          summary.tiles.map((tile) => (
            <TileCard key={tile.system} tile={tile} />
          ))
        ) : null}
      </div>

      <p className="font-mono text-[10px] text-text-tertiary">
        Every tile fuses Journey Map readiness with live DB proof. GREEN = both healthy · AMBER = wired but no recent live proof · RED = broken, failing, or unproven.
      </p>
    </div>
  );
}

// ─── Individual tile card ────────────────────────────────────────────

function TileCard({ tile }: { tile: Tile }) {
  const rate = tile.signal2.recent_failure_rate;
  const rateLabel = rate === null ? null : `${(rate * 100).toFixed(1)}%`;
  const filterQuery = tile.journey_map_filter ? `?q=${encodeURIComponent(tile.journey_map_filter)}` : "";
  const testId = `hq-war-room-tile-${slug(tile.system)}`;

  return (
    <article
      className="rounded-2xl border border-line bg-paper p-3 flex flex-col gap-2"
      data-testid={testId}
      data-status={tile.tile_status}
      data-system={tile.system}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-display text-[13px] font-semibold text-ink">{tile.system}</span>
        <TileStatusPill status={tile.tile_status} />
      </div>

      <div className="grid grid-cols-2 gap-2 mt-1">
        <SignalCell
          label="build"
          tone={tile.signal1.ready ? "ok" : "fail"}
          value={tile.signal1.ready ? "ready" : "unready"}
          hint={tile.signal1.note ?? undefined}
        />
        <SignalCell
          label="live"
          tone={tile.signal2.has_recent_proof ? "ok" : (rate && rate >= 0.10) ? "fail" : "pending"}
          value={tile.signal2.has_recent_proof ? "proof ok" : "no recent proof"}
          hint={tile.signal2.note ?? undefined}
        />
      </div>

      <dl className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[10px] text-text-secondary">
        <dt className="uppercase tracking-[0.10em] text-text-tertiary">last success</dt>
        <dd className="text-ink" data-testid={`${testId}-last-success`}>
          {formatRelative(tile.signal2.last_success_ts) ?? "—"}
        </dd>
        <dt className="uppercase tracking-[0.10em] text-text-tertiary">last failure</dt>
        <dd className="text-ink" data-testid={`${testId}-last-failure`}>
          {tile.signal2.last_failure_ts ? formatRelative(tile.signal2.last_failure_ts) : "—"}
        </dd>
        {tile.signal2.last_failure_msg ? (
          <>
            <dt className="uppercase tracking-[0.10em] text-text-tertiary">msg</dt>
            <dd className="text-ink truncate" title={tile.signal2.last_failure_msg}>
              {tile.signal2.last_failure_msg}
            </dd>
          </>
        ) : null}
        <dt className="uppercase tracking-[0.10em] text-text-tertiary">journeys</dt>
        <dd className="text-ink" data-testid={`${testId}-affected-count`}>
          {tile.affected_journey_count} affected
        </dd>
        {rateLabel !== null ? (
          <>
            <dt className="uppercase tracking-[0.10em] text-text-tertiary">fail rate</dt>
            <dd className="text-ink">{rateLabel} · {tile.signal2.recent_window_hours}h</dd>
          </>
        ) : null}
      </dl>

      <div className="mt-2 flex flex-wrap items-center gap-1 font-mono text-[10px]">
        {/* NOTE: hash routes to the Journey Map tab inside AdminHQ. We
            emit a plain link so the parent tab-switcher can consume the
            search param when it lands; today the deep-link filter is a
            best-effort hint until AdminHQ.tsx wires the query. */}
        <a
          href={`#hq/journey-map${filterQuery}`}
          className="rounded-full border border-line bg-paper-warm px-2 py-0.5 uppercase tracking-[0.08em] text-ink hover:border-fuchsia"
          data-testid={`${testId}-journey-map-link`}
        >
          Journey Map →
        </a>
        {tile.hq_detail_tab ? (
          <a
            href={`#hq/${encodeURIComponent(tile.hq_detail_tab)}`}
            className="rounded-full border border-line bg-paper-warm px-2 py-0.5 uppercase tracking-[0.08em] text-ink hover:border-fuchsia"
            data-testid={`${testId}-hq-detail-link`}
          >
            {tile.hq_detail_tab} →
          </a>
        ) : null}
      </div>
    </article>
  );
}

// ─── Small building blocks ──────────────────────────────────────────

function TileSkeleton() {
  return (
    <div className="rounded-2xl border border-line bg-paper p-3 h-40 animate-pulse" aria-hidden="true">
      <div className="h-4 w-24 rounded bg-line" />
      <div className="mt-2 h-3 w-40 rounded bg-line" />
      <div className="mt-6 h-3 w-32 rounded bg-line" />
      <div className="mt-1 h-3 w-28 rounded bg-line" />
    </div>
  );
}

function TileStatusPill({ status }: { status: TileStatus }) {
  const cfg =
    status === "green" ? { label: "green", style: { borderColor: "rgba(77, 198, 168, 0.42)", background: "rgba(77, 198, 168, 0.10)", color: "var(--lc-ok)" } }
    : status === "amber" ? { label: "amber", style: { borderColor: "rgba(217, 155, 45, 0.42)", background: "rgba(217, 155, 45, 0.10)", color: "var(--lc-warn)" } }
    : { label: "red", style: { borderColor: "rgba(255, 102, 184, 0.40)", background: "var(--lc-accent-soft)", color: "var(--lc-accent-mid)" } };
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]"
      style={cfg.style}
    >
      {cfg.label}
    </span>
  );
}

function SignalCell({
  label,
  tone,
  value,
  hint,
}: { label: string; tone: "ok" | "pending" | "fail"; value: string; hint?: string }) {
  const style: React.CSSProperties =
    tone === "ok" ? { borderColor: "rgba(77, 198, 168, 0.42)", background: "rgba(77, 198, 168, 0.06)", color: "var(--lc-ok)" }
    : tone === "pending" ? { borderColor: "rgba(217, 155, 45, 0.42)", background: "rgba(217, 155, 45, 0.06)", color: "var(--lc-warn)" }
    : { borderColor: "rgba(255, 102, 184, 0.40)", background: "var(--lc-accent-soft, rgba(255, 26, 140, 0.06))", color: "var(--lc-accent-mid, #ff66b8)" };
  return (
    <div
      className="rounded-lg border p-2 flex flex-col gap-0.5 font-mono text-[10px]"
      style={style}
      title={hint}
    >
      <span className="uppercase tracking-[0.10em] opacity-80">{label}</span>
      <span className="font-bold uppercase tracking-[0.06em]">{value}</span>
    </div>
  );
}

function RollUpChip({ label, value, tone }: { label: string; value: number; tone: "ok" | "pending" | "fail" }) {
  const style: React.CSSProperties =
    tone === "ok" ? { borderColor: "rgba(77, 198, 168, 0.42)", background: "rgba(77, 198, 168, 0.10)", color: "var(--lc-ok)" }
    : tone === "pending" ? { borderColor: "rgba(217, 155, 45, 0.42)", background: "rgba(217, 155, 45, 0.10)", color: "var(--lc-warn)" }
    : { borderColor: "rgba(255, 102, 184, 0.40)", background: "var(--lc-accent-soft, rgba(255, 26, 140, 0.10))", color: "var(--lc-accent-mid, #ff66b8)" };
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.10em]"
      style={style}
      data-testid={`hq-launch-war-room-rollup-${label}`}
    >
      <span className="font-bold">{value}</span>
      <span>{label}</span>
    </span>
  );
}

// ─── Utils ──────────────────────────────────────────────────────────

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function formatRelative(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const now = Date.now();
  const diffMs = now - then;
  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}
