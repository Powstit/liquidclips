"use client";

/**
 * CampaignSubmissionsTab · AdminHQ audit follow-through · 2026-08-26.
 *
 * The gap the audit found: zero platform-wide visibility into
 * CampaignSubmission — only agency-owner-scoped reads existed
 * (agency_campaigns.py), so a platform admin had no way to see
 * submissions across every agency's campaigns in one place.
 *
 * Data: GET /api/admin/campaign-submissions
 * (junior-backend/app/routes/admin_platform_visibility.py)
 */

import { useCallback, useEffect, useState } from "react";

type SubmissionRow = {
  id: string;
  user_id: string;
  campaign_slug: string;
  campaign_title: string | null;
  campaign_owner_id: string | null;
  clip_url: string;
  moment_type: string;
  status: string;
  rejection_reason: string | null;
  verified_views: number;
  payout_usd_cents: number;
  whop_submission_id: string | null;
  created_at: string;
};

type SubmissionsResponse = { submissions: SubmissionRow[]; total_returned: number };

function statusTone(status: string): "ok" | "warn" | "fail" | "gray" {
  if (status === "accepted" || status === "paid") return "ok";
  if (status === "rejected") return "fail";
  if (status === "submitted" || status === "forwarded") return "warn";
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
    <span className="inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]" style={style}>
      {status}
    </span>
  );
}

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "—";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function CampaignSubmissionsTab() {
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [slugFilter, setSlugFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const params = new URLSearchParams();
    if (statusFilter) params.set("status_filter", statusFilter);
    if (slugFilter.trim()) params.set("campaign_slug", slugFilter.trim());
    try {
      const r = await fetch(`/api/admin/campaign-submissions?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = (await r.json()) as SubmissionsResponse;
      setRows(body.submissions || []);
    } catch (e) {
      // allow-raw-error — internal read-only admin tool, same pattern as
      // ClipRunsTab.tsx: operators want the real fetch error, not a
      // customer-safe message.
      setErr(e instanceof Error ? e.message : String(e)); // allow-raw-error — internal admin tool
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, slugFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const totalPayoutCents = rows.reduce((s, r) => s + (r.payout_usd_cents || 0), 0);
  const pendingCount = rows.filter((r) => r.status === "submitted").length;

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-line bg-paper-warm/40 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">Rows shown</div>
          <div className="mt-1 font-mono text-[16px] text-ink">{rows.length}</div>
        </div>
        <div className="rounded-2xl border border-line bg-paper-warm/40 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">Pending review</div>
          <div className="mt-1 font-mono text-[16px] text-ink">{pendingCount}</div>
        </div>
        <div className="rounded-2xl border border-line bg-paper-warm/40 p-3 sm:col-span-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">Total payout (shown rows)</div>
          <div className="mt-1 font-mono text-[16px] text-ink">${(totalPayoutCents / 100).toFixed(2)}</div>
        </div>
      </section>

      <section className="rounded-3xl border border-line bg-paper-warm/40 p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-md border border-line bg-paper px-2 py-1 font-mono text-[12px] text-ink outline-none focus:border-fuchsia">
              <option value="">any</option>
              <option value="submitted">submitted</option>
              <option value="accepted">accepted</option>
              <option value="rejected">rejected</option>
              <option value="forwarded">forwarded</option>
              <option value="paid">paid</option>
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            Campaign slug
            <input value={slugFilter} onChange={(e) => setSlugFilter(e.target.value)} placeholder="exact slug" className="rounded-md border border-line bg-paper px-2 py-1 font-mono text-[12px] text-ink outline-none focus:border-fuchsia" />
          </label>
          <div className="flex items-end">
            <button onClick={() => void load()} className="w-full rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia">
              {loading ? "loading…" : "refresh"}
            </button>
          </div>
        </div>
        {err && <p className="mt-2 font-mono text-[11px] text-red-500">error: {err}</p>}
      </section>

      <section className="overflow-x-auto rounded-3xl border border-line bg-paper-warm/40">
        <table className="w-full min-w-[900px] font-mono text-[12px]">
          <thead className="border-b border-line text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            <tr>
              <th className="px-3 py-2 text-left">Time</th>
              <th className="px-3 py-2 text-left">Campaign</th>
              <th className="px-3 py-2 text-left">Clipper</th>
              <th className="px-3 py-2 text-left">Clip URL</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-right">Payout</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-text-tertiary">
                  {loading ? "loading…" : "no submissions match this filter"}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line/60 hover:bg-paper/60">
                <td className="px-3 py-2">{formatTime(r.created_at)}</td>
                <td className="px-3 py-2">
                  <div>{r.campaign_title ?? r.campaign_slug}</div>
                  <div className="text-[10px] uppercase text-text-tertiary">{truncate(r.campaign_owner_id, 16)}</div>
                </td>
                <td className="px-3 py-2">{truncate(r.user_id, 16)}</td>
                <td className="px-3 py-2">
                  <a href={r.clip_url} target="_blank" rel="noreferrer" className="text-fuchsia hover:underline">
                    {truncate(r.clip_url, 40)}
                  </a>
                </td>
                <td className="px-3 py-2">
                  <StatusChip status={r.status} />
                  {r.status === "rejected" && r.rejection_reason && (
                    <div className="mt-1 text-[10px] text-red-400">{truncate(r.rejection_reason, 60)}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right">${(r.payout_usd_cents / 100).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
