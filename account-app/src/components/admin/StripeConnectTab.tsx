"use client";

/**
 * StripeConnectTab · AdminHQ audit follow-through · 2026-08-26.
 *
 * The gap the audit found: stripe_connect.py already writes
 * stripe_connect_status / payouts_enabled / charges_enabled onto User
 * on every onboarding webhook, but zero admin tab ever read them — a
 * platform admin had no way to see who's actually able to receive a
 * payout versus who's stuck mid-onboarding.
 *
 * Data: GET /api/admin/stripe-connect
 * (junior-backend/app/routes/admin_platform_visibility.py)
 */

import { useCallback, useEffect, useState } from "react";

type StripeConnectRow = {
  user_id: string;
  email: string | null;
  tier: string;
  stripe_connect_account_id: string | null;
  stripe_connect_status: string;
  stripe_connect_payouts_enabled: boolean;
  stripe_connect_charges_enabled: boolean;
};

function StatusChip({ enabled }: { enabled: boolean }) {
  const style: React.CSSProperties = enabled
    ? { background: "rgba(77, 198, 168, 0.14)", color: "var(--lc-ok)", border: "1px solid rgba(77, 198, 168, 0.4)" }
    : { background: "rgba(217, 155, 45, 0.14)", color: "var(--lc-warn)", border: "1px solid rgba(217, 155, 45, 0.4)" };
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]" style={style}>
      {enabled ? "enabled" : "disabled"}
    </span>
  );
}

export function StripeConnectTab() {
  const [rows, setRows] = useState<StripeConnectRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/stripe-connect?only_connected=true`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = (await r.json()) as { users: StripeConnectRow[] };
      setRows(body.users || []);
    } catch (e) {
      // allow-raw-error — internal read-only admin tool, same pattern as
      // ClipRunsTab.tsx: operators want the real fetch error, not a
      // customer-safe message.
      setErr(e instanceof Error ? e.message : String(e)); // allow-raw-error — internal admin tool
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const payoutsReady = rows.filter((r) => r.stripe_connect_payouts_enabled).length;

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-paper-warm/40 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">Connected accounts</div>
          <div className="mt-1 font-mono text-[16px] text-ink">{rows.length}</div>
        </div>
        <div className="rounded-2xl border border-line bg-paper-warm/40 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">Payouts enabled</div>
          <div className="mt-1 font-mono text-[16px] text-ink">{payoutsReady}</div>
        </div>
        <div className="rounded-2xl border border-line bg-paper-warm/40 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">Stuck mid-onboarding</div>
          <div className="mt-1 font-mono text-[16px] text-ink">{rows.length - payoutsReady}</div>
        </div>
      </section>

      <section className="rounded-3xl border border-line bg-paper-warm/40 p-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            Showing users with a Stripe Connect account only
          </span>
          <button onClick={() => void load()} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia">
            {loading ? "loading…" : "refresh"}
          </button>
        </div>
        {err && <p className="mt-2 font-mono text-[11px] text-red-500">error: {err}</p>}
      </section>

      <section className="overflow-x-auto rounded-3xl border border-line bg-paper-warm/40">
        <table className="w-full min-w-[820px] font-mono text-[12px]">
          <thead className="border-b border-line text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            <tr>
              <th className="px-3 py-2 text-left">User</th>
              <th className="px-3 py-2 text-left">Tier</th>
              <th className="px-3 py-2 text-left">Connect account</th>
              <th className="px-3 py-2 text-left">Onboarding status</th>
              <th className="px-3 py-2 text-left">Charges</th>
              <th className="px-3 py-2 text-left">Payouts</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-text-tertiary">
                  {loading ? "loading…" : "no connected Stripe accounts yet"}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.user_id} className="border-b border-line/60 hover:bg-paper/60">
                <td className="px-3 py-2">{r.email ?? r.user_id}</td>
                <td className="px-3 py-2 uppercase text-text-tertiary">{r.tier}</td>
                <td className="px-3 py-2">{r.stripe_connect_account_id}</td>
                <td className="px-3 py-2">{r.stripe_connect_status}</td>
                <td className="px-3 py-2"><StatusChip enabled={r.stripe_connect_charges_enabled} /></td>
                <td className="px-3 py-2"><StatusChip enabled={r.stripe_connect_payouts_enabled} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
