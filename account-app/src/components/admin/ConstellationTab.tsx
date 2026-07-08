"use client";

/**
 * ConstellationTab · HQ visibility into the Constellation Engine · 2026-07-08
 *
 * Wires the shipped backend endpoints (require_admin gated · already in the
 * admin proxy allowlist per src/app/api/admin/[...path]/route.ts) into a
 * single at-a-glance view for HQ admins:
 *
 *   GET /admin/constellation/state          · full sky-map · nodes + clusters
 *   GET /admin/constellation/pool/status    · LLM pool slots + health
 *   GET /admin/constellation/patches        · self-healing patch review queue
 *
 * Ships as read-only. Pool mutations + patch approvals live in the
 * existing endpoints and can wire up in a follow-up.
 */
import { useCallback, useEffect, useState } from "react";

type NodeState = {
  id?: string;
  cluster?: string;
  journey_id?: string;
  component?: string;
  health?: string;
  last_seen?: string | null;
  status?: string;
};

type SkyMap = {
  clusters?: Record<string, unknown>;
  nodes?: NodeState[];
  meta?: Record<string, unknown>;
};

type PoolSlot = {
  slot?: number;
  url?: string | null;
  enabled?: boolean;
  model?: string | null;
  health?: string;
  last_ok_at?: string | null;
  last_error?: string | null;
};

type PoolStatus = {
  slots?: PoolSlot[];
  fallback_llm?: string | null;
  encryption_key_configured?: boolean;
};

type Patch = {
  id?: string;
  node_id?: string;
  summary?: string;
  status?: string;
  created_at?: string;
  reviewer?: string | null;
};

export function ConstellationTab() {
  const [skyMap, setSkyMap] = useState<SkyMap | null>(null);
  const [pool, setPool] = useState<PoolStatus | null>(null);
  const [patches, setPatches] = useState<Patch[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const [s, p, patchRes] = await Promise.all([
        fetch("/api/admin/constellation/state"),
        fetch("/api/admin/constellation/pool/status"),
        fetch("/api/admin/constellation/patches"),
      ]);
      if (s.ok) setSkyMap((await s.json()) as SkyMap);
      if (p.ok) setPool((await p.json()) as PoolStatus);
      if (patchRes.ok) {
        const body = (await patchRes.json()) as { patches?: Patch[] };
        setPatches(body?.patches ?? []);
      }
      if (!s.ok && !p.ok && !patchRes.ok) {
        setErr(`state ${s.status} · pool ${p.status} · patches ${patchRes.status}`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const nodes = skyMap?.nodes ?? [];
  const clusters = skyMap?.clusters ?? {};
  const healthCounts = nodes.reduce<Record<string, number>>((acc, n) => {
    const h = (n.health ?? "unknown").toLowerCase();
    acc[h] = (acc[h] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="lc-hq-panel">
      <header className="lc-hq-panel-head">
        <h2 className="lc-hq-panel-title">Constellation Engine</h2>
        <p className="lc-hq-panel-sub">
          Live sky-map of the self-healing node runtime. Backend routes:
          {" "}<code>/admin/constellation/state</code> · <code>/pool/status</code> ·
          {" "}<code>/patches</code>. Auto-refreshes every 30s. Read-only for now ·
          pool member overrides + patch approvals wire up in a follow-up.
        </p>
      </header>

      {loading && !skyMap && <p className="lc-hq-help">Loading…</p>}
      {err && <p className="lc-hq-err">Fetch error · {err}</p>}

      <section className="lc-hq-grid">
        <article className="lc-hq-card">
          <p className="lc-hq-eb">Nodes</p>
          <p className="lc-hq-big">{nodes.length}</p>
          <p className="lc-hq-help">
            {Object.entries(healthCounts).map(([h, n]) => `${h}: ${n}`).join(" · ")}
          </p>
        </article>
        <article className="lc-hq-card">
          <p className="lc-hq-eb">Clusters</p>
          <p className="lc-hq-big">{Object.keys(clusters).length}</p>
          <p className="lc-hq-help">
            {Object.keys(clusters).slice(0, 4).join(" · ") || "—"}
          </p>
        </article>
        <article className="lc-hq-card">
          <p className="lc-hq-eb">LLM Pool</p>
          <p className="lc-hq-big">{pool?.slots?.length ?? 0}</p>
          <p className="lc-hq-help">
            fallback: <code>{pool?.fallback_llm ?? "—"}</code> · encryption:{" "}
            <span data-health={pool?.encryption_key_configured ? "ok" : "error"} className="lc-hq-chip">
              {pool?.encryption_key_configured ? "configured" : "missing"}
            </span>
          </p>
        </article>
        <article className="lc-hq-card">
          <p className="lc-hq-eb">Open patches</p>
          <p className="lc-hq-big">
            {(patches ?? []).filter((p) => p.status === "pending" || p.status === "open").length}
          </p>
          <p className="lc-hq-help">
            of {patches?.length ?? 0} total in review queue
          </p>
        </article>
      </section>

      {/* Pool slots */}
      <section className="lc-hq-panel-section">
        <h3 className="lc-hq-panel-h3">LLM pool slots</h3>
        <table className="lc-hq-table">
          <thead>
            <tr>
              <th>Slot</th>
              <th>Model</th>
              <th>URL</th>
              <th>Enabled</th>
              <th>Health</th>
              <th>Last OK</th>
            </tr>
          </thead>
          <tbody>
            {(pool?.slots ?? []).map((s) => (
              <tr key={s.slot}>
                <td>{s.slot}</td>
                <td>{s.model ?? "—"}</td>
                <td className="lc-hq-mono">{s.url ? new URL(s.url).host : "—"}</td>
                <td>{s.enabled ? "yes" : "no"}</td>
                <td>
                  <span data-health={(s.health ?? "unknown").toLowerCase()} className="lc-hq-chip">
                    {s.health ?? "unknown"}
                  </span>
                </td>
                <td className="lc-hq-mono">{s.last_ok_at ? new Date(s.last_ok_at).toLocaleTimeString() : "—"}</td>
              </tr>
            ))}
            {(!pool?.slots || pool.slots.length === 0) && (
              <tr><td colSpan={6} className="lc-hq-help">No pool slots configured yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Nodes */}
      <section className="lc-hq-panel-section">
        <h3 className="lc-hq-panel-h3">Nodes ({nodes.length})</h3>
        <table className="lc-hq-table">
          <thead>
            <tr>
              <th>Node ID</th>
              <th>Cluster</th>
              <th>Journey</th>
              <th>Component</th>
              <th>Health</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {nodes.slice(0, 200).map((n, i) => (
              <tr key={n.id ?? i}>
                <td className="lc-hq-mono">{n.id ?? "—"}</td>
                <td>{n.cluster ?? "—"}</td>
                <td>{n.journey_id ?? "—"}</td>
                <td>{n.component ?? "—"}</td>
                <td>
                  <span data-health={(n.health ?? "unknown").toLowerCase()} className="lc-hq-chip">
                    {n.health ?? "unknown"}
                  </span>
                </td>
                <td className="lc-hq-mono">{n.last_seen ? new Date(n.last_seen).toLocaleTimeString() : "—"}</td>
              </tr>
            ))}
            {nodes.length === 0 && !loading && (
              <tr><td colSpan={6} className="lc-hq-help">No nodes reporting.</td></tr>
            )}
          </tbody>
        </table>
        {nodes.length > 200 && (
          <p className="lc-hq-help">Showing first 200 of {nodes.length}.</p>
        )}
      </section>

      {/* Patches */}
      <section className="lc-hq-panel-section">
        <h3 className="lc-hq-panel-h3">Self-healing patches</h3>
        <table className="lc-hq-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Node</th>
              <th>Summary</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {(patches ?? []).slice(0, 50).map((p, i) => (
              <tr key={p.id ?? i}>
                <td className="lc-hq-mono">{p.id?.slice(0, 8) ?? "—"}</td>
                <td className="lc-hq-mono">{p.node_id ?? "—"}</td>
                <td>{p.summary ?? "—"}</td>
                <td>
                  <span data-health={(p.status ?? "unknown").toLowerCase()} className="lc-hq-chip">
                    {p.status ?? "unknown"}
                  </span>
                </td>
                <td className="lc-hq-mono">{p.created_at ? new Date(p.created_at).toLocaleString() : "—"}</td>
              </tr>
            ))}
            {(!patches || patches.length === 0) && (
              <tr><td colSpan={5} className="lc-hq-help">No patches in the review queue.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <p className="lc-hq-help" style={{ marginTop: 16 }}>
        Auto-refresh every 30s. Manual <button type="button" className="lc-hq-chip lc-hq-chip-btn" onClick={() => void load()}>Refresh now</button>
      </p>

      <style jsx>{`
        .lc-hq-panel { display: grid; gap: 20px; }
        .lc-hq-panel-title { font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
        .lc-hq-panel-sub { font-size: 13px; color: rgba(244,241,234,0.65); line-height: 1.55; margin: 4px 0 0; max-width: 820px; }
        .lc-hq-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
        .lc-hq-card { padding: 14px 16px; border-radius: 12px; background: rgba(20,6,18,0.55); border: 1px solid rgba(255,255,255,0.08); }
        .lc-hq-eb { font-family: ui-monospace, 'Geist Mono', monospace; font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: rgba(255,102,184,0.85); margin: 0 0 6px; }
        .lc-hq-big { font-size: 32px; font-weight: 700; margin: 0 0 4px; letter-spacing: -0.02em; }
        .lc-hq-help { font-size: 11px; line-height: 1.55; color: rgba(244,241,234,0.55); margin: 8px 0 0; }
        .lc-hq-err { font-size: 12px; color: #fca5a5; margin: 0; }
        .lc-hq-panel-section { padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.06); }
        .lc-hq-panel-h3 { font-size: 14px; font-weight: 600; margin: 0 0 10px; }
        .lc-hq-table { width: 100%; font-size: 12px; border-collapse: collapse; }
        .lc-hq-table th { text-align: left; font-family: ui-monospace, 'Geist Mono', monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(244,241,234,0.55); padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.08); }
        .lc-hq-table td { padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .lc-hq-mono { font-family: ui-monospace, 'Geist Mono', monospace; font-size: 11px; color: rgba(244,241,234,0.72); }
        .lc-hq-chip { display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 999px; font-family: ui-monospace, 'Geist Mono', monospace; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; background: rgba(255,255,255,0.06); color: rgba(244,241,234,0.72); border: 0; cursor: pointer; }
        .lc-hq-chip[data-health="ok"], .lc-hq-chip[data-health="healthy"], .lc-hq-chip[data-health="approved"] { background: rgba(74,222,128,0.14); color: #86efac; }
        .lc-hq-chip[data-health="degraded"], .lc-hq-chip[data-health="pending"], .lc-hq-chip[data-health="open"] { background: rgba(250,204,21,0.14); color: #fde047; }
        .lc-hq-chip[data-health="error"], .lc-hq-chip[data-health="failed"], .lc-hq-chip[data-health="rejected"] { background: rgba(248,113,113,0.14); color: #fca5a5; }
        .lc-hq-chip-btn { cursor: pointer; }
      `}</style>
    </div>
  );
}
