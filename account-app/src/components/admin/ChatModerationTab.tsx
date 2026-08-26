"use client";

/**
 * ChatModerationTab · AdminHQ audit follow-through · 2026-08-26.
 *
 * The gap the audit found: real message-level moderation (hide / warn
 * / mute24h) and a real message model already existed, but were only
 * reachable from inside the desktop chat panel's own right-click menu
 * — the web admin had no cross-channel read and no way to act at all.
 *
 * Data: GET /api/admin/chat/messages, GET /api/admin/chat/muted-users
 * Actions: POST /api/admin/chat/messages/{id}/{hide|warn|mute24h}
 * (junior-backend/app/routes/chat_admin.py)
 */

import { useCallback, useEffect, useState } from "react";

type ChatMessageRow = {
  id: string;
  user_id: string;
  username: string;
  channel: string;
  content: string;
  role: string;
  pinned: boolean;
  hidden_at: string | null;
  hidden_by_user_id: string | null;
  hide_reason: string | null;
  created_at: string;
};

type MutedUser = { id: string; email: string | null; muted_until: string };

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function ChatModerationTab() {
  const [rows, setRows] = useState<ChatMessageRow[]>([]);
  const [muted, setMuted] = useState<MutedUser[]>([]);
  const [channel, setChannel] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const params = new URLSearchParams();
    if (channel) params.set("channel", channel);
    if (q.trim()) params.set("q", q.trim());
    try {
      const [msgRes, mutedRes] = await Promise.all([
        fetch(`/api/admin/chat/messages?${params.toString()}`, { cache: "no-store" }),
        fetch(`/api/admin/chat/muted-users`, { cache: "no-store" }),
      ]);
      if (!msgRes.ok) throw new Error(`HTTP ${msgRes.status}`);
      const msgBody = (await msgRes.json()) as { messages: ChatMessageRow[] };
      setRows(msgBody.messages || []);
      if (mutedRes.ok) {
        const mutedBody = (await mutedRes.json()) as { users: MutedUser[] };
        setMuted(mutedBody.users || []);
      }
    } catch (e) {
      // allow-raw-error — internal read-only admin tool, same pattern as
      // ClipRunsTab.tsx: operators want the real fetch error, not a
      // customer-safe message.
      setErr(e instanceof Error ? e.message : String(e)); // allow-raw-error — internal admin tool
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [channel, q]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function act(messageId: string, action: "hide" | "warn" | "mute24h", confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusyId(messageId + action);
    try {
      const r = await fetch(`/api/admin/chat/messages/${encodeURIComponent(messageId)}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: null }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setToast(`${action} sent`);
      await load();
    } catch (e) {
      // allow-raw-error — internal admin tool, same rationale as above.
      setToast(`${action} failed: ${e instanceof Error ? e.message : String(e)}`); // allow-raw-error — internal admin tool
    } finally {
      setBusyId(null);
      setTimeout(() => setToast(null), 3000);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-line bg-paper-warm/40 p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            Channel
            <select value={channel} onChange={(e) => setChannel(e.target.value)} className="rounded-md border border-line bg-paper px-2 py-1 font-mono text-[12px] text-ink outline-none focus:border-fuchsia">
              <option value="">all channels</option>
              <option value="global">global</option>
              <option value="agency-vip">agency-vip</option>
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            Search content / username
            <input value={q} onChange={(e) => setQ(e.target.value)} className="rounded-md border border-line bg-paper px-2 py-1 font-mono text-[12px] text-ink outline-none focus:border-fuchsia" />
          </label>
          <div className="flex items-end">
            <button onClick={() => void load()} className="w-full rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia">
              {loading ? "loading…" : "refresh"}
            </button>
          </div>
        </div>
        {err && <p className="mt-2 font-mono text-[11px] text-red-500">error: {err}</p>}
        {toast && <p className="mt-2 font-mono text-[11px] text-fuchsia">{toast}</p>}
      </section>

      {muted.length > 0 && (
        <section className="rounded-3xl border border-line bg-paper-warm/40 p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">Currently muted ({muted.length})</div>
          <ul className="mt-2 flex flex-wrap gap-2 font-mono text-[11px]">
            {muted.map((u) => (
              <li key={u.id} className="rounded-full border border-line bg-paper px-2 py-1 text-ink">
                {u.email ?? u.id} · until {formatTime(u.muted_until)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="overflow-x-auto rounded-3xl border border-line bg-paper-warm/40">
        <table className="w-full min-w-[900px] font-mono text-[12px]">
          <thead className="border-b border-line text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            <tr>
              <th className="px-3 py-2 text-left">Time</th>
              <th className="px-3 py-2 text-left">Channel</th>
              <th className="px-3 py-2 text-left">Author</th>
              <th className="px-3 py-2 text-left">Message</th>
              <th className="px-3 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-text-tertiary">
                  {loading ? "loading…" : "no messages match this filter"}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className={`border-b border-line/60 hover:bg-paper/60 ${r.hidden_at ? "opacity-60" : ""}`}>
                <td className="px-3 py-2">{formatTime(r.created_at)}</td>
                <td className="px-3 py-2">{r.channel}</td>
                <td className="px-3 py-2">
                  <div>{r.username}</div>
                  <div className="text-[10px] uppercase text-text-tertiary">{r.role}</div>
                </td>
                <td className="px-3 py-2 max-w-[360px]">
                  {r.content}
                  {r.hidden_at && <div className="mt-1 text-[10px] text-red-400">hidden{r.hide_reason ? ` · ${r.hide_reason}` : ""}</div>}
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <button
                      disabled={!!r.hidden_at || busyId === r.id + "hide"}
                      onClick={() => void act(r.id, "hide")}
                      className="rounded-full border border-line px-2 py-1 text-[10px] uppercase tracking-[0.08em] hover:border-fuchsia disabled:opacity-40"
                    >
                      hide
                    </button>
                    <button
                      disabled={busyId === r.id + "warn"}
                      onClick={() => void act(r.id, "warn")}
                      className="rounded-full border border-line px-2 py-1 text-[10px] uppercase tracking-[0.08em] hover:border-fuchsia disabled:opacity-40"
                    >
                      warn
                    </button>
                    <button
                      disabled={busyId === r.id + "mute24h"}
                      onClick={() => void act(r.id, "mute24h", `Mute ${r.username} for 24 hours?`)}
                      className="rounded-full border border-line px-2 py-1 text-[10px] uppercase tracking-[0.08em] hover:border-fuchsia disabled:opacity-40"
                    >
                      mute 24h
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
