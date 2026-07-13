/**
 * BetaCohortTab · recruit + track 5-10 early partners · Sprint Final §1I.
 *
 * Shows: partner list · invite form · per-partner feedback log · revenue
 * split multiplier dial (default 2× so beta partners get 100% MRR on
 * referrals instead of 50%).
 */
"use client";

import { useCallback, useEffect, useState } from "react";

interface BetaPartner {
  id: number;
  email: string;
  handle: string | null;
  invited_at: string | null;
  activated_at: string | null;
  revenue_split_multiplier: number;
  feedback_count: number;
  active: boolean;
  invite_code: string | null;
}

interface BetaListOut {
  partners: BetaPartner[];
  total_active: number;
  target_size: number;
}

export function BetaCohortTab(): React.ReactElement {
  const [state, setState] = useState<BetaListOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/beta", { cache: "no-store" });
      if (!r.ok) throw new Error(`GET ${r.status}`);
      setState((await r.json()) as BetaListOut);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- triggers async fetch that hydrates React state from backend — canonical external-sync use of useEffect
    void load();
  }, [load]);

  const deactivate = useCallback(
    async (id: number) => {
      if (!confirm("Deactivate this partner? Their invite code stays valid.")) return;
      await fetch(`/api/admin/beta/${id}`, { method: "DELETE" });
      await load();
    },
    [load],
  );

  return (
    <section style={{ padding: 24 }}>
      <header
        style={{
          marginBottom: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Beta cohort</h2>
          <p style={{ margin: "4px 0 0", color: "#a0a0a0", fontSize: 14 }}>
            5-10 early partners. Higher revenue split, real feedback, first-look
            payouts. Recruit before canary opens.
          </p>
        </div>
        {state && (
          <div
            style={{
              padding: "10px 18px",
              background: "#161620",
              borderRadius: 12,
              border: "1px solid #24242e",
            }}
          >
            <div style={{ fontSize: 11, color: "#888", letterSpacing: 1 }}>
              ACTIVE PARTNERS
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: "#ff66b8" }}>
              {state.total_active}{" "}
              <span style={{ fontSize: 15, color: "#666", fontWeight: 500 }}>
                / {state.target_size} target
              </span>
            </div>
          </div>
        )}
      </header>

      <div style={{ marginBottom: 20 }}>
        <button
          type="button"
          onClick={() => setShowInvite((v) => !v)}
          style={{
            padding: "10px 20px",
            background: "#ff1a8c",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {showInvite ? "Cancel" : "+ Invite partner"}
        </button>
      </div>

      {showInvite && (
        <BetaInviteForm
          onSaved={() => {
            setShowInvite(false);
            void load();
          }}
        />
      )}

      {loading && <p>Loading…</p>}
      {error && (
        <p
          style={{
            color: "#ff6b6b",
            padding: 10,
            background: "#331111",
            borderRadius: 8,
          }}
        >
          {error}
        </p>
      )}

      {state && !loading && !error && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {state.partners.length === 0 && (
            <p style={{ color: "#888" }}>
              No partners yet. Recruit the first 5 before running canary.
            </p>
          )}
          {state.partners.map((p) => (
            <PartnerRow key={p.id} partner={p} onDeactivate={() => void deactivate(p.id)} />
          ))}
        </div>
      )}
    </section>
  );
}

function PartnerRow({
  partner: p,
  onDeactivate,
}: {
  partner: BetaPartner;
  onDeactivate: () => void;
}): React.ReactElement {
  const inviteUrl = p.invite_code
    ? `https://liquidclips.app/?beta=${p.invite_code}`
    : "";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 100px 90px 90px 100px",
        alignItems: "center",
        gap: 12,
        padding: 14,
        background: p.active ? "#161620" : "#0f0f14",
        borderRadius: 10,
        border: "1px solid #24242e",
        opacity: p.active ? 1 : 0.55,
      }}
    >
      <div>
        <div style={{ fontWeight: 600 }}>{p.email}</div>
        {p.handle && (
          <div style={{ color: "#888", fontSize: 12 }}>@{p.handle}</div>
        )}
      </div>
      <div style={{ fontFamily: "monospace", fontSize: 12, color: "#888" }}>
        {inviteUrl && (
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(inviteUrl)}
            title={inviteUrl}
            style={{
              background: "transparent",
              border: "1px solid #24242e",
              padding: "4px 8px",
              borderRadius: 6,
              color: "#ff66b8",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            Copy invite ↗
          </button>
        )}
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#ff66b8" }}>
          {p.revenue_split_multiplier}×
        </div>
        <div style={{ fontSize: 10, color: "#888" }}>split</div>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{p.feedback_count}</div>
        <div style={{ fontSize: 10, color: "#888" }}>feedback</div>
      </div>
      <div style={{ textAlign: "center", fontSize: 11, color: "#888" }}>
        {p.activated_at ? "activated" : "invited"}
      </div>
      <div>
        {p.active && (
          <button
            type="button"
            onClick={onDeactivate}
            style={{
              padding: "6px 12px",
              background: "transparent",
              color: "#ff6b6b",
              border: "1px solid #331111",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Deactivate
          </button>
        )}
      </div>
    </div>
  );
}

function BetaInviteForm({ onSaved }: { onSaved: () => void }): React.ReactElement {
  const [email, setEmail] = useState("");
  const [handle, setHandle] = useState("");
  const [multiplier, setMultiplier] = useState(2.0);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (!email.trim()) {
      setErr("email required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/beta/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          handle: handle.trim() || null,
          revenue_split_multiplier: multiplier,
          notes: notes.trim() || null,
        }),
      });
      if (!r.ok) throw new Error(`POST ${r.status}`);
      setEmail("");
      setHandle("");
      setNotes("");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  }, [email, handle, multiplier, notes, onSaved]);

  return (
    <div
      style={{
        padding: 20,
        background: "#161620",
        borderRadius: 12,
        border: "1px solid #24242e",
        marginBottom: 20,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
      }}
    >
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 11, color: "#888", letterSpacing: 1 }}>EMAIL *</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          style={inputStyle}
          placeholder="partner@example.com"
        />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 11, color: "#888", letterSpacing: 1 }}>HANDLE</span>
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          disabled={busy}
          style={inputStyle}
          placeholder="marcus.clips"
        />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 11, color: "#888", letterSpacing: 1 }}>
          REVENUE SPLIT MULTIPLIER
        </span>
        <input
          type="number"
          min={1}
          max={10}
          step={0.5}
          value={multiplier}
          onChange={(e) => setMultiplier(Number(e.target.value))}
          disabled={busy}
          style={inputStyle}
        />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 11, color: "#888", letterSpacing: 1 }}>NOTES</span>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={busy}
          style={inputStyle}
          placeholder="Why we're inviting them"
        />
      </label>
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !email}
          style={{
            padding: "10px 20px",
            background: "#ff1a8c",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontWeight: 600,
            cursor: busy || !email ? "not-allowed" : "pointer",
            opacity: busy || !email ? 0.5 : 1,
          }}
        >
          {busy ? "Inviting…" : "Send invite"}
        </button>
        {err && <span style={{ color: "#ff6b6b", fontSize: 13 }}>{err}</span>}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  background: "#0a0a10",
  border: "1px solid #24242e",
  borderRadius: 8,
  color: "#fff",
  fontSize: 14,
};
