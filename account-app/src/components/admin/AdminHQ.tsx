"use client";

import { useCallback, useEffect, useState } from "react";
import "@/app/admin/_brand/tokens.css";
import { AdminBrandHeader } from "@/app/admin/_brand/AdminBrandHeader";
import {
  AgentsTab,
  APIToolsTab,
  CostsRunwayTab,
  CustomersTab,
  EmployeesTab,
  InboxTab,
  IronGatesTab,
  ReleasesTab,
  ReportsTab,
  RevenueTab,
} from "./HQCommandTabs";
import { SurfacesTab } from "./SurfacesTab";
import { SystemMapTab } from "./SystemMapTab";
import { JourneyMapTab } from "./JourneyMapTab";
import { PromoCodesTab } from "./PromoCodesTab";
import { CarouselClipsTab } from "./CarouselClipsTab";
import { ColdLeadsTab } from "./ColdLeadsTab";
import { CanaryTab } from "./CanaryTab";
import { BetaCohortTab } from "./BetaCohortTab";
import { SignInOpsTab } from "./SignInOpsTab";
import { ConstellationTab } from "./ConstellationTab";
import { useDataSource } from "./_lib/useDataSource";
import { LiveBadge } from "./_lib/LiveBadge";
import { InfoIcon } from "./_lib/InfoIcon";

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
  whop_affiliate_id?: string | null;
  whop_affiliate_code?: string | null;
  referred_paid_subs?: number;
  eligible_affiliate_referrals?: number;
  first_paid_at?: string | null;
  affiliate_qualified_at?: string | null;
  affiliate_commission_override_ids?: string[];
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
  "System Map",
  "Journey Map",
  "Surfaces",
  "Overview",
  "Revenue",
  "Bugs",
  "Iron Gates",
  "Agents",
  "Employees",
  "APIs / Tools",
  "Releases",
  "Costs / Runway",
  "Customers",
  "Reports",
  "Inbox",
  // Existing admin-only tabs
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
  "Ayrshare",
  "Telemetry",
  "Bonus Ledger",
  "Community Channels",
  "Missions",
  "Banners",
  "Announcements",
  "Promo Codes",
  "Carousel Clips",
  "Cold Leads",
  "Canary",
  "Beta Cohort",
  "Sign-in Ops",
  "Constellation",
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
  const style: React.CSSProperties =
    status === "ok"
      ? { borderColor: "rgba(77, 198, 168, 0.42)", background: "rgba(77, 198, 168, 0.10)", color: "var(--lc-ok)" }
      : status === "warn"
        ? { borderColor: "rgba(217, 155, 45, 0.42)", background: "rgba(217, 155, 45, 0.10)", color: "var(--lc-warn)" }
        : { borderColor: "rgba(255, 102, 184, 0.40)", background: "var(--lc-accent-soft)", color: "var(--lc-accent-mid)" };
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] transition hover:border-fuchsia"
      style={style}
      title="Open Function Heat Map"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label} · {score}/100
    </button>
  );
}

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

export function AdminHQ({
  adminEmail,
  initialOverview,
  agentKeyConfig,
  serviceConfig,
}: {
  adminEmail: string;
  initialOverview: Overview | null;
  agentKeyConfig: AgentKeyConfig;
  serviceConfig: ServiceConfig;
}) {
  const [tab, setTab] = useState<Tab>("System Map");

  return (
    <div className="lc-hq-shell mx-auto max-w-[1200px] px-5 pb-8 sm:pb-12">
      <AdminBrandHeader
        adminEmail={adminEmail}
        rightSlot={<AdminStatusPill onOpen={() => setTab("Function Heat Map")} />}
      />

      <nav className="mt-2 flex flex-wrap gap-1.5 pb-3" aria-label="HQ command tabs">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className="lc-tab"
            data-active={tab === t ? "true" : "false"}
            aria-current={tab === t ? "page" : undefined}
          >
            {t}
          </button>
        ))}
      </nav>

      <div className="mt-7">
        {tab === "System Map" && <SystemMapTab />}
        {tab === "Journey Map" && <JourneyMapTab />}
        {tab === "Surfaces" && <SurfacesTab />}
        {tab === "Overview" && <OverviewTab initial={initialOverview} />}
        {tab === "Revenue" && <RevenueTab />}
        {tab === "Bugs" && <BugCommandTab agentKeyConfig={agentKeyConfig} />}
        {tab === "Iron Gates" && <IronGatesTab />}
        {tab === "Agents" && <AgentsTab agentKeyConfig={agentKeyConfig} />}
        {tab === "Employees" && <EmployeesTab />}
        {tab === "APIs / Tools" && <APIToolsTab serviceConfig={serviceConfig} />}
        {tab === "Releases" && <ReleasesTab />}
        {tab === "Costs / Runway" && <CostsRunwayTab agentKeyConfig={agentKeyConfig} serviceConfig={serviceConfig} />}
        {tab === "Customers" && <CustomersTab />}
        {tab === "Reports" && <ReportsTab />}
        {tab === "Inbox" && <InboxTab />}
        {/* Existing admin-only tabs */}
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
        {tab === "Ayrshare" && <AyrshareTab />}
        {tab === "Telemetry" && <BugsTab />}
        {tab === "Bonus Ledger" && <BonusLedgerTab />}
        {tab === "Community Channels" && <CommunityChannelsTab />}
        {tab === "Missions" && <MissionsTab />}
        {tab === "Banners" && <BannersTab />}
        {tab === "Announcements" && <AnnouncementsTab />}
        {tab === "Promo Codes" && <PromoCodesTab />}
        {tab === "Carousel Clips" && <CarouselClipsTab />}
        {tab === "Cold Leads" && <ColdLeadsTab />}
        {tab === "Canary" && <CanaryTab />}
        {tab === "Beta Cohort" && <BetaCohortTab />}
        {tab === "Sign-in Ops" && <SignInOpsTab adminEmail={adminEmail} />}
        {tab === "Constellation" && <ConstellationTab />}
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
  const src = useDataSource();
  const [data, setData] = useState<Overview | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initial ? null : "Overview not loaded — refresh to retry.");

  // Seed badge state from the SSR-provided initial overview, then update
  // on each refresh.
  useEffect(() => {
    if (initial) src.report("overview", "ok");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData((await fetchAdmin("overview")) as unknown as Overview);
      src.report("overview", "ok");
    } catch (e) {
      setError(String(e));
      src.report("overview", "fail");
    } finally {
      setLoading(false);
    }
  }, [fetchAdmin, src]);

  return (
    <Panel
      title="overview · config + counts"
      sub="'configured' means a secret is set in env — never the value. Counts are live from the DB."
      right={
        <div className="flex items-center gap-2">
          <LiveBadge state={src.state} />
          <button onClick={refresh} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink hover:border-fuchsia">
            refresh
          </button>
        </div>
      }
    >
      <Loader on={loading} />
      <ErrorNote error={error} />
      {data && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Object.entries(data.config).map(([k, v]) => (
              <div key={k} className="rounded-2xl border border-line bg-paper p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                  {k}
                  <InfoIcon hint={`Server-side boolean from /admin/overview · backend reports whether the env-secret for "${k}" is set on Railway (presence, not value).`} />
                </div>
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
                <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                  {k.replace(/_/g, " ")}
                  <InfoIcon hint={`Live count from /admin/overview · backend SELECT against the "${k}" table or aggregate. No cache — recomputed per request.`} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-1">
            {Object.entries(data.notes).map(([k, v]) => (
              <div key={k} className="font-mono text-[11px] text-text-tertiary">
                <span className="text-ink">{k.replace(/_/g, " ")}:</span> {v}
                <InfoIcon hint="Backend-shipped honesty note · explains where the count comes from and what would need a new table to populate fully." />
              </div>
            ))}
          </div>
          <div className="mt-3 font-mono text-[10px] text-text-tertiary">
            generated {data.generated_at}
            <InfoIcon hint="UTC server timestamp at the moment /admin/overview computed this snapshot. Refresh re-runs the query." />
          </div>
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
  const src = useDataSource();
  const [data, setData] = useState<LaunchHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData((await fetchAdmin("health")) as unknown as LaunchHealth);
      src.report("health", "ok");
    } catch (e) {
      setError(String(e));
      src.report("health", "fail");
    } finally {
      setLoading(false);
    }
  }, [fetchAdmin, src]);

  return (
    <Panel
      title="launch health · one-click gates"
      sub="Admin-only aggregate check for release readiness. Read-only: no posts, charges, payouts, or account mutations."
      right={
        <div className="flex items-center gap-2">
          <LiveBadge state={src.state} />
          <button onClick={refresh} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink hover:border-fuchsia">
            run health check
          </button>
        </div>
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
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                automated gate score
                <InfoIcon hint="Weighted score from /admin/health · ok=full points, warn=partial, fail=zero. Pure read-only — no posts, charges, or mutations." />
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div><Chip label={data.overall} tone={gateTone(data.overall)} /></div>
              <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                overall status
                <InfoIcon hint="Worst gate wins · any fail → fail, any warn → warn, else ok. Computed server-side on each /admin/health call." />
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div className="font-mono text-[12px] text-ink">{data.generated_at}</div>
              <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                last run
                <InfoIcon hint="UTC timestamp of the most recent /admin/health invocation rendered above. Click 'run health check' to refresh." />
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {data.gates.map((g) => {
              const value = prettyJson(g.value);
              return (
                <div key={g.key} className="rounded-2xl border border-line bg-paper p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                        {g.key}
                        <InfoIcon hint={`Gate key · stable identifier the backend uses for this check. Owner: /admin/health gate "${g.key}".`} />
                      </div>
                      <h3 className="mt-1 font-display text-[18px] font-semibold leading-tight tracking-[-0.02em] text-ink">{g.label}</h3>
                    </div>
                    <Chip label={g.status} tone={gateTone(g.status)} />
                  </div>
                  <p className="mt-3 font-sans text-[13px] leading-relaxed text-text-secondary">
                    {g.detail}
                    <InfoIcon hint="Detail string from the backend gate · plain-English explanation of why this is ok / warn / fail." />
                  </p>
                  {value && (
                    <code className="mt-3 block overflow-x-auto rounded-xl bg-paper-warm/60 px-3 py-2 font-mono text-[11px] text-text-tertiary">
                      {value}
                    </code>
                  )}
                  {g.action && (
                    <p className="mt-3 font-mono text-[11px] text-fuchsia-deep">
                      action · {g.action}
                      <InfoIcon hint="Operator action the backend recommends to clear this gate (e.g. set env var, run migration, paste id)." />
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-4 rounded-2xl border border-line bg-paper p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
              public urls
              <InfoIcon hint="Live public URLs the backend expects to be reachable. Each link opens in a new tab — pre-launch sanity check." />
            </div>
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
  const src = useDataSource();
  const [data, setData] = useState<FunctionHeatmap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData((await fetchAdmin("function-heatmap")) as unknown as FunctionHeatmap);
      src.report("heatmap", "ok");
    } catch (e) {
      setError(String(e));
      src.report("heatmap", "fail");
    } finally {
      setLoading(false);
    }
  }, [fetchAdmin, src]);

  const runNow = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData((await fetchAdmin("function-heatmap/run", { method: "POST" })) as unknown as FunctionHeatmap);
      src.report("heatmap", "ok");
    } catch (e) {
      setError(String(e));
      src.report("heatmap", "fail");
    } finally {
      setLoading(false);
    }
  }, [fetchAdmin, src]);

  return (
    <Panel
      title="function heat map · automated rail checks"
      sub="Railway runs this every 5 hours. Red gates email admins through Resend; every run emits PostHog telemetry. Read-only: no posts, charges, OAuth mutations, or payouts."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge state={src.state} />
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
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                function score
                <InfoIcon hint="Weighted aggregate from /admin/function-heatmap · ok=full, warn=partial, fail=0. Computed every 5h by Railway cron." />
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div><Chip label={data.overall} tone={gateTone(data.overall)} /></div>
              <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                overall
                <InfoIcon hint="Worst-gate-wins roll-up · any fail → fail. Drives the admin Resend email when status flips to fail." />
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div className="font-display text-[28px] font-bold text-ink">{data.failures}</div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                red gates
                <InfoIcon hint="Count of gates with status=fail in this snapshot. Each fail emits PostHog telemetry + triggers operator email." />
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div className="font-mono text-[11px] text-ink">{data.source}</div>
              <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                {data.generated_at}
                <InfoIcon hint='source = "cron" (Railway scheduled) or "manual" (run-now button). generated_at = UTC timestamp of the run.' />
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {data.gates.map((g) => (
              <div key={g.key} className="rounded-2xl border border-line bg-paper p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                      {g.owner} · {g.key}
                      <InfoIcon hint={`owner = which lane (auth/billing/backend/etc) owns this gate · key = stable id used by /admin/function-heatmap. Owner: ${g.owner}.`} />
                    </div>
                    <h3 className="mt-1 font-display text-[18px] font-semibold leading-tight tracking-[-0.02em] text-ink">{g.label}</h3>
                  </div>
                  <Chip label={g.status} tone={gateTone(g.status)} />
                </div>
                <p className="mt-3 font-sans text-[13px] leading-relaxed text-text-secondary">
                  {g.detail}
                  <InfoIcon hint="Backend detail string · why this gate is currently ok / warn / fail. Edited via /admin/function-heatmap gate definitions." />
                </p>
                {g.action && (
                  <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.08em] text-fuchsia-deep">
                    {g.action}
                    <InfoIcon hint="Operator action to clear this gate · ship-blocking when status=fail." />
                  </p>
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
  const src = useDataSource();
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
      src.report("alerts", "ok");
    } catch (e) {
      setError(String(e));
      src.report("alerts", "fail");
    } finally {
      setLoading(false);
    }
  }, [fetchAdmin, filter, src]);

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
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge state={src.state} />
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
          <InfoIcon hint="Count of AdminAlert rows where read_at IS NULL for the signed-in admin. Mark-read writes read_at via POST /admin/alerts/{id}/read." />
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">{data.alerts.length} shown</span>
          <InfoIcon hint="Alerts returned for the current filter (all / unread / high). Server caps at 100 rows; older rows live in /admin/alerts with paging." />
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
                  <InfoIcon hint="AdminAlert.category (heatmap/webhook/billing/system) and created_at UTC timestamp — written by the source that emitted the alert." />
                </div>
                <h3 className="mt-1 font-display text-[18px] font-semibold leading-tight tracking-[-0.02em] text-ink">{alert.title}</h3>
              </div>
              <div className="flex items-center gap-2">
                <Chip label={alert.priority} tone={alert.priority === "high" ? "fail" : alert.priority === "medium" ? "pending" : "gray"} />
                <InfoIcon hint="AdminAlert.priority · high triggers Resend operator email + sirens; medium/low ride the inbox only." />
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
      <div className="flex w-full flex-1 items-center gap-1">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSearch()}
          placeholder="email · clerk id · whop user id · backend id · affiliate id"
          className="w-full flex-1 rounded-xl border border-line bg-paper px-3 py-2.5 font-mono text-[12px] text-ink placeholder:text-text-tertiary"
        />
        <InfoIcon hint="GET /admin/users?query= · matches against email, clerk_id, whop_user_id, backend User.id, affiliate_id. Email substring is case-insensitive." />
      </div>
      <button onClick={onSearch} disabled={loading} className="shrink-0 rounded-xl bg-ink px-5 py-2.5 font-mono text-[12px] uppercase tracking-[0.1em] text-paper transition hover:bg-fuchsia disabled:opacity-50">
        {loading ? "…" : "search"}
      </button>
    </div>
  );
}

const USER_COL_HINTS: Record<string, string> = {
  email: "User.email · MASKED in this list (e.g. d•••@example.com). Full email only appears in the detail card below after you click 'open'.",
  tier: "users.tier · effective Liquid Clips tier (free/solo/pro/agency). Backend resolves Clerk metadata + Whop subscription + admin override.",
  status: "users.subscription_status · active/trialing/canceled/past_due/refunded. Source: latest Whop/Clerk webhook for this user.",
  provider: "users.billing_provider · 'whop' or 'stripe' (Clerk Billing). Determines which dashboard opens in the Billing tab.",
  founder: "users.founder · true if the lifetime/founder unlock applies. Locked-in benefits survive subscription_status changes.",
  created: "users.created_at · UTC date the backend User row was first inserted (Clerk webhook or first /desktop/connect).",
};

function ResultsTable({ rows, onOpen }: { rows: UserRow[]; onOpen: (id: string) => void }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full border-collapse font-mono text-[11px]">
        <thead>
          <tr className="text-left text-text-tertiary">
            {["email", "tier", "status", "provider", "founder", "created", ""].map((h) => (
              <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">
                {h}
                {USER_COL_HINTS[h] && <InfoIcon hint={USER_COL_HINTS[h]} />}
              </th>
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

function KV({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/40 px-1 py-1.5 last:border-b-0">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
        {label}
        {hint && <InfoIcon hint={hint} />}
      </span>
      <span className="text-right font-mono text-[11px] text-ink">{children}</span>
    </div>
  );
}

function UserDetailCard({ d, timeline, onLoadTimeline }: { d: UserDetail; timeline: Timeline | null; onLoadTimeline: (id: string) => void }) {
  return (
    <div className="mt-5 rounded-2xl border border-line bg-paper p-5">
      <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        <div>
          <KV label="email (full)" hint="users.email · UNMASKED · PII exposure — only render in this admin-only detail card, never in lists or logs.">{d.email}</KV>
          <KV label="backend id" hint="users.id · primary key in junior-backend Postgres. Stable, internal — use this for /admin/users/{id} lookups.">{d.backend_user_id}</KV>
          <KV label="clerk id" hint="users.clerk_id · Clerk's user_xxxx id. Source for sign-in identity and (for Stripe path) billing.">{d.clerk_id}</KV>
          <KV label="whop user id" hint="users.whop_user_id · Whop user_xxxx id, set when account linked via /whop/* OAuth or webhook. Null = no Whop link.">{d.whop_user_id ?? <NA />}</KV>
          <KV label="affiliate id (referrer)" hint="users.referred_by · backend User.id of the affiliate who brought this user in. Drives starter-pass + Whop reward credit.">{d.affiliate_id ?? <NA />}</KV>
          <KV label="own Whop affiliate" hint="users.whop_affiliate_id · this user's aff_* record in Whop. Distinct from the referrer token above.">{d.whop_affiliate_id ?? <NA />}</KV>
          <KV label="affiliate checkout code" hint="users.whop_affiliate_code · username passed to the Whop checkout embed. Current referral links use this value.">{d.whop_affiliate_code ?? <NA />}</KV>
          <KV label="created" hint="users.created_at · UTC insert timestamp of this User row.">{d.created_at ?? <NA />}</KV>
        </div>
        <div>
          <KV label="tier raw → effective" hint="raw_tier = Clerk metadata · effective_tier = backend-resolved (raw + Whop sub + admin_override). The effective value is what gates features.">
            <span>
              {d.raw_tier} → <Chip label={d.effective_tier} />
              {d.admin_override && <span className="ml-1"><Chip label="admin override" tone="pending" /></span>}
            </span>
          </KV>
          <KV label="founder raw / effective" hint="raw = stored founder flag, effective = post-resolution (admin override can flip). Founder unlock is sticky across status changes.">{d.raw_founder ? "yes" : "no"} / {d.effective_founder ? "yes" : "no"}</KV>
          <KV label="subscription status" hint="users.subscription_status · last value written by Clerk/Whop webhook. Drives gating across desktop + account-app."><Chip label={d.subscription_status} /></KV>
          <KV label="billing provider" hint="users.billing_provider · 'whop' (Whop checkout/Affiliate) or 'stripe' (Clerk Billing direct). Determines which dashboard the Billing tab links to.">{d.billing_provider}</KV>
          <KV label="first paid" hint="users.first_paid_at · immutable first successful paid invoice. Starts the affiliate 7-day good-standing hold for the referrer.">{d.first_paid_at ?? <NA />}</KV>
          <KV label="paid until" hint="users.paid_until · UTC expiry from the last Whop/Stripe subscription event. Null if free/never-paid.">{d.paid_until ?? <NA />}</KV>
          <KV label="exports used / cap" hint="users.starter_exports_used / .starter_export_cap · counter for the 100-export starter pass. Paid users bypass the cap.">{d.starter_exports_used} / {d.starter_export_cap}</KV>
          <KV label="remaining exports" hint="Derived: cap − used (paid users return null = unlimited). Drives the desktop export #101 block.">{d.remaining_exports === null ? "unlimited" : d.remaining_exports}</KV>
          <KV label="affiliate referrals" hint="Transactional paid count / referrals that are still active and have cleared the 7-day good-standing hold.">
            {d.referred_paid_subs ?? 0} total / {d.eligible_affiliate_referrals ?? 0} eligible
          </KV>
          <KV label="50% commission" hint="Active only when Whop override ids are stored. Qualification timestamp remains after a subscription lapse; overrides are removed until reactivation.">
            {(d.affiliate_commission_override_ids?.length ?? 0) > 0
              ? <Chip label="active" tone="ok" />
              : d.affiliate_qualified_at
                ? <Chip label="paused" tone="pending" />
                : <Chip label="not qualified" tone="gray" />}
          </KV>
          <KV label="qualified at" hint="users.affiliate_qualified_at · set only after all recurring-plan Whop overrides succeeded.">{d.affiliate_qualified_at ?? <NA />}</KV>
          <KV label="override ids" hint="Whop per-plan override ids. Three ids means Pro, Growth, and Agency qualified terms are reconciled.">{d.affiliate_commission_override_ids?.length ?? 0}</KV>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-line bg-paper-warm/50 p-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          latest license
          <InfoIcon hint="Most recent License row for this user (junior-backend License table). Desktop reads the active license via JWT in macOS keychain." />
        </div>
        {d.latest_license ? (
          <div className="mt-2 grid grid-cols-2 gap-x-6 sm:grid-cols-4">
            <KV label="tier at issue" hint="License.tier_at_issue · tier snapshotted into the JWT at mint time. Frozen for the license lifetime.">{d.latest_license.tier_at_issue}</KV>
            <KV label="issued" hint="License.issued_at · UTC mint timestamp from POST /desktop/connect (server-side, x-internal-secret gated).">{d.latest_license.issued_at ?? <NA />}</KV>
            <KV label="expires" hint="License.expires_at · JWT exp claim. Desktop refreshes on next launch when within renewal window.">{d.latest_license.expires_at ?? <NA />}</KV>
            <KV label="revoked" hint="License.revoked · boolean. Set true by admin revoke; desktop hard-blocks paid features when true.">{d.latest_license.revoked ? <Chip label="revoked" tone="fail" /> : <Chip label="active" tone="ok" />}</KV>
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
  const src = useDataSource();
  useEffect(() => {
    if (s.error) src.report("users", "fail");
    else if (s.results.length > 0 || s.detail) src.report("users", "ok");
  }, [s.error, s.results.length, s.detail, src]);
  return (
    <Panel
      title="users · search + detail"
      sub="Emails masked in results; full email only in the detail card below."
      right={<LiveBadge state={src.state} />}
    >
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
  const src = useDataSource();
  useEffect(() => {
    if (s.error) src.report("users", "fail");
    else if (s.detail) src.report("users", "ok");
  }, [s.error, s.detail, src]);
  const d = s.detail;
  const wouldBlock = d ? d.remaining_exports !== null && d.remaining_exports <= 0 : false;
  return (
    <Panel
      title="usage · export gate"
      sub="Search a user to inspect their 100-export starter pass and whether export #101 would be blocked."
      right={<LiveBadge state={src.state} />}
    >
      <SearchBar query={s.query} setQuery={s.setQuery} onSearch={s.search} loading={s.loading} />
      <ErrorNote error={s.error} />
      <ResultsTable rows={s.results} onOpen={s.open} />
      {d && (
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-2xl border border-line bg-paper p-4">
            <div className="font-display text-[28px] font-bold text-ink">{d.starter_exports_used}</div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
              exports used
              <InfoIcon hint="users.starter_exports_used · monotonic counter incremented by sidecar on every successful export. Survives logout." />
            </div>
          </div>
          <div className="rounded-2xl border border-line bg-paper p-4">
            <div className="font-display text-[28px] font-bold text-ink">{d.remaining_exports === null ? "∞" : d.remaining_exports}</div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
              remaining exports
              <InfoIcon hint="Derived: starter_export_cap − starter_exports_used · null/∞ when tier is paid (cap is bypassed)." />
            </div>
          </div>
          <div className="rounded-2xl border border-line bg-paper p-4">
            <div className="mt-1"><Chip label={d.subscription_status === "active" ? "active" : "trialing"} /></div>
            <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
              trialing vs active
              <InfoIcon hint="Coalesces users.subscription_status into the 2-state label the gate cares about: 'active' (paid) or 'trialing' (everything else)." />
            </div>
          </div>
          <div className="rounded-2xl border border-line bg-paper p-4">
            <div className="mt-1"><Chip label={d.remaining_exports === null ? "no" : wouldBlock ? "blocked" : "no"} tone={d.remaining_exports === null ? "ok" : wouldBlock ? "fail" : "ok"} /></div>
            <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
              export #101 blocked?
              <InfoIcon hint="Simulates the desktop gate: if remaining_exports ≤ 0 AND tier is not paid, the next export is hard-blocked with the upgrade modal." />
            </div>
          </div>
          <div className="col-span-2 mt-1 font-mono text-[11px] text-text-tertiary sm:col-span-4">
            last individual export event: <NA /> — only the running counter is stored in v0 (PostHog has clip-export events).
            <InfoIcon hint="Per-export history is not in junior-backend (v0 design: only the monotonic counter). PostHog 'clip-export' events are the only event-level audit trail." />
          </div>
        </div>
      )}
    </Panel>
  );
}

// Billing tab — provider-specific read-only state for a searched user.
function BillingTab() {
  const s = useUserDetail();
  const src = useDataSource();
  useEffect(() => {
    if (s.error) src.report("users", "fail");
    else if (s.detail) src.report("users", "ok");
  }, [s.error, s.detail, src]);
  const d = s.detail;
  const whopOrders = "https://whop.com/dashboard";
  const clerkDash = "https://dashboard.clerk.com";
  return (
    <Panel
      title="billing · read-only"
      sub="No cancel / refund / edit here. Whop owns current subscription checkout and the payment ledger."
      right={<LiveBadge state={src.state} />}
    >
      <SearchBar query={s.query} setQuery={s.setQuery} onSearch={s.search} loading={s.loading} />
      <ErrorNote error={s.error} />
      <ResultsTable rows={s.results} onOpen={s.open} />
      {d && (
        <div className="mt-5 rounded-2xl border border-line bg-paper p-5">
          <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            <div>
              <KV label="provider" hint="Subscription provider only. Affiliate attribution and payouts are handled separately by Whop."><Chip label={d.billing_provider} /></KV>
              <KV label="subscription status" hint="users.subscription_status · last value written by Clerk/Whop webhook. active/trialing/canceled/past_due/refunded."><Chip label={d.subscription_status} /></KV>
              <KV label="tier" hint="users.tier · effective tier after admin override + Whop sub. Determines feature gating across desktop + account-app."><Chip label={d.effective_tier} /></KV>
              <KV label="paid until" hint="users.paid_until · UTC expiry from the latest provider event. Null when user is free or never paid.">{d.paid_until ?? <NA />}</KV>
            </div>
            <div>
              <KV label="founder" hint="users.founder (effective) · lifetime/founder unlock. A refund clears this entitlement; a normal recurring cancellation does not create one.">{d.effective_founder ? "yes" : "no"}</KV>
              <KV label="refunded" hint="Derived: subscription_status === 'refunded'. Set by provider webhook (Whop or Stripe).">{d.subscription_status === "refunded" ? "yes" : "no"}</KV>
              <KV label="canceled" hint="Derived: subscription_status === 'canceled'. User retains access until paid_until elapses unless revoked.">{d.subscription_status === "canceled" ? "yes" : "no"}</KV>
              <KV label="past due" hint="Derived: subscription_status === 'past_due'. Provider failed to charge — Whop/Stripe retries; tier holds until status flips to canceled.">{d.subscription_status === "past_due" ? "yes" : "no"}</KV>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={d.billing_provider === "whop" ? whopOrders : clerkDash} target="_blank" rel="noreferrer" className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink hover:border-fuchsia">
              open {d.billing_provider} dashboard →
            </a>
            <InfoIcon hint={d.billing_provider === "whop" ? "Opens whop.com/dashboard — backend does not store a per-user Whop order id, so this lands on the root dashboard." : "Opens dashboard.clerk.com — backend does not store a Stripe customer id mapping, so this lands on the Clerk dashboard root."} />
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
  const src = useDataSource();
  useEffect(() => {
    if (error) src.report("pending-whop", "fail");
    else if (rows.length >= 0 && !loading) src.report("pending-whop", "ok");
  }, [error, rows.length, loading, src]);
  return (
    <Panel
      title="pending whop · read-only"
      sub="Entitlements parked for buyers who paid on Whop before signing up. Emails masked."
      right={
        <div className="flex items-center gap-2">
          <LiveBadge state={src.state} />
          <LoadButton onClick={load} />
        </div>
      }
    >
      <Loader on={loading} />
      <ErrorNote error={error} />
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr className="text-left text-text-tertiary">
                {([
                  ["email", "PendingWhopMembership.email_masked · MASKED. Email pre-purchase, before the user signed up for Liquid Clips."],
                  ["tier", "PendingWhopMembership.tier · tier paid for on Whop (solo/pro/agency). Becomes users.tier when claim is consumed."],
                  ["founder", "PendingWhopMembership.founder · true if Whop product = founder/lifetime SKU. Carries into users.founder on consume."],
                  ["whop user id", "PendingWhopMembership.whop_user_id · Whop user_xxxx that paid. Null until Whop webhook attaches one."],
                  ["renewal end", "PendingWhopMembership.renewal_period_end · UNIX seconds. Whop subscription expiry locked at the time of purchase."],
                  ["created", "PendingWhopMembership.created_at · UTC insert (Whop webhook receipt time)."],
                  ["consumed", "PendingWhopMembership.consumed_at · UTC when the entitlement was attached to a real user via signup/connect."],
                  ["status", "PendingWhopMembership.status · 'open' (waiting for signup) / 'consumed' / 'expired' / 'voided'."],
                  ["age", "Derived: now − created_at. How long this entitlement has been parked unclaimed."],
                ] as Array<[string, string]>).map(([h, hint]) => (
                  <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">
                    {h}
                    <InfoIcon hint={hint} />
                  </th>
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
      {note && <p className="mt-3 font-mono text-[11px] text-text-tertiary">{note}<InfoIcon hint="Backend-shipped honesty note for /admin/pending-whop · explains data shape + gaps." /></p>}
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
  const src = useDataSource();
  useEffect(() => {
    if (error) src.report("claims", "fail");
    else if (!loading) src.report("claims", "ok");
  }, [error, loading, src]);
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
    <Panel
      title="claims · read-only + safe actions"
      sub="Raw tokens are never rendered. Safe actions: expire (burn link) · resend (re-email the SAME open link)."
      right={
        <div className="flex items-center gap-2">
          <LiveBadge state={src.state} />
          <LoadButton onClick={load} />
        </div>
      }
    >
      <Loader on={loading} />
      <ErrorNote error={error} />
      {actionMsg && <div className="mt-2 rounded-xl border border-line bg-paper px-3 py-2 font-mono text-[11px] text-ink">{actionMsg}</div>}
      {rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr className="text-left text-text-tertiary">
                {([
                  ["short id", "ClaimToken.short_id · last 8 chars of the token id (safe to display). Raw token is NEVER rendered server-side or in the browser."],
                  ["target email", "ClaimToken.target_email_masked · MASKED. Address the claim link was emailed to via Resend."],
                  ["requester", "ClaimToken.requester_clerk_id · truncated. The admin/operator Clerk user who created the claim link."],
                  ["created", "ClaimToken.created_at · UTC mint timestamp. Pairs with expires_at for the link lifetime."],
                  ["expires", "ClaimToken.expires_at · UTC link death. After this, the claim cannot be used."],
                  ["used", "ClaimToken.used_at · UTC when the link was clicked + entitlement attached. Null = unused."],
                  ["status", "ClaimToken.status · open / used / expired / revoked. Drives whether expire/resend buttons are enabled."],
                  ["actions", "expire = POST /admin/claims/{id}/expire (burn the link) · resend = POST /admin/claims/{id}/resend (re-email the SAME open link, no new token)."],
                ] as Array<[string, string]>).map(([h, hint]) => (
                  <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">
                    {h}
                    <InfoIcon hint={hint} />
                  </th>
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
  const src = useDataSource();
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
      src.report("webhooks", "ok");
    } catch (e) {
      setError(String(e));
      src.report("webhooks", "fail");
    } finally {
      setLoading(false);
    }
  }, [fetchAdmin, provider, status, src]);

  const shortId = (v: string | null) => (v ? v.slice(0, 8) + "…" : null);

  return (
    <Panel
      title="webhooks · read-only"
      sub="Metadata-only log of signature-valid Clerk/Whop webhooks — no payloads, emails, secrets, or tokens stored."
      right={
        <div className="flex items-center gap-2">
          <LiveBadge state={src.state} />
          <LoadButton onClick={load} />
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center">
          <FilterSelect label="provider" value={provider} onChange={setProvider} options={["", "clerk", "whop"]} />
          <InfoIcon hint="Filter on WebhookEvent.provider · clerk (sign-in/billing) or whop (subscription/affiliate). Empty = both." />
        </span>
        <span className="inline-flex items-center">
          <FilterSelect label="status" value={status} onChange={setStatus} options={["", "handled", "ignored", "failed"]} />
          <InfoIcon hint="Filter on WebhookEvent.status · handled (applied), ignored (out-of-order/no-op), failed (signature ok, handler crashed)." />
        </span>
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
                {([
                  ["provider", "WebhookEvent.provider · clerk | whop. Source webhook surface."],
                  ["event", "WebhookEvent.event_name · the provider's event id (e.g. user.created, subscription.canceled)."],
                  ["status", "WebhookEvent.status · handled / ignored / failed. Failure = signature was valid but the handler raised."],
                  ["linked", "Foreign keys this event touched · u:<User.id> · p:<PendingWhopMembership.id>. Empty = no record matched."],
                  ["error", "WebhookEvent.error · raw handler error string (admin-only). Truncated; hover for full."],
                  ["received", "WebhookEvent.received_at · UTC of POST hitting junior-backend, before handler runs."],
                  ["handled", "WebhookEvent.handled_at · UTC of handler completion. Null = still in-flight or crashed before write."],
                ] as Array<[string, string]>).map(([h, hint]) => (
                  <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">
                    {h}
                    <InfoIcon hint={hint} />
                  </th>
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
  const src = useDataSource();
  const [data, setData] = useState<PostizData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData((await fetchAdmin("postiz")) as unknown as PostizData);
      src.report("postiz", "ok");
    } catch (e) {
      setError(String(e));
      src.report("postiz", "fail");
    } finally {
      setLoading(false);
    }
  }, [fetchAdmin, src]);

  return (
    <Panel
      title="postiz · status only"
      sub="Display only — Admin HQ never calls or changes Postiz."
      right={
        <div className="flex items-center gap-2">
          <LiveBadge state={src.state} />
          <LoadButton onClick={load} />
        </div>
      }
    >
      <Loader on={loading} />
      <ErrorNote error={error} />
      {data && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div className="mt-1"><BoolChip value={data.configured} on="configured" off="not configured" /></div>
              <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                postiz live
                <InfoIcon hint="True iff POSTIZ_BASE_URL + POSTIZ_API_KEY are set on Railway. NOTE: Postiz is the legacy/fallback publisher — Ayrshare is the LIVE rail in production. See Ayrshare tab." />
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div className="font-display text-[28px] font-bold text-ink">{data.connections.users_with_connection}</div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                users connected
                <InfoIcon hint="Count of SocialConnection rows with provider='postiz'. Each row = one user who paired their Postiz workspace." />
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div className="font-display text-[28px] font-bold text-ink">{data.connections.active_connections}</div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                active connections
                <InfoIcon hint="Subset of users_with_connection that have completed at least one successful schedule. Used to gauge real activation, not just account link." />
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div className="font-display text-[28px] font-bold text-ink">{data.schedules_total}</div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                schedules total
                <InfoIcon hint="Total Schedule rows for the Postiz rail (all statuses, all-time). Drives the per-status chip row below." />
              </div>
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
            <InfoIcon hint="Schedule.status grouped count · pending / queued / posted / failed. Backend GROUP BY against the Schedule table." />
          </div>

          <div className="mt-4 rounded-xl border border-line bg-paper-warm/50 p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
              last error
              <InfoIcon hint="Most recent Schedule with status='failed' · platform, error string, timestamp, retry count. Source of operator triage when Postiz publishing breaks." />
            </div>
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
                    {([
                      ["platform", "Schedule.platform · destination network (twitter/instagram/youtube/tiktok/etc)."],
                      ["status", "Schedule.status · pending → queued → posted (or failed). Live row state."],
                      ["scheduled for", "Schedule.scheduled_for · UTC time the schedule is queued to publish. Past values still pending = stuck worker."],
                      ["retries", "Schedule.retry_count · how many times the publisher rail has retried this row. >3 usually = dead."],
                      ["post url", "Schedule.post_url · live link returned by Postiz on success. Null = not posted yet (or failed)."],
                      ["updated", "Schedule.updated_at · UTC of the last state change row touched."],
                    ] as Array<[string, string]>).map(([h, hint]) => (
                      <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">
                        {h}
                        <InfoIcon hint={hint} />
                      </th>
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
          <p className="mt-3 font-mono text-[11px] text-text-tertiary">{data.note}<InfoIcon hint="Backend-shipped honesty note for /admin/postiz · explains current data scope + gaps." /></p>
        </>
      )}
    </Panel>
  );
}

// =====================================================================
// Ayrshare (the LIVE publisher rail · status display only) · 2026-06-25
// =====================================================================
type AyrshareData = PostizData;

function AyrshareTab() {
  const fetchAdmin = useAdminFetch();
  const src = useDataSource();
  const [data, setData] = useState<AyrshareData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData((await fetchAdmin("ayrshare")) as unknown as AyrshareData);
      src.report("ayrshare", "ok");
    } catch (e) {
      setError(String(e));
      src.report("ayrshare", "fail");
    } finally {
      setLoading(false);
    }
  }, [fetchAdmin, src]);

  return (
    <Panel
      title="ayrshare · status only (live publisher rail)"
      sub="Display only — Admin HQ never calls or changes Ayrshare. SocialConnection rows = users with Ayrshare Profile Key pasted."
      right={
        <div className="flex items-center gap-2">
          <LiveBadge state={src.state} />
          <LoadButton onClick={load} />
        </div>
      }
    >
      <Loader on={loading} />
      <ErrorNote error={error} />
      {data && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div className="mt-1"><BoolChip value={data.configured} on="configured" off="not configured" /></div>
              <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                ayrshare live
                <InfoIcon hint="True iff AYRSHARE_API_KEY is set on Railway. THIS is the live publisher rail used by production today — Postiz is the legacy/fallback architecture." />
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div className="font-display text-[28px] font-bold text-ink">{data.connections.users_with_connection}</div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                users connected
                <InfoIcon hint="Count of SocialConnection rows with provider='ayrshare' (Ayrshare Profile Key pasted by the user)." />
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div className="font-display text-[28px] font-bold text-ink">{data.connections.active_connections}</div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                active connections
                <InfoIcon hint="Subset of users_with_connection that have completed at least one successful Ayrshare schedule. Live activation pulse." />
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div className="font-display text-[28px] font-bold text-ink">{data.schedules_total}</div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
                schedules total
                <InfoIcon hint="Total Schedule rows on the Ayrshare rail (all statuses, all-time). This is the live publish queue users see." />
              </div>
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
            <InfoIcon hint="Live Ayrshare Schedule.status grouped count · pending / queued / posted / failed. Backend GROUP BY against the Schedule table." />
          </div>

          <div className="mt-4 rounded-xl border border-line bg-paper-warm/50 p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
              last error
              <InfoIcon hint="Most recent Schedule with status='failed' on the live Ayrshare rail · platform, error, time, retries. THIS is the rail users hit today — triage here first when publishing breaks." />
            </div>
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
                    {([
                      ["platform", "Schedule.platform · destination network (twitter/instagram/youtube/tiktok/etc) on the live Ayrshare rail."],
                      ["status", "Schedule.status · pending → queued → posted (or failed). Live state on the Ayrshare publisher rail."],
                      ["scheduled for", "Schedule.scheduled_for · UTC publish time on the live rail. Past values still pending = stuck Ayrshare worker."],
                      ["retries", "Schedule.retry_count · live-rail retries. Ayrshare backoff handles transient failures up to ~3 attempts."],
                      ["post url", "Schedule.post_url · live link returned by Ayrshare on success. Null = not posted yet or failed."],
                      ["updated", "Schedule.updated_at · UTC of the last state change for this Ayrshare-rail row."],
                    ] as Array<[string, string]>).map(([h, hint]) => (
                      <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">
                        {h}
                        <InfoIcon hint={hint} />
                      </th>
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
          <p className="mt-3 font-mono text-[11px] text-text-tertiary">{data.note}<InfoIcon hint="Backend-shipped honesty note for /admin/ayrshare — explains the live-rail data scope and gaps." /></p>
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
  const src = useDataSource();
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
      src.report("bugs", "ok");
    } catch (e) {
      setError(String(e));
      src.report("bugs", "fail");
    } finally {
      setLoading(false);
    }
  }, [fetchAdmin, filterEvent, filterVersion, src]);

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
      right={
        <div className="flex items-center gap-2">
          <LiveBadge state={src.state} />
          <LoadButton onClick={load} />
        </div>
      }
    >
      {/* Needs-action summary */}
      {needsAction.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
            needs action
            <InfoIcon hint="Server-computed signals (BugTelemetry.needs_action) — usually 'p0_count > 0' or known failure-cluster thresholds. Drives operator triage urgency." />
          </span>
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
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
              affected users
              <InfoIcon hint="Distinct count of BugTelemetry.user_ref values in the current filter window. Server-side DISTINCT — null user_refs excluded." />
            </div>
          </div>
          {/* Total rows */}
          <div className="rounded-2xl border border-line bg-paper p-4">
            <div className="font-display text-[28px] font-bold tracking-[-0.02em] text-ink">{rows.length}</div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
              events shown
              <InfoIcon hint="Number of BugTelemetry rows returned for the current filter. Server caps at 200; older rows live in PostHog." />
            </div>
          </div>
          {/* By version */}
          <div className="col-span-2 rounded-2xl border border-line bg-paper p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
              by app version
              <InfoIcon hint="Server-side GROUP BY app_version from BugTelemetry. Tells you which desktop version is generating the noise — e.g. did v0.7.x regress something." />
            </div>
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
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
              by error code / event
              <InfoIcon hint="Server-side GROUP BY COALESCE(error_code, event). Cluster view of what's breaking — sort the loudest cluster first." />
            </div>
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
          <span className="inline-flex items-center">
            <FilterSelect label="event" value={filterEvent} onChange={setFilterEvent} options={eventOptions} />
            <InfoIcon hint="Filter on BugTelemetry.event · narrows the rows + aggregates to one event family (e.g. crash, sidecar_timeout)." />
          </span>
        )}
        {loaded && versionOptions.length > 1 && (
          <span className="inline-flex items-center">
            <FilterSelect label="version" value={filterVersion} onChange={setFilterVersion} options={versionOptions} />
            <InfoIcon hint="Filter on BugTelemetry.app_version · isolate failures to a specific desktop build (e.g. v0.7.55)." />
          </span>
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
                {([
                  ["event", "BugTelemetry.event · short kind label posted by the desktop reporter (crash/error/warn/timeout/etc)."],
                  ["version", "BugTelemetry.app_version · tauri appVersion at the moment the event fired."],
                  ["os / arch", "BugTelemetry.os + .arch · e.g. darwin / aarch64. Useful for triaging Mac-only or arm64-only regressions."],
                  ["route", "BugTelemetry.route · in-app surface or URL path the user was on when the event fired."],
                  ["status", "BugTelemetry.http_status · only set when the event came from an HTTP call. 5xx → fail tone, 4xx → warn."],
                  ["error code", "BugTelemetry.error_code · stable backend/sidecar error symbol (e.g. SIDECAR_TIMEOUT). Use for clustering."],
                  ["message", "BugTelemetry.message · short error message string. Truncated to 60 chars; hover for full text (no payloads/tokens stored)."],
                  ["user", "BugTelemetry.user_ref · opaque user reference (clerk_id or backend id). Truncated. PII-safe — not the email."],
                  ["time", "BugTelemetry.created_at · UTC server-receive time."],
                ] as Array<[string, string]>).map(([h, hint]) => (
                  <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">
                    {h}
                    <InfoIcon hint={hint} />
                  </th>
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
  const src = useDataSource();
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
      src.report("bonus-ledger", "ok");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); // allow-raw-error — admin-internal debug surface
      src.report("bonus-ledger", "fail");
    }
  }, [adminFetch, statusFilter, missionFilter, src]);

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
          <LiveBadge state={src.state} />
          <span className="inline-flex items-center gap-1">
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
            <InfoIcon hint="Filter on BonusLedger.bonus_payout_status · pending (owed) · paid (sent) · waived (not eligible)." />
          </span>
          <span className="inline-flex items-center gap-1">
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
            <InfoIcon hint="Filter on BonusLedger.mission_lane · training | main | proof. Mirrors sponsored_campaigns.mission_lane." />
          </span>
          <button
            onClick={() => setShowImport((v) => !v)}
            className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia hover:text-fuchsia"
          >
            {showImport ? "Close import" : "Import Whop row"}
          </button>
          <InfoIcon hint="POST /admin/bonus-ledger/import · creates a BonusLedger row mirroring an approved Whop submission. Base + bonus payout computed server-side from membership tier + watermark status at import." />
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
                <th className="px-2 py-2">whop_submission<InfoIcon hint="BonusLedger.whop_submission_id · the Whop submission id this row mirrors. Truncated. Idempotency key for the import endpoint." /></th>
                <th className="px-2 py-2">email<InfoIcon hint="BonusLedger.email · clipper email at import time. PII exposure — admin-only surface." /></th>
                <th className="px-2 py-2">membership<InfoIcon hint="BonusLedger.membership_status_at_export · free | solo | pro | agency at the moment of export. Snapshotted at import (does not auto-update)." /></th>
                <th className="px-2 py-2">watermark<InfoIcon hint="BonusLedger.export_watermark_status · true (watermark) → bonus $0. false (no watermark, paid user) → bonus eligible. Frozen at import." /></th>
                <th className="px-2 py-2">campaign<InfoIcon hint="BonusLedger.campaign_name or campaign_id · sponsored_campaigns row this submission is attached to." /></th>
                <th className="px-2 py-2">lane<InfoIcon hint="BonusLedger.mission_lane · training | main | proof. Defines payout tier within the campaign." /></th>
                <th className="px-2 py-2">post<InfoIcon hint="BonusLedger.submitted_post_url · the public clip URL on the destination network. Opens in new tab for view-count verification." /></th>
                <th className="px-2 py-2 text-right">views<InfoIcon hint="BonusLedger.approved_views · view count Whop signed off on. Updated when admin marks-paid with a fresh final count." /></th>
                <th className="px-2 py-2 text-right">base<InfoIcon hint="BonusLedger.base_payout_cents · approved_views × base_rpm. Whop pays this; Liquid Clips does not." /></th>
                <th className="px-2 py-2 text-right">bonus due<InfoIcon hint="BonusLedger.premium_bonus_due_cents · the +$4 RPM bonus Liquid Clips owes the clipper (only when paid + no watermark)." /></th>
                <th className="px-2 py-2 text-right">total eff.<InfoIcon hint="BonusLedger.total_effective_payout_cents · base + bonus. The clipper's true take if the bonus lands." /></th>
                <th className="px-2 py-2 text-right">refs<InfoIcon hint="BonusLedger.affiliate_referrals · count of users who signed up via this clipper's affiliate link. Drives reward eligibility on the flywheel." /></th>
                <th className="px-2 py-2">status<InfoIcon hint="BonusLedger.bonus_payout_status · pending | paid | waived. 'paid' freezes the row + records the timestamp." /></th>
                <th className="px-2 py-2"> <InfoIcon hint="Mark-paid action · POST /admin/bonus-ledger/{id}/mark-paid with final approved_views. Confirms the bonus was sent and stores bonus_marked_paid_at." /></th>
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
                        className="rounded-full bg-fuchsia px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:bg-fuchsia-bright disabled:opacity-60"
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

  function field(name: keyof typeof form, label: string, opts?: { placeholder?: string; type?: string; hint?: string }) {
    return (
      <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
        <span>{label}{opts?.hint && <InfoIcon hint={opts.hint} />}</span>
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
        {field("whop_submission_id", "whop_submission_id *", { placeholder: "wsub_…", hint: "Whop submission id (wsub_…). Required + serves as idempotency key — re-importing returns the existing BonusLedger row." })}
        {field("whop_bounty_id", "whop_bounty_id", { placeholder: "wbnt_…", hint: "Whop bounty id (wbnt_…) the submission belongs to. Optional · used for cross-referencing in Whop dashboard." })}
        {field("whop_user_id", "whop_user_id", { placeholder: "wuser_…", hint: "Whop user id (wuser_…) of the clipper. Backend joins this to users.whop_user_id to resolve liquid_clips_user_id." })}
        {field("email", "email", { placeholder: "clipper@example.com", hint: "Clipper email (PII). Used for display + as fallback identifier if whop_user_id doesn't join." })}
        {field("campaign_id", "campaign_id or slug", { placeholder: "clip-uncle-daniel-content", hint: "sponsored_campaigns.id or .slug. Backend resolves slug → id at import." })}
        {field("mission_lane", "mission_lane", { placeholder: "training | main | proof", hint: "BonusLedger.mission_lane label. Echoed onto the row + used by the lane filter above." })}
        {field("submitted_post_url", "submitted_post_url *", { placeholder: "https://…", hint: "Public clip URL on the destination network (YT/IG/TT/X). Required." })}
        {field("approved_views", "approved_views", { type: "number", hint: "Whop-approved view count at import. Used for base + bonus computation; can be updated when marking-paid." })}
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          <span>membership_status_at_export<InfoIcon hint="Membership tier at the moment of export · free | solo | pro | agency. Snapshotted into BonusLedger.membership_status_at_export — bonus only eligible for paid tiers." /></span>
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
          <span>export_watermark_status<InfoIcon hint="Was the clip exported with the Liquid Clips watermark? Backend rule: watermark=true → bonus $0; watermark=false + paid tier → bonus due." /></span>
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
          className="rounded-full bg-fuchsia px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink hover:bg-fuchsia-bright disabled:opacity-60"
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
  const src = useDataSource();
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
      src.report("channels", "ok");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); // allow-raw-error — admin-internal debug surface
      src.report("channels", "fail");
    }
  }, [adminFetch, src]);

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
        <div className="flex items-center gap-2">
          <LiveBadge state={src.state} />
          <button
            type="button"
            onClick={reset}
            className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia hover:text-fuchsia"
          >
            {editingSlug ? "Cancel edit" : "New channel"}
          </button>
        </div>
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
                <th className="px-2 py-2">section<InfoIcon hint="community_channels.section · announcements | free_lobby | paid_core | mission. Groups rooms in the community sidebar." /></th>
                <th className="px-2 py-2">slug · name<InfoIcon hint="community_channels.slug (immutable id) + .name (display label). Slug is the URL segment + Whop sync key." /></th>
                <th className="px-2 py-2">tier<InfoIcon hint="community_channels.required_tier · free | free_paid | paid | paid_admin. Controls who can read/post." /></th>
                <th className="px-2 py-2">whop_channel_id<InfoIcon hint="community_channels.whop_channel_id · chat_feed_… id from Whop. When set, room routes directly to Whop chat; when null, paid users see the community landing." /></th>
                <th className="px-2 py-2">business · lane<InfoIcon hint="community_channels.business_unit + .mission_lane · routes the room to a specific funnel (e.g. uncle_daniel · training)." /></th>
                <th className="px-2 py-2 text-right">sort<InfoIcon hint="community_channels.sort_order · ascending. Determines order within the section." /></th>
                <th className="px-2 py-2"> <InfoIcon hint="Edit = PATCH /admin/community/channels/{slug} · Delete = DELETE same endpoint. Slug is immutable on edit." /></th>
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
  function text(name: keyof ChannelDraft, label: string, opts?: { placeholder?: string; hint?: string }) {
    return (
      <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
        <span>{label}{opts?.hint && <InfoIcon hint={opts.hint} />}</span>
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

  function bool(name: keyof ChannelDraft, label: string, hint?: string) {
    return (
      <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
        <input
          type="checkbox"
          checked={!!draft[name]}
          onChange={(e) => setDraft((d) => ({ ...d, [name]: e.target.checked }))}
        />
        {label}
        {hint && <InfoIcon hint={hint} />}
      </label>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-paper p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia">
        {editingSlug ? `editing ${editingSlug}` : "new channel"}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
        {text("slug", "slug *", { placeholder: "premium-rewards-hq", hint: "community_channels.slug · immutable URL/sync key. Lowercase, hyphenated. Required + cannot change after create." })}
        {text("name", "name *", { placeholder: "Premium Rewards HQ", hint: "community_channels.name · display label shown in the room list. Required." })}
        {text("whop_channel_id", "whop_channel_id", { placeholder: "chat_feed_…", hint: "community_channels.whop_channel_id · paste the chat_feed_XXX from Whop. When set, room routes paid users into Whop chat directly." })}
        {text("business_unit", "business_unit", { placeholder: "uncle_daniel", hint: "community_channels.business_unit · funnel grouping (uncle_daniel | viral_reaction | software_proof | ddb | etc)." })}
        {text("mission_lane", "mission_lane", { placeholder: "training", hint: "community_channels.mission_lane · training | main | proof. Pairs with business_unit for per-mission rooms." })}
        {text("sort_order", "sort_order", { hint: "community_channels.sort_order · integer, ascending. Controls position within section." })}
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          <span>required_tier<InfoIcon hint="community_channels.required_tier · free | free_paid | paid | paid_admin. Determines read+post permission per user.tier." /></span>
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
          <span>section<InfoIcon hint="community_channels.section · announcements (top) | free_lobby | paid_core | mission (funnel rooms). Visual grouping." /></span>
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
          <span>purpose<InfoIcon hint="community_channels.purpose · short prose shown as a room subtitle. Optional but recommended for free_lobby + mission rooms." /></span>
          <textarea
            value={draft.purpose}
            onChange={(e) => setDraft((d) => ({ ...d, purpose: e.target.value }))}
            rows={2}
            className="rounded-md border border-line bg-paper px-2 py-1 font-sans text-[12px] normal-case tracking-normal text-ink"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {bool("is_admin_only", "admin-only posts", "community_channels.is_admin_only · when true, only admins can post — users can read.")}
        {bool("is_locked_preview_enabled", "show locked preview to free users", "community_channels.is_locked_preview_enabled · when true, free users see a teaser of the room (read but no post).")}
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="ml-auto rounded-full bg-fuchsia px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink hover:bg-fuchsia-bright disabled:opacity-60"
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
  const src = useDataSource();
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
      src.report("campaigns", "ok");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); // allow-raw-error — admin-internal debug surface
      src.report("campaigns", "fail");
    }
  }, [adminFetch, src]);

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
        <div className="flex items-center gap-2">
          <LiveBadge state={src.state} />
          <button
            type="button"
            onClick={reset}
            className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia hover:text-fuchsia"
          >
            {editingSlug ? "Cancel edit" : "New mission"}
          </button>
        </div>
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
                <th className="px-2 py-2">status<InfoIcon hint="sponsored_campaigns.status · draft | coming_soon | partially_funded | funded | live | closed. Public mission feed shows everything except 'closed'." /></th>
                <th className="px-2 py-2">slug · name<InfoIcon hint="sponsored_campaigns.slug (URL/sync key, immutable on edit) + .name (display label)." /></th>
                <th className="px-2 py-2">lane<InfoIcon hint="sponsored_campaigns.mission_lane ?? mission_type. Defines payout cohort within the mission." /></th>
                <th className="px-2 py-2 text-right">base $RPM<InfoIcon hint="sponsored_campaigns.base_rpm_cents / 100 · $/1000 views Whop pays everyone." /></th>
                <th className="px-2 py-2 text-right">premium $RPM<InfoIcon hint="sponsored_campaigns.premium_rpm_cents / 100 · $/1000 views Liquid Clips tops up for paid clippers (paid + no-watermark only)." /></th>
                <th className="px-2 py-2 text-right">budget<InfoIcon hint="sponsored_campaigns.budget_cents / 100 · total $ pool for this mission. Whop enforces drawdown." /></th>
                <th className="px-2 py-2">whop_bounty_id<InfoIcon hint="sponsored_campaigns.whop_campaign_id · Whop content reward id bound to this mission. Required for funnel to work end-to-end." /></th>
                <th className="px-2 py-2"> <InfoIcon hint="Edit = PATCH /admin/campaigns/{slug} · Delete = DELETE same endpoint. Slug immutable on edit." /></th>
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
  function text(name: string, label: string, opts?: { placeholder?: string; hint?: string }) {
    return (
      <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
        <span>{label}{opts?.hint && <InfoIcon hint={opts.hint} />}</span>
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

  function bool(name: string, label: string, hint?: string) {
    return (
      <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
        <input type="checkbox" checked={!!draft[name]} onChange={(e) => setDraft((d) => ({ ...d, [name]: e.target.checked }))} />
        {label}
        {hint && <InfoIcon hint={hint} />}
      </label>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-paper p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia">
        {editingSlug ? `editing ${editingSlug}` : "new mission"}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {text("slug", "slug *", { hint: "sponsored_campaigns.slug · immutable URL/sync key. Required, hyphenated, lowercase." })}
        {text("name", "name *", { hint: "sponsored_campaigns.name · display label across Earn, Whop bounty card, and admin." })}
        {text("brand", "brand label", { hint: "sponsored_campaigns.brand · short brand tag (e.g. 'DDB'). Used in lists + filters." })}
        {text("brand_name", "brand_name", { hint: "sponsored_campaigns.brand_name · full brand display name (e.g. 'Daniel Diyepriye Beauty')." })}
        {text("business_unit", "business_unit", { hint: "sponsored_campaigns.business_unit · funnel grouping (uncle_daniel, viral_reaction, ddb, etc)." })}
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          <span>mission_type<InfoIcon hint="sponsored_campaigns.mission_type · uncle_daniel | viral_reaction | software_proof. Drives card style + payout cohort." /></span>
          <select value={String(draft.mission_type)} onChange={(e) => setDraft((d) => ({ ...d, mission_type: e.target.value }))} className="rounded-md border border-line bg-paper px-2 py-1 font-sans text-[12px] normal-case tracking-normal text-ink">
            <option value="uncle_daniel">uncle_daniel</option>
            <option value="viral_reaction">viral_reaction</option>
            <option value="software_proof">software_proof</option>
          </select>
        </label>
        {text("mission_lane", "mission_lane", { hint: "sponsored_campaigns.mission_lane · training | main | proof. Pairs with mission_type for per-lane payout." })}
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          <span>status<InfoIcon hint="sponsored_campaigns.status · controls public visibility. live = surfaced + earning; closed = hidden from public feed." /></span>
          <select value={String(draft.status)} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))} className="rounded-md border border-line bg-paper px-2 py-1 font-sans text-[12px] normal-case tracking-normal text-ink">
            <option value="coming_soon">coming_soon</option>
            <option value="partially_funded">partially_funded</option>
            <option value="funded">funded</option>
            <option value="live">live</option>
            <option value="closed">closed</option>
          </select>
        </label>
        {text("base_rpm_cents", "base_rpm (cents)", { hint: "sponsored_campaigns.base_rpm_cents · $/1000 views Whop pays everyone (base + bonus is the LC top-up)." })}
        {text("premium_rpm_cents", "premium_rpm (cents)", { hint: "sponsored_campaigns.premium_rpm_cents · target $/1000 for paid no-watermark clippers (base + bonus)." })}
        {text("premium_bonus_cents", "bonus_rpm (cents)", { hint: "sponsored_campaigns.premium_bonus_cents · the +$ on top of base for paid no-watermark clippers. Drives BonusLedger calc." })}
        {text("budget_cents", "budget (cents)", { hint: "sponsored_campaigns.budget_cents · total mission $ pool. Whop enforces drawdown." })}
        {text("required_tier", "required_tier", { hint: "sponsored_campaigns.required_tier · free | solo | pro | agency. Locks who can submit." })}
        {text("whop_url", "whop_url *", { hint: "sponsored_campaigns.whop_url · public Whop product/bounty link. Required + opened from Earn cards." })}
        {text("whop_campaign_id", "whop_campaign_id", { hint: "sponsored_campaigns.whop_campaign_id · Whop content reward id (wcamp_…) bound to this mission." })}
        {text("whop_campaign_url", "whop_campaign_url", { hint: "sponsored_campaigns.whop_campaign_url · operator-facing Whop dashboard link for this campaign." })}
        {text("community_channel_id", "community_channel_id", { hint: "sponsored_campaigns.community_channel_id · UUID of the community_channels row that hosts this mission's discussion." })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {bool("is_high_rpm", "high RPM", "sponsored_campaigns.is_high_rpm · flag for the high-payout badge on Earn cards.")}
        {bool("is_invite_only", "invite only", "sponsored_campaigns.is_invite_only · hides the mission from the public feed; only invited clippers see it.")}
        {bool("affiliate_enabled", "affiliate enabled", "sponsored_campaigns.affiliate_enabled · when true, referrals from this mission count toward the flywheel reward.")}
        <button onClick={() => void save()} disabled={busy} className="ml-auto rounded-full bg-fuchsia px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink hover:bg-fuchsia-bright disabled:opacity-60">
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
  const src = useDataSource();
  const [rows, setRows] = useState<AdminBanner[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const j = (await adminFetch("banners")) as { banners: AdminBanner[] };
      setRows(j.banners);
      src.report("banners", "ok");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); // allow-raw-error — admin-internal debug surface
      src.report("banners", "fail");
    }
  }, [adminFetch, src]);

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
        <div className="flex items-center gap-2">
          <LiveBadge state={src.state} />
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia hover:text-fuchsia"
          >
            {showForm ? "Close form" : "New banner"}
          </button>
        </div>
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
                <th className="px-2 py-2">placement<InfoIcon hint="banners.placement · earn_hero | mission_card | mission_detail | upgrade_modal | community_top | home_hero | checkout_modal." /></th>
                <th className="px-2 py-2">title<InfoIcon hint="banners.title · primary headline shown in the placement." /></th>
                <th className="px-2 py-2">target<InfoIcon hint="banners.target_tier + .target_mission_id · narrows which users see this. Empty/everyone = all users." /></th>
                <th className="px-2 py-2 text-right">priority<InfoIcon hint="banners.priority · higher number = wins when multiple banners qualify for the same placement." /></th>
                <th className="px-2 py-2">cta<InfoIcon hint="banners.cta_text + .cta_url · optional click-through. Null = display-only banner." /></th>
                <th className="px-2 py-2">active<InfoIcon hint="banners.is_active · controls live visibility. Pause = is_active=false; row preserved." /></th>
                <th className="px-2 py-2"> <InfoIcon hint="Pause/Resume = PATCH /admin/banners/{id} {is_active}. Delete = DELETE /admin/banners/{id}." /></th>
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
        <Field label="title *" value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} hint="banners.title · primary headline. Required." />
        <Field label="subtitle" value={draft.subtitle} onChange={(v) => setDraft({ ...draft, subtitle: v })} hint="banners.subtitle · optional secondary line under the headline." />
        <Field label="image_url" value={draft.image_url} onChange={(v) => setDraft({ ...draft, image_url: v })} hint="banners.image_url · ABSOLUTE URL to brand asset. Prefer /public/brand/ from the marketing site over external CDNs." />
        <Field label="cta_text" value={draft.cta_text} onChange={(v) => setDraft({ ...draft, cta_text: v })} hint="banners.cta_text · button label. Empty + cta_url = display-only banner." />
        <Field label="cta_url" value={draft.cta_url} onChange={(v) => setDraft({ ...draft, cta_url: v })} hint="banners.cta_url · click-through destination. Internal route or absolute URL." />
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          <span>placement<InfoIcon hint="banners.placement · where this banner renders in the app. One placement per row; multiple banners per placement compete on priority." /></span>
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
          <span>target_tier<InfoIcon hint="banners.target_tier · narrow visibility to free or paid. Empty = everyone." /></span>
          <select value={draft.target_tier} onChange={(e) => setDraft({ ...draft, target_tier: e.target.value })} className="rounded-md border border-line bg-paper px-2 py-1 font-sans text-[12px] normal-case tracking-normal text-ink">
            <option value="">everyone</option>
            <option value="free">free</option>
            <option value="paid">paid</option>
          </select>
        </label>
        <Field label="target_mission_id" value={draft.target_mission_id} onChange={(v) => setDraft({ ...draft, target_mission_id: v })} hint="banners.target_mission_id · sponsored_campaigns.id this banner is bound to. Empty = not mission-scoped." />
        <Field label="priority" value={draft.priority} onChange={(v) => setDraft({ ...draft, priority: v })} hint="banners.priority · integer, higher wins. Tie-breaker for multiple active banners in the same placement." />
      </div>
      {error && <p className="mt-3 rounded-md border border-[#DC2626]/40 bg-[#DC2626]/5 px-3 py-2 font-mono text-[11px] text-[#F87171]">{error}</p>}
      <div className="mt-3 flex items-center">
        <button onClick={() => void save()} disabled={busy} className="ml-auto rounded-full bg-fuchsia px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink hover:bg-fuchsia-bright disabled:opacity-60">{busy ? "Saving…" : "Create banner"}</button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
      <span>{label}{hint && <InfoIcon hint={hint} />}</span>
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
  const src = useDataSource();
  const [rows, setRows] = useState<AdminAnnouncement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const j = (await adminFetch("announcements")) as { announcements: AdminAnnouncement[] };
      setRows(j.announcements);
      src.report("announcements", "ok");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); // allow-raw-error — admin-internal debug surface
      src.report("announcements", "fail");
    }
  }, [adminFetch, src]);

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
        <div className="flex items-center gap-2">
          <LiveBadge state={src.state} />
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia hover:text-fuchsia"
          >
            {showForm ? "Close form" : "New post"}
          </button>
        </div>
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
                  <InfoIcon hint="announcements.kind · mission_drop | payout | rule_change | deadline | other. Tags the card icon + priority." />
                  {a.pinned && <Chip label="pinned" />}
                  {a.pinned && <InfoIcon hint="announcements.pinned = true · surfaces first in the Announcements room + on dashboard first paint." />}
                  {a.target_tier && <span>· {a.target_tier}<InfoIcon hint="announcements.target_tier · narrows visibility (free | paid). Empty = everyone." /></span>}
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
        <Field label="title *" value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} hint="announcements.title · headline shown in the room + dashboard. Required." />
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          <span>kind<InfoIcon hint="announcements.kind · taxonomy chip · mission_drop | payout | rule_change | deadline | other." /></span>
          <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} className="rounded-md border border-line bg-paper px-2 py-1 font-sans text-[12px] normal-case tracking-normal text-ink">
            <option value="mission_drop">mission_drop</option>
            <option value="payout">payout</option>
            <option value="rule_change">rule_change</option>
            <option value="deadline">deadline</option>
            <option value="other">other</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          <span>target_tier<InfoIcon hint="announcements.target_tier · narrows audience to free or paid. Empty = everyone." /></span>
          <select value={draft.target_tier} onChange={(e) => setDraft({ ...draft, target_tier: e.target.value })} className="rounded-md border border-line bg-paper px-2 py-1 font-sans text-[12px] normal-case tracking-normal text-ink">
            <option value="">everyone</option>
            <option value="free">free</option>
            <option value="paid">paid</option>
          </select>
        </label>
        <Field label="cta_text" value={draft.cta_text} onChange={(v) => setDraft({ ...draft, cta_text: v })} hint="announcements.cta_text · optional click-through label." />
        <Field label="cta_url" value={draft.cta_url} onChange={(v) => setDraft({ ...draft, cta_url: v })} hint="announcements.cta_url · click destination. Internal route or absolute URL." />
        <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
          <input type="checkbox" checked={draft.pinned} onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })} />
          pin to top
          <InfoIcon hint="announcements.pinned · pinned rows surface first in the Announcements room + on dashboard first paint." />
        </label>
        <label className="col-span-2 flex flex-col gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary md:col-span-3">
          <span>body (markdown)<InfoIcon hint="announcements.body_markdown · rendered as markdown. Newlines + links supported." /></span>
          <textarea value={draft.body_markdown} onChange={(e) => setDraft({ ...draft, body_markdown: e.target.value })} rows={4} className="rounded-md border border-line bg-paper px-2 py-1 font-sans text-[12px] normal-case tracking-normal text-ink" />
        </label>
      </div>
      {error && <p className="mt-3 rounded-md border border-[#DC2626]/40 bg-[#DC2626]/5 px-3 py-2 font-mono text-[11px] text-[#F87171]">{error}</p>}
      <div className="mt-3 flex items-center">
        <button onClick={() => void save()} disabled={busy} className="ml-auto rounded-full bg-fuchsia px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink hover:bg-fuchsia-bright disabled:opacity-60">{busy ? "Saving…" : "Publish"}</button>
      </div>
    </div>
  );
}

// =====================================================================
// Bug Command Centre — MRR protection dashboard (live)
// =====================================================================
// 2026-06-24 HQ Demo-Data Wipe: the hardcoded MOCK_BUGS / AGENT_REPORTS
// arrays and per-lane demo statuses were removed. Bug intake now fetches
// /api/admin/bug-intake; the lane table renders configuration only (the
// allowed/forbidden files + Iron Gate section per lane), not invented
// statuses. Lane *status* is unavailable until a real lane-state table
// ships — shown as "—" rather than a fake "fixing" label.
//
// Security rules:
//   - API keys are boolean flags passed from the server component. The real
//     values live in env vars and never reach the browser.
//   - The UI only ever shows "Configured" / "Missing".
//   - No secrets, tokens, or full customer PII are rendered here.

type BugStatus =
  | "new"
  | "assigned"
  | "fixing"
  | "ready for review"
  | "passed"
  | "failed"
  | "parked";

type BugSeverity =
  | "P0 — stops payment"
  | "P0 — stops paid access"
  | "P0 — stops first action"
  | "P1 — trust loss"
  | "P1 — retention blocker"
  | "P2 — polish";

type Bug = {
  id: string;
  title: string;
  description: string;
  source: string;
  section: string;
  severity: BugSeverity;
  appVersion: string;
  status: BugStatus;
  lane: LaneKey;
  assignedAgent: string;
  latestAgentReport: string;
  danielApprovalRequired: boolean;
};

type LaneKey =
  | "auth"
  | "projects"
  | "earn"
  | "onboarding"
  | "ui"
  | "backend"
  | "release";

type AgentLane = {
  key: LaneKey;
  name: string;
  owner: string;
  ironGateSection: string;
  allowedFiles: string;
  forbiddenFiles: string;
  apiKeyFlag: keyof AgentKeyConfig;
};

// Lane registry — pure configuration (which files an agent owns, which
// API key it uses). No status field — status comes from live bug counts
// or shows "—" when no intake table exists.
const LANES: AgentLane[] = [
  {
    key: "auth",
    name: "Auth / Account / Upgrade",
    owner: "Auth Agent",
    ironGateSection: "Section A — Auth / Account / Upgrade",
    allowedFiles: "activation.ts, useTier.ts, Whop checkout routes",
    forbiddenFiles: "FirstRun, Projects Manager, Earn Workflow",
    apiKeyFlag: "auth",
  },
  {
    key: "projects",
    name: "Projects Manager",
    owner: "Projects Agent",
    ironGateSection: "Section B — Projects Manager",
    allowedFiles: "Project views, project.json logic, asset grid",
    forbiddenFiles: "Earn workflow, auth/tier gating, Library core",
    apiKeyFlag: "projects",
  },
  {
    key: "earn",
    name: "Earn Workflow",
    owner: "Earn Agent",
    ironGateSection: "Section C — Earn Workflow",
    allowedFiles: "Earn panels, bounty cards, SUB/PAY tabs",
    forbiddenFiles: "Whop API routes, payout ledger mutations",
    apiKeyFlag: "earn",
  },
  {
    key: "onboarding",
    name: "Upgrade + Self-Onboarding",
    owner: "Onboarding Agent",
    ironGateSection: "Section A / D — Upgrade + UI Polish",
    allowedFiles: "Upgrade page, WhopCheckoutEmbed, onboarding copy",
    forbiddenFiles: "Backend Whop routes, license minting logic",
    apiKeyFlag: "codex",
  },
  {
    key: "ui",
    name: "UI Polish",
    owner: "UI Agent",
    ironGateSection: "Section D — Earn + Projects UI Polish",
    allowedFiles: "Tailwind tokens, card/button components, empty states",
    forbiddenFiles: "Data flow hooks, backend routes, sidecar",
    apiKeyFlag: "codex",
  },
  {
    key: "backend",
    name: "Backend",
    owner: "Backend Agent",
    ironGateSection: "Architecture / backend health gates",
    allowedFiles: "Admin routes, feature flags, telemetry ingest",
    forbiddenFiles: "Desktop customer flows, Railway deploy config",
    apiKeyFlag: "hqInternal",
  },
  {
    key: "release",
    name: "Release / QA",
    owner: "Release Agent",
    ironGateSection: "Global Iron Gate / launch health",
    allowedFiles: "local-install.sh, test:invariant, health checks",
    forbiddenFiles: "latest.json, release tags, customer flows",
    apiKeyFlag: "hqInternal",
  },
];

// Bug + AgentReport response shapes from /admin/bug-intake + /admin/agent-reports.
type BugIntakeResponse = { rows: Bug[]; note?: string };
type AgentReport = { lane: LaneKey; at: string; summary: string };
type AgentReportsResponse = { rows: AgentReport[]; note?: string };

function severityTone(severity: BugSeverity): ChipTone {
  if (severity.startsWith("P0")) return "fail";
  if (severity.startsWith("P1")) return "pending";
  return "gray";
}

function isActiveBug(status: BugStatus): boolean {
  return status !== "passed" && status !== "parked";
}

function isBlockingPayment(severity: BugSeverity): boolean {
  return severity === "P0 — stops payment" || severity === "P0 — stops paid access";
}

function isBlockingActivation(severity: BugSeverity): boolean {
  return severity === "P0 — stops first action";
}

function isBlockingRetention(severity: BugSeverity): boolean {
  return severity === "P1 — retention blocker";
}

function laneCounts(bugs: Bug[], laneKey: LaneKey) {
  const ofLane = bugs.filter((b) => b.lane === laneKey);
  const active = ofLane.filter((b) => isActiveBug(b.status));
  const p0 = ofLane.filter((b) => b.severity.startsWith("P0"));
  const p1 = ofLane.filter((b) => b.severity.startsWith("P1"));
  const p2 = ofLane.filter((b) => b.severity.startsWith("P2"));
  return { active, p0, p1, p2 };
}

function BugCommandTab({ agentKeyConfig }: { agentKeyConfig: AgentKeyConfig }) {
  const src = useDataSource();
  const fetchAdmin = useAdminFetch();
  const [filterLane, setFilterLane] = useState<LaneKey | "all">("all");
  const [filterStatus, setFilterStatus] = useState<BugStatus | "all">("all");
  const [bugs, setBugs] = useState<Bug[]>([]);
  const [bugsNote, setBugsNote] = useState<string | null>(null);
  const [reports, setReports] = useState<AgentReport[]>([]);
  const [reportsNote, setReportsNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [intake, agentReports] = await Promise.allSettled([
      fetchAdmin("bug-intake") as Promise<unknown> as Promise<BugIntakeResponse>,
      fetchAdmin("agent-reports") as Promise<unknown> as Promise<AgentReportsResponse>,
    ]);
    if (intake.status === "fulfilled") {
      setBugs(intake.value.rows ?? []);
      setBugsNote(intake.value.note ?? null);
      src.report("bug-intake", "ok");
    } else {
      setError(String(intake.reason));
      src.report("bug-intake", "fail");
    }
    if (agentReports.status === "fulfilled") {
      setReports(agentReports.value.rows ?? []);
      setReportsNote(agentReports.value.note ?? null);
      src.report("agent-reports", "ok");
    } else {
      src.report("agent-reports", "fail");
    }
  }, [fetchAdmin, src]);

  useEffect(() => {
    void load();
  }, [load]);

  const openP0 = bugs.filter((b) => b.severity.startsWith("P0") && isActiveBug(b.status));
  const blockingPayment = bugs.filter((b) => isBlockingPayment(b.severity) && isActiveBug(b.status));
  const blockingActivation = bugs.filter((b) => isBlockingActivation(b.severity) && isActiveBug(b.status));
  const blockingRetention = bugs.filter((b) => isBlockingRetention(b.severity) && isActiveBug(b.status));

  const filteredBugs = bugs.filter((b) => {
    if (filterLane !== "all" && b.lane !== filterLane) return false;
    if (filterStatus !== "all" && b.status !== filterStatus) return false;
    return true;
  });

  return (
    <Panel
      title="bug command centre · MRR protection (live)"
      sub="Tracks only bugs that block install, activation, payment, retention, or trust. Lane config below is constant; per-lane status comes from live bug counts."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <LiveBadge state={src.state} />
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">lanes</span>
          <Chip label={`${LANES.length}`} tone="gray" />
          <InfoIcon hint="Total agent lanes configured · const LANES at the top of the BugCommandTab. Lane count is static; status is computed from live bug counts." />
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">open bugs</span>
          <Chip label={`${bugs.filter((b) => isActiveBug(b.status)).length}`} tone="gray" />
          <InfoIcon hint="Bugs from /admin/bug-intake where status not in (passed, parked). Live count — refreshes on Refresh." />
          <button onClick={() => void load()} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia">refresh</button>
        </div>
      }
    >
      <ErrorNote error={error} />
      {/* Cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-2xl border border-line bg-paper p-4">
          <div className="font-display text-[34px] font-bold tracking-[-0.03em] text-ink">{openP0.length}</div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
            Open P0 bugs
            <InfoIcon hint="Bugs from /admin/bug-intake where severity starts with 'P0' AND status not in (passed, parked). Top priority — these block ship." />
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-paper p-4">
          <div className="font-display text-[34px] font-bold tracking-[-0.03em] text-ink">{blockingPayment.length}</div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
            Blocking payment
            <InfoIcon hint="Open bugs with severity = 'P0 — stops payment' OR 'P0 — stops paid access'. These cost MRR directly." />
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-paper p-4">
          <div className="font-display text-[34px] font-bold tracking-[-0.03em] text-ink">{blockingActivation.length}</div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
            Blocking activation
            <InfoIcon hint="Open bugs with severity = 'P0 — stops first action'. New users can't reach their first success — early churn driver." />
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-paper p-4">
          <div className="font-display text-[34px] font-bold tracking-[-0.03em] text-ink">{blockingRetention.length}</div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
            Blocking retention
            <InfoIcon hint="Open bugs with severity = 'P1 — retention blocker'. Returning users hit something that erodes habit — silent churn driver." />
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-paper p-4">
          <div className="font-display text-[34px] font-bold tracking-[-0.03em] text-ink">{LANES.length}</div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">
            Total agent lanes
            <InfoIcon hint="Static count of agent lanes defined in the LANES const · auth, projects, earn, onboarding, ui, backend, release." />
          </div>
        </div>
      </div>

      {/* Agent lanes table — pure configuration, no demo statuses */}
      <div className="mb-6 overflow-x-auto">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          agent lanes (config + live counts)
          <InfoIcon hint="Static lane registry from const LANES · per-row counts come from /admin/bug-intake. Lane config (allowed/forbidden files) defines what an agent may touch." />
        </div>
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead>
            <tr className="text-left text-text-tertiary">
              {([
                ["lane", "LANE.name · the agent lane's display label (Auth, Projects, Earn, Onboarding, UI, Backend, Release)."],
                ["owner", "LANE.owner · the named agent persona responsible for this lane (e.g. Auth Agent, Projects Agent)."],
                ["P0", "Live count: bugs from /admin/bug-intake where severity starts 'P0' AND lane matches this row."],
                ["P1", "Live count: bugs where severity starts 'P1' AND lane matches this row."],
                ["P2", "Live count: bugs where severity starts 'P2' AND lane matches this row."],
                ["active", "Live count: bugs where status not in (passed, parked) AND lane matches this row."],
                ["API key", "Boolean flag passed from page.tsx server component · whether the env var for this lane's API key is set on Railway. Value never leaves the server."],
                ["Iron Gate section", "LANE.ironGateSection · which IG sentinel section locks this lane's territory (docs/IRON_GATES.md)."],
                ["allowed files", "LANE.allowedFiles · which files/areas this agent may edit. Touching outside = lane violation."],
                ["forbidden files", "LANE.forbiddenFiles · which files this agent must NOT touch. Hard-fail at review."],
              ] as Array<[string, string]>).map(([h, hint]) => (
                <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">
                  {h}
                  <InfoIcon hint={hint} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LANES.map((lane) => {
              const counts = laneCounts(bugs, lane.key);
              return (
                <tr key={lane.key} className="border-b border-line/40">
                  <td className="px-2 py-2 text-ink">{lane.name}</td>
                  <td className="px-2 py-2 text-text-secondary">{lane.owner}</td>
                  <td className="px-2 py-2 text-text-secondary">{counts.p0.length}</td>
                  <td className="px-2 py-2 text-text-secondary">{counts.p1.length}</td>
                  <td className="px-2 py-2 text-text-secondary">{counts.p2.length}</td>
                  <td className="px-2 py-2 text-text-secondary">{counts.active.length}</td>
                  <td className="px-2 py-2">
                    <BoolChip value={agentKeyConfig[lane.apiKeyFlag]} on="configured" off="missing" />
                  </td>
                  <td className="px-2 py-2 text-text-tertiary">{lane.ironGateSection}</td>
                  <td className="max-w-[180px] px-2 py-2 text-text-secondary" title={lane.allowedFiles}>{lane.allowedFiles}</td>
                  <td className="max-w-[180px] px-2 py-2 text-fuchsia-deep" title={lane.forbiddenFiles}>{lane.forbiddenFiles}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Recent agent reports (live) */}
      <div className="mb-6 rounded-2xl border border-line bg-paper p-4">
        <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          recent agent reports
          <InfoIcon hint="Live agent_reports rows from /admin/agent-reports · most recent operator + agent reports written into the table. Empty until an agent ships a report." />
        </div>
        {reports.length === 0 ? (
          <div className="font-mono text-[11px] text-text-tertiary">{reportsNote ?? "No agent reports yet."}</div>
        ) : (
          <ul className="space-y-2">
            {reports.map((r, i) => {
              const lane = LANES.find((l) => l.key === r.lane);
              return (
                <li key={i} className="flex flex-wrap items-baseline gap-2 font-mono text-[11px]">
                  <span className="text-text-tertiary">{r.at.slice(0, 16).replace("T", " ")}</span>
                  <Chip label={lane?.owner ?? r.lane} tone="gray" />
                  <span className="text-ink">{r.summary}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Bug intake table (live) */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
            bug intake
            <InfoIcon hint="Live rows from /admin/bug-intake · operator-tracked bugs (NOT raw telemetry). Each row is hand-triaged + assigned to a lane + severity." />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
              lane
              <select
                value={filterLane}
                onChange={(e) => setFilterLane(e.target.value as LaneKey | "all")}
                className="rounded border border-line bg-paper px-2 py-1 text-[11px] text-ink"
              >
                <option value="all">all</option>
                {LANES.map((l) => (
                  <option key={l.key} value={l.key}>{l.name}</option>
                ))}
              </select>
              <InfoIcon hint="Filter on bug-intake.lane · narrows to one agent lane's queue." />
            </label>
            <label className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-tertiary">
              status
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as BugStatus | "all")}
                className="rounded border border-line bg-paper px-2 py-1 text-[11px] text-ink"
              >
                <option value="all">all</option>
                {["new", "assigned", "fixing", "ready for review", "passed", "failed", "parked"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <InfoIcon hint="Filter on bug-intake.status · new → assigned → fixing → ready for review → passed/failed/parked." />
            </label>
          </div>
        </div>

        {bugs.length === 0 ? (
          <div className="rounded-2xl border border-line border-dashed bg-paper p-5 text-center font-mono text-[11px] text-text-tertiary">
            {bugsNote ?? "No bug intake rows yet."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse font-mono text-[11px]">
              <thead>
                <tr className="text-left text-text-tertiary">
                  {([
                    ["id", "bug-intake.id · stable bug identifier (BUG-NNN). Used in commit messages + agent reports."],
                    ["title", "bug-intake.title · short headline + description shown beneath."],
                    ["section", "bug-intake.section · subsystem the bug lives in (e.g. Auth, Earn, Sidecar)."],
                    ["severity", "bug-intake.severity · P0 (stops X) / P1 (trust loss / retention) / P2 (polish). Drives KPI cards above."],
                    ["status", "bug-intake.status · workflow state · new → assigned → fixing → ready for review → passed/failed/parked."],
                    ["lane", "bug-intake.lane · which agent lane owns this bug (from the LANES const)."],
                    ["source", "bug-intake.source · how the bug surfaced (Daniel, automation, customer, telemetry)."],
                    ["version", "bug-intake.appVersion · desktop build the bug was first reported against."],
                    ["daniel approval", "bug-intake.danielApprovalRequired · true = Daniel must sign off on the fix before merge (P0 + visible UX)."],
                    ["report", "bug-intake.latestAgentReport · most recent agent report string. Hover for full text (truncated to 260px)."],
                  ] as Array<[string, string]>).map(([h, hint]) => (
                    <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">
                      {h}
                      <InfoIcon hint={hint} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredBugs.map((b) => (
                  <tr key={b.id} className="border-b border-line/40 align-top hover:bg-paper-warm/60">
                    <td className="px-2 py-2 text-text-tertiary">{b.id}</td>
                    <td className="px-2 py-2 text-ink">
                      <div className="max-w-[220px]">
                        <div className="font-display text-[13px] font-semibold">{b.title}</div>
                        <div className="mt-0.5 text-text-secondary">{b.description}</div>
                      </div>
                    </td>
                    <td className="px-2 py-2"><Chip label={b.section} tone="gray" /></td>
                    <td className="px-2 py-2"><Chip label={b.severity} tone={severityTone(b.severity)} /></td>
                    <td className="px-2 py-2"><Chip label={b.status} tone={b.status === "passed" ? "ok" : b.status === "failed" ? "fail" : "pending"} /></td>
                    <td className="px-2 py-2 text-text-secondary">{LANES.find((l) => l.key === b.lane)?.name ?? b.lane}</td>
                    <td className="px-2 py-2 text-text-secondary">{b.source}</td>
                    <td className="px-2 py-2 text-text-tertiary">{b.appVersion}</td>
                    <td className="px-2 py-2"><BoolChip value={b.danielApprovalRequired} /></td>
                    <td className="max-w-[260px] px-2 py-2 text-text-secondary" title={b.latestAgentReport}>{b.latestAgentReport}</td>
                  </tr>
                ))}
                {filteredBugs.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-2 py-4 font-mono text-[11px] text-text-tertiary">No bugs match the current filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Panel>
  );
}
