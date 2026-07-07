/**
 * CanaryTab · dial rollout % per feature · Sprint Final §1G.
 *
 * HQ reads GET /api/admin/canary → renders one row per feature with
 * a slider + input. Save writes POST /api/admin/canary/{feature}.
 *
 * Killswitch pattern: setting a feature to 0 crashes it back to the
 * baseline experience across all users within 60s (server cache TTL).
 */
"use client";

import { useCallback, useEffect, useState } from "react";

interface CanaryEntry {
  feature: string;
  percent: number;
}

const PRESETS = [0, 5, 10, 25, 50, 100];

export function CanaryTab(): React.ReactElement {
  const [entries, setEntries] = useState<CanaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/canary", { cache: "no-store" });
      if (!r.ok) throw new Error(`GET ${r.status}`);
      const data = (await r.json()) as { features: CanaryEntry[] };
      setEntries(data.features ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setPercent = useCallback(
    async (feature: string, percent: number) => {
      setSaving(feature);
      setError(null);
      try {
        const r = await fetch(`/api/admin/canary/${encodeURIComponent(feature)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ percent }),
        });
        if (!r.ok) throw new Error(`POST ${r.status}`);
        setEntries((prev) =>
          prev.map((e) => (e.feature === feature ? { ...e, percent } : e)),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "save failed");
      } finally {
        setSaving(null);
      }
    },
    [],
  );

  return (
    <section style={{ padding: 24 }}>
      <header style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Canary rollout</h2>
        <p style={{ margin: "4px 0 0", color: "#a0a0a0", fontSize: 14 }}>
          Dial each feature 0 → 5 → 25 → 100 as confidence grows. Set to 0 to
          crash rollback within 60 seconds.
        </p>
      </header>

      {loading && <p>Loading canaries…</p>}
      {error && (
        <p style={{ color: "#ff6b6b", padding: 10, background: "#331111", borderRadius: 8 }}>
          {error}
        </p>
      )}

      {!loading && !error && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {entries.map((e) => (
            <CanaryRow
              key={e.feature}
              feature={e.feature}
              percent={e.percent}
              saving={saving === e.feature}
              onChange={(p) => void setPercent(e.feature, p)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CanaryRow({
  feature,
  percent,
  saving,
  onChange,
}: {
  feature: string;
  percent: number;
  saving: boolean;
  onChange: (p: number) => void;
}): React.ReactElement {
  const [draft, setDraft] = useState(percent);
  useEffect(() => setDraft(percent), [percent]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: 16,
        background: "#161620",
        borderRadius: 12,
        border: "1px solid #24242e",
      }}
    >
      <div style={{ flex: "0 0 220px" }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{feature}</div>
        <div style={{ color: "#888", fontSize: 12, marginTop: 2 }}>
          Live at{" "}
          <strong style={{ color: percent > 0 ? "#ff66b8" : "#888" }}>{percent}%</strong>
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={draft}
        onChange={(e) => setDraft(Number(e.target.value))}
        disabled={saving}
        style={{ flex: 1 }}
      />

      <input
        type="number"
        min={0}
        max={100}
        value={draft}
        onChange={(e) => setDraft(Math.max(0, Math.min(100, Number(e.target.value))))}
        disabled={saving}
        style={{
          width: 60,
          padding: "6px 8px",
          background: "#0a0a10",
          border: "1px solid #24242e",
          borderRadius: 6,
          color: "#fff",
          textAlign: "center",
        }}
      />

      <button
        type="button"
        onClick={() => onChange(draft)}
        disabled={saving || draft === percent}
        style={{
          padding: "8px 16px",
          background: draft === percent ? "#333" : "#ff1a8c",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          fontWeight: 600,
          cursor: saving || draft === percent ? "not-allowed" : "pointer",
        }}
      >
        {saving ? "…" : "Save"}
      </button>

      <div style={{ display: "flex", gap: 4 }}>
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            disabled={saving || p === percent}
            title={`Set to ${p}%`}
            style={{
              padding: "4px 8px",
              background: p === percent ? "#ff1a8c" : "#222",
              color: "#fff",
              border: "1px solid #333",
              borderRadius: 6,
              fontSize: 11,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {p === 0 ? "OFF" : `${p}%`}
          </button>
        ))}
      </div>
    </div>
  );
}
