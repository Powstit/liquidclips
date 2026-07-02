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
import { mutationsApi, type ChatRolePayload } from "../../app/admin/_mutations/api";
import { AuditLogPanel } from "../../app/admin/_mutations/AuditLogPanel";

import { useDataSource } from "./_lib/useDataSource";
import { LiveBadge } from "./_lib/LiveBadge";
import { InfoIcon } from "./_lib/InfoIcon";

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

function Panel({ title, sub, children, right, hint }: { title: string; sub?: string; children: React.ReactNode; right?: React.ReactNode; hint?: string }) {
  return (
    <section className="rounded-3xl border border-line bg-paper-warm/40 p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            {title}
            {hint && <InfoIcon hint={hint} />}
          </div>
          {sub && <p className="mt-1 font-sans text-[12px] text-text-secondary">{sub}</p>}
        </div>
        {right}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SectionHead({ title, sub, hint }: { title: string; sub?: string; hint?: string }) {
  return (
    <div className="mb-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia">
        {title}
        {hint && <InfoIcon hint={hint} />}
      </div>
      {sub && <p className="mt-1 font-sans text-[12px] text-text-secondary">{sub}</p>}
    </div>
  );
}

function Card({ label, value, sub, tone, hint }: { label: string; value: React.ReactNode; sub?: string; tone?: ChipTone; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
        {label}
        {hint && <InfoIcon hint={hint} />}
      </div>
      <div className={`mt-2 font-display text-[28px] font-bold tracking-[-0.02em] ${tone === "fail" ? "text-fuchsia-deep" : "text-ink"}`}>{value}</div>
      {sub && <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">{sub}</div>}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, hint }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; hint?: string }) {
  return (
    <label className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
      {label}
      {hint && <InfoIcon hint={hint} />}
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

  // Mod-promotion form state.
  const [modUserId, setModUserId] = useState("");
  const [modRole, setModRole] = useState<ChatRolePayload["role"]>("mod");
  const [modReason, setModReason] = useState("");
  const [modSubmitting, setModSubmitting] = useState(false);
  const [modResult, setModResult] = useState<{
    kind: "ok" | "error";
    message: string;
  } | null>(null);
  // Bumped after every successful mutation so the sibling AuditLogPanel
  // re-fetches on the same page load (no full-tab reload required).
  const [auditRefresh, setAuditRefresh] = useState(0);

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

  // Backend Pydantic constraints (admin_mutations.py:630-632):
  //   role: Literal["member", "mod"]     ← select is bounded to those.
  //   reason: str, min_length=1, max_length=400
  // Local validator mirrors the backend so the submit button disables
  // until the payload will actually pass server-side.
  const trimmedReason = modReason.trim();
  const modFormValid =
    modUserId.trim().length > 0
    && trimmedReason.length >= 1
    && trimmedReason.length <= 400;

  const submitModPromotion = useCallback(async () => {
    if (!modFormValid || modSubmitting) return;
    setModSubmitting(true);
    setModResult(null);
    try {
      const result = await mutationsApi.chatRole(modUserId.trim(), {
        role: modRole,
        reason: trimmedReason,
      });
      setModResult({ kind: "ok", message: result.message });
      setModUserId("");
      setModReason("");
      setAuditRefresh((n) => n + 1);
    } catch (e) {
      setModResult({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setModSubmitting(false);
    }
  }, [modFormValid, modSubmitting, modUserId, modRole, trimmedReason]);

  const rows = data?.rows ?? [];
  const filtered = rows.filter((e) => statusFilter === "all" || e.status === statusFilter);
  const totalMonthlyCost = rows
    .filter((e) => e.status === "active" && e.monthly_cost_cents !== null)
    .reduce((sum, e) => sum + (e.monthly_cost_cents ?? 0), 0);

  const COL_HINTS_EMP: Record<string, string> = {
    "name": "Display name + email. Email pulled from Clerk User record matched to JUNIOR_ADMIN_EMAILS entry.",
    "role": "Free-text role label. Not yet stored in DB — comes from the admin allowlist record on the backend.",
    "status": "active = present in JUNIOR_ADMIN_EMAILS env AND a User row exists. invited = on allowlist but no Clerk signup yet.",
    "tier": "Subscription tier of the matched User row. Free admins still have HQ access via the allowlist gate.",
    "cost/mo": "Monthly payroll cost in USD. Returns null until a people-directory table is wired — never demo data.",
    "rate": "Hourly rate in USD. Same null-until-tracked rule as cost/mo.",
    "HQ access": "Whether this email can hit /api/admin/* routes. Driven entirely by JUNIOR_ADMIN_EMAILS membership.",
    "started": "User.created_at — when the Clerk account was first provisioned. Null for invited-but-not-signed-up admins.",
    "last active": "User.last_seen_at from /sync pings. Null = never opened the desktop app while signed in.",
    "notes": "Free-text — currently empty until a real employees table exists. Surfaced verbatim, never inferred.",
  };

  return (
    <div className="space-y-6">
    <Panel
      title="employees · admin allowlist (live)"
      hint="Live join of JUNIOR_ADMIN_EMAILS env var ↔ User table. Edits happen on Railway env vars, not in this UI."
      sub="One row per admin email from JUNIOR_ADMIN_EMAILS joined to live User rows. Costs/hours show null until a people-directory table exists."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge state={src.state} />
          <FilterSelect
            label="status"
            hint="Narrow rows by employee status. active = signed up + on allowlist; invited = on allowlist but no Clerk account yet."
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: "all" },
              { value: "active", label: "active" },
              { value: "invited", label: "invited" },
            ]}
          />
          <span className="inline-flex items-center">
            <button
              onClick={() => void load()}
              className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia"
            >
              refresh
            </button>
            <InfoIcon hint="Re-fetch employees from /admin/employees. No cache — re-runs the JUNIOR_ADMIN_EMAILS ↔ User join." />
          </span>
        </div>
      }
    >
      {loading && !data && <LoadingNote />}
      <ErrorNote error={error} />
      {data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Card label="active employees" value={rows.filter((e) => e.status === "active").length} hint="Count of allowlist emails that already have a matching Clerk User row." />
            <Card label="monthly people cost" value={moneyCentsOrDash(totalMonthlyCost || null)} hint="Sum of monthly_cost_cents across active employees. Null until per-person payroll is stored." />
            <Card label="HQ access" value={rows.filter((e) => e.can_access_hq).length} hint="Count of rows where can_access_hq=true — equals the JUNIOR_ADMIN_EMAILS allowlist size." />
            <Card label="invited" value={rows.filter((e) => e.status === "invited").length} hint="Allowlist entries with no signed-up Clerk account yet — they still get admin once they sign up." />
          </div>

          {filtered.length === 0 ? (
            <EmptyNote>No employees match the current filter.</EmptyNote>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse font-mono text-[11px]">
                <thead>
                  <tr className="text-left text-text-tertiary">
                    {["name", "role", "status", "tier", "cost/mo", "rate", "HQ access", "started", "last active", "notes"].map((h) => (
                      <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">
                        {h}
                        {COL_HINTS_EMP[h] && <InfoIcon hint={COL_HINTS_EMP[h]} />}
                      </th>
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
          <p className="mt-3 font-mono text-[10px] text-text-tertiary">{data.note}<InfoIcon hint="Backend-shipped honesty note for this endpoint — explains data shape, gaps, and what would need a new table to populate fully." /></p>
        </>
      )}
    </Panel>

    {/* ================================================================
        Stage 5/7 · Mod promotion + honest staff-onboarding banner.
        The `chat-role` endpoint's Pydantic `Literal["member","mod"]`
        bounds this form to those two options — attempting `"staff"`
        would 422. Staff onboarding today is env-var-only (Railway
        `JUNIOR_ADMIN_EMAILS`), documented in the banner below and in
        my Item 1 audit; a scoped follow-up backend cycle would ship
        a `admin_allowlist` table + `is_admin_email` rewrite to make
        it UI-manageable.
        ================================================================ */}
    <Panel
      title="chat role · member ↔ mod"
      hint="Promote a User to chat mod (or revert them) via admin_mutations.py:636 POST /admin/users/{id}/chat-role. Idempotency-key + audit row are handled by mutationsApi.chatRole for you."
      sub="This is the only role transition the backend accepts today. Staff and founder are auth-state, not moderation state — see the banner at the bottom of this tab."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            user_id
            <InfoIcon hint="Target User row id (uuid.hex from the users table). Look it up in the employees table above or via the Customers tab." />
          </span>
          <input
            type="text"
            value={modUserId}
            onChange={(e) => setModUserId(e.target.value)}
            placeholder="uuid.hex"
            className="rounded-xl border border-line bg-paper px-3 py-2 font-mono text-[12px] text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none"
            disabled={modSubmitting}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            role
            <InfoIcon hint="Bounded by the backend Pydantic Literal — member reverts a mod, mod promotes a member." />
          </span>
          <select
            value={modRole}
            onChange={(e) => setModRole(e.target.value as ChatRolePayload["role"])}
            className="rounded-xl border border-line bg-paper px-3 py-2 font-mono text-[12px] text-ink focus:border-fuchsia focus:outline-none"
            disabled={modSubmitting}
          >
            <option value="member">member (revert)</option>
            <option value="mod">mod (promote)</option>
          </select>
        </label>
        <div className="flex flex-col justify-end">
          <button
            type="button"
            onClick={() => void submitModPromotion()}
            disabled={!modFormValid || modSubmitting}
            className="rounded-full border border-fuchsia bg-fuchsia/10 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia hover:bg-fuchsia/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {modSubmitting ? "submitting…" : "apply role change"}
          </button>
        </div>
        <label className="flex flex-col gap-1 sm:col-span-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            reason
            <InfoIcon hint="Backend requires 1..400 chars — surfaces on the audit row and in `admin/audit-log` for later review." />
          </span>
          <textarea
            value={modReason}
            onChange={(e) => setModReason(e.target.value)}
            placeholder="Why this role change? Free-text · 1..400 chars · appears in the audit row."
            maxLength={400}
            rows={2}
            className="rounded-xl border border-line bg-paper px-3 py-2 font-mono text-[12px] text-ink placeholder:text-text-tertiary focus:border-fuchsia focus:outline-none"
            disabled={modSubmitting}
          />
          <span className="text-right font-mono text-[10px] text-text-tertiary">
            {trimmedReason.length}/400
          </span>
        </label>
      </div>
      {modResult && (
        <div
          className={`mt-3 rounded-xl border px-3 py-2 font-mono text-[11px] backdrop-blur-md ${
            modResult.kind === "ok"
              ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-300"
              : "border-pink-400/50 bg-pink-500/10 text-pink-300"
          }`}
          role="status"
        >
          {modResult.message}
        </div>
      )}
    </Panel>

    {/* Honest capability banner · replaces the earlier disabled-stub
        pattern the master doc §850 codified for placeholder panes. */}
    <Panel
      title="staff onboarding · env-var only (v0)"
      hint="This is documented as a v0 gap, not a working form. Adding a staff member today = edit Railway JUNIOR_ADMIN_EMAILS env var + redeploy. is_admin_email() is a frozenset built at process import time (features.py:235), so a UI form would require a schema + endpoint + is_admin_email rewrite — a scoped backend cycle, not this tab."
      sub="Once the admin_allowlist table lands, this pane will mount an add/remove form and this banner is replaced with the live control."
    >
      <div className="rounded-xl border border-line/60 bg-paper-elev/80 backdrop-blur-md px-4 py-3 font-mono text-[11px] leading-relaxed text-text-secondary">
        <span className="font-display text-[12px] font-semibold text-ink">
          Onboarding a new staff member (v0 · env-var flow)
        </span>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Add the email to <code className="rounded bg-paper px-1 py-0.5 text-ink">JUNIOR_ADMIN_EMAILS</code> on Railway (comma-separated).</li>
          <li>Redeploy · <code className="rounded bg-paper px-1 py-0.5 text-ink">railway up --service junior-backend</code>.</li>
          <li>Have them sign in via Clerk once. They inherit staff on their first request.</li>
        </ol>
        <p className="mt-2 text-text-tertiary">
          Mod promotion above is separate — it writes <code className="rounded bg-paper px-1 py-0.5 text-ink">users.chat_role</code>
          {" "}and does <em>not</em> grant HQ access.
        </p>
      </div>
    </Panel>

    {/* ================================================================
        Recent role changes & moderation audit · reuses the shared
        AuditLogPanel with a Stage 5/7 target_type filter so this
        sub-window shows only the mutations relevant to this tab:
        user-role changes (target_type="user") + chat moderation
        actions I shipped in Stage 7 (target_type="chat_moderation").
        Bumping `auditRefresh` after a successful mutation re-fetches.
        ================================================================ */}
    <section>
      <div className="mb-2 flex items-baseline gap-3">
        <h3 className="font-display text-[16px] font-semibold tracking-[-0.02em] text-ink">
          Recent role changes & moderation audit
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          target_type ∈ user · chat_moderation
        </span>
      </div>
      <AuditLogPanel
        refreshKey={auditRefresh}
        filter={{ targetType: ["user", "chat_moderation"] }}
      />
    </section>
    </div>
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

  const COL_HINTS_AGT: Record<string, string> = {
    "agent": "Agent persona name + lane. Defined in junior-backend /admin/agents endpoint, not editable from this UI.",
    "provider": "Underlying LLM provider (Kimi / OpenAI / Claude / Internal). Determines which API key env var must be set.",
    "lane": "Functional lane this agent owns (e.g. Auth Agent runs the sign-in/upgrade flow). One agent per lane in v0.",
    "API key": "Whether the agent's API key env var is set on Railway. e.g. Auth Agent reads KIMI_AUTH_AGENT_API_KEY.",
    "budget": "Monthly spend ceiling for this agent (USD). Returns null in v0 — wire a per-agent billing-event table to populate.",
    "spent": "Current-month spend for this agent (USD). Same null-until-tracked rule as budget.",
  };

  return (
    <Panel
      title="agents · automated workforce (live env)"
      hint="Each agent maps 1-to-1 to an env var on Railway (KIMI_*_AGENT_API_KEY, OPENAI_CODEX_AGENT_API_KEY, CLAUDE_AGENT_API_KEY, HQ_INTERNAL_SECRET). No fleet table — env var presence IS the truth."
      sub="Configured = the per-agent API key env var is set on the backend. Cost telemetry not stored in v0."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge state={src.state} />
          <span className="inline-flex items-center"><button onClick={() => void load()} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia">refresh</button><InfoIcon hint="Re-fetch this tab's data from the backend. No cache — every click hits /api/admin/* fresh." /></span>
        </div>
      }
    >
      {loading && !data && <LoadingNote />}
      <ErrorNote error={error} />
      {data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Card label="keys configured" value={rows.filter((a) => a.configured).length} hint="Count of agents whose env var is set on Railway right now." />
            <Card label="keys missing" value={rows.filter((a) => !a.configured).length} tone="fail" hint="Agents with no API key env var — they cannot run until the key lands on Railway." />
            <Card label="total agents" value={rows.length} hint="Total agent personas defined in junior-backend /admin/agents (currently 7: auth, projects, earn, ui, codex, claude, hq_internal)." />
            <Card label="active providers" value={new Set(rows.filter((a) => a.configured).map((a) => a.provider)).size} hint="Distinct LLM providers with at least one configured agent (Kimi / OpenAI / Claude / Internal)." />
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
                      <div className="text-text-tertiary">
                        API key
                        <InfoIcon hint={`Env var name driving this agent — set/unset on Railway to flip configured state. (agent key: ${a.key})`} />
                      </div>
                      <div><BoolChip value={a.configured} on="configured" off="missing" /></div>
                      <div className="text-text-tertiary">
                        budget
                        <InfoIcon hint="Monthly USD ceiling. Null in v0 — no per-agent cost table wired." />
                      </div>
                      <div className="text-ink">{moneyCentsOrDash(a.monthly_budget_cents)}</div>
                      <div className="text-text-tertiary">
                        spent
                        <InfoIcon hint="Current-month USD spend. Null in v0 — billing events not ingested per agent." />
                      </div>
                      <div className="text-ink">{moneyCentsOrDash(a.spent_this_month_cents)}</div>
                    </div>
                    {a.note && (
                      <div className="mt-3 font-mono text-[10px] text-text-tertiary">{a.note}</div>
                    )}
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                  agent detail
                  <InfoIcon hint="Flat table view of the same agents above — easier to scan when comparing providers / lanes." />
                </div>
                <table className="w-full border-collapse font-mono text-[11px]">
                  <thead>
                    <tr className="text-left text-text-tertiary">
                      {["agent", "provider", "lane", "API key", "budget", "spent"].map((h) => (
                        <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">
                          {h}
                          {COL_HINTS_AGT[h] && <InfoIcon hint={COL_HINTS_AGT[h]} />}
                        </th>
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
          <p className="mt-3 font-mono text-[10px] text-text-tertiary">{data.note}<InfoIcon hint="Backend-shipped honesty note for this endpoint — explains data shape, gaps, and what would need a new table to populate fully." /></p>
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

  const COL_HINTS_API: Record<string, string> = {
    "service": "Third-party SaaS service Liquid Clips depends on. Definition lives in junior-backend /admin/api-services.",
    "category": "Functional grouping (AI / payments / auth / infra / hosting / storage / email / social / analytics).",
    "env var": "Exact env var name the backend looks up on Railway to decide configured=true.",
    "key": "configured = env var present + non-empty on Railway. missing = unset; the service is effectively off until the key lands.",
    "fixed/mo": "Fixed monthly subscription cost. Null in v0 — no provider-invoice ingestion yet.",
    "spend": "Variable usage cost this month. Null in v0 — same reason as fixed/mo.",
  };

  const SERVICE_HINTS: Record<string, string> = {
    openai: "Powers AI title/caption generation, embeddings. Reads OPENAI_API_KEY.",
    kimi: "Cheap LLM provider for high-volume jobs (auth flows, polish prompts). Reads KIMI_API_KEY or KIMI_AUTH_AGENT_API_KEY.",
    claude: "Premium reasoning for backend planning + release tasks. Reads CLAUDE_API_KEY or CLAUDE_AGENT_API_KEY.",
    whop: "Sub-merchant payments + community + agent fleet. Reads WHOP_API_KEY — controls whether Whop carrot rail can fan out.",
    clerk: "Auth provider (sign-in, sessions, billing add-on packs). Reads CLERK_SECRET_KEY.",
    stripe: "Legacy billing and Stripe Connect payout support. Customer subscriptions use Whop.",
    railway: "Hosts junior-backend. Reads RAILWAY_TOKEN — only needed for CLI deploys, not runtime.",
    vercel: "Hosts account-app + marketing. Reads VERCEL_TOKEN — only needed for CLI deploys.",
    supabase: "Optional storage backend. Reads SUPABASE_SERVICE_ROLE_KEY.",
    resend: "Transactional email (license invites, password reset). Reads RESEND_API_KEY.",
    ayrshare: "Hosted multi-channel social publisher. Reads AYRSHARE_API_KEY — required for /publish-now to actually post.",
    postiz: "Self-hosted publisher (legacy, sprint-replaced by Ayrshare). Reads POSTIZ_API_KEY.",
    storage: "Object storage for clip uploads. Reads AWS_ACCESS_KEY_ID, S3_ACCESS_KEY_ID, or R2_ACCESS_KEY_ID — any one wins.",
    sentry: "Error tracking. Reads SENTRY_AUTH_TOKEN — needed for source-map uploads, not runtime capture.",
    posthog: "Product analytics. Reads POSTHOG_KEY — controls server-side event capture.",
  };

  return (
    <Panel
      title="apis & tools · dependency map (live env)"
      hint="Live snapshot of which third-party services are wired. The 'configured' bit is real (env var presence). Cost columns are placeholders until billing-event ingestion lands."
      sub="Configured = env var set on backend. Costs not tracked in v0."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge state={src.state} />
          <Chip label={`${missing} missing keys`} tone={missing ? "fail" : "ok"} />
          <span className="inline-flex items-center"><button onClick={() => void load()} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia">refresh</button><InfoIcon hint="Re-fetch this tab's data from the backend. No cache — every click hits /api/admin/* fresh." /></span>
        </div>
      }
    >
      {loading && !data && <LoadingNote />}
      <ErrorNote error={error} />
      {data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Card label="services tracked" value={rows.length} hint="Total third-party services defined in the backend registry." />
            <Card label="configured" value={rows.filter((s) => s.configured).length} hint="Services whose env var is set on Railway right now." />
            <Card label="missing keys" value={missing} tone={missing ? "fail" : "ok"} hint="Services with no env var — feature paths that depend on them will fail at runtime." />
            <Card label="categories" value={categories.length} hint="Distinct functional categories across tracked services." />
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <FilterSelect
              label="category"
              hint="Narrow services by category (AI, payments, auth, infra, hosting, storage, email, social, analytics)."
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
                      <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">
                        {h}
                        {COL_HINTS_API[h] && <InfoIcon hint={COL_HINTS_API[h]} />}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.id} className="border-b border-line/40 align-top">
                      <td className="px-2 py-2 text-ink">
                        <div className="font-display text-[13px] font-semibold">
                          {s.name}
                          {SERVICE_HINTS[s.key] && <InfoIcon hint={SERVICE_HINTS[s.key]} />}
                        </div>
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
          <p className="mt-3 font-mono text-[10px] text-text-tertiary">{data.note}<InfoIcon hint="Backend-shipped honesty note for this endpoint — explains data shape, gaps, and what would need a new table to populate fully." /></p>
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
      hint="Iron-gate sentinels (IG-001…IG-005) protect locked sections of the codebase. Pre-commit hook refuses sentinel deletions. Real state lives in docs/IRON_GATES.md, not a DB table."
      sub="Per-section gate state. v0 has no iron_gate_runs table; gate truth lives in docs/IRON_GATES.md."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge state={src.state} />
          <span className="inline-flex items-center"><button onClick={() => void load()} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia">refresh</button><InfoIcon hint="Re-fetch this tab's data from the backend. No cache — every click hits /api/admin/* fresh." /></span>
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
      hint="Future: per-release columns (version, channel, notarised, sha256, published_at). Today the Tauri updater manifest is the only source of truth for the latest signed build."
      sub="Per-version build state. v0 has no release_history table; the Tauri updater manifest holds the latest signed release only."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge state={src.state} />
          <span className="inline-flex items-center"><button onClick={() => void load()} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia">refresh</button><InfoIcon hint="Re-fetch this tab's data from the backend. No cache — every click hits /api/admin/* fresh." /></span>
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

  const COL_HINTS_CUST: Record<string, string> = {
    "email": "User email masked to first letter + domain (privacy: full emails never leave the backend). From Clerk User record.",
    "tier": "Subscription tier resolved server-side from Clerk metadata + tier-alias map (channel/growth → pro, autopilot → agency).",
    "status": "Stripe / Whop subscription status (active / trialing / past_due / canceled / expired). Source: webhook-synced fields.",
    "provider": "Which billing rail this user is on (stripe / whop / none). Driven by which webhook last touched the user record.",
    "signed up": "User.created_at — first Clerk signup timestamp. Truncated to date.",
    "active": "User.last_seen_at — last /sync ping from the desktop app. Blank = never opened the app while signed in.",
    "clips": "Lifetime count of clips this user has created. From clips_created counter on User row.",
    "exports": "Free-tier starter-pass exports consumed (cap: 100). Resets only by upgrade, not by month.",
    "paid?": "True when active subscription_status maps to a paid tier (solo / pro / agency). Free tier = false.",
    "errors (14d)": "Count of DesktopErrorEvent rows for this user in the last 14 days. Highlighted fuchsia when > 0.",
  };

  return (
    <Panel
      title="customer signals · live activity"
      hint="Live join of users + DesktopErrorEvent for the most-recent signups. Read-only — edits happen via Clerk dashboard or Stripe."
      sub="Most-recent signups with live tier/status + last-14-days error counts. Emails masked."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge state={src.state} />
          <FilterSelect
            label="filter"
            hint="Narrow customer signals. recent errors = users with ≥1 DesktopErrorEvent in last 14d; no first clip = users who haven't activated yet."
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "all" },
              { value: "blocked", label: "recent errors" },
              { value: "no clip", label: "no first clip" },
            ]}
          />
          <span className="inline-flex items-center"><button onClick={() => void load()} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia">refresh</button><InfoIcon hint="Re-fetch this tab's data from the backend. No cache — every click hits /api/admin/* fresh." /></span>
        </div>
      }
    >
      {loading && !data && <LoadingNote />}
      <ErrorNote error={error} />
      {data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Card label="tracked users" value={rows.length} hint="Total users returned by /admin/customer-signals (capped to recent activity window)." />
            <Card label="paid" value={rows.filter((c) => c.is_paid).length} hint="Subset with an active paid subscription. Source: Stripe + Whop webhook-synced subscription_status." />
            <Card label="recent errors" value={rows.filter((c) => c.recent_error_count > 0).length} tone="fail" hint="Users with at least one DesktopErrorEvent in the last 14 days — candidates for outreach." />
            <Card label="first clip created" value={rows.filter((c) => c.first_clip_created).length} hint="Users who completed first clip (activation milestone). first_clip_created flag is set on first successful export." />
          </div>

          {filtered.length === 0 ? (
            <EmptyNote>No customers match this filter.</EmptyNote>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse font-mono text-[11px]">
                <thead>
                  <tr className="text-left text-text-tertiary">
                    {["email", "tier", "status", "provider", "signed up", "active", "clips", "exports", "paid?", "errors (14d)"].map((h) => (
                      <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">
                        {h}
                        {COL_HINTS_CUST[h] && <InfoIcon hint={COL_HINTS_CUST[h]} />}
                      </th>
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
          <p className="mt-3 font-mono text-[10px] text-text-tertiary">{data.note}<InfoIcon hint="Backend-shipped honesty note for this endpoint — explains data shape, gaps, and what would need a new table to populate fully." /></p>
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
      hint="Revenue side is real (MRR from User table). Cost side is null in v0 — no provider-invoice ingestion. Treat 'burn' as a placeholder until billing events land."
      sub="MRR computed live from active paid users. Cost tracking is null until per-service billing events are wired."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge state={src.state} />
          <span className="inline-flex items-center"><button onClick={() => void load()} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia">refresh</button><InfoIcon hint="Re-fetch this tab's data from the backend. No cache — every click hits /api/admin/* fresh." /></span>
        </div>
      }
    >
      {loading && !revenue && <LoadingNote />}
      <ErrorNote error={error} />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="current MRR" value={moneyCents(mrr)} hint="Sum of (tier baseline price × active paid users) live from User table — no cache. Stripe + Whop rails counted." />
        <Card label="target MRR" value={moneyCents(TARGET_MRR)} hint="Hardcoded $30k MRR goal (or revenue.headline.target_mrr_cents if backend overrides). Change in backend, not UI." />
        <Card label="gap to target" value={moneyCents(gap)} tone="fail" hint="(target_mrr − current MRR), floored at zero. Returned by backend so calc stays single-sourced." />
        <Card label="paid users needed @ $29.99" value={customersNeeded} tone="pending" hint="Ceil((target − current MRR) / $29.99). Assumes solo-tier pricing; real mix is lower (pro/agency add more MRR per user)." />
      </div>

      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          <span>
            $30k MRR progress
            <InfoIcon hint="Visual % of MRR target reached. min(100, round(current MRR / target_mrr × 100))." />
          </span>
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
        <Card label="tool / api costs" value={moneyCentsOrDash(toolCosts || null)} hint="Sum of api-services monthly_cost_cents + current_month_spend_cents. Null until provider invoices are ingested." />
        <Card label="agent costs" value={moneyCentsOrDash(agentCosts || null)} hint="Sum of agents spent_this_month_cents. Null until per-agent billing events are tracked." />
        <Card label="people costs" value={moneyCentsOrDash(peopleCosts || null)} hint="Sum of active employees monthly_cost_cents. Null until a people-directory table stores payroll." />
        <Card label="total monthly burn" value={moneyCentsOrDash(totalBurn || null)} tone={costsKnown && totalBurn > grossThisMonth ? "fail" : undefined} hint="tool + agent + people costs combined. Turns fuchsia when burn exceeds this month's gross." />
        <Card label="gross revenue (this mo)" value={moneyCents(grossThisMonth)} hint="This calendar month's gross from the monthly revenue rollup (last row of revenue.monthly)." />
        <Card label="net monthly cash" value={costsKnown ? moneyCents(netCash) : "—"} tone={costsKnown && netCash < 0 ? "fail" : "ok"} hint="gross revenue − total burn. Renders as — until any cost telemetry is wired." />
        <Card label="1,000 paid users" value={`${revenue?.headline.paid_users ?? 0} / 1,000`} hint="Progress toward the 1k-paid-users milestone. paid_users = users with active paid subscription_status." />
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
      <Panel title="revenue · path to $30k MRR" hint="Loading live revenue from /admin/revenue/summary." right={<LiveBadge state={src.state} />}>
        <LoadingNote />
        <ErrorNote error={error} />
      </Panel>
    );
  }
  if (!summary) {
    return (
      <Panel title="revenue · path to $30k MRR" hint="Backend call to /admin/revenue/summary failed — check Railway logs + error chip above." right={<LiveBadge state={src.state} />}>
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

  const COL_HINTS_BLK: Record<string, string> = {
    "code": "Error code group key (e.g. EXPORT_FAILED, LICENSE_INVALID). Aggregated from DesktopErrorEvent rows.",
    "count": "Total events for this code in the rolling 24h window.",
    "affected users": "Distinct user_id count for this code in the same window.",
    "route": "Frontend route or backend endpoint the error fired from. Null when source not tagged.",
    "latest message": "Most recent error message in the group (truncated to 300px). Hover full row for the untruncated string.",
    "latest at": "When the latest error of this code group occurred. Truncated to minute.",
  };
  const COL_HINTS_DAILY: Record<string, string> = {
    "date": "Calendar date (UTC). One row per day in the rolling window.",
    "new signups": "New User rows created on this date.",
    "new paid": "Users whose paid status flipped on this date (Stripe/Whop webhook → users row).",
    "canceled": "Subscriptions that canceled / expired on this date.",
    "gross": "Calculated gross USD for the day. Approximate — actual payments ledger lives in Stripe/Whop.",
  };
  const COL_HINTS_WEEK: Record<string, string> = {
    "week starting": "Monday of the ISO week (UTC).",
    "new signups": "New User rows created during this week.",
    "new paid": "Paid conversions during this week.",
    "canceled": "Cancellations during this week.",
    "gross": "Sum of daily gross over the week. Same approximation caveat.",
  };
  const COL_HINTS_MONTH: Record<string, string> = {
    "month": "Calendar month (YYYY-MM).",
    "MRR": "Snapshot of MRR at end of this month. Computed from active paid users × tier baseline price.",
    "paid": "Paid users at end of this month.",
    "free": "Free users at end of this month.",
    "new signups": "New User rows in this month.",
    "new paid": "Paid conversions in this month.",
    "gross": "Sum of monthly gross. Approximate, see Stripe/Whop for canonical ledger.",
  };

  return (
    <Panel
      title="revenue · path to $30k MRR (live)"
      hint="MRR + signup buckets recomputed from the users table on every load — no cache. Daily gross is approximate; Stripe + Whop own the canonical payments ledger."
      sub="MRR + signup buckets computed live from the users table. Stripe/Whop own the actual payments ledger."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge state={src.state} />
          <span className="inline-flex items-center"><button onClick={() => void load()} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia">refresh</button><InfoIcon hint="Re-fetch this tab's data from the backend. No cache — every click hits /api/admin/* fresh." /></span>
        </div>
      }
    >
      <ErrorNote error={error} />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <Card label="today's gross" value={moneyCents(today?.gross_cents ?? 0)} hint="Gross USD for today (UTC). Approximated from daily revenue rollup — Stripe owns canonical." />
        <Card label="this week's gross" value={moneyCents(thisWeek?.gross_cents ?? 0)} hint="Gross USD for the current ISO week (Mon-Sun, UTC)." />
        <Card label="this month's gross" value={moneyCents(thisMonth?.gross_cents ?? 0)} hint="Gross USD for the current calendar month." />
        <Card label="current MRR" value={moneyCents(headline.mrr_cents)} hint="Sum of (tier baseline price × active paid subscribers). Live from User table, no cache." />
        <Card label="paid users" value={headline.paid_users} hint="Users with active paid subscription_status (solo / pro / agency)." />
        <Card label="free users" value={headline.free_users} hint="Users on the free tier — counted from User rows with tier='free'." />
        <Card label="users total" value={headline.users_total} hint="Total User rows in the DB (paid + free + canceled)." />
        <Card label="canceled / expired" value={headline.canceled_users} tone="fail" hint="Users whose subscription_status is canceled / past_due / expired. Churn candidates." />
        <Card label="gap to $30k MRR" value={moneyCents(headline.gap_to_target_cents)} tone="fail" hint="target_mrr_cents − mrr_cents, computed backend-side so UI never drifts from canonical target." />
        <Card label="paid users needed @ $29.99" value={customersNeeded} tone="pending" hint="Ceil(gap / $29.99). Assumes solo-tier pricing; actual mix needs fewer users when pro/agency convert." />
      </div>

      <div className="mb-6 rounded-2xl border border-line bg-paper p-4">
        <SectionHead title="MRR target" hint="Progress bar toward target_mrr_cents (default $30k). Target is editable backend-side via revenue.headline.target_mrr_cents." sub={`${moneyCents(headline.target_mrr_cents)} target · ${headline.paid_users} paid users so far`} />
        <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          <span>
            progress
            <InfoIcon hint="min(100, round(current MRR / target_mrr × 100)). Capped at 100% display, real number can overshoot." />
          </span>
          <span>{progress}%</span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-paper-elev">
          <div className="h-full rounded-full bg-fuchsia" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-line bg-paper p-4">
        <SectionHead title="revenue blockers" hint="Top error groups in the rolling 24h window. Source: /admin/revenue/blockers (DesktopErrorEvent aggregated by code)." sub="Top error groups from desktop telemetry in the last 24h." />
        {blockers && blockers.rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse font-mono text-[11px]">
              <thead>
                <tr className="text-left text-text-tertiary">
                  {["code", "count", "affected users", "route", "latest message", "latest at"].map((h) => (
                    <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">
                      {h}
                      {COL_HINTS_BLK[h] && <InfoIcon hint={COL_HINTS_BLK[h]} />}
                    </th>
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
        <SectionHead title="daily" hint="Daily rollup buckets returned by /admin/revenue/summary. UTC dates. Each row = 24h slice." sub="Daily rollup over the recent window. Source: junior-backend /admin/revenue/summary." />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr className="text-left text-text-tertiary">
                {["date", "new signups", "new paid", "canceled", "gross"].map((h) => (
                  <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">
                    {h}
                    {COL_HINTS_DAILY[h] && <InfoIcon hint={COL_HINTS_DAILY[h]} />}
                  </th>
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
        <SectionHead title="weekly" hint="ISO-week rollup (Mon-Sun). Each row aggregates the daily buckets in that week." sub="ISO weekly rollup. Each row sums the days in that week." />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr className="text-left text-text-tertiary">
                {["week starting", "new signups", "new paid", "canceled", "gross"].map((h) => (
                  <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">
                    {h}
                    {COL_HINTS_WEEK[h] && <InfoIcon hint={COL_HINTS_WEEK[h]} />}
                  </th>
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
        <SectionHead title="monthly" hint="Calendar-month rollup (YYYY-MM). MRR + paid/free columns are end-of-month snapshots, not running totals." sub="Calendar-month rollup. MRR + paid/free are end-of-month snapshots." />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr className="text-left text-text-tertiary">
                {["month", "MRR", "paid", "free", "new signups", "new paid", "gross"].map((h) => (
                  <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">
                    {h}
                    {COL_HINTS_MONTH[h] && <InfoIcon hint={COL_HINTS_MONTH[h]} />}
                  </th>
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
      <p className="mt-3 font-mono text-[10px] text-text-tertiary">{summary.note}<InfoIcon hint="Backend-shipped honesty note from /admin/revenue/summary — calls out approximations (e.g. per-day revenue not persisted in v0; Stripe/Whop own the ledger)." /></p>
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
      hint="Combined feed of two sources: /admin/revenue/blockers (top 5 desktop error groups, last 24h) + /admin/agent-reports (per-lane agent notes). Agent reports are empty in v0 — no table wired."
      sub="Top error groups from desktop telemetry + per-lane agent reports."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge state={src.state} />
          <span className="inline-flex items-center"><button onClick={() => void load()} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia">refresh</button><InfoIcon hint="Re-fetch this tab's data from the backend. No cache — every click hits /api/admin/* fresh." /></span>
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
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                {b.code} · {b.route ?? "no route"}
                <InfoIcon hint="Error-code key · originating route. Aggregated from DesktopErrorEvent over the last 24h." />
              </div>
              <Chip label={`${b.count} events`} tone="fail" />
            </div>
            <p className="mt-2 font-sans text-[13px] leading-relaxed text-text-secondary">{b.latest_message ?? "—"}</p>
            <div className="mt-2 font-mono text-[10px] text-fuchsia-deep">
              affected: {b.affected_users} users · {b.latest_at?.slice(0, 16) ?? "—"}
              <InfoIcon hint="Distinct affected user count · latest occurrence timestamp (truncated to minute, UTC)." />
            </div>
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
      hint="Future home for inbound user messages (sender · kind · status). No inbox_messages table in v0 — wire /webhooks/support or an in-app support form to populate."
      sub="Inbound customer messages. v0 has no inbox_messages table."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge state={src.state} />
          <span className="inline-flex items-center"><button onClick={() => void load()} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia">refresh</button><InfoIcon hint="Re-fetch this tab's data from the backend. No cache — every click hits /api/admin/* fresh." /></span>
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
