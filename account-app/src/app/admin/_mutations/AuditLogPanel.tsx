"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { mutationsApi, type AuditRow } from "./api";

// HQ Agent 3 · Audit log panel.
//
// Renders the last N audit rows with simple filters (actor email, action,
// target id). The panel polls on mount + when `refreshKey` ticks (parent
// bumps it after every mutation so a fired action shows up immediately).

const PAGE_SIZE = 50;

export function AuditLogPanel({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterActor, setFilterActor] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterTarget, setFilterTarget] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await mutationsApi.auditLog({
        limit: PAGE_SIZE,
        sinceHours: 168,
        actor: filterActor.trim() || undefined,
        action: filterAction.trim() || undefined,
        userId: filterTarget.trim() || undefined,
      });
      setRows(res.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [filterActor, filterAction, filterTarget]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const actions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.action);
    return Array.from(set).sort();
  }, [rows]);

  return (
    <section className="rounded-3xl border border-neutral-200 bg-white p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-500">
            audit log · last 7 days
          </div>
          <h3 className="mt-1 font-display text-[18px] font-semibold tracking-[-0.02em] text-neutral-900">
            Mutation history
          </h3>
        </div>
        <button
          type="button"
          onClick={load}
          className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-neutral-800 hover:border-pink-500"
        >
          refresh
        </button>
      </header>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <input
          value={filterActor}
          onChange={(e) => setFilterActor(e.target.value)}
          placeholder="actor email contains…"
          className="rounded-xl border border-neutral-300 bg-white px-3 py-2 font-mono text-[11px] text-neutral-900 placeholder:text-neutral-400 focus:border-pink-500 focus:outline-none"
        />
        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          className="rounded-xl border border-neutral-300 bg-white px-3 py-2 font-mono text-[11px] text-neutral-900 focus:border-pink-500 focus:outline-none"
        >
          <option value="">all actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <input
          value={filterTarget}
          onChange={(e) => setFilterTarget(e.target.value)}
          placeholder="target id exact match…"
          className="rounded-xl border border-neutral-300 bg-white px-3 py-2 font-mono text-[11px] text-neutral-900 placeholder:text-neutral-400 focus:border-pink-500 focus:outline-none"
        />
      </div>

      {loading && (
        <div className="mt-3 font-mono text-[11px] text-neutral-500">loading…</div>
      )}
      {error && (
        <div className="mt-3 rounded-xl border border-pink-300 bg-pink-50 px-3 py-2 font-mono text-[11px] text-pink-700">
          {error}
        </div>
      )}

      {!loading && rows.length === 0 && !error && (
        <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 font-mono text-[11px] text-neutral-500">
          No audit rows in this window.
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr className="text-left text-neutral-500">
                {["when", "actor", "action", "target", "result", "payload"].map((h) => (
                  <th key={h} className="border-b border-neutral-200 px-2 py-2 font-normal uppercase tracking-[0.08em]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-neutral-100">
                  <td className="px-2 py-2 text-neutral-500">{r.created_at?.slice(0, 19) ?? "—"}</td>
                  <td className="px-2 py-2 text-neutral-800">{r.actor_email}</td>
                  <td className="px-2 py-2">
                    <span className="rounded-full border border-neutral-300 bg-neutral-50 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-neutral-700">
                      {r.action}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-neutral-700">
                    <span className="text-neutral-400">{r.target_type}/</span>
                    {r.target_id}
                  </td>
                  <td className="px-2 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${
                        r.result === "ok"
                          ? "border border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border border-pink-300 bg-pink-50 text-pink-700"
                      }`}
                    >
                      {r.result}
                      {r.error_message ? ` · ${r.error_message.slice(0, 32)}` : ""}
                    </span>
                  </td>
                  <td className="px-2 py-2 max-w-[420px]">
                    <details className="cursor-pointer">
                      <summary className="text-neutral-500 hover:text-neutral-800">
                        {summarise(r.payload)}
                      </summary>
                      <pre className="mt-1 max-w-[400px] overflow-x-auto rounded bg-neutral-50 p-2 text-[10px] text-neutral-700">
                        {JSON.stringify(r.payload, null, 2)}
                      </pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function summarise(payload: Record<string, unknown>): string {
  const entries = Object.entries(payload).slice(0, 3);
  if (entries.length === 0) return "(empty)";
  return entries
    .map(([k, v]) => {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}=${s.length > 24 ? `${s.slice(0, 24)}…` : s}`;
    })
    .join(" · ");
}
