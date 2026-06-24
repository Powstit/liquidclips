"use client";

// HQ command tabs — wires every tab body to live /api/admin/* fetchers.
//
// 2026-06-24 HQ Demo-Data Wipe: every hardcoded EMPLOYEES / AGENTS /
// SERVICES / IRON_GATES / RELEASES / CUSTOMERS / REVENUE_* / INBOX_MESSAGES
// / AGENT_REPORTS array that used to live in this file was removed and
// replaced with a real fetcher. Where the backend doesn't yet have a
// table for a dimension (iron-gate runs, release history, bug intake,
// agent reports, inbox messages), the endpoint returns an empty list
// with an honest note and the tab renders an "No X yet" empty state.
//
// Every tab body also wires the per-tab useDataSource() hook so the
// LiveBadge pill at the top reflects whether the data on screen is
// LIVE / PARTIAL / NO DATA / IDLE.

import { useCallback, useEffect, useState } from "react";

import { useDataSource } from "./_lib/useDataSource";
import { LiveBadge } from "./_lib/LiveBadge";

// =====================================================================
// Shared HQ UI primitives (duplicated from AdminHQ to avoid a circular
// dependency). Keep these minimal and identical to the AdminHQ versions.
// =====================================================================

type ChipTone = "ok" | "pending" | "fail" | "gray";

function chipTone(value: string): ChipTone {
  const v = value.toLowerCase();
  if (["active", "ok", "true", "yes", "live", "published", "open", "used", "connected", "handled", "passed", "configured"].includes(v))
    return "ok";
  if (["trial", "trialing", "pending", "scheduled", "uploading", "consumed", "fixing", "assigned", "waiting review", "review", "in progress"].includes(v))
    return "pending";
  if (["failed", "fail", "blocked", "expired", "canceled", "past_due", "refunded", "false", "no", "denied", "revoked", "missing", "removed", "cancel"].includes(v))
    return "fail";
  return "gray";
}

function Chip({ label, tone }: { label: string; tone?: ChipTone }) {
  const t = tone ?? chipTone(label);
  const style: React.CSSProperties =
    t === "ok"
      ? { borderColor: "rgba(77, 198, 168, 0.42)", background: "rgba(77, 198, 168, 0.10)", color: "var(--lc-ok)" }
      : t === "pending"
        ? { borderColor: "rgba(217, 155, 45, 0.42)", background: "rgba(217, 155, 45, 0.10)", color: "var(--lc-warn)" }
        : t === "fail"
          ? { borderColor: "rgba(255, 102, 184, 0.40)", background: "var(--lc-accent-soft)", color: "var(--lc-accent-mid)" }
          : { borderColor: "var(--lc-stroke)", background: "color-mix(in srgb, var(--lc-bg-warm) 70%, transparent)", color: "var(--lc-fg-faint)" };
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]"
      style={style}
    >
      {label}
    </span>
  );
}

function BoolChip({ value, on = "yes", off = "no" }: { value: boolean; on?: string; off?: string }) {
  return <Chip label={value ? on : off} tone={value ? "ok" : "fail"} />;
}

function Panel({ title, sub, children, right }: { title: string; sub?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-line bg-paper-warm/40 p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">{title}</div>
          {sub && <p className="mt-1 font-sans text-[12px] text-text-secondary">{sub}</p>}
        </div>
        {right}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia">{title}</div>
      {sub && <p className="mt-1 font-sans text-[12px] text-text-secondary">{sub}</p>}
    </div>
  );
}

function Card({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: ChipTone }) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">{label}</div>
      <div className={`mt-2 font-display text-[28px] font-bold tracking-[-0.02em] ${tone === "fail" ? "text-fuchsia-deep" : "text-ink"}`}>{value}</div>
      {sub && <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">{sub}</div>}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-line bg-paper px-2 py-1 text-[11px] text-ink"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function moneyCents(n: number): string {
  return `$${(n / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function moneyCentsOrDash(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return moneyCents(n);
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line border-dashed bg-paper p-5 text-center font-mono text-[11px] text-text-tertiary">
      {children}
    </div>
  );
}

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="mt-2 rounded-xl border border-fuchsia-deep/30 bg-fuchsia-soft/30 px-3 py-2 font-mono text-[11px] text-fuchsia-deep">
      {error}
    </div>
  );
}

function LoadingNote() {
  return <div className="font-mono text-[11px] text-text-tertiary">loading…</div>;
}

// =====================================================================
// Live fetch helper — wraps fetch + reports outcome to useDataSource().
// =====================================================================

async function adminGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api/admin/${path}`, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// =====================================================================
// Agent / service key configuration types — passed in from admin/page.tsx.
// =====================================================================

type AgentKeyConfig = {
  auth: boolean;
  projects: boolean;
  earn: boolean;
  ui: boolean;
  codex: boolean;
  claude: boolean;
  hqInternal: boolean;
};

type ServiceConfig = {
  openai: boolean;
  kimi: boolean;
  claude: boolean;
  whop: boolean;
  clerk: boolean;
  stripe: boolean;
  railway: boolean;
  vercel: boolean;
  supabase: boolean;
  resend: boolean;
  ayrshare: boolean;
  postiz: boolean;
  storage: boolean;
  sentry: boolean;
};

// =====================================================================
// Backend response shapes
// =====================================================================

type EmployeeRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  created_at: string | null;
  last_active: string | null;
  tier: string;
  founder: boolean;
  monthly_cost_cents: number | null;
  hourly_rate_cents: number | null;
  can_access_hq: boolean;
  emergency_contact: boolean;
  notes: string;
};

type EmployeesResponse = {
  rows: EmployeeRow[];
  generated_at: string;
  note: string;
};

type AgentRow = {
  id: string;
  key: string;
  name: string;
  provider: string;
  lane: string;
  configured: boolean;
  status: string;
  monthly_budget_cents: number | null;
  spent_this_month_cents: number | null;
  note: string;
};

type AgentsResponse = {
  rows: AgentRow[];
  generated_at: string;
  note: string;
};

type ApiServiceRow = {
  id: string;
  key: string;
  name: string;
  category: string;
  env_var: string;
  configured: boolean;
  monthly_cost_cents: number | null;
  current_month_spend_cents: number | null;
  note: string;
};

type ApiServicesResponse = {
  rows: ApiServiceRow[];
  generated_at: string;
  note: string;
};

type RevenueDay = {
  date: string;
  new_signups: number;
  new_paid: number;
  canceled: number;
  gross_cents: number;
  note: string;
};

type RevenueWeek = {
  week_starting: string;
  new_signups: number;
  new_paid: number;
  canceled: number;
  gross_cents: number;
};

type RevenueMonth = {
  month: string;
  new_signups: number;
  new_paid: number;
  canceled: number;
  gross_cents: number;
  mrr_cents: number;
  paid_users: number;
  free_users: number;
};

type RevenueSummary = {
  headline: {
    mrr_cents: number;
    paid_users: number;
    free_users: number;
    canceled_users: number;
    users_total: number;
    target_mrr_cents: number;
    gap_to_target_cents: number;
  };
  daily: RevenueDay[];
  weekly: RevenueWeek[];
  monthly: RevenueMonth[];
  generated_at: string;
  note: string;
};

type RevenueBlocker = {
  code: string;
  count: number;
  affected_users: number;
  latest_message: string | null;
  latest_at: string | null;
  route: string | null;
};

type RevenueBlockersResponse = {
  rows: RevenueBlocker[];
  window_hours: number;
  generated_at: string;
  note: string;
};

type CustomerSignal = {
  id: string;
  email_masked: string;
  tier: string;
  subscription_status: string;
  billing_provider: string;
  created_at: string | null;
  active_at: string | null;
  clips_created: number;
  starter_exports_used: number;
  is_paid: boolean;
  recent_error_count: number;
  recent_error_at: string | null;
  first_clip_created: boolean;
};

type CustomerSignalsResponse = {
  rows: CustomerSignal[];
  generated_at: string;
  note: string;
};

type EmptyRowsResponse = {
  rows: unknown[];
  note: string;
};

type InboxResponse = EmptyRowsResponse;
type IronGatesResponse = EmptyRowsResponse;
type ReleasesResponse = EmptyRowsResponse;

// =====================================================================
// Tab header — title row with a LiveBadge.
// =====================================================================

function TabHead({
  title,
  sub,
  badge,
  right,
}: {
  title: string;
  sub?: string;
  badge: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {badge}
      </div>
      {right}
      {(title || sub) && <span className="sr-only">{title} {sub}</span>}
    </div>
  );
}

// =====================================================================
// Employees tab — live from /admin/employees (admin allowlist + Users).
// =====================================================================

export function EmployeesTab() {
  const src = useDataSource();
  const [data, setData] = useState<EmployeesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await adminGet<EmployeesResponse>("employees");
      setData(r);
      src.report("employees", "ok");
    } catch (e) {
      setError(String(e));
      src.report("employees", "fail");
    } finally {
      setLoading(false);
    }
  }, [src]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];
  const filtered = rows.filter((e) => statusFilter === "all" || e.status === statusFilter);
  const totalMonthlyCost = rows
    .filter((e) => e.status === "active" && e.monthly_cost_cents !== null)
    .reduce((sum, e) => sum + (e.monthly_cost_cents ?? 0), 0);

  return (
    <Panel
      title="employees · admin allowlist (live)"
      sub="One row per admin email from JUNIOR_ADMIN_EMAILS joined to live User rows. Costs/hours show null until a people-directory table exists."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge state={src.state} />
          <FilterSelect
            label="status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: "all" },
              { value: "active", label: "active" },
              { value: "invited", label: "invited" },
            ]}
          />
          <button
            onClick={() => void load()}
            className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia"
          >
            refresh
          </button>
        </div>
      }
    >
      {loading && !data && <LoadingNote />}
      <ErrorNote error={error} />
      {data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Card label="active employees" value={rows.filter((e) => e.status === "active").length} />
            <Card label="monthly people cost" value={moneyCentsOrDash(totalMonthlyCost || null)} />
            <Card label="HQ access" value={rows.filter((e) => e.can_access_hq).length} />
            <Card label="invited" value={rows.filter((e) => e.status === "invited").length} />
          </div>

          {filtered.length === 0 ? (
            <EmptyNote>No employees match the current filter.</EmptyNote>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse font-mono text-[11px]">
                <thead>
                  <tr className="text-left text-text-tertiary">
                    {["name", "role", "status", "tier", "cost/mo", "rate", "HQ access", "started", "last active", "notes"].map((h) => (
                      <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => (
                    <tr key={e.id} className="border-b border-line/40 align-top">
                      <td className="px-2 py-2 text-ink">
                        <div className="font-display text-[13px] font-semibold">{e.name}</div>
                        <div className="text-text-tertiary">{e.email}</div>
                      </td>
                      <td className="px-2 py-2 text-text-secondary">{e.role}</td>
                      <td className="px-2 py-2"><Chip label={e.status} /></td>
                      <td className="px-2 py-2"><Chip label={e.tier} /></td>
                      <td className="px-2 py-2 text-text-secondary">{moneyCentsOrDash(e.monthly_cost_cents)}</td>
                      <td className="px-2 py-2 text-text-secondary">{e.hourly_rate_cents ? moneyCents(e.hourly_rate_cents) + "/hr" : "—"}</td>
                      <td className="px-2 py-2"><BoolChip value={e.can_access_hq} /></td>
                      <td className="px-2 py-2 text-text-tertiary">{e.created_at?.slice(0, 10) ?? "—"}</td>
                      <td className="px-2 py-2 text-text-tertiary">{e.last_active?.slice(0, 10) ?? "—"}</td>
                      <td className="max-w-[260px] px-2 py-2 text-text-secondary">{e.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 font-mono text-[10px] text-text-tertiary">{data.note}</p>
        </>
      )}
    </Panel>
  );
}

// =====================================================================
// Agents tab — live from /admin/agents.
// =====================================================================

export function AgentsTab({ agentKeyConfig: _agentKeyConfig }: { agentKeyConfig: AgentKeyConfig }) {
  const src = useDataSource();
  const [data, setData] = useState<AgentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await adminGet<AgentsResponse>("agents");
      setData(r);
      src.report("agents", "ok");
    } catch (e) {
      setError(String(e));
      src.report("agents", "fail");
    } finally {
      setLoading(false);
    }
  }, [src]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];

  return (
    <Panel
      title="agents · automated workforce (live env)"
      sub="Configured = the per-agent API key env var is set on the backend. Cost telemetry not stored in v0."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge state={src.state} />
          <button onClick={() => void load()} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia">refresh</button>
        </div>
      }
    >
      {loading && !data && <LoadingNote />}
      <ErrorNote error={error} />
      {data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Card label="keys configured" value={rows.filter((a) => a.configured).length} />
            <Card label="keys missing" value={rows.filter((a) => !a.configured).length} tone="fail" />
            <Card label="total agents" value={rows.length} />
            <Card label="active providers" value={new Set(rows.filter((a) => a.configured).map((a) => a.provider)).size} />
          </div>

          {rows.length === 0 ? (
            <EmptyNote>No agents configured yet.</EmptyNote>
          ) : (
            <>
              <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {rows.map((a) => (
                  <div key={a.id} className="rounded-2xl border border-line bg-paper p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-display text-[16px] font-semibold text-ink">{a.name}</div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">{a.provider} · {a.lane}</div>
                      </div>
                      <Chip label={a.status} tone={a.configured ? "ok" : "fail"} />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[10px]">
                      <div className="text-text-tertiary">API key</div>
                      <div><BoolChip value={a.configured} on="configured" off="missing" /></div>
                      <div className="text-text-tertiary">budget</div>
                      <div className="text-ink">{moneyCentsOrDash(a.monthly_budget_cents)}</div>
                      <div className="text-text-tertiary">spent</div>
                      <div className="text-ink">{moneyCentsOrDash(a.spent_this_month_cents)}</div>
                    </div>
                    {a.note && (
                      <div className="mt-3 font-mono text-[10px] text-text-tertiary">{a.note}</div>
                    )}
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">agent detail</div>
                <table className="w-full border-collapse font-mono text-[11px]">
                  <thead>
                    <tr className="text-left text-text-tertiary">
                      {["agent", "provider", "lane", "API key", "budget", "spent"].map((h) => (
                        <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((a) => (
                      <tr key={a.id} className="border-b border-line/40 align-top">
                        <td className="px-2 py-2 text-ink">
                          <div className="font-display text-[13px] font-semibold">{a.name}</div>
                        </td>
                        <td className="px-2 py-2 text-text-secondary">{a.provider}</td>
                        <td className="px-2 py-2 text-text-secondary">{a.lane}</td>
                        <td className="px-2 py-2"><BoolChip value={a.configured} on="configured" off="missing" /></td>
                        <td className="px-2 py-2 text-text-secondary">{moneyCentsOrDash(a.monthly_budget_cents)}</td>
                        <td className="px-2 py-2 text-text-secondary">{moneyCentsOrDash(a.spent_this_month_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className="mt-3 font-mono text-[10px] text-text-tertiary">{data.note}</p>
        </>
      )}
    </Panel>
  );
}

// =====================================================================
// APIs / Tools tab — live from /admin/api-services.
// =====================================================================

export function APIToolsTab({ serviceConfig: _serviceConfig }: { serviceConfig: ServiceConfig }) {
  const src = useDataSource();
  const [data, setData] = useState<ApiServicesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await adminGet<ApiServicesResponse>("api-services");
      setData(r);
      src.report("api-services", "ok");
    } catch (e) {
      setError(String(e));
      src.report("api-services", "fail");
    } finally {
      setLoading(false);
    }
  }, [src]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];
  const filtered = categoryFilter === "all" ? rows : rows.filter((s) => s.category === categoryFilter);
  const categories = Array.from(new Set(rows.map((s) => s.category))).sort();
  const missing = rows.filter((s) => !s.configured).length;

  return (
    <Panel
      title="apis & tools · dependency map (live env)"
      sub="Configured = env var set on backend. Costs not tracked in v0."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge state={src.state} />
          <Chip label={`${missing} missing keys`} tone={missing ? "fail" : "ok"} />
          <button onClick={() => void load()} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia">refresh</button>
        </div>
      }
    >
      {loading && !data && <LoadingNote />}
      <ErrorNote error={error} />
      {data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Card label="services tracked" value={rows.length} />
            <Card label="configured" value={rows.filter((s) => s.configured).length} />
            <Card label="missing keys" value={missing} tone={missing ? "fail" : "ok"} />
            <Card label="categories" value={categories.length} />
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <FilterSelect
              label="category"
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={[
                { value: "all", label: "all" },
                ...categories.map((c) => ({ value: c, label: c })),
              ]}
            />
          </div>

          {filtered.length === 0 ? (
            <EmptyNote>No services match this filter.</EmptyNote>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse font-mono text-[11px]">
                <thead>
                  <tr className="text-left text-text-tertiary">
                    {["service", "category", "env var", "key", "fixed/mo", "spend"].map((h) => (
                      <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.id} className="border-b border-line/40 align-top">
                      <td className="px-2 py-2 text-ink">
                        <div className="font-display text-[13px] font-semibold">{s.name}</div>
                      </td>
                      <td className="px-2 py-2"><Chip label={s.category} tone="gray" /></td>
                      <td className="px-2 py-2 font-mono text-[10px] text-text-tertiary">{s.env_var}</td>
                      <td className="px-2 py-2"><BoolChip value={s.configured} on="configured" off="missing" /></td>
                      <td className="px-2 py-2 text-text-secondary">{moneyCentsOrDash(s.monthly_cost_cents)}</td>
                      <td className="px-2 py-2 text-text-secondary">{moneyCentsOrDash(s.current_month_spend_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 font-mono text-[10px] text-text-tertiary">{data.note}</p>
        </>
      )}
    </Panel>
  );
}

// =====================================================================
// Iron Gates tab — live (currently empty + honest note).
// =====================================================================

export function IronGatesTab() {
  const src = useDataSource();
  const [data, setData] = useState<IronGatesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await adminGet<IronGatesResponse>("iron-gates");
      setData(r);
      src.report("iron-gates", "ok");
    } catch (e) {
      setError(String(e));
      src.report("iron-gates", "fail");
    } finally {
      setLoading(false);
    }
  }, [src]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];

  return (
    <Panel
      title="iron gates · commit readiness"
      sub="Per-section gate state. v0 has no iron_gate_runs table; gate truth lives in docs/IRON_GATES.md."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge state={src.state} />
          <button onClick={() => void load()} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia">refresh</button>
        </div>
      }
    >
      {loading && !data && <LoadingNote />}
      <ErrorNote error={error} />
      {data && rows.length === 0 && (
        <EmptyNote>{data.note ?? "No iron-gate rows yet."}</EmptyNote>
      )}
    </Panel>
  );
}

// =====================================================================
// Releases tab — live (currently empty + honest note).
// =====================================================================

export function ReleasesTab() {
  const src = useDataSource();
  const [data, setData] = useState<ReleasesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await adminGet<ReleasesResponse>("releases");
      setData(r);
      src.report("releases", "ok");
    } catch (e) {
      setError(String(e));
      src.report("releases", "fail");
    } finally {
      setLoading(false);
    }
  }, [src]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];

  return (
    <Panel
      title="releases / builds · version control"
      sub="Per-version build state. v0 has no release_history table; the Tauri updater manifest holds the latest signed release only."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge state={src.state} />
          <button onClick={() => void load()} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia">refresh</button>
        </div>
      }
    >
      {loading && !data && <LoadingNote />}
      <ErrorNote error={error} />
      {data && rows.length === 0 && (
        <EmptyNote>{data.note ?? "No release rows yet."}</EmptyNote>
      )}
    </Panel>
  );
}

// =====================================================================
// Customers tab — live from /admin/customer-signals.
// =====================================================================

export function CustomersTab() {
  const src = useDataSource();
  const [data, setData] = useState<CustomerSignalsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await adminGet<CustomerSignalsResponse>("customer-signals");
      setData(r);
      src.report("customer-signals", "ok");
    } catch (e) {
      setError(String(e));
      src.report("customer-signals", "fail");
    } finally {
      setLoading(false);
    }
  }, [src]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];
  const filtered =
    filter === "all"
      ? rows
      : filter === "blocked"
        ? rows.filter((c) => c.recent_error_count > 0)
        : rows.filter((c) => !c.first_clip_created);

  return (
    <Panel
      title="customer signals · live activity"
      sub="Most-recent signups with live tier/status + last-14-days error counts. Emails masked."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge state={src.state} />
          <FilterSelect
            label="filter"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "all" },
              { value: "blocked", label: "recent errors" },
              { value: "no clip", label: "no first clip" },
            ]}
          />
          <button onClick={() => void load()} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia">refresh</button>
        </div>
      }
    >
      {loading && !data && <LoadingNote />}
      <ErrorNote error={error} />
      {data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Card label="tracked users" value={rows.length} />
            <Card label="paid" value={rows.filter((c) => c.is_paid).length} />
            <Card label="recent errors" value={rows.filter((c) => c.recent_error_count > 0).length} tone="fail" />
            <Card label="first clip created" value={rows.filter((c) => c.first_clip_created).length} />
          </div>

          {filtered.length === 0 ? (
            <EmptyNote>No customers match this filter.</EmptyNote>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse font-mono text-[11px]">
                <thead>
                  <tr className="text-left text-text-tertiary">
                    {["email", "tier", "status", "provider", "signed up", "active", "clips", "exports", "paid?", "errors (14d)"].map((h) => (
                      <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id} className="border-b border-line/40 align-top">
                      <td className="px-2 py-2 text-ink">{c.email_masked}</td>
                      <td className="px-2 py-2"><Chip label={c.tier} /></td>
                      <td className="px-2 py-2"><Chip label={c.subscription_status} /></td>
                      <td className="px-2 py-2 text-text-secondary">{c.billing_provider}</td>
                      <td className="px-2 py-2 text-text-tertiary">{c.created_at?.slice(0, 10) ?? "—"}</td>
                      <td className="px-2 py-2 text-text-tertiary">{c.active_at?.slice(0, 10) ?? "—"}</td>
                      <td className="px-2 py-2 text-text-secondary">{c.clips_created}</td>
                      <td className="px-2 py-2 text-text-secondary">{c.starter_exports_used}</td>
                      <td className="px-2 py-2"><BoolChip value={c.is_paid} /></td>
                      <td className={`px-2 py-2 ${c.recent_error_count > 0 ? "text-fuchsia-deep" : "text-text-tertiary"}`}>{c.recent_error_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 font-mono text-[10px] text-text-tertiary">{data.note}</p>
        </>
      )}
    </Panel>
  );
}

// =====================================================================
// Costs / Runway tab — composed of live agents + api-services.
// =====================================================================

export function CostsRunwayTab({
  agentKeyConfig: _agentKeyConfig,
  serviceConfig: _serviceConfig,
}: {
  agentKeyConfig: AgentKeyConfig;
  serviceConfig: ServiceConfig;
}) {
  const src = useDataSource();
  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
  const [agents, setAgents] = useState<AgentsResponse | null>(null);
  const [services, setServices] = useState<ApiServicesResponse | null>(null);
  const [employees, setEmployees] = useState<EmployeesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const all = await Promise.allSettled([
      adminGet<RevenueSummary>("revenue/summary"),
      adminGet<AgentsResponse>("agents"),
      adminGet<ApiServicesResponse>("api-services"),
      adminGet<EmployeesResponse>("employees"),
    ]);
    if (all[0].status === "fulfilled") { setRevenue(all[0].value); src.report("revenue", "ok"); } else { src.report("revenue", "fail"); }
    if (all[1].status === "fulfilled") { setAgents(all[1].value); src.report("agents", "ok"); } else { src.report("agents", "fail"); }
    if (all[2].status === "fulfilled") { setServices(all[2].value); src.report("api-services", "ok"); } else { src.report("api-services", "fail"); }
    if (all[3].status === "fulfilled") { setEmployees(all[3].value); src.report("employees", "ok"); } else { src.report("employees", "fail"); }
    const firstReason = all.find((a) => a.status === "rejected");
    if (firstReason && firstReason.status === "rejected") {
      setError(String(firstReason.reason));
    }
    setLoading(false);
  }, [src]);

  useEffect(() => {
    void load();
  }, [load]);

  const mrr = revenue?.headline.mrr_cents ?? 0;
  const TARGET_MRR = revenue?.headline.target_mrr_cents ?? 30000_00;
  const PRICE = 2999;
  const customersNeeded = Math.max(0, Math.ceil((TARGET_MRR - mrr) / PRICE));
  const gap = revenue?.headline.gap_to_target_cents ?? Math.max(0, TARGET_MRR - mrr);

  const toolCosts = (services?.rows ?? [])
    .filter((s) => s.monthly_cost_cents !== null || s.current_month_spend_cents !== null)
    .reduce((sum, s) => sum + (s.monthly_cost_cents ?? 0) + (s.current_month_spend_cents ?? 0), 0);
  const agentCosts = (agents?.rows ?? [])
    .filter((a) => a.spent_this_month_cents !== null)
    .reduce((sum, a) => sum + (a.spent_this_month_cents ?? 0), 0);
  const peopleCosts = (employees?.rows ?? [])
    .filter((e) => e.status === "active" && e.monthly_cost_cents !== null)
    .reduce((sum, e) => sum + (e.monthly_cost_cents ?? 0), 0);
  const totalBurn = toolCosts + agentCosts + peopleCosts;
  const grossThisMonth = (revenue?.monthly?.find((m) => m.month === revenue?.monthly[revenue.monthly.length - 1]?.month)?.gross_cents) ?? 0;
  const netCash = grossThisMonth - totalBurn;

  const progress = Math.min(100, Math.round((mrr / TARGET_MRR) * 100));
  const costsKnown = toolCosts + agentCosts + peopleCosts > 0;

  return (
    <Panel
      title="costs / runway · can Daniel afford to ship?"
      sub="MRR computed live from active paid users. Cost tracking is null until per-service billing events are wired."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge state={src.state} />
          <button onClick={() => void load()} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia">refresh</button>
        </div>
      }
    >
      {loading && !revenue && <LoadingNote />}
      <ErrorNote error={error} />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="current MRR" value={moneyCents(mrr)} />
        <Card label="target MRR" value={moneyCents(TARGET_MRR)} />
        <Card label="gap to target" value={moneyCents(gap)} tone="fail" />
        <Card label="paid users needed @ $29.99" value={customersNeeded} tone="pending" />
      </div>

      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          <span>$30k MRR progress</span>
          <span>{progress}%</span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-paper-elev">
          <div className="h-full rounded-full bg-fuchsia" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-2 flex justify-between font-mono text-[10px] text-text-tertiary">
          <span>{moneyCents(mrr)} today</span>
          <span>{moneyCents(TARGET_MRR)} target</span>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="tool / api costs" value={moneyCentsOrDash(toolCosts || null)} />
        <Card label="agent costs" value={moneyCentsOrDash(agentCosts || null)} />
        <Card label="people costs" value={moneyCentsOrDash(peopleCosts || null)} />
        <Card label="total monthly burn" value={moneyCentsOrDash(totalBurn || null)} tone={costsKnown && totalBurn > grossThisMonth ? "fail" : undefined} />
        <Card label="gross revenue (this mo)" value={moneyCents(grossThisMonth)} />
        <Card label="net monthly cash" value={costsKnown ? moneyCents(netCash) : "—"} tone={costsKnown && netCash < 0 ? "fail" : "ok"} />
        <Card label="1,000 paid users" value={`${revenue?.headline.paid_users ?? 0} / 1,000`} />
      </div>

      {!costsKnown && (
        <EmptyNote>
          Cost telemetry not stored in v0 — agent + service spend show null. Wire a per-service billing-event table to populate burn.
        </EmptyNote>
      )}
    </Panel>
  );
}

// =====================================================================
// Revenue tab — live from /admin/revenue/summary + /admin/revenue/blockers.
// =====================================================================

export function RevenueTab() {
  const src = useDataSource();
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [blockers, setBlockers] = useState<RevenueBlockersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [a, b] = await Promise.allSettled([
      adminGet<RevenueSummary>("revenue/summary"),
      adminGet<RevenueBlockersResponse>("revenue/blockers"),
    ]);
    if (a.status === "fulfilled") { setSummary(a.value); src.report("revenue", "ok"); } else { src.report("revenue", "fail"); }
    if (b.status === "fulfilled") { setBlockers(b.value); src.report("revenue-blockers", "ok"); } else { src.report("revenue-blockers", "fail"); }
    if (a.status === "rejected") setError(String(a.reason));
    setLoading(false);
  }, [src]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !summary) {
    return (
      <Panel title="revenue · path to $30k MRR" right={<LiveBadge state={src.state} />}>
        <LoadingNote />
        <ErrorNote error={error} />
      </Panel>
    );
  }
  if (!summary) {
    return (
      <Panel title="revenue · path to $30k MRR" right={<LiveBadge state={src.state} />}>
        <ErrorNote error={error} />
        <EmptyNote>Could not load live revenue summary.</EmptyNote>
      </Panel>
    );
  }

  const headline = summary.headline;
  const PRICE = 2999;
  const customersNeeded = Math.max(0, Math.ceil((headline.target_mrr_cents - headline.mrr_cents) / PRICE));
  const progress = Math.min(100, Math.round((headline.mrr_cents / headline.target_mrr_cents) * 100));

  const today = summary.daily[summary.daily.length - 1];
  const thisWeek = summary.weekly[summary.weekly.length - 1];
  const thisMonth = summary.monthly[summary.monthly.length - 1];

  return (
    <Panel
      title="revenue · path to $30k MRR (live)"
      sub="MRR + signup buckets computed live from the users table. Stripe/Whop own the actual payments ledger."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge state={src.state} />
          <button onClick={() => void load()} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia">refresh</button>
        </div>
      }
    >
      <ErrorNote error={error} />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <Card label="today's gross" value={moneyCents(today?.gross_cents ?? 0)} />
        <Card label="this week's gross" value={moneyCents(thisWeek?.gross_cents ?? 0)} />
        <Card label="this month's gross" value={moneyCents(thisMonth?.gross_cents ?? 0)} />
        <Card label="current MRR" value={moneyCents(headline.mrr_cents)} />
        <Card label="paid users" value={headline.paid_users} />
        <Card label="free users" value={headline.free_users} />
        <Card label="users total" value={headline.users_total} />
        <Card label="canceled / expired" value={headline.canceled_users} tone="fail" />
        <Card label="gap to $30k MRR" value={moneyCents(headline.gap_to_target_cents)} tone="fail" />
        <Card label="paid users needed @ $29.99" value={customersNeeded} tone="pending" />
      </div>

      <div className="mb-6 rounded-2xl border border-line bg-paper p-4">
        <SectionHead title="MRR target" sub={`${moneyCents(headline.target_mrr_cents)} target · ${headline.paid_users} paid users so far`} />
        <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          <span>progress</span>
          <span>{progress}%</span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-paper-elev">
          <div className="h-full rounded-full bg-fuchsia" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-line bg-paper p-4">
        <SectionHead title="revenue blockers" sub="Top error groups from desktop telemetry in the last 24h." />
        {blockers && blockers.rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse font-mono text-[11px]">
              <thead>
                <tr className="text-left text-text-tertiary">
                  {["code", "count", "affected users", "route", "latest message", "latest at"].map((h) => (
                    <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {blockers.rows.map((b) => (
                  <tr key={b.code} className="border-b border-line/40 align-top">
                    <td className="px-2 py-2 text-ink">{b.code}</td>
                    <td className="px-2 py-2 text-text-secondary">{b.count}</td>
                    <td className="px-2 py-2 text-text-secondary">{b.affected_users}</td>
                    <td className="px-2 py-2 text-text-tertiary">{b.route ?? "—"}</td>
                    <td className="max-w-[300px] truncate px-2 py-2 text-text-secondary" title={b.latest_message ?? undefined}>{b.latest_message ?? "—"}</td>
                    <td className="px-2 py-2 text-text-tertiary">{b.latest_at?.slice(0, 16) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyNote>No desktop errors in the last 24h — nothing actively breaking flows.</EmptyNote>
        )}
      </div>

      <div className="mb-6 rounded-2xl border border-line bg-paper p-4">
        <SectionHead title="daily" />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr className="text-left text-text-tertiary">
                {["date", "new signups", "new paid", "canceled", "gross"].map((h) => (
                  <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.daily.map((d) => (
                <tr key={d.date} className="border-b border-line/40">
                  <td className="px-2 py-2 text-ink">{d.date}</td>
                  <td className="px-2 py-2 text-text-secondary">{d.new_signups}</td>
                  <td className="px-2 py-2 text-text-secondary">{d.new_paid}</td>
                  <td className="px-2 py-2 text-text-secondary">{d.canceled}</td>
                  <td className="px-2 py-2 text-ink">{moneyCents(d.gross_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-line bg-paper p-4">
        <SectionHead title="weekly" />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr className="text-left text-text-tertiary">
                {["week starting", "new signups", "new paid", "canceled", "gross"].map((h) => (
                  <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.weekly.map((w) => (
                <tr key={w.week_starting} className="border-b border-line/40">
                  <td className="px-2 py-2 text-ink">{w.week_starting}</td>
                  <td className="px-2 py-2 text-text-secondary">{w.new_signups}</td>
                  <td className="px-2 py-2 text-text-secondary">{w.new_paid}</td>
                  <td className="px-2 py-2 text-text-secondary">{w.canceled}</td>
                  <td className="px-2 py-2 text-ink">{moneyCents(w.gross_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-paper p-4">
        <SectionHead title="monthly" />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr className="text-left text-text-tertiary">
                {["month", "MRR", "paid", "free", "new signups", "new paid", "gross"].map((h) => (
                  <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.monthly.map((m) => (
                <tr key={m.month} className="border-b border-line/40">
                  <td className="px-2 py-2 text-ink">{m.month}</td>
                  <td className="px-2 py-2 text-ink">{m.mrr_cents ? moneyCents(m.mrr_cents) : "—"}</td>
                  <td className="px-2 py-2 text-text-secondary">{m.paid_users || "—"}</td>
                  <td className="px-2 py-2 text-text-secondary">{m.free_users || "—"}</td>
                  <td className="px-2 py-2 text-text-secondary">{m.new_signups}</td>
                  <td className="px-2 py-2 text-text-secondary">{m.new_paid}</td>
                  <td className="px-2 py-2 text-text-secondary">{moneyCents(m.gross_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-3 font-mono text-[10px] text-text-tertiary">{summary.note}</p>
    </Panel>
  );
}

// =====================================================================
// Reports tab — live from /admin/revenue/blockers + /admin/agent-reports.
// =====================================================================

export function ReportsTab() {
  const src = useDataSource();
  const [blockers, setBlockers] = useState<RevenueBlockersResponse | null>(null);
  const [reports, setReports] = useState<EmptyRowsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [a, b] = await Promise.allSettled([
      adminGet<RevenueBlockersResponse>("revenue/blockers"),
      adminGet<EmptyRowsResponse>("agent-reports"),
    ]);
    if (a.status === "fulfilled") { setBlockers(a.value); src.report("revenue-blockers", "ok"); } else { src.report("revenue-blockers", "fail"); }
    if (b.status === "fulfilled") { setReports(b.value); src.report("agent-reports", "ok"); } else { src.report("agent-reports", "fail"); }
    if (a.status === "rejected") setError(String(a.reason));
    setLoading(false);
  }, [src]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Panel
      title="reports · latest signals (live)"
      sub="Top error groups from desktop telemetry + per-lane agent reports."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge state={src.state} />
          <button onClick={() => void load()} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia">refresh</button>
        </div>
      }
    >
      {loading && !blockers && <LoadingNote />}
      <ErrorNote error={error} />

      <div className="space-y-3">
        {(reports?.rows ?? []).length === 0 && (
          <EmptyNote>{reports?.note ?? "No agent reports yet."}</EmptyNote>
        )}
        {(blockers?.rows ?? []).slice(0, 5).map((b) => (
          <div key={b.code} className="rounded-2xl border border-fuchsia-deep/30 bg-fuchsia-soft/20 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">{b.code} · {b.route ?? "no route"}</div>
              <Chip label={`${b.count} events`} tone="fail" />
            </div>
            <p className="mt-2 font-sans text-[13px] leading-relaxed text-text-secondary">{b.latest_message ?? "—"}</p>
            <div className="mt-2 font-mono text-[10px] text-fuchsia-deep">affected: {b.affected_users} users · {b.latest_at?.slice(0, 16) ?? "—"}</div>
          </div>
        ))}
        {(blockers?.rows ?? []).length === 0 && !loading && (
          <EmptyNote>No revenue-blocker errors in the last 24h.</EmptyNote>
        )}
      </div>
    </Panel>
  );
}

// =====================================================================
// Inbox tab — live from /admin/inbox (currently empty + honest note).
// =====================================================================

export function InboxTab() {
  const src = useDataSource();
  const [data, setData] = useState<InboxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await adminGet<InboxResponse>("inbox");
      setData(r);
      src.report("inbox", "ok");
    } catch (e) {
      setError(String(e));
      src.report("inbox", "fail");
    } finally {
      setLoading(false);
    }
  }, [src]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Panel
      title="inbox · user-to-HQ support board"
      sub="Inbound customer messages. v0 has no inbox_messages table."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge state={src.state} />
          <button onClick={() => void load()} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia">refresh</button>
        </div>
      }
    >
      {loading && !data && <LoadingNote />}
      <ErrorNote error={error} />
      {data && (
        <EmptyNote>{data.note ?? "No inbox messages."}</EmptyNote>
      )}
    </Panel>
  );
}
