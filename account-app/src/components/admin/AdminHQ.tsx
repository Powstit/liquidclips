"use client";

import { useCallback, useState } from "react";

// Read-only Admin HQ v0 — dense, utilitarian, on-brand (paper/ink + fuchsia).
// All data is fetched THROUGH /api/admin/* proxy routes that re-check admin on
// the server and forward the internal secret; the browser never sees the
// secret. The page.tsx server component already gated access before rendering
// this; these client fetches are an additional admin-gated server hop.
//
// Display rules:
//  - emails are masked in tables; full email only in the single-user detail.
//  - claim tokens: never render the raw token (the API only returns short ids).
//  - unavailable data shows "not available" — never invent values.

// ---- shared types (loose; backend is source of truth) ----------------
type Json = Record<string, unknown>;

type Overview = {
  config: Record<string, boolean | string>;
  counts: Record<string, number>;
  notes: Record<string, string>;
  generated_at: string;
};

type UserRow = {
  backend_user_id: string;
  clerk_id: string;
  email_masked: string;
  whop_user_id: string | null;
  affiliate_id: string | null;
  tier: string;
  founder: boolean;
  subscription_status: string;
  billing_provider: string;
  created_at: string | null;
};

type UserDetail = {
  backend_user_id: string;
  clerk_id: string;
  email: string;
  whop_user_id: string | null;
  affiliate_id: string | null;
  raw_tier: string;
  raw_founder: boolean;
  effective_tier: string;
  effective_founder: boolean;
  admin_override: boolean;
  subscription_status: string;
  billing_provider: string;
  trial_started_at: string | null;
  paid_until: string | null;
  starter_exports_used: number;
  starter_export_cap: number;
  remaining_exports: number | null;
  created_at: string | null;
  latest_license: {
    id: string;
    tier_at_issue: string;
    issued_at: string | null;
    expires_at: string | null;
    revoked: boolean;
  } | null;
};

type TimelineEvent = { at: string | null; kind: string; label: string; source: string };
type Timeline = { user_id: string; email_masked: string; events: TimelineEvent[]; unavailable: string[]; note: string };

const TABS = [
  "Overview",
  "Users",
  "Pending Whop",
  "Claims",
  "Webhooks",
  "Usage",
  "Billing",
  "Postiz",
  "Bugs",
] as const;
type Tab = (typeof TABS)[number];

// ---- status chip -----------------------------------------------------
type ChipTone = "ok" | "pending" | "fail" | "gray";

function chipTone(value: string): ChipTone {
  const v = value.toLowerCase();
  if (["active", "ok", "true", "yes", "live", "published", "open", "used", "connected", "handled"].includes(v)) return "ok";
  if (["trial", "trialing", "pending", "scheduled", "uploading", "consumed"].includes(v)) return "pending";
  if (["failed", "fail", "blocked", "expired", "canceled", "past_due", "refunded", "false", "no", "denied", "revoked"].includes(v))
    return "fail";
  return "gray";
}

function Chip({ label, tone }: { label: string; tone?: ChipTone }) {
  const t = tone ?? chipTone(label);
  const cls =
    t === "ok"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
      : t === "pending"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700"
        : t === "fail"
          ? "border-fuchsia-deep/40 bg-fuchsia-soft/40 text-fuchsia-deep"
          : "border-line bg-paper-warm/60 text-text-tertiary";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${cls}`}>
      {label}
    </span>
  );
}

function BoolChip({ value, on = "yes", off = "no" }: { value: boolean; on?: string; off?: string }) {
  return <Chip label={value ? on : off} tone={value ? "ok" : "fail"} />;
}

function NA() {
  return <span className="font-mono text-[11px] text-text-tertiary">not available</span>;
}

// ---- generic fetch helper -------------------------------------------
function useAdminFetch() {
  return useCallback(async (path: string, init?: RequestInit): Promise<Json> => {
    const res = await fetch(`/api/admin/${path}`, { cache: "no-store", ...init });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${res.status} ${body.slice(0, 200)}`);
    }
    return (await res.json()) as Json;
  }, []);
}

// =====================================================================
export function AdminHQ({ adminEmail, initialOverview }: { adminEmail: string; initialOverview: Overview | null }) {
  const [tab, setTab] = useState<Tab>("Overview");

  return (
    <div className="mx-auto max-w-[1200px] px-5 py-8 sm:py-12">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fuchsia">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-fuchsia" />
            admin hq · read-only
          </div>
          <h1 className="mt-2 font-display text-[clamp(28px,4vw,42px)] font-semibold leading-[1.05] tracking-[-0.03em] text-ink">
            Junior control surface.
          </h1>
        </div>
        <div className="text-right font-mono text-[11px] text-text-tertiary">
          <div>signed in</div>
          <div className="text-ink">{adminEmail}</div>
        </div>
      </header>

      <nav className="mt-7 flex flex-wrap gap-1.5 border-b border-line pb-3">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] transition ${
              tab === t ? "bg-ink text-paper" : "border border-line bg-paper text-ink hover:border-fuchsia"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      <div className="mt-7">
        {tab === "Overview" && <OverviewTab initial={initialOverview} />}
        {tab === "Users" && <UsersTab />}
        {tab === "Pending Whop" && <PendingWhopTab />}
        {tab === "Claims" && <ClaimsTab />}
        {tab === "Webhooks" && <WebhooksTab />}
        {tab === "Usage" && <UsageTab />}
        {tab === "Billing" && <BillingTab />}
        {tab === "Postiz" && <PostizTab />}
        {tab === "Bugs" && <BugsTab />}
      </div>

      <footer className="mt-14 border-t border-line pt-5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
        read-only inspection · no payment / destructive actions · backend db is source of truth
      </footer>
    </div>
  );
}

// ---- panel scaffolding ----------------------------------------------
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

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="mt-2 rounded-xl border border-fuchsia-deep/30 bg-fuchsia-soft/30 px-3 py-2 font-mono text-[11px] text-fuchsia-deep">
      {error}
    </div>
  );
}

function Loader({ on }: { on: boolean }) {
  if (!on) return null;
  return <div className="font-mono text-[11px] text-text-tertiary">loading…</div>;
}

// =====================================================================
// Overview
// =====================================================================
function OverviewTab({ initial }: { initial: Overview | null }) {
  const fetchAdmin = useAdminFetch();
  const [data, setData] = useState<Overview | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initial ? null : "Overview not loaded — refresh to retry.");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData((await fetchAdmin("overview")) as unknown as Overview);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [fetchAdmin]);

  return (
    <Panel
      title="overview · config + counts"
      sub="'configured' means a secret is set in env — never the value. Counts are live from the DB."
      right={
        <button onClick={refresh} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink hover:border-fuchsia">
          refresh
        </button>
      }
    >
      <Loader on={loading} />
      <ErrorNote error={error} />
      {data && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Object.entries(data.config).map(([k, v]) => (
              <div key={k} className="rounded-2xl border border-line bg-paper p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">{k}</div>
                <div className="mt-2">
                  {typeof v === "boolean" ? <BoolChip value={v} /> : <span className="font-mono text-[12px] text-ink">{String(v)}</span>}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Object.entries(data.counts).map(([k, v]) => (
              <div key={k} className="rounded-2xl border border-line bg-paper p-4">
                <div className="font-display text-[28px] font-bold tracking-[-0.02em] text-ink">{v}</div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">{k.replace(/_/g, " ")}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-1">
            {Object.entries(data.notes).map(([k, v]) => (
              <div key={k} className="font-mono text-[11px] text-text-tertiary">
                <span className="text-ink">{k.replace(/_/g, " ")}:</span> {v}
              </div>
            ))}
          </div>
          <div className="mt-3 font-mono text-[10px] text-text-tertiary">generated {data.generated_at}</div>
        </>
      )}
    </Panel>
  );
}

// =====================================================================
// Users — search + detail + timeline. Drives Usage/Billing tabs too.
// =====================================================================
function useUserDetail() {
  const fetchAdmin = useAdminFetch();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserRow[]>([]);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setDetail(null);
    setTimeline(null);
    try {
      const r = (await fetchAdmin(`users?query=${encodeURIComponent(query.trim())}`)) as unknown as { results: UserRow[] };
      setResults(r.results ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [fetchAdmin, query]);

  const open = useCallback(
    async (id: string) => {
      setLoading(true);
      setError(null);
      setTimeline(null);
      try {
        setDetail((await fetchAdmin(`users/${encodeURIComponent(id)}`)) as unknown as UserDetail);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [fetchAdmin],
  );

  const loadTimeline = useCallback(
    async (id: string) => {
      try {
        setTimeline((await fetchAdmin(`users/${encodeURIComponent(id)}/timeline`)) as unknown as Timeline);
      } catch (e) {
        setError(String(e));
      }
    },
    [fetchAdmin],
  );

  return { query, setQuery, results, detail, timeline, loading, error, search, open, loadTimeline };
}

function SearchBar({ query, setQuery, onSearch, loading }: { query: string; setQuery: (s: string) => void; onSearch: () => void; loading: boolean }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSearch()}
        placeholder="email · clerk id · whop user id · backend id · affiliate id"
        className="w-full flex-1 rounded-xl border border-line bg-paper px-3 py-2.5 font-mono text-[12px] text-ink placeholder:text-text-tertiary"
      />
      <button onClick={onSearch} disabled={loading} className="shrink-0 rounded-xl bg-ink px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.1em] text-paper transition hover:bg-fuchsia disabled:opacity-50">
        {loading ? "…" : "search"}
      </button>
    </div>
  );
}

function ResultsTable({ rows, onOpen }: { rows: UserRow[]; onOpen: (id: string) => void }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full border-collapse font-mono text-[11px]">
        <thead>
          <tr className="text-left text-text-tertiary">
            {["email", "tier", "status", "provider", "founder", "created", ""].map((h) => (
              <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.backend_user_id} className="border-b border-line/40 hover:bg-paper-warm/60">
              <td className="px-2 py-2 text-ink">{u.email_masked}</td>
              <td className="px-2 py-2"><Chip label={u.tier} /></td>
              <td className="px-2 py-2"><Chip label={u.subscription_status} /></td>
              <td className="px-2 py-2 text-text-secondary">{u.billing_provider}</td>
              <td className="px-2 py-2">{u.founder ? <Chip label="founder" tone="ok" /> : <span className="text-text-tertiary">—</span>}</td>
              <td className="px-2 py-2 text-text-tertiary">{u.created_at?.slice(0, 10) ?? "—"}</td>
              <td className="px-2 py-2">
                <button onClick={() => onOpen(u.backend_user_id)} className="rounded-full border border-line px-2.5 py-1 uppercase tracking-[0.08em] text-ink hover:border-fuchsia">
                  open
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/40 px-1 py-1.5 last:border-b-0">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">{label}</span>
      <span className="text-right font-mono text-[11px] text-ink">{children}</span>
    </div>
  );
}

function UserDetailCard({ d, timeline, onLoadTimeline }: { d: UserDetail; timeline: Timeline | null; onLoadTimeline: (id: string) => void }) {
  return (
    <div className="mt-5 rounded-2xl border border-line bg-paper p-5">
      <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        <div>
          <KV label="email (full)">{d.email}</KV>
          <KV label="backend id">{d.backend_user_id}</KV>
          <KV label="clerk id">{d.clerk_id}</KV>
          <KV label="whop user id">{d.whop_user_id ?? <NA />}</KV>
          <KV label="affiliate id (referrer)">{d.affiliate_id ?? <NA />}</KV>
          <KV label="created">{d.created_at ?? <NA />}</KV>
        </div>
        <div>
          <KV label="tier raw → effective">
            <span>
              {d.raw_tier} → <Chip label={d.effective_tier} />
              {d.admin_override && <span className="ml-1"><Chip label="admin override" tone="pending" /></span>}
            </span>
          </KV>
          <KV label="founder raw / effective">{d.raw_founder ? "yes" : "no"} / {d.effective_founder ? "yes" : "no"}</KV>
          <KV label="subscription status"><Chip label={d.subscription_status} /></KV>
          <KV label="billing provider">{d.billing_provider}</KV>
          <KV label="paid until">{d.paid_until ?? <NA />}</KV>
          <KV label="exports used / cap">{d.starter_exports_used} / {d.starter_export_cap}</KV>
          <KV label="remaining exports">{d.remaining_exports === null ? "unlimited" : d.remaining_exports}</KV>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-line bg-paper-warm/50 p-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">latest license</div>
        {d.latest_license ? (
          <div className="mt-2 grid grid-cols-2 gap-x-6 sm:grid-cols-4">
            <KV label="tier at issue">{d.latest_license.tier_at_issue}</KV>
            <KV label="issued">{d.latest_license.issued_at ?? <NA />}</KV>
            <KV label="expires">{d.latest_license.expires_at ?? <NA />}</KV>
            <KV label="revoked">{d.latest_license.revoked ? <Chip label="revoked" tone="fail" /> : <Chip label="active" tone="ok" />}</KV>
          </div>
        ) : (
          <div className="mt-2"><NA /> <span className="font-mono text-[11px] text-text-tertiary">— no license minted yet</span></div>
        )}
      </div>

      <div className="mt-4">
        <button onClick={() => onLoadTimeline(d.backend_user_id)} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink hover:border-fuchsia">
          load timeline
        </button>
        {timeline && (
          <div className="mt-3 rounded-xl border border-line bg-paper-warm/50 p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">{timeline.note}</div>
            <ol className="mt-3 space-y-1.5">
              {timeline.events.map((ev, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-2 font-mono text-[11px]">
                  <span className="text-text-tertiary">{ev.at ?? "—"}</span>
                  <Chip label={ev.kind} tone="gray" />
                  <span className="text-ink">{ev.label}</span>
                  <span className="text-text-tertiary">({ev.source})</span>
                </li>
              ))}
              {timeline.events.length === 0 && <li className="font-mono text-[11px] text-text-tertiary">no dated events</li>}
            </ol>
            <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">not available in v0</div>
            <ul className="mt-1 space-y-0.5">
              {timeline.unavailable.map((u, i) => (
                <li key={i} className="font-mono text-[10px] text-text-tertiary">· {u}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function UsersTab() {
  const s = useUserDetail();
  return (
    <Panel title="users · search + detail" sub="Emails masked in results; full email only in the detail card below.">
      <SearchBar query={s.query} setQuery={s.setQuery} onSearch={s.search} loading={s.loading} />
      <ErrorNote error={s.error} />
      <ResultsTable rows={s.results} onOpen={s.open} />
      {s.detail && <UserDetailCard d={s.detail} timeline={s.timeline} onLoadTimeline={s.loadTimeline} />}
    </Panel>
  );
}

// Usage tab — focuses on the export gate for a searched user.
function UsageTab() {
  const s = useUserDetail();
  const d = s.detail;
  const wouldBlock = d ? d.remaining_exports !== null && d.remaining_exports <= 0 : false;
  return (
    <Panel title="usage · export gate" sub="Search a user to inspect their 100-export starter pass and whether export #101 would be blocked.">
      <SearchBar query={s.query} setQuery={s.setQuery} onSearch={s.search} loading={s.loading} />
      <ErrorNote error={s.error} />
      <ResultsTable rows={s.results} onOpen={s.open} />
      {d && (
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-2xl border border-line bg-paper p-4">
            <div className="font-display text-[28px] font-bold text-ink">{d.starter_exports_used}</div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">exports used</div>
          </div>
          <div className="rounded-2xl border border-line bg-paper p-4">
            <div className="font-display text-[28px] font-bold text-ink">{d.remaining_exports === null ? "∞" : d.remaining_exports}</div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">remaining exports</div>
          </div>
          <div className="rounded-2xl border border-line bg-paper p-4">
            <div className="mt-1"><Chip label={d.subscription_status === "active" ? "active" : "trialing"} /></div>
            <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">trialing vs active</div>
          </div>
          <div className="rounded-2xl border border-line bg-paper p-4">
            <div className="mt-1"><Chip label={d.remaining_exports === null ? "no" : wouldBlock ? "blocked" : "no"} tone={d.remaining_exports === null ? "ok" : wouldBlock ? "fail" : "ok"} /></div>
            <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">export #101 blocked?</div>
          </div>
          <div className="col-span-2 mt-1 font-mono text-[11px] text-text-tertiary sm:col-span-4">
            last individual export event: <NA /> — only the running counter is stored in v0 (PostHog has clip-export events).
          </div>
        </div>
      )}
    </Panel>
  );
}

// Billing tab — provider-specific read-only state for a searched user.
function BillingTab() {
  const s = useUserDetail();
  const d = s.detail;
  const whopOrders = "https://whop.com/dashboard";
  const clerkDash = "https://dashboard.clerk.com";
  return (
    <Panel title="billing · read-only" sub="No cancel / refund / edit in v0. Whop & Clerk/Stripe own the ledger.">
      <SearchBar query={s.query} setQuery={s.setQuery} onSearch={s.search} loading={s.loading} />
      <ErrorNote error={s.error} />
      <ResultsTable rows={s.results} onOpen={s.open} />
      {d && (
        <div className="mt-5 rounded-2xl border border-line bg-paper p-5">
          <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            <div>
              <KV label="provider"><Chip label={d.billing_provider} /></KV>
              <KV label="subscription status"><Chip label={d.subscription_status} /></KV>
              <KV label="tier"><Chip label={d.effective_tier} /></KV>
              <KV label="paid until">{d.paid_until ?? <NA />}</KV>
            </div>
            <div>
              <KV label="founder">{d.effective_founder ? "yes" : "no"}</KV>
              <KV label="refunded">{d.subscription_status === "refunded" ? "yes" : "no"}</KV>
              <KV label="canceled">{d.subscription_status === "canceled" ? "yes" : "no"}</KV>
              <KV label="past due">{d.subscription_status === "past_due" ? "yes" : "no"}</KV>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={d.billing_provider === "whop" ? whopOrders : clerkDash} target="_blank" rel="noreferrer" className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink hover:border-fuchsia">
              open {d.billing_provider} dashboard →
            </a>
          </div>
          <p className="mt-3 font-mono text-[11px] text-text-tertiary">
            Deep customer/order links are not available — the backend does not store a Whop order id or Clerk/Stripe customer id mapping in v0. These open the provider dashboard root.
          </p>
        </div>
      )}
    </Panel>
  );
}

// =====================================================================
// Pending Whop (read-only)
// =====================================================================
type Pending = {
  id: string;
  email_masked: string;
  tier: string;
  founder: boolean;
  whop_user_id: string | null;
  renewal_period_end: number | null;
  created_at: string | null;
  consumed_at: string | null;
  status: string;
  age_seconds: number | null;
};

function ageLabel(s: number | null): string {
  if (s === null) return "—";
  const d = Math.floor(s / 86400);
  if (d > 0) return `${d}d`;
  const h = Math.floor(s / 3600);
  if (h > 0) return `${h}h`;
  return `${Math.floor(s / 60)}m`;
}

function useList<T>(path: string) {
  const fetchAdmin = useAdminFetch();
  const [rows, setRows] = useState<T[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = (await fetchAdmin(path)) as unknown as { rows: T[]; note?: string };
      setRows(r.rows ?? []);
      setNote(r.note ?? null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [fetchAdmin, path]);

  return { rows, note, loading, error, load, fetchAdmin };
}

function LoadButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink hover:border-fuchsia">
      load
    </button>
  );
}

function PendingWhopTab() {
  const { rows, note, loading, error, load } = useList<Pending>("pending-whop");
  return (
    <Panel title="pending whop · read-only" sub="Entitlements parked for buyers who paid on Whop before signing up. Emails masked." right={<LoadButton onClick={load} />}>
      <Loader on={loading} />
      <ErrorNote error={error} />
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr className="text-left text-text-tertiary">
                {["email", "tier", "founder", "whop user id", "renewal end", "created", "consumed", "status", "age"].map((h) => (
                  <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-line/40">
                  <td className="px-2 py-2 text-ink">{p.email_masked}</td>
                  <td className="px-2 py-2"><Chip label={p.tier} /></td>
                  <td className="px-2 py-2">{p.founder ? <Chip label="founder" tone="ok" /> : "—"}</td>
                  <td className="px-2 py-2 text-text-secondary">{p.whop_user_id ?? "—"}</td>
                  <td className="px-2 py-2 text-text-secondary">{p.renewal_period_end ?? "—"}</td>
                  <td className="px-2 py-2 text-text-tertiary">{p.created_at?.slice(0, 16) ?? "—"}</td>
                  <td className="px-2 py-2 text-text-tertiary">{p.consumed_at?.slice(0, 16) ?? "—"}</td>
                  <td className="px-2 py-2"><Chip label={p.status} /></td>
                  <td className="px-2 py-2 text-text-secondary">{ageLabel(p.age_seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {note && <p className="mt-3 font-mono text-[11px] text-text-tertiary">{note}</p>}
    </Panel>
  );
}

// =====================================================================
// Claims (read-only) + safe actions
// =====================================================================
type Claim = {
  id: string;
  short_id: string | null;
  target_email_masked: string;
  requester_clerk_id: string;
  created_at: string | null;
  expires_at: string | null;
  used_at: string | null;
  status: string;
};

function ClaimsTab() {
  const { rows, loading, error, load, fetchAdmin } = useList<Claim>("claims");
  const [actioning, setActioning] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const act = useCallback(
    async (id: string, action: "expire" | "resend") => {
      setActioning(`${id}:${action}`);
      setActionMsg(null);
      try {
        const r = (await fetchAdmin(`claims/${encodeURIComponent(id)}/${action}`, { method: "POST" })) as unknown as { message: string };
        setActionMsg(r.message ?? "done");
        await load();
      } catch (e) {
        setActionMsg(String(e));
      } finally {
        setActioning(null);
      }
    },
    [fetchAdmin, load],
  );

  return (
    <Panel title="claims · read-only + safe actions" sub="Raw tokens are never rendered. Safe actions: expire (burn link) · resend (re-email the SAME open link)." right={<LoadButton onClick={load} />}>
      <Loader on={loading} />
      <ErrorNote error={error} />
      {actionMsg && <div className="mt-2 rounded-xl border border-line bg-paper px-3 py-2 font-mono text-[11px] text-ink">{actionMsg}</div>}
      {rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr className="text-left text-text-tertiary">
                {["short id", "target email", "requester", "created", "expires", "used", "status", "actions"].map((h) => (
                  <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-line/40">
                  <td className="px-2 py-2 text-ink">{c.short_id ?? "—"}</td>
                  <td className="px-2 py-2 text-ink">{c.target_email_masked}</td>
                  <td className="px-2 py-2 text-text-secondary">{c.requester_clerk_id.slice(0, 14)}…</td>
                  <td className="px-2 py-2 text-text-tertiary">{c.created_at?.slice(0, 16) ?? "—"}</td>
                  <td className="px-2 py-2 text-text-tertiary">{c.expires_at?.slice(0, 16) ?? "—"}</td>
                  <td className="px-2 py-2 text-text-tertiary">{c.used_at?.slice(0, 16) ?? "—"}</td>
                  <td className="px-2 py-2"><Chip label={c.status} /></td>
                  <td className="px-2 py-2">
                    <div className="flex gap-1.5">
                      <button
                        disabled={c.status !== "open" || actioning !== null}
                        onClick={() => act(c.id, "expire")}
                        className="rounded-full border border-line px-2 py-0.5 uppercase tracking-[0.08em] text-ink hover:border-fuchsia disabled:opacity-30"
                      >
                        {actioning === `${c.id}:expire` ? "…" : "expire"}
                      </button>
                      <button
                        disabled={c.status !== "open" || actioning !== null}
                        onClick={() => act(c.id, "resend")}
                        className="rounded-full border border-line px-2 py-0.5 uppercase tracking-[0.08em] text-ink hover:border-fuchsia disabled:opacity-30"
                      >
                        {actioning === `${c.id}:resend` ? "…" : "resend"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// =====================================================================
// Webhooks (read-only)
// =====================================================================
type Webhook = {
  id: string;
  provider: string;
  event_name: string;
  status: string;
  user_id: string | null;
  pending_whop_membership_id: string | null;
  claim_token_id: string | null;
  external_event_id: string | null;
  error: string | null;
  received_at: string | null;
  handled_at: string | null;
};

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-line bg-paper px-2 py-1 text-[11px] text-ink"
      >
        {options.map((o) => (
          <option key={o} value={o}>{o || "all"}</option>
        ))}
      </select>
    </label>
  );
}

function WebhooksTab() {
  const fetchAdmin = useAdminFetch();
  const [rows, setRows] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [provider, setProvider] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (provider) qs.set("provider", provider);
      if (status) qs.set("status", status);
      const path = qs.toString() ? `webhooks?${qs.toString()}` : "webhooks";
      const r = (await fetchAdmin(path)) as unknown as { rows: Webhook[] };
      setRows(r.rows ?? []);
      setLoaded(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [fetchAdmin, provider, status]);

  const shortId = (v: string | null) => (v ? v.slice(0, 8) + "…" : null);

  return (
    <Panel
      title="webhooks · read-only"
      sub="Metadata-only log of signature-valid Clerk/Whop webhooks — no payloads, emails, secrets, or tokens stored."
      right={<LoadButton onClick={load} />}
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <FilterSelect label="provider" value={provider} onChange={setProvider} options={["", "clerk", "whop"]} />
        <FilterSelect label="status" value={status} onChange={setStatus} options={["", "handled", "ignored", "failed"]} />
        <span className="font-mono text-[10px] text-text-tertiary">pick filters, then Load</span>
      </div>
      <Loader on={loading} />
      <ErrorNote error={error} />
      {loaded && rows.length === 0 && !loading && (
        <p className="font-mono text-[11px] text-text-tertiary">No webhook rows for this filter yet.</p>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr className="text-left text-text-tertiary">
                {["provider", "event", "status", "linked", "error", "received", "handled"].map((h) => (
                  <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id} className="border-b border-line/40 align-top">
                  <td className="px-2 py-2"><Chip label={w.provider} tone="gray" /></td>
                  <td className="px-2 py-2 text-ink">{w.event_name}</td>
                  <td className="px-2 py-2"><Chip label={w.status} /></td>
                  <td className="px-2 py-2 text-text-tertiary">
                    {w.user_id ? <span title="backend user id">u:{shortId(w.user_id)}</span> : null}
                    {w.pending_whop_membership_id ? <span title="pending membership id"> p:{shortId(w.pending_whop_membership_id)}</span> : null}
                    {!w.user_id && !w.pending_whop_membership_id ? <NA /> : null}
                  </td>
                  <td className="max-w-[260px] truncate px-2 py-2 text-fuchsia-deep" title={w.error ?? undefined}>{w.error ?? "—"}</td>
                  <td className="px-2 py-2 text-text-tertiary">{w.received_at?.slice(0, 19) ?? "—"}</td>
                  <td className="px-2 py-2 text-text-tertiary">{w.handled_at?.slice(0, 19) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// =====================================================================
// Postiz (status display only)
// =====================================================================
type PostizData = {
  configured: boolean;
  status_counts: Record<string, number>;
  schedules_total: number;
  last_error: { schedule_id: string; platform: string; error: string; at: string | null; retry_count: number } | null;
  connections: { users_with_connection: number; active_connections: number };
  recent_schedules: { id: string; platform: string; status: string; scheduled_for: string | null; post_url: string | null; retry_count: number; updated_at: string | null }[];
  note: string;
};

function PostizTab() {
  const fetchAdmin = useAdminFetch();
  const [data, setData] = useState<PostizData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData((await fetchAdmin("postiz")) as unknown as PostizData);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [fetchAdmin]);

  return (
    <Panel title="postiz · status only" sub="Display only — Admin HQ never calls or changes Postiz." right={<LoadButton onClick={load} />}>
      <Loader on={loading} />
      <ErrorNote error={error} />
      {data && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div className="mt-1"><BoolChip value={data.configured} on="configured" off="not configured" /></div>
              <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">postiz live</div>
            </div>
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div className="font-display text-[28px] font-bold text-ink">{data.connections.users_with_connection}</div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">users connected</div>
            </div>
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div className="font-display text-[28px] font-bold text-ink">{data.connections.active_connections}</div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">active connections</div>
            </div>
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div className="font-display text-[28px] font-bold text-ink">{data.schedules_total}</div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">schedules total</div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {Object.keys(data.status_counts).length === 0 ? (
              <span className="font-mono text-[11px] text-text-tertiary">no schedule rows yet</span>
            ) : (
              Object.entries(data.status_counts).map(([k, v]) => (
                <span key={k} className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1.5">
                  <Chip label={k} />
                  <span className="font-display text-[15px] font-bold text-ink">{v}</span>
                </span>
              ))
            )}
          </div>

          <div className="mt-4 rounded-xl border border-line bg-paper-warm/50 p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">last error</div>
            {data.last_error ? (
              <div className="mt-2 font-mono text-[11px] text-fuchsia-deep">
                [{data.last_error.platform}] {data.last_error.error}
                <span className="text-text-tertiary"> · {data.last_error.at ?? "—"} · retries {data.last_error.retry_count}</span>
              </div>
            ) : (
              <div className="mt-2"><NA /> <span className="font-mono text-[11px] text-text-tertiary">— no failed schedules</span></div>
            )}
          </div>

          {data.recent_schedules.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse font-mono text-[11px]">
                <thead>
                  <tr className="text-left text-text-tertiary">
                    {["platform", "status", "scheduled for", "retries", "post url", "updated"].map((h) => (
                      <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.recent_schedules.map((r) => (
                    <tr key={r.id} className="border-b border-line/40">
                      <td className="px-2 py-2"><Chip label={r.platform} tone="gray" /></td>
                      <td className="px-2 py-2"><Chip label={r.status} /></td>
                      <td className="px-2 py-2 text-text-tertiary">{r.scheduled_for?.slice(0, 16) ?? "—"}</td>
                      <td className="px-2 py-2 text-text-secondary">{r.retry_count}</td>
                      <td className="px-2 py-2 text-text-secondary">{r.post_url ? <a href={r.post_url} target="_blank" rel="noreferrer" className="text-fuchsia underline">link</a> : "—"}</td>
                      <td className="px-2 py-2 text-text-tertiary">{r.updated_at?.slice(0, 16) ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 font-mono text-[11px] text-text-tertiary">{data.note}</p>
        </>
      )}
    </Panel>
  );
}

// =====================================================================
// Bugs (desktop error telemetry — read-only)
// =====================================================================
type BugRow = {
  event: string;
  app_version: string | null;
  os: string | null;
  arch: string | null;
  route: string | null;
  http_status: number | null;
  error_code: string | null;
  message: string | null;
  user_ref: string | null;
  created_at: string | null;
};

type BugsData = {
  rows: BugRow[];
  by_app_version?: Record<string, number>;
  by_error_code?: Record<string, number>;
  affected_users?: number;
  needs_action?: Record<string, boolean | string | number>;
};

function bugChipTone(event: string, http_status: number | null, error_code: string | null): ChipTone {
  const ev = (event ?? "").toLowerCase();
  const code = (error_code ?? "").toLowerCase();
  if (["error", "crash", "failed", "fail", "exception"].some((k) => ev.includes(k) || code.includes(k))) return "fail";
  if (http_status !== null && http_status >= 500) return "fail";
  if (http_status !== null && http_status >= 400) return "pending";
  if (["warn", "warning", "timeout", "retry"].some((k) => ev.includes(k) || code.includes(k))) return "pending";
  return "gray";
}

function BugsTab() {
  const fetchAdmin = useAdminFetch();
  const [data, setData] = useState<BugsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [filterEvent, setFilterEvent] = useState("");
  const [filterVersion, setFilterVersion] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (filterEvent) qs.set("event", filterEvent);
      if (filterVersion) qs.set("app_version", filterVersion);
      const path = qs.toString() ? `bugs?${qs.toString()}` : "bugs";
      setData((await fetchAdmin(path)) as unknown as BugsData);
      setLoaded(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [fetchAdmin, filterEvent, filterVersion]);

  const rows = data?.rows ?? [];

  // Derive unique event + version options for filter selects (from loaded data).
  const eventOptions = ["", ...Array.from(new Set(rows.map((r) => r.event).filter(Boolean)))];
  const versionOptions = ["", ...Array.from(new Set(rows.map((r) => r.app_version ?? "").filter(Boolean)))];

  // Needs-action flags from the response.
  const needsAction = data?.needs_action ? Object.entries(data.needs_action).filter(([, v]) => v === true || (typeof v === "number" && v > 0)) : [];

  return (
    <Panel
      title="bugs · desktop error telemetry"
      sub="Recent desktop error events forwarded by the app. Read-only — no payloads, tokens, or PII from the payload."
      right={<LoadButton onClick={load} />}
    >
      {/* Needs-action summary */}
      {needsAction.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">needs action</span>
          {needsAction.map(([k, v]) => (
            <Chip key={k} label={`${k.replace(/_/g, " ")}${typeof v === "number" ? `: ${v}` : ""}`} tone="fail" />
          ))}
        </div>
      )}

      {/* Aggregation cards */}
      {data && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {/* Affected users */}
          <div className="rounded-2xl border border-line bg-paper p-4">
            <div className="font-display text-[28px] font-bold tracking-[-0.02em] text-ink">
              {data.affected_users !== undefined ? data.affected_users : <span className="text-[14px] text-text-tertiary">—</span>}
            </div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">affected users</div>
          </div>
          {/* Total rows */}
          <div className="rounded-2xl border border-line bg-paper p-4">
            <div className="font-display text-[28px] font-bold tracking-[-0.02em] text-ink">{rows.length}</div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">events shown</div>
          </div>
          {/* By version */}
          <div className="col-span-2 rounded-2xl border border-line bg-paper p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">by app version</div>
            {data.by_app_version && Object.keys(data.by_app_version).length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {Object.entries(data.by_app_version).map(([ver, cnt]) => (
                  <span key={ver} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper-warm/60 px-2.5 py-1">
                    <span className="font-mono text-[11px] text-ink">{ver || "unknown"}</span>
                    <span className="font-display text-[13px] font-bold text-ink">{cnt}</span>
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-2"><NA /></div>
            )}
          </div>
          {/* By error code / event */}
          <div className="col-span-2 rounded-2xl border border-line bg-paper p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">by error code / event</div>
            {data.by_error_code && Object.keys(data.by_error_code).length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {Object.entries(data.by_error_code).map(([code, cnt]) => (
                  <span key={code} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper-warm/60 px-2.5 py-1">
                    <Chip label={code || "unknown"} tone="fail" />
                    <span className="font-display text-[13px] font-bold text-ink">{cnt}</span>
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-2"><NA /></div>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {loaded && eventOptions.length > 1 && (
          <FilterSelect label="event" value={filterEvent} onChange={setFilterEvent} options={eventOptions} />
        )}
        {loaded && versionOptions.length > 1 && (
          <FilterSelect label="version" value={filterVersion} onChange={setFilterVersion} options={versionOptions} />
        )}
        {loaded && (eventOptions.length > 1 || versionOptions.length > 1) && (
          <span className="font-mono text-[10px] text-text-tertiary">pick filters, then Load</span>
        )}
      </div>

      <Loader on={loading} />
      <ErrorNote error={error} />

      {loaded && rows.length === 0 && !loading && (
        <p className="font-mono text-[11px] text-text-tertiary">No bug rows for this filter yet.</p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr className="text-left text-text-tertiary">
                {["event", "version", "os / arch", "route", "status", "error code", "message", "user", "time"].map((h) => (
                  <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const tone = bugChipTone(r.event, r.http_status, r.error_code);
                const osArch = [r.os, r.arch].filter(Boolean).join(" / ") || null;
                const msgShort = r.message ? (r.message.length > 60 ? r.message.slice(0, 60) + "…" : r.message) : null;
                const userShort = r.user_ref ? (r.user_ref.length > 12 ? r.user_ref.slice(0, 12) + "…" : r.user_ref) : null;
                return (
                  <tr key={i} className="border-b border-line/40 align-top hover:bg-paper-warm/60">
                    <td className="px-2 py-2">
                      <Chip label={r.event || "unknown"} tone={tone} />
                    </td>
                    <td className="px-2 py-2 text-text-secondary">{r.app_version ?? <NA />}</td>
                    <td className="px-2 py-2 text-text-tertiary">{osArch ?? <NA />}</td>
                    <td className="px-2 py-2 text-text-secondary">{r.route ?? <NA />}</td>
                    <td className="px-2 py-2">
                      {r.http_status !== null ? (
                        <Chip
                          label={String(r.http_status)}
                          tone={r.http_status >= 500 ? "fail" : r.http_status >= 400 ? "pending" : "gray"}
                        />
                      ) : (
                        <span className="text-text-tertiary">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {r.error_code ? <Chip label={r.error_code} tone={tone} /> : <span className="text-text-tertiary">—</span>}
                    </td>
                    <td className="max-w-[240px] px-2 py-2 text-ink" title={r.message ?? undefined}>
                      {msgShort ?? <NA />}
                    </td>
                    <td className="px-2 py-2 text-text-tertiary" title={r.user_ref ?? undefined}>
                      {userShort ?? <span className="text-text-tertiary">—</span>}
                    </td>
                    <td className="px-2 py-2 text-text-tertiary">{r.created_at?.slice(0, 16) ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
