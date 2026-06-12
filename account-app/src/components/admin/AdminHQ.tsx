"use client";

import { useCallback, useEffect, useState } from "react";

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

type HealthGate = {
  key: string;
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  value?: unknown;
  action?: string | null;
};

type LaunchHealth = {
  overall: "ok" | "warn" | "fail";
  score: number;
  generated_at: string;
  gates: HealthGate[];
  public_urls: Record<string, string>;
  note: string;
};

type FunctionHeatmapGate = HealthGate & {
  owner: string;
};

type FunctionHeatmap = {
  overall: "ok" | "warn" | "fail";
  score: number;
  generated_at: string;
  source: string;
  failures: number;
  warnings: number;
  gates: FunctionHeatmapGate[];
};

type AdminAlert = {
  id: string;
  category: string;
  title: string;
  body: string;
  priority: "low" | "medium" | "high";
  action_kind: string | null;
  action_data: Record<string, unknown>;
  read_at: string | null;
  created_at: string | null;
};

type AdminAlertsResponse = {
  unread: number;
  alerts: AdminAlert[];
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
  "Launch Health",
  "Function Heat Map",
  "Alerts",
  "Users",
  "Pending Whop",
  "Claims",
  "Webhooks",
  "Usage",
  "Billing",
  "Postiz",
  "Bugs",
  "Bonus Ledger",
  "Community Channels",
  "Missions",
  "Banners",
  "Announcements",
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

function AdminStatusPill({ onOpen }: { onOpen: () => void }) {
  const [data, setData] = useState<FunctionHeatmap | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch("/api/admin/function-heatmap", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as FunctionHeatmap;
        if (active) {
          setData(json);
          setError(false);
        }
      } catch {
        if (active) setError(true);
      }
    };
    void load();
    const id = window.setInterval(load, 60_000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  const status = error ? "fail" : data?.overall ?? "warn";
  const label = error ? "red" : status === "ok" ? "ok" : status === "warn" ? "warn" : "red";
  const score = error ? "—" : data?.score ?? "—";
  const tone =
    status === "ok"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
      : status === "warn"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700"
        : "border-fuchsia-deep/40 bg-fuchsia-soft/40 text-fuchsia-deep";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`mb-2 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] transition hover:border-fuchsia ${tone}`}
      title="Open Function Heat Map"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label} · {score}/100
    </button>
  );
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
            Liquid Clips control surface.
          </h1>
        </div>
        <div className="text-right font-mono text-[11px] text-text-tertiary">
          <AdminStatusPill onOpen={() => setTab("Function Heat Map")} />
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
        {tab === "Launch Health" && <LaunchHealthTab />}
        {tab === "Function Heat Map" && <FunctionHeatmapTab />}
        {tab === "Alerts" && <AlertsTab />}
        {tab === "Users" && <UsersTab />}
        {tab === "Pending Whop" && <PendingWhopTab />}
        {tab === "Claims" && <ClaimsTab />}
        {tab === "Webhooks" && <WebhooksTab />}
        {tab === "Usage" && <UsageTab />}
        {tab === "Billing" && <BillingTab />}
        {tab === "Postiz" && <PostizTab />}
        {tab === "Bugs" && <BugsTab />}
        {tab === "Bonus Ledger" && <BonusLedgerTab />}
        {tab === "Community Channels" && <CommunityChannelsTab />}
        {tab === "Missions" && <MissionsTab />}
        {tab === "Banners" && <BannersTab />}
        {tab === "Announcements" && <AnnouncementsTab />}
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
// Launch Health — one-click green gates
// =====================================================================
function gateTone(status: HealthGate["status"]): ChipTone {
  if (status === "ok") return "ok";
  if (status === "warn") return "pending";
  return "fail";
}

function prettyJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function LaunchHealthTab() {
  const fetchAdmin = useAdminFetch();
  const [data, setData] = useState<LaunchHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData((await fetchAdmin("health")) as unknown as LaunchHealth);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [fetchAdmin]);

  return (
    <Panel
      title="launch health · one-click gates"
      sub="Admin-only aggregate check for release readiness. Read-only: no posts, charges, payouts, or account mutations."
      right={
        <button onClick={refresh} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink hover:border-fuchsia">
          run health check
        </button>
      }
    >
      <Loader on={loading} />
      <ErrorNote error={error} />
      {!data && !loading && (
        <div className="rounded-2xl border border-line bg-paper p-5 font-sans text-[13px] text-text-secondary">
          Run the health check to verify the launch gates in one place.
        </div>
      )}
      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div className="font-display text-[34px] font-bold tracking-[-0.03em] text-ink">{data.score}/100</div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">automated gate score</div>
            </div>
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div><Chip label={data.overall} tone={gateTone(data.overall)} /></div>
              <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">overall status</div>
            </div>
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div className="font-mono text-[12px] text-ink">{data.generated_at}</div>
              <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">last run</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {data.gates.map((g) => {
              const value = prettyJson(g.value);
              return (
                <div key={g.key} className="rounded-2xl border border-line bg-paper p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">{g.key}</div>
                      <h3 className="mt-1 font-display text-[18px] font-semibold leading-tight tracking-[-0.02em] text-ink">{g.label}</h3>
                    </div>
                    <Chip label={g.status} tone={gateTone(g.status)} />
                  </div>
                  <p className="mt-3 font-sans text-[13px] leading-relaxed text-text-secondary">{g.detail}</p>
                  {value && (
                    <code className="mt-3 block overflow-x-auto rounded-xl bg-paper-warm/60 px-3 py-2 font-mono text-[11px] text-text-tertiary">
                      {value}
                    </code>
                  )}
                  {g.action && (
                    <p className="mt-3 font-mono text-[11px] text-fuchsia-deep">
                      action · {g.action}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-4 rounded-2xl border border-line bg-paper p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">public urls</div>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {Object.entries(data.public_urls).map(([k, v]) => (
                <a key={k} href={v} target="_blank" rel="noreferrer" className="truncate rounded-xl border border-line bg-paper-warm/40 px-3 py-2 font-mono text-[11px] text-ink hover:border-fuchsia">
                  {k} · {v}
                </a>
              ))}
            </div>
            <p className="mt-3 font-mono text-[11px] text-text-tertiary">{data.note}</p>
          </div>
        </>
      )}
    </Panel>
  );
}

// =====================================================================
// Function Heat Map — Railway cron every 5h + manual read-only run
// =====================================================================
function FunctionHeatmapTab() {
  const fetchAdmin = useAdminFetch();
  const [data, setData] = useState<FunctionHeatmap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData((await fetchAdmin("function-heatmap")) as unknown as FunctionHeatmap);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [fetchAdmin]);

  const runNow = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData((await fetchAdmin("function-heatmap/run", { method: "POST" })) as unknown as FunctionHeatmap);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [fetchAdmin]);

  return (
    <Panel
      title="function heat map · automated rail checks"
      sub="Railway runs this every 5 hours. Red gates email admins through Resend; every run emits PostHog telemetry. Read-only: no posts, charges, OAuth mutations, or payouts."
      right={
        <div className="flex flex-wrap gap-2">
          <button onClick={load} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink hover:border-fuchsia">
            load latest
          </button>
          <button onClick={runNow} className="rounded-full bg-fuchsia px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-paper hover:bg-fuchsia-bright">
            run now
          </button>
        </div>
      }
    >
      <Loader on={loading} />
      <ErrorNote error={error} />
      {!data && !loading && (
        <div className="rounded-2xl border border-line bg-paper p-5 font-sans text-[13px] text-text-secondary">
          Load the latest Railway heat-map or run one now. Failed gates trigger admin email on the scheduled cron.
        </div>
      )}
      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div className="font-display text-[34px] font-bold tracking-[-0.03em] text-ink">{data.score}/100</div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">function score</div>
            </div>
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div><Chip label={data.overall} tone={gateTone(data.overall)} /></div>
              <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">overall</div>
            </div>
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div className="font-display text-[28px] font-bold text-ink">{data.failures}</div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">red gates</div>
            </div>
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div className="font-mono text-[11px] text-ink">{data.source}</div>
              <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">{data.generated_at}</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {data.gates.map((g) => (
              <div key={g.key} className="rounded-2xl border border-line bg-paper p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">{g.owner} · {g.key}</div>
                    <h3 className="mt-1 font-display text-[18px] font-semibold leading-tight tracking-[-0.02em] text-ink">{g.label}</h3>
                  </div>
                  <Chip label={g.status} tone={gateTone(g.status)} />
                </div>
                <p className="mt-3 font-sans text-[13px] leading-relaxed text-text-secondary">{g.detail}</p>
                {g.action && (
                  <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.08em] text-fuchsia-deep">{g.action}</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

// =====================================================================
// Alerts — admin inbox view for Railway/operator notifications
// =====================================================================
function AlertsTab() {
  const fetchAdmin = useAdminFetch();
  const [data, setData] = useState<AdminAlertsResponse | null>(null);
  const [filter, setFilter] = useState<"all" | "unread" | "high">("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filter === "unread") params.set("unread_only", "true");
      if (filter === "high") params.set("priority", "high");
      const suffix = params.toString() ? `?${params.toString()}` : "";
      setData((await fetchAdmin(`alerts${suffix}`)) as unknown as AdminAlertsResponse);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [fetchAdmin, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const markRead = useCallback(async (id: string) => {
    setError(null);
    try {
      await fetchAdmin(`alerts/${id}/read`, { method: "POST" });
      await load();
    } catch (e) {
      setError(String(e));
    }
  }, [fetchAdmin, load]);

  return (
    <Panel
      title="alerts · admin inbox"
      sub="High-signal operator alerts from Railway heat-map, webhooks, billing, and system notifications for the signed-in admin."
      right={
        <div className="flex flex-wrap gap-2">
          {(["all", "unread", "high"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] transition ${
                filter === f ? "bg-ink text-paper" : "border border-line bg-paper text-ink hover:border-fuchsia"
              }`}
            >
              {f}
            </button>
          ))}
          <button onClick={load} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink hover:border-fuchsia">
            refresh
          </button>
        </div>
      }
    >
      <Loader on={loading} />
      <ErrorNote error={error} />
      {data && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Chip label={`${data.unread} unread`} tone={data.unread ? "pending" : "ok"} />
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">{data.alerts.length} shown</span>
        </div>
      )}
      {data && data.alerts.length === 0 && (
        <div className="rounded-2xl border border-line bg-paper p-5 font-sans text-[13px] text-text-secondary">
          No alerts in this view.
        </div>
      )}
      <div className="space-y-3">
        {data?.alerts.map((alert) => (
          <div key={alert.id} className={`rounded-2xl border p-4 ${alert.read_at ? "border-line bg-paper" : "border-fuchsia/35 bg-fuchsia-soft/20"}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                  {alert.category} · {alert.created_at ?? "unknown"}
                </div>
                <h3 className="mt-1 font-display text-[18px] font-semibold leading-tight tracking-[-0.02em] text-ink">{alert.title}</h3>
              </div>
              <div className="flex items-center gap-2">
                <Chip label={alert.priority} tone={alert.priority === "high" ? "fail" : alert.priority === "medium" ? "pending" : "gray"} />
                {!alert.read_at && (
                  <button onClick={() => markRead(alert.id)} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink hover:border-fuchsia">
                    mark read
                  </button>
                )}
              </div>
            </div>
            <p className="mt-3 font-sans text-[13px] leading-relaxed text-text-secondary">{alert.body}</p>
          </div>
        ))}
      </div>
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

/* ── Bonus ledger tab (v0.7.55 Uncle Daniel funnel — Phase 1) ────── */
// Whop owns submission flow + base $1 RPM. This tab tracks the +$4 RPM
// premium bonus due to paid users with no-watermark exports. Rows are
// mirrored from approved Whop submissions via the Import button.

type AdminBonusLedgerRow = {
  id: string;
  whop_submission_id: string;
  whop_bounty_id: string | null;
  whop_user_id: string | null;
  liquid_clips_user_id: string | null;
  email: string;
  campaign_id: string | null;
  campaign_name: string | null;
  mission_lane: string | null;
  submitted_post_url: string;
  whop_status: string;
  approved_views: number;
  membership_status_at_export: string;
  export_watermark_status: string;
  base_rpm_cents: number;
  premium_bonus_rpm_cents: number;
  base_payout_cents: number;
  premium_bonus_due_cents: number;
  total_effective_payout_cents: number;
  bonus_payout_status: string;
  bonus_payout_notes: string | null;
  affiliate_referrals: number;
  bonus_marked_paid_at: string | null;
  ledger_created_at: string;
};

function BonusLedgerTab() {
  const adminFetch = useAdminFetch();
  const [rows, setRows] = useState<AdminBonusLedgerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [missionFilter, setMissionFilter] = useState<string>("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set("status", statusFilter);
      if (missionFilter) qs.set("mission_lane", missionFilter);
      const r = (await adminFetch(
        `bonus-ledger${qs.toString() ? `?${qs.toString()}` : ""}`,
      )) as { rows: AdminBonusLedgerRow[] };
      setRows(r.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); // allow-raw-error — admin-internal debug surface
    }
  }, [adminFetch, statusFilter, missionFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markPaid(row: AdminBonusLedgerRow) {
    const viewsStr = window.prompt(
      `Final approved view count for ${row.email || row.whop_user_id || row.whop_submission_id}?\n\nPost: ${row.submitted_post_url}`,
      String(row.approved_views || 0),
    );
    if (viewsStr === null) return;
    const approved_views = parseInt(viewsStr.trim(), 10);
    if (!Number.isFinite(approved_views) || approved_views < 0) {
      window.alert("Approved views must be a non-negative integer.");
      return;
    }
    setBusyId(row.id);
    try {
      await adminFetch(`bonus-ledger/${row.id}/mark-paid`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved_views }),
      });
      await load();
    } catch (e) {
      window.alert(`Mark-paid failed: ${e instanceof Error ? e.message : String(e)}`); // allow-raw-error — admin-internal alert
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Panel
      title="Reward bonus ledger"
      sub="Phase 1. Whop owns submission + base $1 RPM. This ledger tracks the +$4 premium bonus due to paid users with no-watermark exports. Click Import to mirror an approved Whop submission; Mark paid to record the bonus has been sent."
      right={
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-md border border-line bg-paper px-2 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-ink"
          >
            <option value="">all statuses</option>
            <option value="pending">pending</option>
            <option value="paid">paid</option>
            <option value="waived">waived</option>
          </select>
          <select
            value={missionFilter}
            onChange={(e) => setMissionFilter(e.target.value)}
            className="rounded-md border border-line bg-paper px-2 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-ink"
          >
            <option value="">all missions</option>
            <option value="training">uncle daniel · training</option>
            <option value="main">viral reaction · main</option>
            <option value="proof">software proof</option>
          </select>
          <button
            onClick={() => setShowImport((v) => !v)}
            className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia hover:text-fuchsia"
          >
            {showImport ? "Close import" : "Import Whop row"}
          </button>
        </div>
      }
    >
      {showImport && (
        <BonusLedgerImport
          onSaved={async () => {
            setShowImport(false);
            await load();
          }}
          adminFetch={adminFetch}
        />
      )}
      {error && (
        <p className="rounded-md border border-[#DC2626]/40 bg-[#DC2626]/5 px-3 py-2 font-mono text-[11px] text-[#F87171]">
          {error}
        </p>
      )}
      {!rows ? (
        <p className="font-mono text-[11px] text-text-tertiary">loading…</p>
      ) : rows.length === 0 ? (
        <p className="font-mono text-[11px] text-text-tertiary">no rows yet — import an approved Whop submission to populate</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full font-mono text-[11px]">
            <thead className="border-b border-line text-text-tertiary">
              <tr className="text-left">
                <th className="px-2 py-2">whop_submission</th>
                <th className="px-2 py-2">email</th>
                <th className="px-2 py-2">membership</th>
                <th className="px-2 py-2">watermark</th>
                <th className="px-2 py-2">campaign</th>
                <th className="px-2 py-2">lane</th>
                <th className="px-2 py-2">post</th>
                <th className="px-2 py-2 text-right">views</th>
                <th className="px-2 py-2 text-right">base</th>
                <th className="px-2 py-2 text-right">bonus due</th>
                <th className="px-2 py-2 text-right">total eff.</th>
                <th className="px-2 py-2 text-right">refs</th>
                <th className="px-2 py-2">status</th>
                <th className="px-2 py-2"> </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line/40">
                  <td className="px-2 py-2 text-text-tertiary">{r.whop_submission_id.slice(0, 10)}…</td>
                  <td className="px-2 py-2 text-ink">{r.email || "—"}</td>
                  <td className="px-2 py-2 text-text-tertiary">{r.membership_status_at_export}</td>
                  <td className="px-2 py-2 text-text-tertiary">{r.export_watermark_status}</td>
                  <td className="px-2 py-2 text-ink">{r.campaign_name ?? r.campaign_id ?? "—"}</td>
                  <td className="px-2 py-2 text-text-tertiary">{r.mission_lane ?? "—"}</td>
                  <td className="px-2 py-2">
                    <a
                      href={r.submitted_post_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-fuchsia underline-offset-2 hover:underline"
                    >
                      open ↗
                    </a>
                  </td>
                  <td className="px-2 py-2 text-right text-ink tabular-nums">{r.approved_views.toLocaleString()}</td>
                  <td className="px-2 py-2 text-right text-ink tabular-nums">${(r.base_payout_cents / 100).toFixed(2)}</td>
                  <td className="px-2 py-2 text-right text-ink tabular-nums">${(r.premium_bonus_due_cents / 100).toFixed(2)}</td>
                  <td className="px-2 py-2 text-right text-ink tabular-nums">${(r.total_effective_payout_cents / 100).toFixed(2)}</td>
                  <td className="px-2 py-2 text-right text-text-tertiary tabular-nums">{r.affiliate_referrals}</td>
                  <td className="px-2 py-2"><Chip label={r.bonus_payout_status} /></td>
                  <td className="px-2 py-2 text-right">
                    {r.bonus_payout_status === "paid" ? (
                      <span className="text-text-tertiary">{r.bonus_marked_paid_at?.slice(0, 10) ?? "paid"}</span>
                    ) : (
                      <button
                        onClick={() => void markPaid(r)}
                        disabled={busyId === r.id}
                        className="rounded-full bg-fuchsia px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-white hover:bg-fuchsia-bright disabled:opacity-60"
                      >
                        {busyId === r.id ? "Saving…" : "Mark bonus paid"}
                      </button>
                    )}
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

function BonusLedgerImport({
  onSaved,
  adminFetch,
}: {
  onSaved: () => Promise<void> | void;
  adminFetch: (path: string, init?: RequestInit) => Promise<Json>;
}) {
  const [form, setForm] = useState({
    whop_submission_id: "",
    whop_bounty_id: "",
    whop_user_id: "",
    email: "",
    campaign_id: "",
    mission_lane: "",
    submitted_post_url: "",
    approved_views: "0",
    membership_status_at_export: "free",
    export_watermark_status: "unknown",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!form.whop_submission_id.trim() || !form.submitted_post_url.trim()) {
      setError("whop_submission_id and submitted_post_url are required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminFetch("bonus-ledger/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          approved_views: parseInt(form.approved_views || "0", 10),
        }),
      });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); // allow-raw-error — admin-internal debug surface
    } finally {
      setBusy(false);
    }
  }

  function field(name: keyof typeof form, label: string, opts?: { placeholder?: string; type?: string }) {
    return (
      <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
        {label}
        <input
          type={opts?.type ?? "text"}
          value={form[name]}
          placeholder={opts?.placeholder}
          onChange={(e) => setForm((f) => ({ ...f, [name]: e.target.value }))}
          className="rounded-md border border-line bg-paper px-2 py-1 font-sans text-[12px] normal-case tracking-normal text-ink"
        />
      </label>
    );
  }

  return (
    <div className="mb-4 rounded-2xl border border-line bg-paper p-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {field("whop_submission_id", "whop_submission_id *", { placeholder: "wsub_…" })}
        {field("whop_bounty_id", "whop_bounty_id", { placeholder: "wbnt_…" })}
        {field("whop_user_id", "whop_user_id", { placeholder: "wuser_…" })}
        {field("email", "email", { placeholder: "clipper@example.com" })}
        {field("campaign_id", "campaign_id or slug", { placeholder: "clip-uncle-daniel-content" })}
        {field("mission_lane", "mission_lane", { placeholder: "training | main | proof" })}
        {field("submitted_post_url", "submitted_post_url *", { placeholder: "https://…" })}
        {field("approved_views", "approved_views", { type: "number" })}
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          membership_status_at_export
          <select
            value={form.membership_status_at_export}
            onChange={(e) => setForm((f) => ({ ...f, membership_status_at_export: e.target.value }))}
            className="rounded-md border border-line bg-paper px-2 py-1 font-sans text-[12px] normal-case tracking-normal text-ink"
          >
            <option value="free">free</option>
            <option value="solo">solo</option>
            <option value="pro">pro</option>
            <option value="agency">agency</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          export_watermark_status
          <select
            value={form.export_watermark_status}
            onChange={(e) => setForm((f) => ({ ...f, export_watermark_status: e.target.value }))}
            className="rounded-md border border-line bg-paper px-2 py-1 font-sans text-[12px] normal-case tracking-normal text-ink"
          >
            <option value="false">false (no watermark — bonus eligible)</option>
            <option value="true">true (watermark present — bonus $0)</option>
            <option value="unknown">unknown</option>
          </select>
        </label>
      </div>
      {error && (
        <p className="mt-3 rounded-md border border-[#DC2626]/40 bg-[#DC2626]/5 px-3 py-2 font-mono text-[11px] text-[#F87171]">{error}</p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="rounded-full bg-fuchsia px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-white hover:bg-fuchsia-bright disabled:opacity-60"
        >
          {busy ? "Saving…" : "Import row"}
        </button>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          base + bonus computed server-side at import
        </span>
      </div>
    </div>
  );
}

/* ── Community Channels tab (v0.7.55) ────────────────────────────── */

type AdminChannel = {
  id: string;
  slug: string;
  name: string;
  purpose: string | null;
  whop_channel_id: string | null;
  required_tier: string;
  business_unit: string | null;
  mission_lane: string | null;
  is_admin_only: boolean;
  is_locked_preview_enabled: boolean;
  section: string;
  sort_order: number;
  created_at: string | null;
  updated_at: string | null;
};

type ChannelDraft = {
  slug: string;
  name: string;
  purpose: string;
  whop_channel_id: string;
  required_tier: string;
  business_unit: string;
  mission_lane: string;
  is_admin_only: boolean;
  is_locked_preview_enabled: boolean;
  section: string;
  sort_order: string;
};

const EMPTY_DRAFT: ChannelDraft = {
  slug: "",
  name: "",
  purpose: "",
  whop_channel_id: "",
  required_tier: "paid",
  business_unit: "",
  mission_lane: "",
  is_admin_only: false,
  is_locked_preview_enabled: true,
  section: "mission",
  sort_order: "100",
};

function CommunityChannelsTab() {
  const adminFetch = useAdminFetch();
  const [rows, setRows] = useState<AdminChannel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ChannelDraft>(EMPTY_DRAFT);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const j = (await adminFetch("community/channels")) as { channels: AdminChannel[] };
      setRows(j.channels);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); // allow-raw-error — admin-internal debug surface
    }
  }, [adminFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  function reset() {
    setDraft(EMPTY_DRAFT);
    setEditingSlug(null);
  }

  function edit(c: AdminChannel) {
    setEditingSlug(c.slug);
    setDraft({
      slug: c.slug,
      name: c.name,
      purpose: c.purpose ?? "",
      whop_channel_id: c.whop_channel_id ?? "",
      required_tier: c.required_tier,
      business_unit: c.business_unit ?? "",
      mission_lane: c.mission_lane ?? "",
      is_admin_only: !!c.is_admin_only,
      is_locked_preview_enabled: !!c.is_locked_preview_enabled,
      section: c.section,
      sort_order: String(c.sort_order),
    });
  }

  async function save() {
    if (!draft.slug.trim() || !draft.name.trim()) {
      setError("slug and name are required");
      return;
    }
    setBusy(true);
    setError(null);
    const sortOrder = parseInt(draft.sort_order.trim() || "0", 10);
    const body = {
      slug: draft.slug.trim(),
      name: draft.name.trim(),
      purpose: draft.purpose.trim() || null,
      whop_channel_id: draft.whop_channel_id.trim() || null,
      required_tier: draft.required_tier,
      business_unit: draft.business_unit.trim() || null,
      mission_lane: draft.mission_lane.trim() || null,
      is_admin_only: draft.is_admin_only,
      is_locked_preview_enabled: draft.is_locked_preview_enabled,
      section: draft.section,
      sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
    };
    try {
      if (editingSlug) {
        const patch = { ...body } as Record<string, unknown>;
        // Slug is immutable on PATCH per the backend contract.
        delete patch.slug;
        await adminFetch(`community/channels/${editingSlug}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
      } else {
        await adminFetch("community/channels", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      reset();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); // allow-raw-error — admin-internal debug surface
    } finally {
      setBusy(false);
    }
  }

  async function remove(slug: string) {
    if (!window.confirm(`Delete channel "${slug}"? This cannot be undone.`)) return;
    try {
      await adminFetch(`community/channels/${slug}`, { method: "DELETE" });
      if (editingSlug === slug) reset();
      await load();
    } catch (e) {
      window.alert(`Delete failed: ${e instanceof Error ? e.message : String(e)}`); // allow-raw-error — admin-internal alert
    }
  }

  return (
    <Panel
      title="Community channels"
      sub="Tier-gated rooms backed by Whop chat feeds. Sections: announcements · free_lobby · paid_core · mission. Paste chat_feed_XXX from Whop into a row's whop_channel_id to route that room directly to chat — rooms without an id route paid users to the community landing instead."
      right={
        <button
          type="button"
          onClick={reset}
          className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia hover:text-fuchsia"
        >
          {editingSlug ? "Cancel edit" : "New channel"}
        </button>
      }
    >
      <ChannelDraftForm
        draft={draft}
        setDraft={setDraft}
        save={save}
        busy={busy}
        editingSlug={editingSlug}
      />
      {error && (
        <p className="mt-3 rounded-md border border-[#DC2626]/40 bg-[#DC2626]/5 px-3 py-2 font-mono text-[11px] text-[#F87171]">
          {error}
        </p>
      )}
      {!rows ? (
        <p className="mt-4 font-mono text-[11px] text-text-tertiary">loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 font-mono text-[11px] text-text-tertiary">no channels yet</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full font-mono text-[11px]">
            <thead className="border-b border-line text-text-tertiary">
              <tr className="text-left">
                <th className="px-2 py-2">section</th>
                <th className="px-2 py-2">slug · name</th>
                <th className="px-2 py-2">tier</th>
                <th className="px-2 py-2">whop_channel_id</th>
                <th className="px-2 py-2">business · lane</th>
                <th className="px-2 py-2 text-right">sort</th>
                <th className="px-2 py-2"> </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-line/40">
                  <td className="px-2 py-2 text-text-tertiary">{c.section}</td>
                  <td className="px-2 py-2 text-ink">
                    <div className="flex flex-col">
                      <span className="font-display text-[13px] font-semibold text-ink">{c.name}</span>
                      <span className="text-text-tertiary">{c.slug}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2"><Chip label={c.required_tier} /></td>
                  <td className="px-2 py-2 text-text-tertiary">{c.whop_channel_id ?? "—"}</td>
                  <td className="px-2 py-2 text-text-tertiary">
                    {(c.business_unit ?? "—") + " · " + (c.mission_lane ?? "—")}
                  </td>
                  <td className="px-2 py-2 text-right text-text-tertiary tabular-nums">{c.sort_order}</td>
                  <td className="px-2 py-2 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => edit(c)}
                        className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia hover:text-fuchsia"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(c.slug)}
                        className="rounded-full border border-[#DC2626]/40 bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#F87171] hover:bg-[#DC2626]/10"
                      >
                        Delete
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

function ChannelDraftForm({
  draft,
  setDraft,
  save,
  busy,
  editingSlug,
}: {
  draft: ChannelDraft;
  setDraft: (fn: (d: ChannelDraft) => ChannelDraft) => void;
  save: () => Promise<void> | void;
  busy: boolean;
  editingSlug: string | null;
}) {
  function text(name: keyof ChannelDraft, label: string, opts?: { placeholder?: string }) {
    return (
      <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
        {label}
        <input
          type="text"
          value={draft[name] as string}
          placeholder={opts?.placeholder}
          disabled={name === "slug" && !!editingSlug}
          onChange={(e) =>
            setDraft((d) => ({ ...d, [name]: e.target.value }))
          }
          className="rounded-md border border-line bg-paper px-2 py-1 font-sans text-[12px] normal-case tracking-normal text-ink disabled:opacity-60"
        />
      </label>
    );
  }

  function bool(name: keyof ChannelDraft, label: string) {
    return (
      <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
        <input
          type="checkbox"
          checked={!!draft[name]}
          onChange={(e) => setDraft((d) => ({ ...d, [name]: e.target.checked }))}
        />
        {label}
      </label>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-paper p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia">
        {editingSlug ? `editing ${editingSlug}` : "new channel"}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
        {text("slug", "slug *", { placeholder: "premium-rewards-hq" })}
        {text("name", "name *", { placeholder: "Premium Rewards HQ" })}
        {text("whop_channel_id", "whop_channel_id", { placeholder: "chat_feed_…" })}
        {text("business_unit", "business_unit", { placeholder: "uncle_daniel" })}
        {text("mission_lane", "mission_lane", { placeholder: "training" })}
        {text("sort_order", "sort_order")}
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          required_tier
          <select
            value={draft.required_tier}
            onChange={(e) => setDraft((d) => ({ ...d, required_tier: e.target.value }))}
            className="rounded-md border border-line bg-paper px-2 py-1 font-sans text-[12px] normal-case tracking-normal text-ink"
          >
            <option value="free">free</option>
            <option value="free_paid">free_paid</option>
            <option value="paid">paid</option>
            <option value="paid_admin">paid_admin</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          section
          <select
            value={draft.section}
            onChange={(e) => setDraft((d) => ({ ...d, section: e.target.value }))}
            className="rounded-md border border-line bg-paper px-2 py-1 font-sans text-[12px] normal-case tracking-normal text-ink"
          >
            <option value="announcements">announcements</option>
            <option value="free_lobby">free_lobby</option>
            <option value="paid_core">paid_core</option>
            <option value="mission">mission</option>
          </select>
        </label>
        <label className="col-span-2 flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary md:col-span-3">
          purpose
          <textarea
            value={draft.purpose}
            onChange={(e) => setDraft((d) => ({ ...d, purpose: e.target.value }))}
            rows={2}
            className="rounded-md border border-line bg-paper px-2 py-1 font-sans text-[12px] normal-case tracking-normal text-ink"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {bool("is_admin_only", "admin-only posts")}
        {bool("is_locked_preview_enabled", "show locked preview to free users")}
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="ml-auto rounded-full bg-fuchsia px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-white hover:bg-fuchsia-bright disabled:opacity-60"
        >
          {busy ? "Saving…" : editingSlug ? "Save changes" : "Create channel"}
        </button>
      </div>
    </div>
  );
}

/* ── Missions tab (v0.7.55) ──────────────────────────────────────── */
// Thin CRUD wrapper over /admin/campaigns. The underlying table is
// sponsored_campaigns — missions and campaigns are the same row in
// schema terms. Slug is immutable on edit.

type AdminMission = {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  brand_name: string | null;
  business_unit: string | null;
  mission_type: string | null;
  mission_lane: string | null;
  status: string;
  type: string;
  rpm_cents: number;
  base_rpm_cents: number;
  premium_rpm_cents: number;
  premium_bonus_cents: number;
  budget_cents: number;
  required_tier: string | null;
  is_high_rpm: boolean;
  is_invite_only: boolean;
  affiliate_enabled: boolean;
  community_channel_id: string | null;
  whop_campaign_id: string | null;
  whop_campaign_url: string | null;
  whop_url: string;
  visibility_tiers: string[];
};

const EMPTY_MISSION: Record<string, string | boolean> = {
  slug: "",
  name: "",
  brand: "",
  brand_name: "",
  business_unit: "",
  mission_type: "uncle_daniel",
  mission_lane: "",
  status: "draft",
  type: "public",
  rpm_cents: "0",
  base_rpm_cents: "100",
  premium_rpm_cents: "500",
  premium_bonus_cents: "400",
  budget_cents: "0",
  required_tier: "",
  is_high_rpm: false,
  is_invite_only: false,
  affiliate_enabled: false,
  community_channel_id: "",
  whop_campaign_id: "",
  whop_campaign_url: "",
  whop_url: "https://whop.com/liquidclips/",
  sort_order: "100",
};

function MissionsTab() {
  const adminFetch = useAdminFetch();
  const [rows, setRows] = useState<AdminMission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string | boolean>>(EMPTY_MISSION);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      // Public /campaigns lists every row including draft (status filter
      // on the public read excludes "closed" only).
      const j = (await adminFetch("campaigns")) as { campaigns: AdminMission[] };
      setRows(j.campaigns);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); // allow-raw-error — admin-internal debug surface
    }
  }, [adminFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  function reset() {
    setDraft(EMPTY_MISSION);
    setEditingSlug(null);
  }

  function edit(m: AdminMission) {
    setEditingSlug(m.slug);
    setDraft({
      slug: m.slug,
      name: m.name,
      brand: m.brand ?? "",
      brand_name: m.brand_name ?? "",
      business_unit: m.business_unit ?? "",
      mission_type: m.mission_type ?? "uncle_daniel",
      mission_lane: m.mission_lane ?? "",
      status: m.status,
      type: m.type,
      rpm_cents: String(m.rpm_cents),
      base_rpm_cents: String(m.base_rpm_cents),
      premium_rpm_cents: String(m.premium_rpm_cents),
      premium_bonus_cents: String(m.premium_bonus_cents),
      budget_cents: String(m.budget_cents),
      required_tier: m.required_tier ?? "",
      is_high_rpm: !!m.is_high_rpm,
      is_invite_only: !!m.is_invite_only,
      affiliate_enabled: !!m.affiliate_enabled,
      community_channel_id: m.community_channel_id ?? "",
      whop_campaign_id: m.whop_campaign_id ?? "",
      whop_campaign_url: m.whop_campaign_url ?? "",
      whop_url: m.whop_url,
      sort_order: "100",
    });
  }

  async function save() {
    if (!draft.slug || !draft.name || !draft.whop_url) {
      setError("slug, name, and whop_url are required");
      return;
    }
    setBusy(true);
    setError(null);
    const numField = (k: string) => parseInt(String(draft[k] ?? "0"), 10) || 0;
    const body: Record<string, unknown> = {
      slug: String(draft.slug).trim(),
      name: String(draft.name).trim(),
      brand: String(draft.brand).trim() || null,
      brand_name: String(draft.brand_name).trim() || null,
      business_unit: String(draft.business_unit).trim() || null,
      mission_type: String(draft.mission_type).trim() || null,
      mission_lane: String(draft.mission_lane).trim() || null,
      status: String(draft.status),
      type: String(draft.type),
      rpm_cents: numField("rpm_cents"),
      base_rpm_cents: numField("base_rpm_cents"),
      premium_rpm_cents: numField("premium_rpm_cents"),
      premium_bonus_cents: numField("premium_bonus_cents"),
      budget_cents: numField("budget_cents"),
      required_tier: String(draft.required_tier).trim() || null,
      is_high_rpm: !!draft.is_high_rpm,
      is_invite_only: !!draft.is_invite_only,
      affiliate_enabled: !!draft.affiliate_enabled,
      community_channel_id: String(draft.community_channel_id).trim() || null,
      whop_campaign_id: String(draft.whop_campaign_id).trim() || null,
      whop_campaign_url: String(draft.whop_campaign_url).trim() || null,
      whop_url: String(draft.whop_url).trim(),
      sort_order: numField("sort_order"),
    };
    try {
      if (editingSlug) {
        const patch = { ...body };
        delete patch.slug;
        await adminFetch(`campaigns/${editingSlug}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
      } else {
        await adminFetch("campaigns", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      reset();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); // allow-raw-error — admin-internal debug surface
    } finally {
      setBusy(false);
    }
  }

  async function remove(slug: string) {
    if (!window.confirm(`Delete mission "${slug}"?`)) return;
    try {
      await adminFetch(`campaigns/${slug}`, { method: "DELETE" });
      if (editingSlug === slug) reset();
      await load();
    } catch (e) {
      window.alert(`Delete failed: ${e instanceof Error ? e.message : String(e)}`); // allow-raw-error — admin-internal alert
    }
  }

  return (
    <Panel
      title="Missions"
      sub="Every clipping mission across Uncle Daniel, viral reactions, DDB, fashion, sponsors, proof. Whop bounty id is the Whop content reward bound to this mission."
      right={
        <button
          type="button"
          onClick={reset}
          className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia hover:text-fuchsia"
        >
          {editingSlug ? "Cancel edit" : "New mission"}
        </button>
      }
    >
      <MissionDraftForm
        draft={draft}
        setDraft={setDraft}
        save={save}
        busy={busy}
        editingSlug={editingSlug}
      />
      {error && (
        <p className="mt-3 rounded-md border border-[#DC2626]/40 bg-[#DC2626]/5 px-3 py-2 font-mono text-[11px] text-[#F87171]">{error}</p>
      )}
      {!rows ? (
        <p className="mt-4 font-mono text-[11px] text-text-tertiary">loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 font-mono text-[11px] text-text-tertiary">no missions yet</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full font-mono text-[11px]">
            <thead className="border-b border-line text-text-tertiary">
              <tr className="text-left">
                <th className="px-2 py-2">status</th>
                <th className="px-2 py-2">slug · name</th>
                <th className="px-2 py-2">lane</th>
                <th className="px-2 py-2 text-right">base $RPM</th>
                <th className="px-2 py-2 text-right">premium $RPM</th>
                <th className="px-2 py-2 text-right">budget</th>
                <th className="px-2 py-2">whop_bounty_id</th>
                <th className="px-2 py-2"> </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-b border-line/40">
                  <td className="px-2 py-2"><Chip label={m.status} /></td>
                  <td className="px-2 py-2 text-ink">
                    <div className="flex flex-col">
                      <span className="font-display text-[13px] font-semibold text-ink">{m.name}</span>
                      <span className="text-text-tertiary">{m.slug}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-text-tertiary">{(m.mission_lane ?? m.mission_type) ?? "—"}</td>
                  <td className="px-2 py-2 text-right text-ink tabular-nums">${(m.base_rpm_cents / 100).toFixed(0)}</td>
                  <td className="px-2 py-2 text-right text-ink tabular-nums">${(m.premium_rpm_cents / 100).toFixed(0)}</td>
                  <td className="px-2 py-2 text-right text-text-tertiary tabular-nums">${(m.budget_cents / 100).toLocaleString()}</td>
                  <td className="px-2 py-2 text-text-tertiary">{m.whop_campaign_id ?? "—"}</td>
                  <td className="px-2 py-2 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => edit(m)} className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia hover:text-fuchsia">Edit</button>
                      <button onClick={() => void remove(m.slug)} className="rounded-full border border-[#DC2626]/40 bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#F87171] hover:bg-[#DC2626]/10">Delete</button>
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

function MissionDraftForm({
  draft,
  setDraft,
  save,
  busy,
  editingSlug,
}: {
  draft: Record<string, string | boolean>;
  setDraft: (fn: (d: Record<string, string | boolean>) => Record<string, string | boolean>) => void;
  save: () => Promise<void> | void;
  busy: boolean;
  editingSlug: string | null;
}) {
  function text(name: string, label: string, opts?: { placeholder?: string }) {
    return (
      <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
        {label}
        <input
          type="text"
          value={String(draft[name] ?? "")}
          placeholder={opts?.placeholder}
          disabled={name === "slug" && !!editingSlug}
          onChange={(e) => setDraft((d) => ({ ...d, [name]: e.target.value }))}
          className="rounded-md border border-line bg-paper px-2 py-1 font-sans text-[12px] normal-case tracking-normal text-ink disabled:opacity-60"
        />
      </label>
    );
  }

  function bool(name: string, label: string) {
    return (
      <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
        <input type="checkbox" checked={!!draft[name]} onChange={(e) => setDraft((d) => ({ ...d, [name]: e.target.checked }))} />
        {label}
      </label>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-paper p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia">
        {editingSlug ? `editing ${editingSlug}` : "new mission"}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {text("slug", "slug *")}
        {text("name", "name *")}
        {text("brand", "brand label")}
        {text("brand_name", "brand_name")}
        {text("business_unit", "business_unit")}
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          mission_type
          <select value={String(draft.mission_type)} onChange={(e) => setDraft((d) => ({ ...d, mission_type: e.target.value }))} className="rounded-md border border-line bg-paper px-2 py-1 font-sans text-[12px] normal-case tracking-normal text-ink">
            <option value="uncle_daniel">uncle_daniel</option>
            <option value="viral_reaction">viral_reaction</option>
            <option value="software_proof">software_proof</option>
          </select>
        </label>
        {text("mission_lane", "mission_lane")}
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          status
          <select value={String(draft.status)} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))} className="rounded-md border border-line bg-paper px-2 py-1 font-sans text-[12px] normal-case tracking-normal text-ink">
            <option value="coming_soon">coming_soon</option>
            <option value="partially_funded">partially_funded</option>
            <option value="funded">funded</option>
            <option value="live">live</option>
            <option value="closed">closed</option>
          </select>
        </label>
        {text("base_rpm_cents", "base_rpm (cents)")}
        {text("premium_rpm_cents", "premium_rpm (cents)")}
        {text("premium_bonus_cents", "bonus_rpm (cents)")}
        {text("budget_cents", "budget (cents)")}
        {text("required_tier", "required_tier")}
        {text("whop_url", "whop_url *")}
        {text("whop_campaign_id", "whop_campaign_id")}
        {text("whop_campaign_url", "whop_campaign_url")}
        {text("community_channel_id", "community_channel_id")}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {bool("is_high_rpm", "high RPM")}
        {bool("is_invite_only", "invite only")}
        {bool("affiliate_enabled", "affiliate enabled")}
        <button onClick={() => void save()} disabled={busy} className="ml-auto rounded-full bg-fuchsia px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-white hover:bg-fuchsia-bright disabled:opacity-60">
          {busy ? "Saving…" : editingSlug ? "Save changes" : "Create mission"}
        </button>
      </div>
    </div>
  );
}

/* ── Banners tab (v0.7.55) ───────────────────────────────────────── */

type AdminBanner = {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  cta_text: string | null;
  cta_url: string | null;
  placement: string;
  target_tier: string | null;
  target_mission_id: string | null;
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
};

function BannersTab() {
  const adminFetch = useAdminFetch();
  const [rows, setRows] = useState<AdminBanner[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const j = (await adminFetch("banners")) as { banners: AdminBanner[] };
      setRows(j.banners);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); // allow-raw-error — admin-internal debug surface
    }
  }, [adminFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive(b: AdminBanner) {
    try {
      await adminFetch(`banners/${b.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_active: !b.is_active }),
      });
      await load();
    } catch (e) {
      window.alert(`Toggle failed: ${e instanceof Error ? e.message : String(e)}`); // allow-raw-error — admin-internal alert
    }
  }

  async function remove(b: AdminBanner) {
    if (!window.confirm(`Delete banner "${b.title}"?`)) return;
    try {
      await adminFetch(`banners/${b.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      window.alert(`Delete failed: ${e instanceof Error ? e.message : String(e)}`); // allow-raw-error — admin-internal alert
    }
  }

  return (
    <Panel
      title="Banners"
      sub="Promotional placements across earn_hero · mission_card · mission_detail · upgrade_modal · community_top · home_hero · checkout_modal."
      right={
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia hover:text-fuchsia"
        >
          {showForm ? "Close form" : "New banner"}
        </button>
      }
    >
      {showForm && (
        <BannerForm
          adminFetch={adminFetch}
          onSaved={async () => {
            setShowForm(false);
            await load();
          }}
        />
      )}
      {error && (
        <p className="mt-3 rounded-md border border-[#DC2626]/40 bg-[#DC2626]/5 px-3 py-2 font-mono text-[11px] text-[#F87171]">{error}</p>
      )}
      {!rows ? (
        <p className="mt-4 font-mono text-[11px] text-text-tertiary">loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 font-mono text-[11px] text-text-tertiary">no banners yet</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full font-mono text-[11px]">
            <thead className="border-b border-line text-text-tertiary">
              <tr className="text-left">
                <th className="px-2 py-2">placement</th>
                <th className="px-2 py-2">title</th>
                <th className="px-2 py-2">target</th>
                <th className="px-2 py-2 text-right">priority</th>
                <th className="px-2 py-2">cta</th>
                <th className="px-2 py-2">active</th>
                <th className="px-2 py-2"> </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="border-b border-line/40">
                  <td className="px-2 py-2 text-text-tertiary">{b.placement}</td>
                  <td className="px-2 py-2 text-ink">{b.title}</td>
                  <td className="px-2 py-2 text-text-tertiary">{[b.target_tier, b.target_mission_id].filter(Boolean).join(" · ") || "everyone"}</td>
                  <td className="px-2 py-2 text-right text-text-tertiary tabular-nums">{b.priority}</td>
                  <td className="px-2 py-2 text-text-tertiary">{b.cta_text ?? "—"}</td>
                  <td className="px-2 py-2"><Chip label={b.is_active ? "live" : "paused"} /></td>
                  <td className="px-2 py-2 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => void toggleActive(b)} className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia hover:text-fuchsia">{b.is_active ? "Pause" : "Resume"}</button>
                      <button onClick={() => void remove(b)} className="rounded-full border border-[#DC2626]/40 bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#F87171] hover:bg-[#DC2626]/10">Delete</button>
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

function BannerForm({
  adminFetch,
  onSaved,
}: {
  adminFetch: (path: string, init?: RequestInit) => Promise<Json>;
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState({
    title: "",
    subtitle: "",
    image_url: "",
    cta_text: "",
    cta_url: "",
    placement: "earn_hero",
    target_tier: "",
    target_mission_id: "",
    priority: "100",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!draft.title) {
      setError("title required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminFetch("banners", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          subtitle: draft.subtitle || null,
          image_url: draft.image_url || null,
          cta_text: draft.cta_text || null,
          cta_url: draft.cta_url || null,
          placement: draft.placement,
          target_tier: draft.target_tier || null,
          target_mission_id: draft.target_mission_id || null,
          priority: parseInt(draft.priority || "0", 10) || 0,
          is_active: true,
        }),
      });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); // allow-raw-error — admin-internal debug surface
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 rounded-2xl border border-line bg-paper p-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Field label="title *" value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} />
        <Field label="subtitle" value={draft.subtitle} onChange={(v) => setDraft({ ...draft, subtitle: v })} />
        <Field label="image_url" value={draft.image_url} onChange={(v) => setDraft({ ...draft, image_url: v })} />
        <Field label="cta_text" value={draft.cta_text} onChange={(v) => setDraft({ ...draft, cta_text: v })} />
        <Field label="cta_url" value={draft.cta_url} onChange={(v) => setDraft({ ...draft, cta_url: v })} />
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          placement
          <select value={draft.placement} onChange={(e) => setDraft({ ...draft, placement: e.target.value })} className="rounded-md border border-line bg-paper px-2 py-1 font-sans text-[12px] normal-case tracking-normal text-ink">
            <option value="earn_hero">earn_hero</option>
            <option value="mission_card">mission_card</option>
            <option value="mission_detail">mission_detail</option>
            <option value="upgrade_modal">upgrade_modal</option>
            <option value="community_top">community_top</option>
            <option value="home_hero">home_hero</option>
            <option value="checkout_modal">checkout_modal</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          target_tier
          <select value={draft.target_tier} onChange={(e) => setDraft({ ...draft, target_tier: e.target.value })} className="rounded-md border border-line bg-paper px-2 py-1 font-sans text-[12px] normal-case tracking-normal text-ink">
            <option value="">everyone</option>
            <option value="free">free</option>
            <option value="paid">paid</option>
          </select>
        </label>
        <Field label="target_mission_id" value={draft.target_mission_id} onChange={(v) => setDraft({ ...draft, target_mission_id: v })} />
        <Field label="priority" value={draft.priority} onChange={(v) => setDraft({ ...draft, priority: v })} />
      </div>
      {error && <p className="mt-3 rounded-md border border-[#DC2626]/40 bg-[#DC2626]/5 px-3 py-2 font-mono text-[11px] text-[#F87171]">{error}</p>}
      <div className="mt-3 flex items-center">
        <button onClick={() => void save()} disabled={busy} className="ml-auto rounded-full bg-fuchsia px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-white hover:bg-fuchsia-bright disabled:opacity-60">{busy ? "Saving…" : "Create banner"}</button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
      {label}
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-line bg-paper px-2 py-1 font-sans text-[12px] normal-case tracking-normal text-ink" />
    </label>
  );
}

/* ── Announcements tab (v0.7.55) ─────────────────────────────────── */

type AdminAnnouncement = {
  id: string;
  title: string;
  body_markdown: string | null;
  kind: string;
  cta_text: string | null;
  cta_url: string | null;
  target_tier: string | null;
  pinned: boolean;
  published_at: string | null;
  is_active: boolean;
};

function AnnouncementsTab() {
  const adminFetch = useAdminFetch();
  const [rows, setRows] = useState<AdminAnnouncement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const j = (await adminFetch("announcements")) as { announcements: AdminAnnouncement[] };
      setRows(j.announcements);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); // allow-raw-error — admin-internal debug surface
    }
  }, [adminFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  async function togglePin(a: AdminAnnouncement) {
    try {
      await adminFetch(`announcements/${a.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pinned: !a.pinned }),
      });
      await load();
    } catch (e) {
      window.alert(`Pin failed: ${e instanceof Error ? e.message : String(e)}`); // allow-raw-error — admin-internal alert
    }
  }

  async function remove(a: AdminAnnouncement) {
    if (!window.confirm(`Delete announcement "${a.title}"?`)) return;
    try {
      await adminFetch(`announcements/${a.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      window.alert(`Delete failed: ${e instanceof Error ? e.message : String(e)}`); // allow-raw-error — admin-internal alert
    }
  }

  return (
    <Panel
      title="Announcements"
      sub="Mission drops, payout updates, rule changes. Pinned rows surface first in the Announcements room and on dashboard first paint."
      right={
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia hover:text-fuchsia"
        >
          {showForm ? "Close form" : "New post"}
        </button>
      }
    >
      {showForm && (
        <AnnouncementForm
          adminFetch={adminFetch}
          onSaved={async () => {
            setShowForm(false);
            await load();
          }}
        />
      )}
      {error && (
        <p className="mt-3 rounded-md border border-[#DC2626]/40 bg-[#DC2626]/5 px-3 py-2 font-mono text-[11px] text-[#F87171]">{error}</p>
      )}
      {!rows ? (
        <p className="mt-4 font-mono text-[11px] text-text-tertiary">loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 font-mono text-[11px] text-text-tertiary">no announcements yet</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {rows.map((a) => (
            <li key={a.id} className="flex flex-col gap-2 rounded-2xl border border-line bg-paper-elev/30 p-4 md:flex-row md:items-start md:justify-between">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
                  <Chip label={a.kind} />
                  {a.pinned && <Chip label="pinned" />}
                  {a.target_tier && <span>· {a.target_tier}</span>}
                </div>
                <span className="font-display text-[15px] font-semibold text-ink">{a.title}</span>
                {a.body_markdown && (
                  <p className="font-sans text-[12px] leading-relaxed text-text-secondary">{a.body_markdown}</p>
                )}
                {a.cta_text && a.cta_url && (
                  <a href={a.cta_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex w-fit items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-fuchsia underline-offset-2 hover:underline">{a.cta_text} ↗</a>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => void togglePin(a)} className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia hover:text-fuchsia">{a.pinned ? "Unpin" : "Pin"}</button>
                <button onClick={() => void remove(a)} className="rounded-full border border-[#DC2626]/40 bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#F87171] hover:bg-[#DC2626]/10">Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function AnnouncementForm({
  adminFetch,
  onSaved,
}: {
  adminFetch: (path: string, init?: RequestInit) => Promise<Json>;
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState({
    title: "",
    body_markdown: "",
    kind: "other",
    cta_text: "",
    cta_url: "",
    target_tier: "",
    pinned: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!draft.title) {
      setError("title required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminFetch("announcements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          body_markdown: draft.body_markdown || null,
          kind: draft.kind,
          cta_text: draft.cta_text || null,
          cta_url: draft.cta_url || null,
          target_tier: draft.target_tier || null,
          pinned: draft.pinned,
          published_at: new Date().toISOString(),
          is_active: true,
        }),
      });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); // allow-raw-error — admin-internal debug surface
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 rounded-2xl border border-line bg-paper p-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Field label="title *" value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} />
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          kind
          <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} className="rounded-md border border-line bg-paper px-2 py-1 font-sans text-[12px] normal-case tracking-normal text-ink">
            <option value="mission_drop">mission_drop</option>
            <option value="payout">payout</option>
            <option value="rule_change">rule_change</option>
            <option value="deadline">deadline</option>
            <option value="other">other</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          target_tier
          <select value={draft.target_tier} onChange={(e) => setDraft({ ...draft, target_tier: e.target.value })} className="rounded-md border border-line bg-paper px-2 py-1 font-sans text-[12px] normal-case tracking-normal text-ink">
            <option value="">everyone</option>
            <option value="free">free</option>
            <option value="paid">paid</option>
          </select>
        </label>
        <Field label="cta_text" value={draft.cta_text} onChange={(v) => setDraft({ ...draft, cta_text: v })} />
        <Field label="cta_url" value={draft.cta_url} onChange={(v) => setDraft({ ...draft, cta_url: v })} />
        <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          <input type="checkbox" checked={draft.pinned} onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })} />
          pin to top
        </label>
        <label className="col-span-2 flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary md:col-span-3">
          body (markdown)
          <textarea value={draft.body_markdown} onChange={(e) => setDraft({ ...draft, body_markdown: e.target.value })} rows={4} className="rounded-md border border-line bg-paper px-2 py-1 font-sans text-[12px] normal-case tracking-normal text-ink" />
        </label>
      </div>
      {error && <p className="mt-3 rounded-md border border-[#DC2626]/40 bg-[#DC2626]/5 px-3 py-2 font-mono text-[11px] text-[#F87171]">{error}</p>}
      <div className="mt-3 flex items-center">
        <button onClick={() => void save()} disabled={busy} className="ml-auto rounded-full bg-fuchsia px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-white hover:bg-fuchsia-bright disabled:opacity-60">{busy ? "Saving…" : "Publish"}</button>
      </div>
    </div>
  );
}
