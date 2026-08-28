"use client";

/**
 * OpsVisibilityTab · AdminHQ gap-closing audit · 2026-08-28.
 *
 * Daniel: "admin is to see all and be able to." Four real gaps found
 * with zero admin visibility despite the underlying feature being live:
 * scheduled posts, AI-thumbnail quota, LC ID redemption, and arcade
 * prize dispatch (the last one already had a correctly-built admin
 * endpoint that was simply unreachable through the proxy — same bug
 * class as canary.py/beta_cohort.py from the first audit pass).
 *
 * Data: junior-backend/app/routes/admin_ops_visibility.py
 */

import { useCallback, useEffect, useState } from "react";

type ScheduleRow = {
  id: string; user_id: string; user_email: string | null; project_slug: string;
  clip_title: string; platform: string; scheduled_for: string; status: string;
  post_url: string | null; error: string | null; retry_count: number;
};
type ThumbnailQuotaRow = {
  user_id: string; email: string | null; tier: string; founder_flag: boolean;
  used_this_period: number; boost_credit: number; period_start: string | null;
};
type LcIdRow = { user_id: string; email: string | null; lc_id: string; tier: string };
type ArcadePrizeCurrent = {
  month: string; prize_amount_usd: number; paid_sub_count: number;
  ends_at: string; current_leader: { handle: string | null; score: number } | null;
};
type ArcadePrizeHistoryEntry = {
  month: string; handle: string | null; score: number; amount_cents: number;
  paid_at: string | null; state: string;
};

const STATUS_COLOR: Record<string, string> = {
  pending: "var(--lc-warn)", uploading: "var(--lc-warn)", scheduled: "var(--lc-warn)",
  published: "var(--lc-ok)", failed: "#ef4444", canceled: "var(--text-tertiary)",
};

export function OpsVisibilityTab() {
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [quota, setQuota] = useState<ThumbnailQuotaRow[]>([]);
  const [lcIds, setLcIds] = useState<LcIdRow[]>([]);
  const [prizeCurrent, setPrizeCurrent] = useState<ArcadePrizeCurrent | null>(null);
  const [prizeHistory, setPrizeHistory] = useState<ArcadePrizeHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [s, q, l, pc, ph] = await Promise.all([
        fetch(`/api/admin/schedules`, { cache: "no-store" }),
        fetch(`/api/admin/thumbnail-quota`, { cache: "no-store" }),
        fetch(`/api/admin/lc-ids`, { cache: "no-store" }),
        fetch(`/api/admin/arcade-prize/current`, { cache: "no-store" }),
        fetch(`/api/admin/arcade-prize/history`, { cache: "no-store" }),
      ]);
      if (!s.ok || !q.ok || !l.ok || !pc.ok || !ph.ok) {
        throw new Error(`HTTP ${[s, q, l, pc, ph].map((r) => r.status).join("/")}`);
      }
      setSchedules(((await s.json()) as { schedules: ScheduleRow[] }).schedules || []);
      setQuota(((await q.json()) as { users: ThumbnailQuotaRow[] }).users || []);
      setLcIds(((await l.json()) as { users: LcIdRow[] }).users || []);
      setPrizeCurrent((await pc.json()) as ArcadePrizeCurrent);
      setPrizeHistory(((await ph.json()) as { winners: ArcadePrizeHistoryEntry[] }).winners || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e)); // allow-raw-error — internal admin tool
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function act(scheduleId: string, action: "retry" | "cancel") {
    setBusyId(scheduleId);
    try {
      const r = await fetch(`/api/admin/schedules/${scheduleId}/${action}`, { method: "POST" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e)); // allow-raw-error — internal admin tool
    } finally {
      setBusyId(null);
    }
  }

  async function dispatchPrize() {
    const month = prizeCurrent?.month ?? new Date().toISOString().slice(0, 7);
    setBusyId("dispatch");
    try {
      const r = await fetch(`/api/admin/arcade-prize/dispatch?month=${month}`, { method: "POST" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e)); // allow-raw-error — internal admin tool
    } finally {
      setBusyId(null);
    }
  }

  const failedCount = schedules.filter((s) => s.status === "failed").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          Schedules · thumbnail quota · LC IDs · arcade prize — platform-wide
        </span>
        <button onClick={() => void load()} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia">
          {loading ? "loading…" : "refresh"}
        </button>
      </div>
      {err && <p className="font-mono text-[11px] text-red-500">error: {err}</p>}

      {/* Scheduled posts */}
      <section className="overflow-x-auto rounded-3xl border border-line bg-paper-warm/40">
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink">Scheduled posts ({schedules.length})</span>
          {failedCount > 0 && <span className="font-mono text-[10px] text-red-500">{failedCount} failed</span>}
        </div>
        <table className="w-full min-w-[900px] font-mono text-[12px]">
          <thead className="border-b border-line text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            <tr>
              <th className="px-3 py-2 text-left">User</th>
              <th className="px-3 py-2 text-left">Clip</th>
              <th className="px-3 py-2 text-left">Platform</th>
              <th className="px-3 py-2 text-left">Scheduled for</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Error</th>
              <th className="px-3 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {schedules.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-text-tertiary">{loading ? "loading…" : "no scheduled posts"}</td></tr>
            )}
            {schedules.map((s) => (
              <tr key={s.id} className="border-b border-line/60 hover:bg-paper/60">
                <td className="px-3 py-2">{s.user_email ?? s.user_id}</td>
                <td className="px-3 py-2 max-w-[220px] truncate" title={s.clip_title}>{s.clip_title}</td>
                <td className="px-3 py-2 uppercase text-text-tertiary">{s.platform}</td>
                <td className="px-3 py-2">{new Date(s.scheduled_for).toLocaleString()}</td>
                <td className="px-3 py-2" style={{ color: STATUS_COLOR[s.status] ?? "var(--ink)" }}>{s.status}</td>
                <td className="px-3 py-2 max-w-[200px] truncate text-red-500" title={s.error ?? ""}>{s.error ?? "—"}</td>
                <td className="px-3 py-2 space-x-2">
                  <button
                    disabled={busyId === s.id}
                    onClick={() => void act(s.id, "retry")}
                    className="rounded-full border border-line px-2 py-1 text-[10px] uppercase hover:border-fuchsia"
                  >
                    retry
                  </button>
                  <button
                    disabled={busyId === s.id}
                    onClick={() => void act(s.id, "cancel")}
                    className="rounded-full border border-line px-2 py-1 text-[10px] uppercase hover:border-red-500"
                  >
                    cancel
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Thumbnail quota + LC IDs side by side */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="overflow-x-auto rounded-3xl border border-line bg-paper-warm/40">
          <div className="border-b border-line px-4 py-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink">AI thumbnail quota usage ({quota.length})</span>
          </div>
          <table className="w-full font-mono text-[12px]">
            <thead className="border-b border-line text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
              <tr><th className="px-3 py-2 text-left">User</th><th className="px-3 py-2 text-left">Tier</th><th className="px-3 py-2 text-left">Used</th><th className="px-3 py-2 text-left">Boost</th></tr>
            </thead>
            <tbody>
              {quota.length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-text-tertiary">{loading ? "loading…" : "no usage this period"}</td></tr>}
              {quota.map((u) => (
                <tr key={u.user_id} className="border-b border-line/60 hover:bg-paper/60">
                  <td className="px-3 py-2">{u.email ?? u.user_id}</td>
                  <td className="px-3 py-2 uppercase text-text-tertiary">{u.founder_flag ? "founder" : u.tier}</td>
                  <td className="px-3 py-2">{u.used_this_period}</td>
                  <td className="px-3 py-2">{u.boost_credit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="overflow-x-auto rounded-3xl border border-line bg-paper-warm/40">
          <div className="border-b border-line px-4 py-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink">LC IDs minted ({lcIds.length})</span>
          </div>
          <table className="w-full font-mono text-[12px]">
            <thead className="border-b border-line text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
              <tr><th className="px-3 py-2 text-left">User</th><th className="px-3 py-2 text-left">LC ID</th><th className="px-3 py-2 text-left">Tier</th></tr>
            </thead>
            <tbody>
              {lcIds.length === 0 && <tr><td colSpan={3} className="px-3 py-8 text-center text-text-tertiary">{loading ? "loading…" : "no LC IDs minted"}</td></tr>}
              {lcIds.map((u) => (
                <tr key={u.user_id} className="border-b border-line/60 hover:bg-paper/60">
                  <td className="px-3 py-2">{u.email ?? u.user_id}</td>
                  <td className="px-3 py-2">{u.lc_id}</td>
                  <td className="px-3 py-2 uppercase text-text-tertiary">{u.tier}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {/* Arcade prize */}
      <section className="rounded-3xl border border-line bg-paper-warm/40 p-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink">Arcade prize</span>
          <button
            disabled={busyId === "dispatch" || !prizeCurrent}
            onClick={() => void dispatchPrize()}
            className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia"
          >
            {busyId === "dispatch" ? "dispatching…" : `dispatch ${prizeCurrent?.month ?? ""}`}
          </button>
        </div>
        {prizeCurrent && (
          <p className="mt-2 font-mono text-[12px] text-text-tertiary">
            {prizeCurrent.month} · ${prizeCurrent.prize_amount_usd.toFixed(2)} · {prizeCurrent.paid_sub_count} paid subs ·
            {" "}leader: {prizeCurrent.current_leader ? `${prizeCurrent.current_leader.handle} (${prizeCurrent.current_leader.score})` : "none yet"}
          </p>
        )}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full font-mono text-[12px]">
            <thead className="border-b border-line text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
              <tr><th className="px-3 py-2 text-left">Month</th><th className="px-3 py-2 text-left">Winner</th><th className="px-3 py-2 text-left">Score</th><th className="px-3 py-2 text-left">Amount</th><th className="px-3 py-2 text-left">State</th></tr>
            </thead>
            <tbody>
              {prizeHistory.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-text-tertiary">{loading ? "loading…" : "no dispatched prizes yet"}</td></tr>}
              {prizeHistory.map((h) => (
                <tr key={h.month} className="border-b border-line/60 hover:bg-paper/60">
                  <td className="px-3 py-2">{h.month}</td>
                  <td className="px-3 py-2">{h.handle ?? "—"}</td>
                  <td className="px-3 py-2">{h.score}</td>
                  <td className="px-3 py-2">${(h.amount_cents / 100).toFixed(2)}</td>
                  <td className="px-3 py-2">{h.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
