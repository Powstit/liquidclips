"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createPromoCode,
  getPromoStats,
  listPromoCodes,
  revokePromoCode,
  type CreatePromoBody,
  type PromoCode,
  type PromoStats,
} from "@/lib/promo";
import { useDataSource } from "./_lib/useDataSource";
import { LiveBadge } from "./_lib/LiveBadge";

// HQ admin tab for promo / discount-code management. Reads + writes go
// through the existing /api/admin proxy (which re-checks admin + forwards
// the internal secret server-side). Visual language inherits the brand
// tokens (--lc-bg, --lc-fg, --lc-accent) by reusing the same Tailwind
// classes the BannersTab / CommunityChannelsTab use elsewhere in HQ.

function Chip({ tone, children }: { tone: "ok" | "warn" | "fail" | "gray"; children: React.ReactNode }) {
  const style: React.CSSProperties =
    tone === "ok"
      ? { borderColor: "rgba(77, 198, 168, 0.42)", background: "rgba(77, 198, 168, 0.10)", color: "var(--lc-ok)" }
      : tone === "warn"
        ? { borderColor: "rgba(217, 155, 45, 0.42)", background: "rgba(217, 155, 45, 0.10)", color: "var(--lc-warn)" }
        : tone === "fail"
          ? { borderColor: "rgba(255, 102, 184, 0.40)", background: "var(--lc-accent-soft)", color: "var(--lc-accent-mid)" }
          : { borderColor: "var(--lc-stroke)", background: "color-mix(in srgb, var(--lc-bg-warm) 70%, transparent)", color: "var(--lc-fg-faint)" };
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]"
      style={style}
    >
      {children}
    </span>
  );
}

function fmtCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function StatusFor(row: PromoCode): { label: string; tone: "ok" | "warn" | "fail" | "gray" } {
  if (row.revoked_at) return { label: "revoked", tone: "fail" };
  if (row.expires_at && new Date(row.expires_at) <= new Date()) return { label: "expired", tone: "fail" };
  if (row.max_uses != null && row.used_count >= row.max_uses) return { label: "exhausted", tone: "warn" };
  return { label: "active", tone: "ok" };
}

export function PromoCodesTab(): React.JSX.Element {
  const src = useDataSource();
  const [rows, setRows] = useState<PromoCode[] | null>(null);
  const [stripeConfigured, setStripeConfigured] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [expandedStats, setExpandedStats] = useState<Record<string, PromoStats | null>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const j = await listPromoCodes();
      setRows(j.codes);
      setStripeConfigured(j.stripe_configured);
      src.report("promo", "ok");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      src.report("promo", "fail");
    }
  }, [src]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(row: PromoCode) {
    if (!window.confirm(`Revoke promo code ${row.code}? This cannot be undone.`)) return;
    try {
      await revokePromoCode(row.code);
      await load();
    } catch (e) {
      window.alert(`Revoke failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function toggleStats(row: PromoCode) {
    if (expandedStats[row.code] !== undefined) {
      // collapse
      const { [row.code]: _drop, ...rest } = expandedStats;
      setExpandedStats(rest);
      return;
    }
    // mark loading
    setExpandedStats({ ...expandedStats, [row.code]: null });
    try {
      const s = await getPromoStats(row.code);
      setExpandedStats((cur) => ({ ...cur, [row.code]: s }));
    } catch (e) {
      window.alert(`Stats failed: ${e instanceof Error ? e.message : String(e)}`);
      setExpandedStats((cur) => {
        const { [row.code]: _drop, ...rest } = cur;
        return rest;
      });
    }
  }

  return (
    <section
      className="rounded-3xl border p-5 sm:p-6"
      style={{ borderColor: "var(--lc-stroke)", background: "color-mix(in srgb, var(--lc-bg-warm) 60%, transparent)" }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--lc-fg-faint)" }}>
            promo codes
          </div>
          <p className="lc-body mt-1 text-[12px]" style={{ color: "var(--lc-fg-muted)" }}>
            Influencer / clipper discount codes. Stripe coupon is created on first apply and cached for idempotence.
            {!stripeConfigured && (
              <>
                {" "}
                <span style={{ color: "var(--lc-warn)" }}>
                  Stripe not configured — applies will record locally but no Stripe coupon will be created.
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LiveBadge state={src.state} />
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition"
            style={{
              borderColor: "var(--lc-stroke)",
              background: "var(--lc-bg)",
              color: "var(--lc-fg)",
            }}
          >
            {showForm ? "Close form" : "New code"}
          </button>
        </div>
      </div>

      {showForm && (
        <NewCodeForm
          onSaved={async () => {
            setShowForm(false);
            await load();
          }}
        />
      )}

      {error && (
        <p
          className="mt-3 rounded-md border px-3 py-2 font-mono text-[11px]"
          style={{ borderColor: "rgba(255,102,184,0.40)", background: "var(--lc-accent-soft)", color: "var(--lc-accent-mid)" }}
        >
          {error}
        </p>
      )}

      {/* Whop note — static reference for Daniel */}
      <details className="mt-4 rounded-2xl border p-3 font-mono text-[11px]" style={{ borderColor: "var(--lc-stroke)", color: "var(--lc-fg-muted)" }}>
        <summary className="cursor-pointer uppercase tracking-[0.12em]" style={{ color: "var(--lc-fg-faint)" }}>
          whop side · how to issue the matching discount
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 normal-case">
          <li>Open the Whop dashboard → Pricing → Discount codes.</li>
          <li>Create a code with the SAME name as the Liquid Clips promo (e.g. FOUNDER25).</li>
          <li>Set the same percent_off so the affiliate-checkout iframe matches the LC ledger.</li>
          <li>Whop owns redemption tracking on its checkout; LC owns redemption tracking on the Stripe rail.</li>
        </ol>
      </details>

      {!rows ? (
        <p className="mt-4 font-mono text-[11px]" style={{ color: "var(--lc-fg-faint)" }}>
          loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-4 font-mono text-[11px]" style={{ color: "var(--lc-fg-faint)" }}>
          no promo codes yet
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full font-mono text-[11px]">
            <thead className="border-b" style={{ borderColor: "var(--lc-stroke)", color: "var(--lc-fg-faint)" }}>
              <tr className="text-left">
                <th className="px-2 py-2">code</th>
                <th className="px-2 py-2 text-right">% off</th>
                <th className="px-2 py-2 text-right">used / max</th>
                <th className="px-2 py-2">expires</th>
                <th className="px-2 py-2">scopes</th>
                <th className="px-2 py-2">status</th>
                <th className="px-2 py-2">created by</th>
                <th className="px-2 py-2"> </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const stat = StatusFor(row);
                const expanded = expandedStats[row.code];
                return (
                  <>
                    <tr key={row.code} className="border-b" style={{ borderColor: "color-mix(in srgb, var(--lc-stroke) 50%, transparent)" }}>
                      <td className="px-2 py-2" style={{ color: "var(--lc-fg)" }}>
                        <span className="lc-display">{row.code}</span>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums" style={{ color: "var(--lc-fg)" }}>
                        {row.percent_off}%
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums" style={{ color: "var(--lc-fg-muted)" }}>
                        {row.used_count} / {row.max_uses ?? "∞"}
                      </td>
                      <td className="px-2 py-2" style={{ color: "var(--lc-fg-muted)" }}>
                        {row.expires_at ? new Date(row.expires_at).toISOString().slice(0, 16).replace("T", " ") : "—"}
                      </td>
                      <td className="px-2 py-2" style={{ color: "var(--lc-fg-muted)" }}>
                        {row.scopes.length === 0 ? "all" : row.scopes.join(", ")}
                      </td>
                      <td className="px-2 py-2">
                        <Chip tone={stat.tone}>{stat.label}</Chip>
                      </td>
                      <td className="px-2 py-2" style={{ color: "var(--lc-fg-faint)" }}>
                        {row.created_by}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => void toggleStats(row)}
                            className="rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em]"
                            style={{ borderColor: "var(--lc-stroke)", background: "var(--lc-bg)", color: "var(--lc-fg)" }}
                          >
                            {expanded !== undefined ? "Hide" : "Stats"}
                          </button>
                          {!row.revoked_at && (
                            <button
                              onClick={() => void revoke(row)}
                              className="rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em]"
                              style={{
                                borderColor: "rgba(255,102,184,0.40)",
                                background: "var(--lc-bg)",
                                color: "var(--lc-accent-mid)",
                              }}
                            >
                              Revoke
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded !== undefined && (
                      <tr key={`${row.code}-stats`}>
                        <td colSpan={8} className="px-2 pb-3">
                          {expanded === null ? (
                            <p className="font-mono text-[11px]" style={{ color: "var(--lc-fg-faint)" }}>
                              loading stats…
                            </p>
                          ) : (
                            <StatsBlock stats={expanded} />
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StatsBlock({ stats }: { stats: PromoStats }): React.JSX.Element {
  return (
    <div
      className="rounded-xl border p-3"
      style={{ borderColor: "var(--lc-stroke)", background: "color-mix(in srgb, var(--lc-bg-warm) 80%, transparent)" }}
    >
      <div className="flex flex-wrap gap-4 font-mono text-[11px]" style={{ color: "var(--lc-fg-muted)" }}>
        <div>
          <span style={{ color: "var(--lc-fg-faint)" }}>redemptions: </span>
          <span className="lc-display" style={{ color: "var(--lc-fg)" }}>
            {stats.redemption_count}
          </span>
        </div>
        <div>
          <span style={{ color: "var(--lc-fg-faint)" }}>revenue impact: </span>
          <span className="lc-display" style={{ color: "var(--lc-fg)" }}>
            {fmtCents(stats.discount_applied_usd_cents_total)}
          </span>
        </div>
        <div>
          <span style={{ color: "var(--lc-fg-faint)" }}>stripe coupon: </span>
          <span style={{ color: "var(--lc-fg)" }}>{stats.code.stripe_coupon_id ?? "—"}</span>
        </div>
      </div>
      {stats.redemptions.length > 0 && (
        <table className="mt-3 min-w-full font-mono text-[11px]">
          <thead style={{ color: "var(--lc-fg-faint)" }}>
            <tr className="text-left">
              <th className="px-2 py-1">applied_at</th>
              <th className="px-2 py-1">user (email masked)</th>
              <th className="px-2 py-1">stripe sub</th>
              <th className="px-2 py-1 text-right">discount</th>
            </tr>
          </thead>
          <tbody>
            {stats.redemptions.map((r, i) => (
              <tr key={`${r.user_id}-${i}`}>
                <td className="px-2 py-1" style={{ color: "var(--lc-fg-muted)" }}>
                  {r.applied_at ? new Date(r.applied_at).toISOString().slice(0, 16).replace("T", " ") : "—"}
                </td>
                <td className="px-2 py-1" style={{ color: "var(--lc-fg)" }}>
                  {r.email_masked}
                </td>
                <td className="px-2 py-1" style={{ color: "var(--lc-fg-faint)" }}>
                  {r.stripe_subscription_id ?? "—"}
                </td>
                <td className="px-2 py-1 text-right tabular-nums" style={{ color: "var(--lc-fg)" }}>
                  {fmtCents(r.discount_applied_usd_cents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function NewCodeForm({ onSaved }: { onSaved: () => Promise<void> | void }): React.JSX.Element {
  const [draft, setDraft] = useState({
    code: "",
    percent_off: "10",
    max_uses: "",
    expires_at: "",
    scopes: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!draft.code.trim()) {
      setError("code required");
      return;
    }
    const percent = parseInt(draft.percent_off, 10);
    if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
      setError("percent_off must be 1-100");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: CreatePromoBody = {
        code: draft.code.trim().toUpperCase(),
        percent_off: percent,
        max_uses: draft.max_uses ? Math.max(1, parseInt(draft.max_uses, 10) || 1) : null,
        expires_at: draft.expires_at ? new Date(draft.expires_at).toISOString() : null,
        scopes: draft.scopes
          ? draft.scopes
              .split(",")
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean)
          : [],
        notes: draft.notes.trim() || null,
      };
      await createPromoCode(body);
      await onSaved();
      setDraft({ code: "", percent_off: "10", max_uses: "", expires_at: "", scopes: "", notes: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="mb-4 mt-4 rounded-2xl border p-4"
      style={{ borderColor: "var(--lc-stroke)", background: "var(--lc-bg)" }}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <FormField label="code *" value={draft.code} onChange={(v) => setDraft({ ...draft, code: v })} placeholder="FOUNDER25" />
        <FormField label="percent_off (1-100) *" value={draft.percent_off} onChange={(v) => setDraft({ ...draft, percent_off: v })} type="number" />
        <FormField label="max_uses (blank = ∞)" value={draft.max_uses} onChange={(v) => setDraft({ ...draft, max_uses: v })} type="number" />
        <FormField label="expires_at (local)" value={draft.expires_at} onChange={(v) => setDraft({ ...draft, expires_at: v })} type="datetime-local" />
        <FormField label="scopes (comma plan slugs)" value={draft.scopes} onChange={(v) => setDraft({ ...draft, scopes: v })} placeholder="solo, growth" />
        <FormField label="notes" value={draft.notes} onChange={(v) => setDraft({ ...draft, notes: v })} placeholder="who got it / why" />
      </div>
      {error && (
        <p
          className="mt-3 rounded-md border px-3 py-2 font-mono text-[11px]"
          style={{ borderColor: "rgba(255,102,184,0.40)", background: "var(--lc-accent-soft)", color: "var(--lc-accent-mid)" }}
        >
          {error}
        </p>
      )}
      <div className="mt-3 flex items-center">
        <button
          onClick={() => void save()}
          disabled={busy}
          className="ml-auto rounded-full px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition disabled:opacity-60"
          style={{ background: "var(--lc-accent)", color: "var(--lc-fg)" }}
        >
          {busy ? "Saving…" : "Create code"}
        </button>
      </div>
    </div>
  );
}

function FormField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--lc-fg-faint)" }}>
      {label}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border px-2 py-1 font-sans text-[12px] normal-case tracking-normal"
        style={{ borderColor: "var(--lc-stroke)", background: "var(--lc-bg-warm)", color: "var(--lc-fg)" }}
      />
    </label>
  );
}
