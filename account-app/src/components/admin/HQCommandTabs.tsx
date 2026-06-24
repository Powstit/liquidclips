"use client";

import { useState } from "react";

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

function NA() {
  return <span className="font-mono text-[11px] text-text-tertiary">not available</span>;
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

// =====================================================================
// Agent / service key configuration types (structurally compatible with
// the objects passed from admin/page.tsx and AdminHQ).
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
// Mock data — Employees
// =====================================================================

type EmployeeStatus = "active" | "invited" | "paused" | "removed";
type Employee = {
  id: string;
  name: string;
  email: string;
  role: string;
  lane: string;
  permission: string;
  status: EmployeeStatus;
  monthlyCost: number;
  hourlyRate: number | null;
  notes: string;
  startDate: string;
  lastActive: string | null;
  emergencyContact: boolean;
  canAccessHQ: boolean;
};

const EMPLOYEES: Employee[] = [
  {
    id: "EMP-001",
    name: "Daniel Diye-Priye",
    email: "daniel@liquidclips.app",
    role: "Founder / Solo Dev",
    lane: "All lanes",
    permission: "Owner",
    status: "active",
    monthlyCost: 0,
    hourlyRate: null,
    notes: "Decision maker. Approves all P0 fixes, releases, and costs.",
    startDate: "2024-01-01",
    lastActive: "2026-06-14T10:00:00Z",
    emergencyContact: true,
    canAccessHQ: true,
  },
  {
    id: "EMP-002",
    name: "Support Contractor A",
    email: "support-a@example.com",
    role: "Customer Support",
    lane: "Customers / Trust",
    permission: "Support",
    status: "active",
    monthlyCost: 150000,
    hourlyRate: 2500,
    notes: "Handles refund requests, account issues, activation troubleshooting.",
    startDate: "2026-03-01",
    lastActive: "2026-06-13T16:00:00Z",
    emergencyContact: false,
    canAccessHQ: false,
  },
  {
    id: "EMP-003",
    name: "Frontend Contractor B",
    email: "frontend-b@example.com",
    role: "UI / Design",
    lane: "UI Polish",
    permission: "Contributor",
    status: "invited",
    monthlyCost: 300000,
    hourlyRate: 5000,
    notes: "Will help polish Earn + Projects cards once scope is locked.",
    startDate: "2026-06-20",
    lastActive: null,
    emergencyContact: false,
    canAccessHQ: false,
  },
];

// =====================================================================
// Mock data — Agents
// =====================================================================

type AgentStatus = "idle" | "active" | "blocked" | "disabled";
type AgentProvider = "Kimi" | "Claude" | "OpenAI" | "Other";
type HQAgent = {
  id: string;
  name: string;
  provider: AgentProvider;
  lane: string;
  status: AgentStatus;
  apiKeyFlag: keyof AgentKeyConfig;
  monthlyBudget: number;
  usageCostThisMonth: number;
  lastTask: string;
  lastReport: string;
  allowedFiles: string;
  forbiddenFiles: string;
  ironGateSection: string;
  approvalRequired: boolean;
};

const AGENTS: HQAgent[] = [
  {
    id: "AGT-001",
    name: "Auth Agent",
    provider: "Kimi",
    lane: "Auth / Account / Upgrade",
    status: "active",
    apiKeyFlag: "auth",
    monthlyBudget: 50000,
    usageCostThisMonth: 32150,
    lastTask: "Fix Reactivate stale state in AvatarPanel + Settings",
    lastReport: "Stale sessionExpired branch isolated; patch in review.",
    allowedFiles: "activation.ts, useTier.ts, Whop checkout routes",
    forbiddenFiles: "FirstRun, Projects Manager, Earn Workflow",
    ironGateSection: "Section A — Auth / Account / Upgrade",
    approvalRequired: true,
  },
  {
    id: "AGT-002",
    name: "Projects Agent",
    provider: "Kimi",
    lane: "Projects Manager",
    status: "active",
    apiKeyFlag: "projects",
    monthlyBudget: 50000,
    usageCostThisMonth: 28400,
    lastTask: "Fix tier race on cold launch before Projects unlock",
    lastReport: "useTier initial state fix targets starter-pass race.",
    allowedFiles: "Project views, project.json logic, asset grid",
    forbiddenFiles: "Earn workflow, auth/tier gating, Library core",
    ironGateSection: "Section B — Projects Manager",
    approvalRequired: true,
  },
  {
    id: "AGT-003",
    name: "Earn Agent",
    provider: "Kimi",
    lane: "Earn Workflow",
    status: "active",
    apiKeyFlag: "earn",
    monthlyBudget: 50000,
    usageCostThisMonth: 19500,
    lastTask: "Deduplicate active Earn Projects for same bounty",
    lastReport: "Guard added to EarnPanelMount. Ready for hand-walk.",
    allowedFiles: "Earn panels, bounty cards, SUB/PAY tabs",
    forbiddenFiles: "Whop API routes, payout ledger mutations",
    ironGateSection: "Section C — Earn Workflow",
    approvalRequired: false,
  },
  {
    id: "AGT-004",
    name: "UI Agent",
    provider: "Kimi",
    lane: "UI Polish",
    status: "active",
    apiKeyFlag: "ui",
    monthlyBudget: 40000,
    usageCostThisMonth: 12200,
    lastTask: "Refactor Earn card hierarchy and empty states",
    lastReport: "Card refactor in progress. Empty states added.",
    allowedFiles: "Tailwind tokens, card/button components, empty states",
    forbiddenFiles: "Data flow hooks, backend routes, sidecar",
    ironGateSection: "Section D — Earn + Projects UI Polish",
    approvalRequired: false,
  },
  {
    id: "AGT-005",
    name: "Codex Agent",
    provider: "OpenAI",
    lane: "Upgrade + Self-Onboarding",
    status: "idle",
    apiKeyFlag: "codex",
    monthlyBudget: 30000,
    usageCostThisMonth: 8700,
    lastTask: "Review onboarding copy + checkout path",
    lastReport: "openUpgradeWhenSignedIn now routes to account-app checkout.",
    allowedFiles: "Upgrade page, WhopCheckoutEmbed, onboarding copy",
    forbiddenFiles: "Backend Whop routes, license minting logic",
    ironGateSection: "Section A / D — Upgrade + UI Polish",
    approvalRequired: true,
  },
  {
    id: "AGT-006",
    name: "Claude Agent",
    provider: "Claude",
    lane: "Backend / Release",
    status: "blocked",
    apiKeyFlag: "claude",
    monthlyBudget: 30000,
    usageCostThisMonth: 5400,
    lastTask: "Verify admin proxy PATCH body forwarding",
    lastReport: "All admin write paths verified. Waiting for Daniel approval.",
    allowedFiles: "Admin routes, feature flags, telemetry ingest",
    forbiddenFiles: "Desktop customer flows, Railway deploy config",
    ironGateSection: "Architecture / backend health gates",
    approvalRequired: true,
  },
];

// =====================================================================
// Mock data — APIs / Tools
// =====================================================================

type ServiceCategory = "AI" | "infra" | "auth" | "payments" | "email" | "analytics" | "video" | "hosting" | "storage" | "other";
type Criticality = "P0" | "P1" | "P2";
type CancelRisk = "keep" | "review" | "cancel";
type AppName = "desktop" | "account-app" | "backend" | "partner-app" | "HQ";

type ApiService = {
  id: string;
  name: string;
  category: ServiceCategory;
  owner: string;
  envVarName: string;
  serviceKey: keyof ServiceConfig;
  monthlyCost: number;
  usageBased: boolean;
  currentMonthSpend: number;
  renewalDate: string | null;
  criticality: Criticality;
  usedBy: AppName[];
  notes: string;
  cancelRisk: CancelRisk;
};

const SERVICES: ApiService[] = [
  {
    id: "SVC-001",
    name: "OpenAI",
    category: "AI",
    owner: "Codex Agent",
    envVarName: "OPENAI_API_KEY",
    serviceKey: "openai",
    monthlyCost: 30000,
    usageBased: true,
    currentMonthSpend: 18750,
    renewalDate: null,
    criticality: "P1",
    usedBy: ["HQ", "account-app"],
    notes: "Codex agent usage. Spikes during deep debug sessions.",
    cancelRisk: "keep",
  },
  {
    id: "SVC-002",
    name: "Kimi",
    category: "AI",
    owner: "Daniel",
    envVarName: "KIMI_API_KEY",
    serviceKey: "kimi",
    monthlyCost: 50000,
    usageBased: true,
    currentMonthSpend: 42300,
    renewalDate: null,
    criticality: "P0",
    usedBy: ["HQ", "account-app"],
    notes: "Primary agent workforce. Cost scales with active lanes.",
    cancelRisk: "keep",
  },
  {
    id: "SVC-003",
    name: "Claude",
    category: "AI",
    owner: "Claude Agent",
    envVarName: "CLAUDE_API_KEY",
    serviceKey: "claude",
    monthlyCost: 30000,
    usageBased: true,
    currentMonthSpend: 12100,
    renewalDate: null,
    criticality: "P1",
    usedBy: ["HQ"],
    notes: "Used for backend/release analysis and scope docs.",
    cancelRisk: "review",
  },
  {
    id: "SVC-004",
    name: "Whop",
    category: "payments",
    owner: "Daniel",
    envVarName: "WHOP_API_KEY",
    serviceKey: "whop",
    monthlyCost: 0,
    usageBased: false,
    currentMonthSpend: 0,
    renewalDate: null,
    criticality: "P0",
    usedBy: ["backend", "account-app"],
    notes: "Payment + membership source of truth. No key = no upgrades.",
    cancelRisk: "keep",
  },
  {
    id: "SVC-005",
    name: "Clerk",
    category: "auth",
    owner: "Daniel",
    envVarName: "CLERK_SECRET_KEY",
    serviceKey: "clerk",
    monthlyCost: 25000,
    usageBased: true,
    currentMonthSpend: 22000,
    renewalDate: null,
    criticality: "P0",
    usedBy: ["account-app", "backend"],
    notes: "Auth + billing. Costs rise with MAU.",
    cancelRisk: "keep",
  },
  {
    id: "SVC-006",
    name: "Stripe",
    category: "payments",
    owner: "Daniel",
    envVarName: "STRIPE_SECRET_KEY",
    serviceKey: "stripe",
    monthlyCost: 0,
    usageBased: true,
    currentMonthSpend: 0,
    renewalDate: null,
    criticality: "P0",
    usedBy: ["backend", "partner-app"],
    notes: "Affiliate + future billing rails. Currently low volume.",
    cancelRisk: "keep",
  },
  {
    id: "SVC-007",
    name: "Railway",
    category: "infra",
    owner: "Daniel",
    envVarName: "RAILWAY_TOKEN",
    serviceKey: "railway",
    monthlyCost: 45000,
    usageBased: true,
    currentMonthSpend: 43800,
    renewalDate: null,
    criticality: "P0",
    usedBy: ["backend"],
    notes: "Backend hosting + Postgres. Usage-based compute.",
    cancelRisk: "keep",
  },
  {
    id: "SVC-008",
    name: "Vercel",
    category: "hosting",
    owner: "Daniel",
    envVarName: "VERCEL_TOKEN",
    serviceKey: "vercel",
    monthlyCost: 20000,
    usageBased: false,
    currentMonthSpend: 20000,
    renewalDate: "2026-07-01",
    criticality: "P0",
    usedBy: ["account-app", "partner-app"],
    notes: "Marketing + account-app hosting.",
    cancelRisk: "keep",
  },
  {
    id: "SVC-009",
    name: "Supabase",
    category: "storage",
    owner: "Backend Agent",
    envVarName: "SUPABASE_SERVICE_ROLE_KEY",
    serviceKey: "supabase",
    monthlyCost: 0,
    usageBased: true,
    currentMonthSpend: 0,
    renewalDate: null,
    criticality: "P1",
    usedBy: ["backend"],
    notes: "Not actively used; evaluate after backend refactor.",
    cancelRisk: "review",
  },
  {
    id: "SVC-010",
    name: "Resend",
    category: "email",
    owner: "Backend Agent",
    envVarName: "RESEND_API_KEY",
    serviceKey: "resend",
    monthlyCost: 0,
    usageBased: true,
    currentMonthSpend: 0,
    renewalDate: null,
    criticality: "P1",
    usedBy: ["backend"],
    notes: "Transactional + admin alert email. Low volume currently.",
    cancelRisk: "keep",
  },
  {
    id: "SVC-011",
    name: "Ayrshare",
    category: "other",
    owner: "Backend Agent",
    envVarName: "AYRSHARE_API_KEY",
    serviceKey: "ayrshare",
    monthlyCost: 0,
    usageBased: false,
    currentMonthSpend: 0,
    renewalDate: null,
    criticality: "P2",
    usedBy: ["backend"],
    notes: "Social posting integration. Future feature.",
    cancelRisk: "cancel",
  },
  {
    id: "SVC-012",
    name: "Postiz",
    category: "other",
    owner: "Daniel",
    envVarName: "POSTIZ_API_KEY",
    serviceKey: "postiz",
    monthlyCost: 0,
    usageBased: false,
    currentMonthSpend: 0,
    renewalDate: null,
    criticality: "P1",
    usedBy: ["backend", "desktop"],
    notes: "Schedule + publish. Existing HQ Postiz tab already tracks health.",
    cancelRisk: "review",
  },
  {
    id: "SVC-013",
    name: "S3 / R2 Storage",
    category: "storage",
    owner: "Backend Agent",
    envVarName: "AWS_ACCESS_KEY_ID / R2_ACCESS_KEY_ID",
    serviceKey: "storage",
    monthlyCost: 5000,
    usageBased: true,
    currentMonthSpend: 2100,
    renewalDate: null,
    criticality: "P1",
    usedBy: ["backend"],
    notes: "Clip exports, thumbnails, marketing assets.",
    cancelRisk: "keep",
  },
  {
    id: "SVC-014",
    name: "Sentry",
    category: "analytics",
    owner: "Daniel",
    envVarName: "SENTRY_AUTH_TOKEN",
    serviceKey: "sentry",
    monthlyCost: 0,
    usageBased: true,
    currentMonthSpend: 0,
    renewalDate: null,
    criticality: "P1",
    usedBy: ["account-app"],
    notes: "Error telemetry. Source maps uploaded at build time.",
    cancelRisk: "keep",
  },
];

// =====================================================================
// Mock data — Iron Gates
// =====================================================================

type IronGateStatus = "not started" | "in progress" | "waiting hand-walk" | "passed" | "failed";
type IronGate = {
  id: string;
  section: string;
  status: IronGateStatus;
  owner: string;
  lastBuildVersion: string;
  lastInstalledVersion: string;
  handWalkPassed: boolean;
  blockerCount: number;
  commitAllowed: boolean;
  latestReportLink: string | null;
};

const IRON_GATES: IronGate[] = [
  {
    id: "IG-001",
    section: "Auth / Account / Upgrade",
    status: "waiting hand-walk",
    owner: "Auth Agent",
    lastBuildVersion: "0.7.55",
    lastInstalledVersion: "0.7.54",
    handWalkPassed: false,
    blockerCount: 2,
    commitAllowed: false,
    latestReportLink: "https://www.notion.so/iron-gate-auth",
  },
  {
    id: "IG-002",
    section: "Projects Manager",
    status: "in progress",
    owner: "Projects Agent",
    lastBuildVersion: "0.7.55",
    lastInstalledVersion: "0.7.54",
    handWalkPassed: false,
    blockerCount: 1,
    commitAllowed: false,
    latestReportLink: "https://www.notion.so/iron-gate-projects",
  },
  {
    id: "IG-003",
    section: "Earn Workflow",
    status: "in progress",
    owner: "Earn Agent",
    lastBuildVersion: "0.7.55",
    lastInstalledVersion: "0.7.54",
    handWalkPassed: false,
    blockerCount: 1,
    commitAllowed: false,
    latestReportLink: "https://www.notion.so/iron-gate-earn",
  },
  {
    id: "IG-004",
    section: "Upgrade + Self-Onboarding",
    status: "waiting hand-walk",
    owner: "Onboarding Agent",
    lastBuildVersion: "0.7.55",
    lastInstalledVersion: "0.7.55",
    handWalkPassed: true,
    blockerCount: 0,
    commitAllowed: true,
    latestReportLink: "https://www.notion.so/iron-gate-upgrade",
  },
  {
    id: "IG-005",
    section: "UI Polish",
    status: "in progress",
    owner: "UI Agent",
    lastBuildVersion: "0.7.55",
    lastInstalledVersion: "0.7.54",
    handWalkPassed: false,
    blockerCount: 1,
    commitAllowed: false,
    latestReportLink: "https://www.notion.so/iron-gate-ui",
  },
  {
    id: "IG-006",
    section: "Backend",
    status: "passed",
    owner: "Backend Agent",
    lastBuildVersion: "0.7.55",
    lastInstalledVersion: "0.7.55",
    handWalkPassed: true,
    blockerCount: 0,
    commitAllowed: true,
    latestReportLink: "https://www.notion.so/iron-gate-backend",
  },
  {
    id: "IG-007",
    section: "Release / QA",
    status: "passed",
    owner: "Release Agent",
    lastBuildVersion: "0.7.55",
    lastInstalledVersion: "0.7.55",
    handWalkPassed: true,
    blockerCount: 0,
    commitAllowed: true,
    latestReportLink: "https://www.notion.so/iron-gate-release",
  },
];

// =====================================================================
// Mock data — Releases / Builds
// =====================================================================

type BuildCheck = "pass" | "fail" | "not run";
type HandWalkStatus = "not started" | "in progress" | "passed" | "blocked";
type Release = {
  id: string;
  version: string;
  buildTime: string;
  installedTime: string | null;
  gitStatusClean: boolean;
  tscResult: BuildCheck;
  invariantResult: BuildCheck;
  keychainAssertResult: BuildCheck;
  sidecarRebuilt: boolean;
  appInstalled: boolean;
  handWalkStatus: HandWalkStatus;
  releaseApprovedByDaniel: boolean;
  notes: string;
};

const RELEASES: Release[] = [
  {
    id: "REL-001",
    version: "0.7.55",
    buildTime: "2026-06-14T06:00:00Z",
    installedTime: "2026-06-14T07:30:00Z",
    gitStatusClean: true,
    tscResult: "pass",
    invariantResult: "pass",
    keychainAssertResult: "pass",
    sidecarRebuilt: true,
    appInstalled: true,
    handWalkStatus: "passed",
    releaseApprovedByDaniel: true,
    notes: "Backend proxy PATCH fix + community channels verified.",
  },
  {
    id: "REL-002",
    version: "0.7.56",
    buildTime: "2026-06-14T09:00:00Z",
    installedTime: null,
    gitStatusClean: false,
    tscResult: "pass",
    invariantResult: "pass",
    keychainAssertResult: "not run",
    sidecarRebuilt: false,
    appInstalled: false,
    handWalkStatus: "not started",
    releaseApprovedByDaniel: false,
    notes: "Auth + Projects fixes pending hand-walk. Dirty tree.",
  },
];

// =====================================================================
// Mock data — Customer Signals
// =====================================================================

type CustomerSignal = {
  id: string;
  email: string;
  appVersion: string;
  lastAction: string;
  bugReported: string | null;
  upgradeAttempted: boolean;
  checkoutCompleted: boolean;
  lockedAfterPayment: boolean;
  firstClipCreated: boolean;
  firstProjectCreated: boolean;
  firstEarnCampaignStarted: boolean;
};

const CUSTOMERS: CustomerSignal[] = [
  {
    id: "SIG-001",
    email: "a***@gmail.com",
    appVersion: "0.7.55",
    lastAction: "Opened Projects, saw locked screen",
    bugReported: "Projects locked after upgrade",
    upgradeAttempted: true,
    checkoutCompleted: true,
    lockedAfterPayment: true,
    firstClipCreated: false,
    firstProjectCreated: false,
    firstEarnCampaignStarted: false,
  },
  {
    id: "SIG-002",
    email: "b***@icloud.com",
    appVersion: "0.7.54",
    lastAction: "Started Earn bounty",
    bugReported: "Duplicate Projects created",
    upgradeAttempted: false,
    checkoutCompleted: false,
    lockedAfterPayment: false,
    firstClipCreated: true,
    firstProjectCreated: true,
    firstEarnCampaignStarted: true,
  },
  {
    id: "SIG-003",
    email: "c***@outlook.com",
    appVersion: "0.7.55",
    lastAction: "Exported first clip",
    bugReported: null,
    upgradeAttempted: false,
    checkoutCompleted: false,
    lockedAfterPayment: false,
    firstClipCreated: true,
    firstProjectCreated: true,
    firstEarnCampaignStarted: false,
  },
];

// =====================================================================
// Mock data — Revenue
// =====================================================================

type RevenueDay = {
  date: string;
  newSubscriptions: number;
  upgrades: number;
  cancellations: number;
  grossRevenue: number;
  refunds: number;
  netRevenue: number;
  notes: string;
};

const REVENUE_DAYS: RevenueDay[] = [
  { date: "2026-06-10", newSubscriptions: 3, upgrades: 1, cancellations: 0, grossRevenue: 11996, refunds: 0, netRevenue: 11996, notes: "" },
  { date: "2026-06-11", newSubscriptions: 2, upgrades: 0, cancellations: 1, grossRevenue: 5998, refunds: 2999, netRevenue: 2999, notes: "Refund for duplicate charge" },
  { date: "2026-06-12", newSubscriptions: 4, upgrades: 2, cancellations: 0, grossRevenue: 17994, refunds: 0, netRevenue: 17994, notes: "Earn launch push" },
  { date: "2026-06-13", newSubscriptions: 5, upgrades: 1, cancellations: 0, grossRevenue: 17994, refunds: 0, netRevenue: 17994, notes: "" },
  { date: "2026-06-14", newSubscriptions: 1, upgrades: 0, cancellations: 0, grossRevenue: 2999, refunds: 0, netRevenue: 2999, notes: "Early day" },
];

type RevenueWeek = {
  weekStarting: string;
  newPaidUsers: number;
  churnedUsers: number;
  netUserGrowth: number;
  grossRevenue: number;
  netRevenue: number;
  topConversionBlocker: string;
  topBugRevenueIssue: string;
};

const REVENUE_WEEKS: RevenueWeek[] = [
  {
    weekStarting: "2026-06-08",
    newPaidUsers: 21,
    churnedUsers: 4,
    netUserGrowth: 17,
    grossRevenue: 85982,
    netRevenue: 80983,
    topConversionBlocker: "Projects locked after payment",
    topBugRevenueIssue: "Reactivate shown to admin user",
  },
];

type RevenueMonth = {
  month: string;
  mrr: number;
  paidUsers: number;
  freeUsers: number;
  churn: number;
  grossRevenue: number;
  toolCosts: number;
  agentCosts: number;
  infraCosts: number;
  netCash: number;
  gapToTarget: number;
};

const REVENUE_MONTHS: RevenueMonth[] = [
  {
    month: "2026-06",
    mrr: 12840,
    paidUsers: 428,
    freeUsers: 1842,
    churn: 0.9,
    grossRevenue: 152945,
    toolCosts: 125000,
    agentCosts: 200000,
    infraCosts: 70000,
    netCash: -242055,
    gapToTarget: 287160,
  },
];

type RevenueBlocker = {
  id: string;
  section: string;
  severity: string;
  assignedAgent: string;
  status: string;
  estimatedRevenueDamage: string;
  latestReport: string;
};

const REVENUE_BLOCKERS: RevenueBlocker[] = [
  {
    id: "RB-001",
    section: "Auth / Account / Upgrade",
    severity: "P0 — stops paid access",
    assignedAgent: "Auth Agent",
    status: "fixing",
    estimatedRevenueDamage: "$2,000 / week",
    latestReport: "Stale Reactivate branch isolated; patch in review.",
  },
  {
    id: "RB-002",
    section: "Projects Manager",
    severity: "P0 — stops paid access",
    assignedAgent: "Projects Agent",
    status: "assigned",
    estimatedRevenueDamage: "$1,500 / week",
    latestReport: "Tier race condition reproduced. Fix targets useTier initial state.",
  },
  {
    id: "RB-003",
    section: "Auth / Account / Upgrade",
    severity: "P0 — stops payment",
    assignedAgent: "Onboarding Agent",
    status: "fixing",
    estimatedRevenueDamage: "$3,000 / week",
    latestReport: "openUpgradeWhenSignedIn now routes to account-app checkout.",
  },
  {
    id: "RB-004",
    section: "Earn Workflow",
    severity: "P1 — retention blocker",
    assignedAgent: "Earn Agent",
    status: "ready for review",
    estimatedRevenueDamage: "$800 / week",
    latestReport: "Deduplication guard added. Ready for hand-walk.",
  },
];

// =====================================================================
// Employees tab
// =====================================================================

export function EmployeesTab() {
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const rows = EMPLOYEES.filter((e) => statusFilter === "all" || e.status === statusFilter);
  const totalMonthlyCost = EMPLOYEES.filter((e) => e.status === "active").reduce((sum, e) => sum + e.monthlyCost, 0);

  return (
    <Panel
      title="employees · humans on the path to $30k MRR"
      sub="Prepare the people model only. No invites or emails are sent yet."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            label="status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: "all" },
              { value: "active", label: "active" },
              { value: "invited", label: "invited" },
              { value: "paused", label: "paused" },
              { value: "removed", label: "removed" },
            ]}
          />
          <button className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia">
            + add employee
          </button>
        </div>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Card label="active employees" value={EMPLOYEES.filter((e) => e.status === "active").length} />
        <Card label="monthly people cost" value={moneyCents(totalMonthlyCost)} />
        <Card label="HQ access" value={EMPLOYEES.filter((e) => e.canAccessHQ).length} />
        <Card label="invited / paused" value={EMPLOYEES.filter((e) => e.status === "invited" || e.status === "paused").length} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead>
            <tr className="text-left text-text-tertiary">
              {["name", "role", "lane", "status", "permission", "cost/mo", "rate", "HQ access", "emergency", "started", "last active", "notes"].map((h) => (
                <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-b border-line/40 align-top">
                <td className="px-2 py-2 text-ink">
                  <div className="font-display text-[13px] font-semibold">{e.name}</div>
                  <div className="text-text-tertiary">{e.email}</div>
                </td>
                <td className="px-2 py-2 text-text-secondary">{e.role}</td>
                <td className="px-2 py-2 text-text-secondary">{e.lane}</td>
                <td className="px-2 py-2"><Chip label={e.status} /></td>
                <td className="px-2 py-2 text-text-secondary">{e.permission}</td>
                <td className="px-2 py-2 text-text-secondary">{moneyCents(e.monthlyCost)}</td>
                <td className="px-2 py-2 text-text-secondary">{e.hourlyRate ? moneyCents(e.hourlyRate) + "/hr" : "—"}</td>
                <td className="px-2 py-2"><BoolChip value={e.canAccessHQ} /></td>
                <td className="px-2 py-2"><BoolChip value={e.emergencyContact} /></td>
                <td className="px-2 py-2 text-text-tertiary">{e.startDate}</td>
                <td className="px-2 py-2 text-text-tertiary">{e.lastActive ? e.lastActive.slice(0, 10) : "—"}</td>
                <td className="max-w-[200px] px-2 py-2 text-text-secondary">{e.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// =====================================================================
// Agents tab
// =====================================================================

export function AgentsTab({ agentKeyConfig }: { agentKeyConfig: AgentKeyConfig }) {
  const totalBudget = AGENTS.reduce((sum, a) => sum + a.monthlyBudget, 0);
  const totalSpend = AGENTS.reduce((sum, a) => sum + a.usageCostThisMonth, 0);

  return (
    <Panel
      title="agents · automated workforce"
      sub="Kimi, Claude, OpenAI/Codex and future agents. API keys show Configured / Missing only."
      right={<Card label="monthly spend / budget" value={`${moneyCents(totalSpend)} / ${moneyCents(totalBudget)}`} sub="mock" />}
    >
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Card label="active agents" value={AGENTS.filter((a) => a.status === "active").length} />
        <Card label="blocked / disabled" value={AGENTS.filter((a) => a.status === "blocked" || a.status === "disabled").length} tone="fail" />
        <Card label="keys configured" value={AGENTS.filter((a) => agentKeyConfig[a.apiKeyFlag]).length} />
        <Card label="keys missing" value={AGENTS.filter((a) => !agentKeyConfig[a.apiKeyFlag]).length} tone="fail" />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {AGENTS.map((a) => (
          <div key={a.id} className="rounded-2xl border border-line bg-paper p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-display text-[16px] font-semibold text-ink">{a.name}</div>
                <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">{a.provider} · {a.lane}</div>
              </div>
              <Chip label={a.status} tone={a.status === "active" ? "ok" : a.status === "blocked" ? "fail" : "pending"} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[10px]">
              <div className="text-text-tertiary">API key</div>
              <div><BoolChip value={agentKeyConfig[a.apiKeyFlag]} on="configured" off="missing" /></div>
              <div className="text-text-tertiary">budget</div>
              <div className="text-ink">{moneyCents(a.monthlyBudget)}</div>
              <div className="text-text-tertiary">spent</div>
              <div className={a.usageCostThisMonth > a.monthlyBudget ? "text-fuchsia-deep" : "text-ink"}>{moneyCents(a.usageCostThisMonth)}</div>
              <div className="text-text-tertiary">approval</div>
              <div><BoolChip value={a.approvalRequired} on="required" off="none" /></div>
            </div>
            <div className="mt-3 rounded-xl border border-line bg-paper-warm/50 p-2">
              <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-tertiary">last report</div>
              <div className="mt-1 font-sans text-[12px] text-text-secondary">{a.lastReport}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">agent detail</div>
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead>
            <tr className="text-left text-text-tertiary">
              {["agent", "lane", "status", "API key", "budget", "spent", "last task", "allowed files", "forbidden files", "Iron Gate"].map((h) => (
                <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {AGENTS.map((a) => (
              <tr key={a.id} className="border-b border-line/40 align-top">
                <td className="px-2 py-2 text-ink">
                  <div className="font-display text-[13px] font-semibold">{a.name}</div>
                  <div className="text-text-tertiary">{a.provider}</div>
                </td>
                <td className="px-2 py-2 text-text-secondary">{a.lane}</td>
                <td className="px-2 py-2"><Chip label={a.status} /></td>
                <td className="px-2 py-2"><BoolChip value={agentKeyConfig[a.apiKeyFlag]} on="configured" off="missing" /></td>
                <td className="px-2 py-2 text-text-secondary">{moneyCents(a.monthlyBudget)}</td>
                <td className={`px-2 py-2 ${a.usageCostThisMonth > a.monthlyBudget ? "text-fuchsia-deep" : "text-text-secondary"}`}>{moneyCents(a.usageCostThisMonth)}</td>
                <td className="max-w-[180px] px-2 py-2 text-text-secondary">{a.lastTask}</td>
                <td className="max-w-[160px] px-2 py-2 text-text-secondary">{a.allowedFiles}</td>
                <td className="max-w-[160px] px-2 py-2 text-fuchsia-deep">{a.forbiddenFiles}</td>
                <td className="px-2 py-2 text-text-tertiary">{a.ironGateSection}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// =====================================================================
// APIs / Tools tab
// =====================================================================

export function APIToolsTab({ serviceConfig }: { serviceConfig: ServiceConfig }) {
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const rows = categoryFilter === "all" ? SERVICES : SERVICES.filter((s) => s.category === categoryFilter);

  const totalMonthly = SERVICES.reduce((sum, s) => sum + s.monthlyCost, 0);
  const totalSpend = SERVICES.reduce((sum, s) => sum + s.currentMonthSpend, 0);
  const missingP0 = SERVICES.filter((s) => s.criticality === "P0" && !serviceConfig[s.serviceKey]).length;
  const overBudget = SERVICES.filter((s) => s.usageBased && s.currentMonthSpend > s.monthlyCost).length;

  return (
    <Panel
      title="apis & tools · cost + dependency map"
      sub="Track every paid API, SaaS, and backend dependency. Keys show Configured / Missing only."
      right={
        <div className="flex flex-wrap gap-2">
          <Chip label={`${missingP0} missing P0 keys`} tone={missingP0 ? "fail" : "ok"} />
          <Chip label={`${overBudget} over budget`} tone={overBudget ? "pending" : "ok"} />
        </div>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Card label="monthly fixed cost" value={moneyCents(totalMonthly)} />
        <Card label="current month spend" value={moneyCents(totalSpend)} />
        <Card label="services tracked" value={SERVICES.length} />
        <Card label="missing keys" value={SERVICES.filter((s) => !serviceConfig[s.serviceKey]).length} tone="fail" />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FilterSelect
          label="category"
          value={categoryFilter}
          onChange={setCategoryFilter}
          options={[
            { value: "all", label: "all" },
            { value: "AI", label: "AI" },
            { value: "auth", label: "auth" },
            { value: "payments", label: "payments" },
            { value: "infra", label: "infra" },
            { value: "hosting", label: "hosting" },
            { value: "email", label: "email" },
            { value: "storage", label: "storage" },
            { value: "analytics", label: "analytics" },
            { value: "other", label: "other" },
          ]}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead>
            <tr className="text-left text-text-tertiary">
              {["service", "category", "owner", "env var", "key", "fixed/mo", "spend", "usage", "critical", "used by", "renewal", "risk", "notes"].map((h) => (
                <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-b border-line/40 align-top">
                <td className="px-2 py-2 text-ink">
                  <div className="font-display text-[13px] font-semibold">{s.name}</div>
                </td>
                <td className="px-2 py-2"><Chip label={s.category} tone="gray" /></td>
                <td className="px-2 py-2 text-text-secondary">{s.owner}</td>
                <td className="px-2 py-2 font-mono text-[10px] text-text-tertiary">{s.envVarName}</td>
                <td className="px-2 py-2"><BoolChip value={serviceConfig[s.serviceKey]} on="configured" off="missing" /></td>
                <td className="px-2 py-2 text-text-secondary">{moneyCents(s.monthlyCost)}</td>
                <td className={`px-2 py-2 ${s.currentMonthSpend > s.monthlyCost ? "text-fuchsia-deep" : "text-text-secondary"}`}>{moneyCents(s.currentMonthSpend)}</td>
                <td className="px-2 py-2"><BoolChip value={s.usageBased} on="yes" off="no" /></td>
                <td className="px-2 py-2"><Chip label={s.criticality} tone={s.criticality === "P0" ? "fail" : s.criticality === "P1" ? "pending" : "gray"} /></td>
                <td className="px-2 py-2 text-text-secondary">{s.usedBy.join(" · ")}</td>
                <td className="px-2 py-2 text-text-tertiary">{s.renewalDate ?? "—"}</td>
                <td className="px-2 py-2"><Chip label={s.cancelRisk} tone={s.cancelRisk === "cancel" ? "fail" : s.cancelRisk === "review" ? "pending" : "ok"} /></td>
                <td className="max-w-[200px] px-2 py-2 text-text-secondary">{s.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// =====================================================================
// Iron Gates tab
// =====================================================================

export function IronGatesTab() {
  const passed = IRON_GATES.filter((g) => g.status === "passed").length;
  const notPassed = IRON_GATES.length - passed;
  const totalBlockers = IRON_GATES.reduce((sum, g) => sum + g.blockerCount, 0);

  return (
    <Panel
      title="iron gates · commit readiness"
      sub="No section is complete until it works in the installed app. Commit only when a gate passes."
      right={<Chip label={`${notPassed} not passed`} tone={notPassed ? "fail" : "ok"} />}
    >
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Card label="gates passed" value={passed} />
        <Card label="gates blocked" value={notPassed} tone={notPassed ? "fail" : "ok"} />
        <Card label="total blockers" value={totalBlockers} tone={totalBlockers ? "fail" : "ok"} />
        <Card label="commit ready" value={IRON_GATES.filter((g) => g.commitAllowed).length} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead>
            <tr className="text-left text-text-tertiary">
              {["section", "owner", "status", "build version", "installed version", "hand-walk", "blockers", "commit allowed", "report"].map((h) => (
                <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {IRON_GATES.map((g) => (
              <tr key={g.id} className="border-b border-line/40 align-top">
                <td className="px-2 py-2 text-ink">
                  <div className="font-display text-[13px] font-semibold">{g.section}</div>
                </td>
                <td className="px-2 py-2 text-text-secondary">{g.owner}</td>
                <td className="px-2 py-2">
                  <Chip
                    label={g.status}
                    tone={g.status === "passed" ? "ok" : g.status === "failed" ? "fail" : "pending"}
                  />
                </td>
                <td className="px-2 py-2 text-text-secondary">{g.lastBuildVersion}</td>
                <td className="px-2 py-2 text-text-secondary">{g.lastInstalledVersion}</td>
                <td className="px-2 py-2"><BoolChip value={g.handWalkPassed} /></td>
                <td className="px-2 py-2 text-text-secondary">{g.blockerCount}</td>
                <td className="px-2 py-2"><BoolChip value={g.commitAllowed} /></td>
                <td className="px-2 py-2">
                  {g.latestReportLink ? (
                    <a href={g.latestReportLink} target="_blank" rel="noreferrer" className="text-fuchsia underline-offset-2 hover:underline">open ↗</a>
                  ) : (
                    <NA />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// =====================================================================
// Releases tab
// =====================================================================

export function ReleasesTab() {
  return (
    <Panel
      title="releases / builds · version control"
      sub="Prevent version chaos. A release is not done until the installed app passes hand-walk."
    >
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Card label="latest build" value={RELEASES[0]?.version ?? "—"} />
        <Card label="installed" value={RELEASES.filter((r) => r.appInstalled).length} />
        <Card label="Daniel approved" value={RELEASES.filter((r) => r.releaseApprovedByDaniel).length} />
        <Card label="dirty trees" value={RELEASES.filter((r) => !r.gitStatusClean).length} tone="fail" />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead>
            <tr className="text-left text-text-tertiary">
              {["version", "built", "installed", "git clean", "tsc", "invariant", "keychain", "sidecar rebuilt", "app installed", "hand-walk", "approved", "notes"].map((h) => (
                <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RELEASES.map((r) => (
              <tr key={r.id} className="border-b border-line/40 align-top">
                <td className="px-2 py-2 text-ink">
                  <div className="font-display text-[13px] font-semibold">{r.version}</div>
                </td>
                <td className="px-2 py-2 text-text-secondary">{r.buildTime.slice(0, 10)}</td>
                <td className="px-2 py-2 text-text-secondary">{r.installedTime ? r.installedTime.slice(0, 10) : "—"}</td>
                <td className="px-2 py-2"><BoolChip value={r.gitStatusClean} /></td>
                <td className="px-2 py-2"><Chip label={r.tscResult} tone={r.tscResult === "pass" ? "ok" : r.tscResult === "fail" ? "fail" : "gray"} /></td>
                <td className="px-2 py-2"><Chip label={r.invariantResult} tone={r.invariantResult === "pass" ? "ok" : r.invariantResult === "fail" ? "fail" : "gray"} /></td>
                <td className="px-2 py-2"><Chip label={r.keychainAssertResult} tone={r.keychainAssertResult === "pass" ? "ok" : r.keychainAssertResult === "fail" ? "fail" : "gray"} /></td>
                <td className="px-2 py-2"><BoolChip value={r.sidecarRebuilt} /></td>
                <td className="px-2 py-2"><BoolChip value={r.appInstalled} /></td>
                <td className="px-2 py-2"><Chip label={r.handWalkStatus} tone={r.handWalkStatus === "passed" ? "ok" : r.handWalkStatus === "blocked" ? "fail" : "pending"} /></td>
                <td className="px-2 py-2"><BoolChip value={r.releaseApprovedByDaniel} /></td>
                <td className="max-w-[240px] px-2 py-2 text-text-secondary">{r.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// =====================================================================
// Customers tab
// =====================================================================

export function CustomersTab() {
  const [filter, setFilter] = useState<string>("all");
  const rows =
    filter === "all"
      ? CUSTOMERS
      : filter === "blocked"
        ? CUSTOMERS.filter((c) => c.lockedAfterPayment || c.bugReported)
        : CUSTOMERS.filter((c) => !c.firstClipCreated);

  return (
    <Panel
      title="customer signals · what stops conversion"
      sub="Mock model for signals that block install, activation, payment, or retention. Real tracking scoped for later."
      right={
        <FilterSelect
          label="filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "all" },
            { value: "blocked", label: "blocked / bug" },
            { value: "no clip", label: "no first clip" },
          ]}
        />
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Card label="tracked signals" value={CUSTOMERS.length} />
        <Card label="paid but locked" value={CUSTOMERS.filter((c) => c.lockedAfterPayment).length} tone="fail" />
        <Card label="upgrade attempted" value={CUSTOMERS.filter((c) => c.upgradeAttempted).length} />
        <Card label="checkout completed" value={CUSTOMERS.filter((c) => c.checkoutCompleted).length} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead>
            <tr className="text-left text-text-tertiary">
              {["email", "version", "last action", "bug reported", "upgrade", "checkout", "locked after pay", "first clip", "first project", "first earn"].map((h) => (
                <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-line/40 align-top">
                <td className="px-2 py-2 text-ink">{c.email}</td>
                <td className="px-2 py-2 text-text-secondary">{c.appVersion}</td>
                <td className="max-w-[200px] px-2 py-2 text-text-secondary">{c.lastAction}</td>
                <td className="max-w-[180px] px-2 py-2 text-fuchsia-deep">{c.bugReported ?? "—"}</td>
                <td className="px-2 py-2"><BoolChip value={c.upgradeAttempted} /></td>
                <td className="px-2 py-2"><BoolChip value={c.checkoutCompleted} /></td>
                <td className="px-2 py-2"><BoolChip value={c.lockedAfterPayment} /></td>
                <td className="px-2 py-2"><BoolChip value={c.firstClipCreated} /></td>
                <td className="px-2 py-2"><BoolChip value={c.firstProjectCreated} /></td>
                <td className="px-2 py-2"><BoolChip value={c.firstEarnCampaignStarted} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// =====================================================================
// Costs / Runway tab
// =====================================================================

export function CostsRunwayTab({ agentKeyConfig, serviceConfig }: { agentKeyConfig: AgentKeyConfig; serviceConfig: ServiceConfig }) {
  const latest = REVENUE_MONTHS[0];
  const TARGET_MRR = 30000_00; // cents
  const PRICE = 2999; // cents
  const customersNeeded = Math.ceil((TARGET_MRR - latest.mrr) / PRICE);

  const toolCosts = SERVICES.reduce((sum, s) => sum + s.monthlyCost + s.currentMonthSpend, 0);
  const agentCosts = AGENTS.reduce((sum, a) => sum + a.usageCostThisMonth, 0);
  const infraCosts = SERVICES.filter((s) => s.category === "infra" || s.category === "hosting").reduce((sum, s) => sum + s.monthlyCost + s.currentMonthSpend, 0);
  const peopleCosts = EMPLOYEES.filter((e) => e.status === "active").reduce((sum, e) => sum + e.monthlyCost, 0);
  const totalBurn = toolCosts + agentCosts + infraCosts + peopleCosts;
  const netCash = latest.grossRevenue - totalBurn;

  const progress = Math.min(100, Math.round((latest.mrr / TARGET_MRR) * 100));

  return (
    <Panel
      title="costs / runway · can Daniel afford to ship?"
      sub="MRR, burn, and gap to $30k MRR. All numbers are mock/static for v0."
    >
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="current MRR" value={moneyCents(latest.mrr)} />
        <Card label="target MRR" value={moneyCents(TARGET_MRR)} />
        <Card label="gap to target" value={moneyCents(TARGET_MRR - latest.mrr)} tone="fail" />
        <Card label="paid users needed @ $29.99" value={customersNeeded} tone="pending" />
      </div>

      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          <span>$30k MRR progress</span>
          <span>{progress}%</span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-paper-elev">
          <div
            className="h-full rounded-full bg-fuchsia"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between font-mono text-[10px] text-text-tertiary">
          <span>{moneyCents(latest.mrr)} today</span>
          <span>{moneyCents(TARGET_MRR)} target</span>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="tool / api costs" value={moneyCents(toolCosts)} />
        <Card label="agent costs" value={moneyCents(agentCosts)} />
        <Card label="infra costs" value={moneyCents(infraCosts)} />
        <Card label="people costs" value={moneyCents(peopleCosts)} />
        <Card label="total monthly burn" value={moneyCents(totalBurn)} tone="fail" />
        <Card label="gross revenue" value={moneyCents(latest.grossRevenue)} />
        <Card label="net monthly cash" value={moneyCents(netCash)} tone={netCash < 0 ? "fail" : "ok"} />
        <Card label="1,000 paid users tracker" value={`${latest.paidUsers} / 1,000`} />
      </div>

      <div className="rounded-2xl border border-line bg-paper p-4">
        <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">cost breakdown</div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr className="text-left text-text-tertiary">
                {["item", "category", "monthly cost", "notes"].map((h) => (
                  <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SERVICES.map((s) => (
                <tr key={s.id} className="border-b border-line/40">
                  <td className="px-2 py-2 text-ink">{s.name}</td>
                  <td className="px-2 py-2"><Chip label={s.category} tone="gray" /></td>
                  <td className="px-2 py-2 text-text-secondary">{moneyCents(s.monthlyCost + s.currentMonthSpend)}</td>
                  <td className="max-w-[260px] px-2 py-2 text-text-secondary">{s.notes}</td>
                </tr>
              ))}
              {AGENTS.map((a) => (
                <tr key={a.id} className="border-b border-line/40">
                  <td className="px-2 py-2 text-ink">{a.name}</td>
                  <td className="px-2 py-2"><Chip label="agent" tone="gray" /></td>
                  <td className="px-2 py-2 text-text-secondary">{moneyCents(a.usageCostThisMonth)}</td>
                  <td className="px-2 py-2 text-text-secondary">{a.lastTask}</td>
                </tr>
              ))}
              {EMPLOYEES.filter((e) => e.status === "active" && e.monthlyCost > 0).map((e) => (
                <tr key={e.id} className="border-b border-line/40">
                  <td className="px-2 py-2 text-ink">{e.name}</td>
                  <td className="px-2 py-2"><Chip label="people" tone="gray" /></td>
                  <td className="px-2 py-2 text-text-secondary">{moneyCents(e.monthlyCost)}</td>
                  <td className="px-2 py-2 text-text-secondary">{e.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {(missingKeys(serviceConfig) > 0 || agentKeysMissing(agentKeyConfig) > 0) && (
        <div className="mt-4 rounded-2xl border border-fuchsia-deep/30 bg-fuchsia-soft/20 p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-fuchsia-deep">costs blocking runway</div>
          <ul className="mt-2 space-y-1 font-mono text-[11px] text-text-secondary">
            {missingKeys(serviceConfig) > 0 && (
              <li>· {missingKeys(serviceConfig)} critical service keys missing — automations cannot run.</li>
            )}
            {agentKeysMissing(agentKeyConfig) > 0 && (
              <li>· {agentKeysMissing(agentKeyConfig)} agent API keys missing — lanes are manual.</li>
            )}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function missingKeys(config: ServiceConfig): number {
  return SERVICES.filter((s) => s.criticality === "P0" && !config[s.serviceKey]).length;
}

function agentKeysMissing(config: AgentKeyConfig): number {
  return AGENTS.filter((a) => !config[a.apiKeyFlag]).length;
}

// =====================================================================
// Revenue tab
// =====================================================================

export function RevenueTab() {
  const latest = REVENUE_MONTHS[0];
  const TARGET_MRR = 30000_00;
  const PRICE = 2999;
  const customersNeeded = Math.ceil((TARGET_MRR - latest.mrr) / PRICE);
  const progress = Math.min(100, Math.round((latest.mrr / TARGET_MRR) * 100));

  const today = REVENUE_DAYS[REVENUE_DAYS.length - 1];
  const thisWeek = REVENUE_WEEKS[REVENUE_WEEKS.length - 1];

  return (
    <Panel
      title="revenue · path to $30k MRR"
      sub="Daily, weekly, monthly revenue + MRR target + revenue blockers. Mock data for v0."
    >
      {/* Overview cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <Card label="today's revenue" value={moneyCents(today.netRevenue)} />
        <Card label="this week's revenue" value={moneyCents(thisWeek.netRevenue)} />
        <Card label="this month's revenue" value={moneyCents(latest.grossRevenue)} />
        <Card label="current MRR" value={moneyCents(latest.mrr)} />
        <Card label="paid users" value={latest.paidUsers} />
        <Card label="free users" value={latest.freeUsers} />
        <Card label="conversion rate" value="18.9%" />
        <Card label="churn" value={`${latest.churn}%`} />
        <Card label="gap to $30k MRR" value={moneyCents(latest.gapToTarget)} tone="fail" />
        <Card label="paid users needed @ $29.99" value={customersNeeded} tone="pending" />
      </div>

      {/* MRR target */}
      <div className="mb-6 rounded-2xl border border-line bg-paper p-4">
        <SectionHead title="MRR target" sub="$30,000 MRR = 1,001 paid users at $29.99/mo" />
        <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          <span>progress</span>
          <span>{progress}%</span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-paper-elev">
          <div className="h-full rounded-full bg-fuchsia" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Card label="current MRR" value={moneyCents(latest.mrr)} />
          <Card label="target" value={moneyCents(TARGET_MRR)} />
          <Card label="gap" value={moneyCents(latest.gapToTarget)} tone="fail" />
          <Card label="customers needed" value={customersNeeded} />
        </div>
      </div>

      {/* Revenue blockers */}
      <div className="mb-6 rounded-2xl border border-line bg-paper p-4">
        <SectionHead title="revenue blockers" sub="Bugs that directly stop money" />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr className="text-left text-text-tertiary">
                {["blocker", "section", "severity", "agent", "status", "est. damage", "latest report"].map((h) => (
                  <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {REVENUE_BLOCKERS.map((b) => (
                <tr key={b.id} className="border-b border-line/40 align-top">
                  <td className="px-2 py-2 text-ink">{b.id}</td>
                  <td className="px-2 py-2 text-text-secondary">{b.section}</td>
                  <td className="px-2 py-2"><Chip label={b.severity} tone={b.severity.startsWith("P0") ? "fail" : b.severity.startsWith("P1") ? "pending" : "gray"} /></td>
                  <td className="px-2 py-2 text-text-secondary">{b.assignedAgent}</td>
                  <td className="px-2 py-2"><Chip label={b.status} /></td>
                  <td className="px-2 py-2 text-fuchsia-deep">{b.estimatedRevenueDamage}</td>
                  <td className="max-w-[240px] px-2 py-2 text-text-secondary">{b.latestReport}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Daily revenue */}
      <div className="mb-6 rounded-2xl border border-line bg-paper p-4">
        <SectionHead title="daily revenue" />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr className="text-left text-text-tertiary">
                {["date", "new subs", "upgrades", "cancellations", "gross", "refunds", "net", "notes"].map((h) => (
                  <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {REVENUE_DAYS.map((d) => (
                <tr key={d.date} className="border-b border-line/40">
                  <td className="px-2 py-2 text-ink">{d.date}</td>
                  <td className="px-2 py-2 text-text-secondary">{d.newSubscriptions}</td>
                  <td className="px-2 py-2 text-text-secondary">{d.upgrades}</td>
                  <td className="px-2 py-2 text-text-secondary">{d.cancellations}</td>
                  <td className="px-2 py-2 text-text-secondary">{moneyCents(d.grossRevenue)}</td>
                  <td className="px-2 py-2 text-text-secondary">{moneyCents(d.refunds)}</td>
                  <td className="px-2 py-2 text-ink">{moneyCents(d.netRevenue)}</td>
                  <td className="max-w-[220px] px-2 py-2 text-text-secondary">{d.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Weekly revenue */}
      <div className="mb-6 rounded-2xl border border-line bg-paper p-4">
        <SectionHead title="weekly revenue" />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr className="text-left text-text-tertiary">
                {["week starting", "new paid", "churned", "net growth", "gross", "net", "top blocker", "top bug issue"].map((h) => (
                  <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {REVENUE_WEEKS.map((w) => (
                <tr key={w.weekStarting} className="border-b border-line/40">
                  <td className="px-2 py-2 text-ink">{w.weekStarting}</td>
                  <td className="px-2 py-2 text-text-secondary">{w.newPaidUsers}</td>
                  <td className="px-2 py-2 text-text-secondary">{w.churnedUsers}</td>
                  <td className="px-2 py-2 text-ink">{w.netUserGrowth}</td>
                  <td className="px-2 py-2 text-text-secondary">{moneyCents(w.grossRevenue)}</td>
                  <td className="px-2 py-2 text-ink">{moneyCents(w.netRevenue)}</td>
                  <td className="max-w-[180px] px-2 py-2 text-fuchsia-deep">{w.topConversionBlocker}</td>
                  <td className="max-w-[180px] px-2 py-2 text-fuchsia-deep">{w.topBugRevenueIssue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Monthly revenue */}
      <div className="rounded-2xl border border-line bg-paper p-4">
        <SectionHead title="monthly revenue" />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr className="text-left text-text-tertiary">
                {["month", "MRR", "paid", "free", "churn", "gross", "tool costs", "agent costs", "infra costs", "net cash", "gap to target"].map((h) => (
                  <th key={h} className="border-b border-line px-2 py-2 font-normal uppercase tracking-[0.08em]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {REVENUE_MONTHS.map((m) => (
                <tr key={m.month} className="border-b border-line/40">
                  <td className="px-2 py-2 text-ink">{m.month}</td>
                  <td className="px-2 py-2 text-ink">{moneyCents(m.mrr)}</td>
                  <td className="px-2 py-2 text-text-secondary">{m.paidUsers}</td>
                  <td className="px-2 py-2 text-text-secondary">{m.freeUsers}</td>
                  <td className="px-2 py-2 text-text-secondary">{m.churn}%</td>
                  <td className="px-2 py-2 text-text-secondary">{moneyCents(m.grossRevenue)}</td>
                  <td className="px-2 py-2 text-text-secondary">{moneyCents(m.toolCosts)}</td>
                  <td className="px-2 py-2 text-text-secondary">{moneyCents(m.agentCosts)}</td>
                  <td className="px-2 py-2 text-text-secondary">{moneyCents(m.infraCosts)}</td>
                  <td className={`px-2 py-2 ${m.netCash < 0 ? "text-fuchsia-deep" : "text-ink"}`}>{moneyCents(m.netCash)}</td>
                  <td className="px-2 py-2 text-fuchsia-deep">{moneyCents(m.gapToTarget)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}

// =====================================================================
// Reports tab
// =====================================================================

export function ReportsTab() {
  return (
    <Panel
      title="reports · latest signals"
      sub="A running feed of agent reports, Iron Gate updates, and revenue blockers."
    >
      <div className="space-y-3">
        {AGENT_REPORTS.map((r, i) => {
          const agent = AGENTS.find((a) => a.lane === r.lane);
          return (
            <div key={i} className="rounded-2xl border border-line bg-paper p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                  <Chip label={agent?.name ?? r.lane} tone="gray" />
                  <span>· {r.at.slice(0, 16).replace("T", " ")}</span>
                </div>
                <Chip label="agent report" tone="pending" />
              </div>
              <p className="mt-2 font-sans text-[13px] leading-relaxed text-text-secondary">{r.summary}</p>
            </div>
          );
        })}
        {REVENUE_BLOCKERS.slice(0, 3).map((b) => (
          <div key={b.id} className="rounded-2xl border border-fuchsia-deep/30 bg-fuchsia-soft/20 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">{b.section}</div>
              <Chip label={b.severity} tone={b.severity.startsWith("P0") ? "fail" : "pending"} />
            </div>
            <p className="mt-2 font-sans text-[13px] leading-relaxed text-text-secondary">{b.latestReport}</p>
            <div className="mt-2 font-mono text-[10px] text-fuchsia-deep">est. damage: {b.estimatedRevenueDamage}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// Agent reports used by ReportsTab and shared with BugCommandTab conceptually.
const AGENT_REPORTS: { lane: string; at: string; summary: string }[] = [
  { lane: "Auth / Account / Upgrade", at: "2026-06-14T09:30:00Z", summary: "Stale Reactivate branch isolated; patch in review." },
  { lane: "Projects Manager", at: "2026-06-14T09:15:00Z", summary: "Tier race condition reproduced. Fix targets useTier initial state." },
  { lane: "Earn Workflow", at: "2026-06-14T08:45:00Z", summary: "Deduplication guard ready for Daniel hand-walk." },
  { lane: "Backend", at: "2026-06-14T08:00:00Z", summary: "PATCH body forwarding verified across all admin write paths." },
];

// =====================================================================
// Inbox — lightweight user-to-HQ support board
// =====================================================================
// v0 is static/mock. The lightest production path later is to add a new
// `inbox_messages` table (or reuse `notifications` with category
// "support_inbound") and expose `/admin/inbox` through the proxy.

type InboxStatus = "new" | "in progress" | "resolved";
type InboxPriority = "low" | "medium" | "high";

type InboxMessage = {
  id: string;
  from: string;
  subject: string;
  body: string;
  status: InboxStatus;
  priority: InboxPriority;
  appVersion: string;
  createdAt: string;
  assignee: string | null;
  revenueRelated: boolean;
};

const INBOX_MESSAGES: InboxMessage[] = [
  {
    id: "INB-001",
    from: "a***@gmail.com",
    subject: "Projects still locked after paying",
    body: "I paid for Solo yesterday but every time I open Projects it says I need to upgrade. Can you fix this?",
    status: "new",
    priority: "high",
    appVersion: "0.7.55",
    createdAt: "2026-06-14T09:12:00Z",
    assignee: null,
    revenueRelated: true,
  },
  {
    id: "INB-002",
    from: "b***@icloud.com",
    subject: "Earn bounty creates duplicate projects",
    body: "I clicked Start Project twice and now I have two of the same project. Which one should I submit to?",
    status: "in progress",
    priority: "medium",
    appVersion: "0.7.54",
    createdAt: "2026-06-13T18:45:00Z",
    assignee: "Earn Agent",
    revenueRelated: true,
  },
  {
    id: "INB-003",
    from: "c***@outlook.com",
    subject: "How do I export without watermark?",
    body: "I just signed up but my exports still have the watermark. Is there a setting?",
    status: "new",
    priority: "medium",
    appVersion: "0.7.55",
    createdAt: "2026-06-14T08:30:00Z",
    assignee: null,
    revenueRelated: false,
  },
  {
    id: "INB-004",
    from: "d***@gmail.com",
    subject: "Checkout page shows Reactivate",
    body: "When I click upgrade while signed in it sends me to a page that says Reactivate instead of checkout.",
    status: "new",
    priority: "high",
    appVersion: "0.7.55",
    createdAt: "2026-06-14T10:05:00Z",
    assignee: null,
    revenueRelated: true,
  },
  {
    id: "INB-005",
    from: "e***@yahoo.com",
    subject: "Can’t connect YouTube channel",
    body: "The schedule tab spins forever when I try to link my channel.",
    status: "resolved",
    priority: "low",
    appVersion: "0.7.53",
    createdAt: "2026-06-10T14:20:00Z",
    assignee: "Backend Agent",
    revenueRelated: false,
  },
];

function InboxCard({
  msg,
  onMove,
}: {
  msg: InboxMessage;
  onMove: (id: string, status: InboxStatus) => void;
}) {
  return (
    <div
      className="rounded-2xl border border-line bg-paper p-3 transition hover:border-fuchsia"
      style={{ boxShadow: "var(--lc-shadow-resting)" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-display text-[14px] font-semibold text-ink">{msg.subject}</div>
          <div className="mt-0.5 truncate font-mono text-[10px] text-text-tertiary">{msg.from} · {msg.appVersion}</div>
        </div>
        <Chip
          label={msg.priority}
          tone={msg.priority === "high" ? "fail" : msg.priority === "medium" ? "pending" : "gray"}
        />
      </div>
      <p className="mt-2 line-clamp-3 font-sans text-[12px] leading-relaxed text-text-secondary">{msg.body}</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono text-[10px] text-text-tertiary">{msg.createdAt.slice(0, 16).replace("T", " ")}</div>
        {msg.revenueRelated && <Chip label="revenue" tone="fail" />}
      </div>
      {msg.assignee && (
        <div className="mt-2 font-mono text-[10px] text-text-secondary">assigned: {msg.assignee}</div>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {(["new", "in progress", "resolved"] as InboxStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => onMove(msg.id, s)}
            disabled={msg.status === s}
            className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] transition disabled:opacity-40 ${
              msg.status === s
                ? "border-ink bg-ink text-paper"
                : "border-line bg-paper text-ink hover:border-fuchsia"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

export function InboxTab() {
  const [messages, setMessages] = useState<InboxMessage[]>(INBOX_MESSAGES);
  const [filter, setFilter] = useState<"all" | "revenue" | "high">("all");

  const move = (id: string, status: InboxStatus) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, status } : m)));
  };

  const filtered = messages.filter((m) => {
    if (filter === "revenue") return m.revenueRelated;
    if (filter === "high") return m.priority === "high";
    return true;
  });

  const columns: { status: InboxStatus; title: string; sub: string }[] = [
    { status: "new", title: "new", sub: "needs triage" },
    { status: "in progress", title: "in progress", sub: "being handled" },
    { status: "resolved", title: "resolved", sub: "done / archived" },
  ];

  return (
    <Panel
      title="inbox · user-to-HQ support board"
      sub="Lightweight triage board. Static/mock for v0; wire to a real inbox table later."
      right={
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            label="filter"
            value={filter}
            onChange={(v) => setFilter(v as typeof filter)}
            options={[
              { value: "all", label: "all" },
              { value: "revenue", label: "revenue-related" },
              { value: "high", label: "high priority" },
            ]}
          />
          <button className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink hover:border-fuchsia">
            + compose
          </button>
        </div>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Card label="new messages" value={messages.filter((m) => m.status === "new").length} tone="pending" />
        <Card label="in progress" value={messages.filter((m) => m.status === "in progress").length} />
        <Card label="resolved" value={messages.filter((m) => m.status === "resolved").length} tone="ok" />
        <Card label="revenue-related" value={messages.filter((m) => m.revenueRelated).length} tone="fail" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {columns.map((col) => {
          const colMessages = filtered.filter((m) => m.status === col.status);
          return (
            <div key={col.status} className="rounded-3xl border border-line bg-paper-warm/40 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">{col.title}</div>
                  <div className="font-sans text-[12px] text-text-secondary">{col.sub}</div>
                </div>
                <Chip label={String(colMessages.length)} tone="gray" />
              </div>
              <div className="space-y-3">
                {colMessages.map((m) => (
                  <InboxCard key={m.id} msg={m} onMove={move} />
                ))}
                {colMessages.length === 0 && (
                  <div className="rounded-2xl border border-line border-dashed bg-paper p-4 text-center font-mono text-[11px] text-text-tertiary">
                    No messages
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
