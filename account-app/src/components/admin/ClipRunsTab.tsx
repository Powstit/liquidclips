"use client";

/**
 * ClipRunsTab · Control Tower · 2026-07-09.
 *
 * The whole point: HQ becomes the brain for clipping · no Railway
 * archaeology, no Sentry stitching, no log grep. One table. One detail
 * view. A 15-year-old can spot the bad row in 2 seconds.
 *
 * Layout (per Daniel's 6-column spec):
 *   TIME · USER · STATUS · COST · STAGE · REASON
 *
 * Click a row → detail modal with linear stage timeline + provider +
 * files-written + cost + customer-visible error.
 *
 * Data:
 *   GET /api/admin/clip-runs?hours=24
 *   GET /api/admin/clip-runs/{run_id}
 *
 * Filters (top strip): hours window · status · failure_layer · provider ·
 * user/run-id search. All optional. Default = last 24h, all statuses.
 */

import { useCallback, useEffect, useState } from "react";

// ── types (match junior-backend/app/routes/clip_runs.py) ──────────────
type ClipRunRow = {
  run_id: string;
  user_id: string;
  tier: string | null;
  status: string;
  source_type: string | null;
  current_stage: string | null;
  clips_generated: number;
  failure_reason: string | null;
  clip_judge_provider: string | null;
  cost_usd: number;
  created_at: string;
};

type ClipRunListResponse = {
  rows: ClipRunRow[];
  total: number;
  hours: number;
};

type StageEntry = {
  stage: string;
  status: string;
  started_at: string | null;
  duration_ms: number | null;
  provider: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd_cents: number | null;
  error_code: string | null;
  error_message: string | null;
  retry_count: number;
};

type ClipRunDetail = {
  run_id: string;
  user_id: string;
  workspace_id: string | null;
  tier: string | null;
  app_version: string | null;
  runtime_version: string | null;
  sidecar_version: string | null;
  source_type: string | null;
  source_url_or_file_type: string | null;
  video_duration_seconds: number | null;
  requested_clip_count: number | null;
  status: string;
  current_stage: string | null;
  failure_layer: string | null;
  failure_reason: string | null;
  customer_visible_error: string | null;
  clip_judge_provider: string | null;
  clip_judge_model: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  clips_generated: number;
  stages: StageEntry[];
  created_at: string;
  completed_at: string | null;
};

// ── colour helpers · the 15-year-old scan ─────────────────────────────
function statusTone(status: string): "ok" | "warn" | "fail" | "gray" {
  if (status === "success") return "ok";
  if (status === "failed") return "fail";
  if (status === "cancelled") return "gray";
  if (status === "running" || status === "queued") return "warn";
  return "gray";
}

function StatusChip({ status }: { status: string }) {
  const tone = statusTone(status);
  const style: React.CSSProperties =
    tone === "ok"
      ? { background: "rgba(77, 198, 168, 0.14)", color: "var(--lc-ok)", border: "1px solid rgba(77, 198, 168, 0.4)" }
      : tone === "warn"
        ? { background: "rgba(217, 155, 45, 0.14)", color: "var(--lc-warn)", border: "1px solid rgba(217, 155, 45, 0.4)" }
        : tone === "fail"
          ? { background: "rgba(255, 102, 184, 0.16)", color: "var(--lc-accent-mid)", border: "1px solid rgba(255, 102, 184, 0.4)" }
          : { background: "color-mix(in srgb, var(--lc-bg-warm) 70%, transparent)", color: "var(--lc-fg-faint)", border: "1px solid var(--lc-stroke)" };
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]"
      style={style}
    >
      {status}
    </span>
  );
}

function formatCost(usd: number): string {
  if (!usd || usd === 0) return "$0.00";
  return `$${usd.toFixed(4)}`;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "—";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// ── the tab ───────────────────────────────────────────────────────────
export function ClipRunsTab() {
  const [rows, setRows] = useState<ClipRunRow[]>([]);
  const [total, setTotal] = useState(0);
  const [hours, setHours] = useState(24);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [providerFilter, setProviderFilter] = useState<string>("");
  const [failureFilter, setFailureFilter] = useState<string>("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<ClipRunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const params = new URLSearchParams({ hours: String(hours) });
    if (statusFilter) params.set("status", statusFilter);
    if (providerFilter) params.set("provider", providerFilter);
    if (failureFilter) params.set("failure_layer", failureFilter);
    if (q.trim()) params.set("q", q.trim());
    try {
      const r = await fetch(`/api/admin/clip-runs?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = (await r.json()) as ClipRunListResponse;
      setRows(body.rows || []);
      setTotal(body.total || 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [hours, statusFilter, providerFilter, failureFilter, q]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- triggers async fetch that hydrates React state from backend — canonical external-sync use of useEffect
    void load();
  }, [load]);

  async function openDetail(runId: string) {
    setDetail(null);
    setDetailLoading(true);
    try {
      const r = await fetch(`/api/admin/clip-runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setDetail((await r.json()) as ClipRunDetail);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailLoading(false);
    }
  }

  // Summary tiles derived from the current row set. Kept simple — a
  // 15-year-old reads the numbers, not a chart.
  const summary = {
    total: rows.length,
    success: rows.filter(r => r.status === "success").length,
    failed: rows.filter(r => r.status === "failed").length,
    zeroClipPaid: rows.filter(r => r.cost_usd > 0 && r.clips_generated === 0).length,
    totalSpend: rows.reduce((s, r) => s + r.cost_usd, 0),
  };
  const successRate = summary.total > 0 ? (summary.success / summary.total) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Summary strip · big numbers · one glance and you know. */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tile label="Runs" value={String(summary.total)} tone="gray" />
        <Tile
          label="Success rate"
          value={`${successRate.toFixed(1)}%`}
          tone={successRate >= 95 ? "ok" : successRate >= 80 ? "warn" : "fail"}
        />
        <Tile label="Failed" value={String(summary.failed)} tone={summary.failed > 0 ? "fail" : "ok"} />
        <Tile
          label="Paid · 0 clips"
          value={String(summary.zeroClipPaid)}
          tone={summary.zeroClipPaid > 0 ? "fail" : "ok"}
        />
        <Tile label="Total spend" value={`$${summary.totalSpend.toFixed(2)}`} tone="gray" />
      </section>

      {/* Filters · plain form controls · no widgets */}
      <section className="rounded-3xl border border-line bg-paper-warm/40 p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          <label className="col-span-2 flex flex-col gap-1 text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            Search user / run_id
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="user_id or run_id"
              className="rounded-md border border-line bg-paper px-2 py-1 font-mono text-[12px] text-ink outline-none focus:border-fuchsia"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            Window
            <select
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className="rounded-md border border-line bg-paper px-2 py-1 font-mono text-[12px] text-ink outline-none focus:border-fuchsia"
            >
              <option value={1}>Last hour</option>
              <option value={24}>Last 24h</option>
              <option value={168}>Last 7d</option>
              <option value={720}>Last 30d</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            Status
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border border-line bg-paper px-2 py-1 font-mono text-[12px] text-ink outline-none focus:border-fuchsia"
            >
              <option value="">any</option>
              <option>success</option>
              <option>failed</option>
              <option>running</option>
              <option>cancelled</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            Provider
            <select
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.target.value)}
              className="rounded-md border border-line bg-paper px-2 py-1 font-mono text-[12px] text-ink outline-none focus:border-fuchsia"
            >
              <option value="">any</option>
              <option value="hosted_anthropic">hosted_anthropic</option>
              <option value="anthropic">anthropic (BYOK)</option>
              <option value="openai">openai (BYOK)</option>
              <option value="hosted">hosted (OpenAI)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            Failure layer
            <select
              value={failureFilter}
              onChange={(e) => setFailureFilter(e.target.value)}
              className="rounded-md border border-line bg-paper px-2 py-1 font-mono text-[12px] text-ink outline-none focus:border-fuchsia"
            >
              <option value="">any</option>
              <option>runtime</option>
              <option>sidecar</option>
              <option>backend</option>
              <option>provider</option>
              <option>whop</option>
              <option>filesystem</option>
              <option>native</option>
              <option>auth</option>
              <option>billing</option>
              <option>unknown</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            Showing {rows.length} of {total} runs · {hours}h window
          </span>
          <button
            onClick={() => void load()}
            className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia"
          >
            {loading ? "loading…" : "refresh"}
          </button>
        </div>
        {err && (
          <p className="mt-2 font-mono text-[11px] text-red-500">error: {err}</p>
        )}
      </section>

      {/* The 6-column table · TIME · USER · STATUS · COST · STAGE · REASON */}
      <section className="overflow-x-auto rounded-3xl border border-line bg-paper-warm/40">
        <table className="w-full min-w-[720px] font-mono text-[12px]">
          <thead className="border-b border-line text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            <tr>
              <th className="px-3 py-2 text-left">Time</th>
              <th className="px-3 py-2 text-left">User · Tier</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-right">Cost</th>
              <th className="px-3 py-2 text-left">Stage · Provider</th>
              <th className="px-3 py-2 text-left">Reason / Clips</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-text-tertiary">
                  {loading ? "loading…" : "no runs in window"}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.run_id}
                onClick={() => void openDetail(r.run_id)}
                className="cursor-pointer border-b border-line/60 hover:bg-paper/60"
              >
                <td className="px-3 py-2">{formatTime(r.created_at)}</td>
                <td className="px-3 py-2">
                  <div>{truncate(r.user_id, 20)}</div>
                  <div className="text-[10px] uppercase text-text-tertiary">{r.tier ?? "—"}</div>
                </td>
                <td className="px-3 py-2"><StatusChip status={r.status} /></td>
                <td className="px-3 py-2 text-right">{formatCost(r.cost_usd)}</td>
                <td className="px-3 py-2">
                  <div>{r.current_stage ?? "—"}</div>
                  <div className="text-[10px] uppercase text-text-tertiary">{r.clip_judge_provider ?? "—"}</div>
                </td>
                <td className="px-3 py-2">
                  {r.status === "success" ? (
                    <span>{r.clips_generated} clips</span>
                  ) : (
                    <span className="text-red-400">{truncate(r.failure_reason, 80)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Detail modal · linear timeline · no charts */}
      {(detail || detailLoading) && (
        <DetailModal
          detail={detail}
          loading={detailLoading}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" | "fail" | "gray" }) {
  const border =
    tone === "ok" ? "rgba(77, 198, 168, 0.4)"
    : tone === "warn" ? "rgba(217, 155, 45, 0.4)"
    : tone === "fail" ? "rgba(255, 102, 184, 0.4)"
    : "var(--lc-stroke)";
  return (
    <div className="rounded-2xl border bg-paper-warm/40 p-3" style={{ borderColor: border }}>
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">{label}</div>
      <div className="mt-1 font-mono text-[16px] text-ink">{value}</div>
    </div>
  );
}

function DetailModal({
  detail,
  loading,
  onClose,
}: {
  detail: ClipRunDetail | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-line bg-paper p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
              Clip Run detail
            </div>
            <div className="mt-1 font-mono text-[14px] text-ink">
              {detail ? detail.run_id : loading ? "loading…" : "—"}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full border border-line bg-paper-warm px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia"
          >
            close
          </button>
        </div>

        {detail && (
          <div className="mt-4 space-y-4 font-mono text-[12px]">
            {/* Headline row */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <KV label="Status">
                <StatusChip status={detail.status} />
              </KV>
              <KV label="User">{truncate(detail.user_id, 22)}</KV>
              <KV label="Tier">{detail.tier ?? "—"}</KV>
              <KV label="Cost">{formatCost(detail.cost_usd)}</KV>
              <KV label="Clips">{String(detail.clips_generated)}</KV>
              <KV label="Provider">{detail.clip_judge_provider ?? "—"}</KV>
              <KV label="Model">{detail.clip_judge_model ?? "—"}</KV>
              <KV label="Duration">{detail.video_duration_seconds ? `${detail.video_duration_seconds}s` : "—"}</KV>
            </div>

            {/* Customer-visible error */}
            {detail.customer_visible_error && (
              <div className="rounded-2xl border border-red-400/40 bg-red-500/10 p-3">
                <div className="text-[10px] uppercase tracking-[0.12em] text-red-400">
                  Customer saw
                </div>
                <div className="mt-1 text-red-100">{detail.customer_visible_error}</div>
              </div>
            )}

            {/* Failure layer + reason */}
            {detail.status === "failed" && (
              <div className="rounded-2xl border border-red-400/40 bg-red-500/5 p-3">
                <div className="text-[10px] uppercase tracking-[0.12em] text-red-400">
                  Failure · {detail.failure_layer ?? "unknown"} layer
                </div>
                <div className="mt-1">{detail.failure_reason ?? "—"}</div>
              </div>
            )}

            {/* Source */}
            <KV label="Source">
              <span>
                {detail.source_type ?? "?"} · {truncate(detail.source_url_or_file_type, 80)}
              </span>
            </KV>

            {/* Stage timeline · linear · top-to-bottom · no chart */}
            <div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                Timeline
              </div>
              <ol className="mt-2 space-y-1">
                {(detail.stages || []).map((s, i) => (
                  <li key={`${s.stage}-${i}`} className="rounded-xl border border-line bg-paper-warm/40 p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px]">{s.stage}</span>
                      <StatusChip status={s.status} />
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-x-3 text-[11px] text-text-tertiary sm:grid-cols-4">
                      <span>duration · {s.duration_ms ? `${(s.duration_ms / 1000).toFixed(1)}s` : "—"}</span>
                      {s.provider && <span>provider · {s.provider}</span>}
                      {s.model && <span>model · {truncate(s.model, 18)}</span>}
                      {(s.input_tokens || s.output_tokens) && (
                        <span>tokens · {s.input_tokens ?? 0}→{s.output_tokens ?? 0}</span>
                      )}
                      {s.cost_usd_cents !== null && s.cost_usd_cents !== undefined && s.cost_usd_cents > 0 && (
                        <span>cost · ${(s.cost_usd_cents / 100).toFixed(4)}</span>
                      )}
                    </div>
                    {s.error_message && (
                      <div className="mt-1 text-[11px] text-red-400">
                        error · {s.error_message}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </div>

            {/* Versions row */}
            <div className="grid grid-cols-3 gap-3 text-[11px] text-text-tertiary">
              <KV label="App version">{detail.app_version ?? "—"}</KV>
              <KV label="Runtime">{detail.runtime_version ?? "—"}</KV>
              <KV label="Sidecar">{detail.sidecar_version ?? "—"}</KV>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.12em] text-text-tertiary">{label}</div>
      <div className="mt-0.5 text-ink">{children}</div>
    </div>
  );
}
