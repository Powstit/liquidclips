"use client";

/**
 * CampaignsAdminTab · AdminHQ · 2026-09-01.
 *
 * Platform-wide campaign control. Distinct from the agency's own
 * `/agency` campaign pages (owner-scoped — an agency only sees and
 * manages campaigns it created). This tab is for the platform admin:
 * every campaign, any agency, with Suspend / Kill / Publish available
 * regardless of who owns it.
 *
 * No new backend surface needed — `GET /agency/campaigns`,
 * `POST /agency/campaigns/{slug}/status`, `/archive`, and `/publish`
 * (junior-backend/app/routes/agency_campaigns.py) already bypass the
 * ownership check for `is_admin_email(user.email)` callers (see
 * `_resolve_owned_or_404` — every one of these routes calls it, or the
 * equivalent bypass in `list_owned_campaigns`). The `/api/agency/*`
 * proxy's own gate also already accepts admin emails
 * (`isAdminEmail(email)` in gateRequest()). This tab is a thin UI over
 * capability that was already live in production — confirmed by
 * `test_admin_can_suspend_and_archive_any_agencys_campaign` in
 * junior-backend/tests/test_agency_campaign_tenant_isolation.py.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AgencyApiError,
  archiveCampaign,
  listMyCampaigns,
  publishCampaign,
  setCampaignStatus,
  type CampaignBlock,
} from "@/lib/agency-campaigns";

function statusTone(status: string): "ok" | "warn" | "fail" | "gray" {
  if (status === "live" || status === "funded" || status === "partially_funded") return "ok";
  if (status === "coming_soon" || status === "pending_reward") return "warn";
  if (status === "closed") return "fail";
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

export function CampaignsAdminTab() {
  const [rows, setRows] = useState<CampaignBlock[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");

  const load = useCallback(async () => {
    setErr(null);
    try {
      const list = await listMyCampaigns();
      setRows(list);
    } catch (e) {
      if (e instanceof AgencyApiError) setErr(`List failed (${e.status}).`);
      else setErr("List failed — backend unreachable.");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- triggers async fetch that hydrates React state from backend — canonical external-sync use of useEffect
    void load();
  }, [load]);

  const runAction = async (slug: string, action: () => Promise<unknown>) => {
    setBusySlug(slug);
    setErr(null);
    try {
      await action();
      await load();
    } catch (e) {
      if (e instanceof AgencyApiError) setErr(`${slug}: action failed (${e.status}).`);
      else setErr(`${slug}: action failed — backend unreachable.`);
    } finally {
      setBusySlug(null);
    }
  };

  const doSuspend = (slug: string) => runAction(slug, () => setCampaignStatus(slug, "coming_soon"));
  const doPublish = (slug: string) => runAction(slug, () => publishCampaign(slug));
  const doKill = (slug: string, title: string) => {
    if (!window.confirm(`Permanently delete "${title}"? This can't be undone.`)) return;
    void runAction(slug, () => archiveCampaign(slug));
  };

  const loading = rows === null;
  const visible = (rows ?? []).filter((r) => !statusFilter || r.status === statusFilter);

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-line bg-paper-warm/40 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">Total campaigns</div>
          <div className="mt-1 font-mono text-[16px] text-ink">{rows?.length ?? "—"}</div>
        </div>
        <div className="rounded-2xl border border-line bg-paper-warm/40 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">Live</div>
          <div className="mt-1 font-mono text-[16px] text-ink">{(rows ?? []).filter((r) => r.status === "live").length}</div>
        </div>
        <div className="rounded-2xl border border-line bg-paper-warm/40 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">Suspended</div>
          <div className="mt-1 font-mono text-[16px] text-ink">{(rows ?? []).filter((r) => r.status === "coming_soon").length}</div>
        </div>
        <div className="rounded-2xl border border-line bg-paper-warm/40 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">Closed</div>
          <div className="mt-1 font-mono text-[16px] text-ink">{(rows ?? []).filter((r) => r.status === "closed").length}</div>
        </div>
      </section>

      <section className="rounded-3xl border border-line bg-paper-warm/40 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-md border border-line bg-paper px-2 py-1 font-mono text-[12px] text-ink outline-none focus:border-fuchsia">
              <option value="">any</option>
              <option value="draft">draft</option>
              <option value="pending_reward">pending_reward</option>
              <option value="coming_soon">coming_soon</option>
              <option value="partially_funded">partially_funded</option>
              <option value="funded">funded</option>
              <option value="live">live</option>
              <option value="closed">closed</option>
            </select>
          </label>
          <button onClick={() => void load()} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia">
            {loading ? "loading…" : "refresh"}
          </button>
        </div>
        {err && <p className="mt-2 font-mono text-[11px] text-red-500">error: {err}</p>}
      </section>

      <section className="overflow-x-auto rounded-3xl border border-line bg-paper-warm/40">
        <table className="w-full min-w-[900px] font-mono text-[12px]">
          <thead className="border-b border-line text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            <tr>
              <th className="px-3 py-2 text-left">Campaign</th>
              <th className="px-3 py-2 text-left">Owner</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Created</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-text-tertiary">
                  {loading ? "loading…" : "no campaigns match this filter"}
                </td>
              </tr>
            )}
            {visible.map((c) => (
              <tr key={c.slug} className="border-b border-line/60 hover:bg-paper/60">
                <td className="px-3 py-2">
                  <div>{c.title}</div>
                  <div className="text-[10px] text-text-tertiary">{c.slug}</div>
                </td>
                <td className="px-3 py-2">{truncate(c.created_by, 16)}</td>
                <td className="px-3 py-2">
                  <StatusChip status={c.status} />
                </td>
                <td className="px-3 py-2">{formatTime(c.created_at)}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => void doPublish(c.slug)}
                      disabled={busySlug === c.slug || c.status === "live"}
                      title="Re-run the publish gate and go live"
                      className="rounded-full border border-line bg-paper px-3 py-1 text-[10px] uppercase tracking-[0.1em] text-ink hover:border-fuchsia disabled:opacity-40"
                    >
                      Live
                    </button>
                    <button
                      type="button"
                      onClick={() => void doSuspend(c.slug)}
                      disabled={busySlug === c.slug || c.status === "coming_soon" || c.status === "closed"}
                      title="Pull out of circulation — clippers see 'coming soon.' Reversible."
                      className="rounded-full border border-line bg-paper px-3 py-1 text-[10px] uppercase tracking-[0.1em] text-ink hover:border-fuchsia disabled:opacity-40"
                    >
                      Suspend
                    </button>
                    <button
                      type="button"
                      onClick={() => doKill(c.slug, c.title)}
                      disabled={busySlug === c.slug}
                      title="Permanently delete — no undo"
                      className="rounded-full border border-line bg-paper px-3 py-1 text-[10px] uppercase tracking-[0.1em] text-ink hover:border-red-400 hover:text-red-300 disabled:opacity-40"
                    >
                      Kill
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
