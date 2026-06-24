"use client";

import { useCallback, useEffect, useState } from "react";
import { ConfirmModal, type ConfirmModalProps } from "./ConfirmModal";
import { AuditLogPanel } from "./AuditLogPanel";
import { mutationsApi, type RecentSales, type SaleRow } from "./api";

// HQ Agent 3 · Mutations tab.
//
// Single HQ surface that hosts all 11 management-gap mutations. Layout:
//   - Sales    · GET /recent-sales feed (auto-loads on mount)
//   - Campaigns · create / edit / archive
//   - Users    · tier-change / refund / ban
//   - Agents   · kill / restart / rotate-key
//   - Audit    · last 50 mutations (auto-refreshes after every fire)
//
// Every action button opens ConfirmModal with a typed-confirmation string
// (e.g. "REFUND user_abc"). After the modal returns success we toast the
// result + bump auditRefresh so the AuditLogPanel re-polls.

type ToastShape = { tone: "ok" | "fail"; message: string } | null;

// One row in our "fire this mutation" definition — the modal config plus
// the actual call. Used by every action button so the modal state stays
// uniform across the panel.
type ModalSpec = Omit<ConfirmModalProps, "open" | "onClose">;

export function MutationsTab({ adminEmail }: { adminEmail: string }) {
  const [modal, setModal] = useState<ModalSpec | null>(null);
  const [toast, setToast] = useState<ToastShape>(null);
  const [auditRefresh, setAuditRefresh] = useState(0);

  const showToast = useCallback((tone: "ok" | "fail", message: string) => {
    setToast({ tone, message });
    window.setTimeout(() => setToast(null), 5000);
  }, []);

  const fireOk = useCallback(
    (msg: string) => {
      showToast("ok", msg);
      setAuditRefresh((n) => n + 1);
    },
    [showToast],
  );

  const fireErr = useCallback(
    (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      showToast("fail", msg);
      setAuditRefresh((n) => n + 1);
    },
    [showToast],
  );

  return (
    <div className="space-y-6">
      <header className="rounded-3xl border border-neutral-200 bg-neutral-50 p-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-500">
          mutations · the 11 management-gap actions
        </div>
        <h2 className="mt-1 font-display text-[22px] font-semibold tracking-[-0.02em] text-neutral-900">
          Operator console
        </h2>
        <p className="mt-2 font-sans text-[13px] leading-relaxed text-neutral-700">
          Every action requires typed confirmation. Mutations are audit-logged with the
          actor email, action, target, and a redacted payload snapshot. Signed in as{" "}
          <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-pink-700 ring-1 ring-pink-200">
            {adminEmail}
          </code>
          .
        </p>
      </header>

      {toast && (
        <div
          role="status"
          className={`rounded-2xl border px-4 py-3 font-mono text-[12px] ${
            toast.tone === "ok"
              ? "border-emerald-300 bg-emerald-50 text-emerald-800"
              : "border-pink-300 bg-pink-50 text-pink-800"
          }`}
        >
          {toast.message}
        </div>
      )}

      <SalesSection />

      <CampaignsSection
        adminEmail={adminEmail}
        openModal={setModal}
        onSuccess={fireOk}
        onError={fireErr}
      />

      <UsersSection
        openModal={setModal}
        onSuccess={fireOk}
        onError={fireErr}
      />

      <AgentsSection
        openModal={setModal}
        onSuccess={fireOk}
        onError={fireErr}
      />

      <AuditLogPanel refreshKey={auditRefresh} />

      {modal && (
        <ConfirmModal {...modal} open onClose={() => setModal(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Sales · GET /recent-sales
// ---------------------------------------------------------------------
function SalesSection() {
  const [data, setData] = useState<RecentSales | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sinceHours, setSinceHours] = useState(72);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await mutationsApi.recentSales(sinceHours, 50));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [sinceHours]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="rounded-3xl border border-neutral-200 bg-white p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-500">
            sales · recent
          </div>
          <h3 className="mt-1 font-display text-[18px] font-semibold tracking-[-0.02em] text-neutral-900">
            Last {sinceHours}h of sales + billing webhooks
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={sinceHours}
            onChange={(e) => setSinceHours(Number(e.target.value))}
            className="rounded-xl border border-neutral-300 bg-white px-3 py-1.5 font-mono text-[11px] text-neutral-900 focus:border-pink-500 focus:outline-none"
          >
            {[24, 72, 168, 720].map((h) => (
              <option key={h} value={h}>
                last {h}h
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={load}
            className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-neutral-800 hover:border-pink-500"
          >
            refresh
          </button>
        </div>
      </header>

      {loading && <div className="mt-3 font-mono text-[11px] text-neutral-500">loading…</div>}
      {error && (
        <div className="mt-3 rounded-xl border border-pink-300 bg-pink-50 px-3 py-2 font-mono text-[11px] text-pink-700">
          {error}
        </div>
      )}
      {data && data.rows.length === 0 && !loading && (
        <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 font-mono text-[11px] text-neutral-500">
          No sales / billing events in this window.
        </div>
      )}
      {data && data.rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr className="text-left text-neutral-500">
                {["when", "kind", "email", "user", "tier", "status", "provider", "paid_until"].map((h) => (
                  <th key={h} className="border-b border-neutral-200 px-2 py-2 font-normal uppercase tracking-[0.08em]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r: SaleRow, i: number) => (
                <tr key={`${r.user_id ?? "?"}-${r.at ?? i}-${i}`} className="border-b border-neutral-100">
                  <td className="px-2 py-2 text-neutral-500">{r.at?.slice(0, 19) ?? "—"}</td>
                  <td className="px-2 py-2 text-neutral-800">{r.event_kind}</td>
                  <td className="px-2 py-2 text-neutral-700">{r.email_masked ?? "—"}</td>
                  <td className="px-2 py-2 text-neutral-500">{r.user_id ?? "—"}</td>
                  <td className="px-2 py-2 text-neutral-700">{r.tier ?? "—"}</td>
                  <td className="px-2 py-2 text-neutral-700">{r.subscription_status ?? "—"}</td>
                  <td className="px-2 py-2 text-neutral-700">{r.provider ?? "—"}</td>
                  <td className="px-2 py-2 text-neutral-500">{r.paid_until?.slice(0, 19) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 font-mono text-[10px] text-neutral-500">{data.note}</p>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// Campaigns · create / edit / archive
// ---------------------------------------------------------------------
type ModalOpener = (spec: ModalSpec) => void;

function CampaignsSection({
  adminEmail: _adminEmail,
  openModal,
  onSuccess,
  onError,
}: {
  adminEmail: string;
  openModal: ModalOpener;
  onSuccess: (msg: string) => void;
  onError: (e: unknown) => void;
}) {
  const openCreate = () => {
    openModal({
      title: "Create campaign",
      description: "Adds a new SponsoredCampaign row. Slug must be unique.",
      requiredText: "CREATE CAMPAIGN",
      confirmLabel: "Create",
      destructive: false,
      fields: [
        { name: "title", label: "Title", required: true, placeholder: "Big bounty Q3" },
        { name: "slug", label: "Slug", required: true, placeholder: "big-bounty-q3", helper: "lowercase + hyphens" },
        { name: "payout_per_view", label: "Payout per view (cents · rpm_cents)", type: "number", required: true, defaultValue: 0 },
        { name: "banner_url", label: "Banner URL", placeholder: "https://…" },
        { name: "status", label: "Status", type: "select", defaultValue: "coming_soon", options: [
          { value: "coming_soon", label: "coming_soon" },
          { value: "live", label: "live" },
          { value: "partially_funded", label: "partially_funded" },
          { value: "funded", label: "funded" },
          { value: "closed", label: "closed" },
        ] },
      ],
      onConfirm: async (vals) => {
        try {
          const res = await mutationsApi.campaignCreate({
            title: vals.title,
            slug: vals.slug,
            payout_per_view: Number(vals.payout_per_view ?? 0),
            banner_url: vals.banner_url || undefined,
            status: vals.status || "coming_soon",
          });
          onSuccess(`campaign created · ${res.slug} (${res.id.slice(0, 8)}…)`);
        } catch (e) {
          onError(e);
          throw e;
        }
      },
    });
  };

  const openEdit = () => {
    openModal({
      title: "Edit campaign",
      description: "Patches one or more fields on an existing campaign (by slug). Leave blank to keep current.",
      requiredText: "EDIT CAMPAIGN",
      confirmLabel: "Save edits",
      destructive: false,
      fields: [
        { name: "slug", label: "Slug (target)", required: true, placeholder: "big-bounty-q3" },
        { name: "title", label: "New title", placeholder: "leave blank to keep" },
        { name: "payout_per_view", label: "Payout per view (cents)", type: "number", placeholder: "leave blank to keep" },
        { name: "banner_url", label: "New banner URL", placeholder: "leave blank to keep" },
        { name: "status", label: "Status", type: "select", options: [
          { value: "", label: "(keep current)" },
          { value: "coming_soon", label: "coming_soon" },
          { value: "live", label: "live" },
          { value: "partially_funded", label: "partially_funded" },
          { value: "funded", label: "funded" },
          { value: "closed", label: "closed" },
        ] },
      ],
      onConfirm: async (vals) => {
        try {
          const body: Record<string, unknown> = {};
          if (vals.title) body.title = vals.title;
          if (vals.payout_per_view !== "") body.payout_per_view = Number(vals.payout_per_view);
          if (vals.banner_url) body.banner_url = vals.banner_url;
          if (vals.status) body.status = vals.status;
          const res = await mutationsApi.campaignEdit(vals.slug, body as Parameters<typeof mutationsApi.campaignEdit>[1]);
          onSuccess(`campaign patched · ${res.slug}`);
        } catch (e) {
          onError(e);
          throw e;
        }
      },
    });
  };

  const openArchive = () => {
    openModal({
      title: "Archive campaign",
      description: "Sets the campaign's status to `archived`. The row is preserved; only the lifecycle bucket changes.",
      requiredText: "ARCHIVE CAMPAIGN",
      confirmLabel: "Archive",
      destructive: true,
      fields: [
        { name: "slug", label: "Slug (target)", required: true, placeholder: "big-bounty-q3" },
      ],
      onConfirm: async (vals) => {
        try {
          const res = await mutationsApi.campaignArchive(vals.slug);
          onSuccess(res.message);
        } catch (e) {
          onError(e);
          throw e;
        }
      },
    });
  };

  return (
    <SectionShell title="campaigns · create / edit / archive">
      <ActionButton onClick={openCreate} label="Create campaign" tone="primary" />
      <ActionButton onClick={openEdit} label="Edit campaign" tone="secondary" />
      <ActionButton onClick={openArchive} label="Archive campaign" tone="destructive" />
    </SectionShell>
  );
}

// ---------------------------------------------------------------------
// Users · tier-change / refund / ban
// ---------------------------------------------------------------------
function UsersSection({
  openModal,
  onSuccess,
  onError,
}: {
  openModal: ModalOpener;
  onSuccess: (msg: string) => void;
  onError: (e: unknown) => void;
}) {
  const openTier = () => {
    openModal({
      title: "Change user tier",
      description: "Overrides the user's tier in the DB. Whop/Clerk billing state is unchanged — this is a manual override.",
      requiredText: "TIER CHANGE",
      confirmLabel: "Change tier",
      destructive: false,
      fields: [
        { name: "user_id", label: "Backend user id", required: true, placeholder: "u_xxx" },
        { name: "tier", label: "New tier", type: "select", required: true, defaultValue: "solo", options: [
          { value: "free", label: "free" },
          { value: "solo", label: "solo" },
          { value: "pro", label: "pro" },
          { value: "growth", label: "growth" },
          { value: "agency", label: "agency" },
        ] },
        { name: "reason", label: "Reason (audit log)", type: "textarea", required: true, placeholder: "Why this manual override?" },
      ],
      onConfirm: async (vals) => {
        try {
          const res = await mutationsApi.tierChange(vals.user_id, {
            tier: vals.tier as Parameters<typeof mutationsApi.tierChange>[1]["tier"],
            reason: vals.reason,
          });
          onSuccess(res.message);
        } catch (e) {
          onError(e);
          throw e;
        }
      },
    });
  };

  const openRefund = () => {
    openModal({
      title: "Refund user",
      description: "Records the refund intent in the audit log. When WHOP_PAYMENTS_LIVE=true is set AND the refund SDK is wired, the call goes through Whop. Until then, this is log-only — reconcile in the Whop dashboard.",
      requiredText: "REFUND USER",
      confirmLabel: "Issue refund",
      destructive: true,
      fields: [
        { name: "user_id", label: "Backend user id", required: true, placeholder: "u_xxx" },
        { name: "amount_usd", label: "Amount (USD)", type: "number", required: true, defaultValue: 0 },
        { name: "currency", label: "Currency", type: "select", required: true, defaultValue: "usd", options: [
          { value: "usd", label: "usd" },
          { value: "usdc", label: "usdc" },
        ] },
        { name: "reason", label: "Reason (audit log)", type: "textarea", required: true },
      ],
      onConfirm: async (vals) => {
        try {
          const res = await mutationsApi.refund(vals.user_id, {
            amount_usd: Number(vals.amount_usd),
            currency: vals.currency as "usd" | "usdc",
            reason: vals.reason,
          });
          onSuccess(`${res.live ? "[LIVE] " : "[LOG] "}${res.message}`);
        } catch (e) {
          onError(e);
          throw e;
        }
      },
    });
  };

  const openBan = () => {
    openModal({
      title: "Ban user",
      description: "Stamps users.banned_until. Leave the date blank for an indefinite ban (~100 years).",
      requiredText: "BAN USER",
      confirmLabel: "Ban",
      destructive: true,
      fields: [
        { name: "user_id", label: "Backend user id", required: true, placeholder: "u_xxx" },
        { name: "reason", label: "Reason (audit log)", type: "textarea", required: true },
        { name: "until", label: "Until (ISO date · blank = indefinite)", type: "date", placeholder: "" },
      ],
      onConfirm: async (vals) => {
        try {
          const res = await mutationsApi.ban(vals.user_id, {
            reason: vals.reason,
            until: vals.until ? new Date(vals.until).toISOString() : null,
          });
          onSuccess(res.message);
        } catch (e) {
          onError(e);
          throw e;
        }
      },
    });
  };

  return (
    <SectionShell title="users · tier-change / refund / ban">
      <ActionButton onClick={openTier} label="Change tier" tone="secondary" />
      <ActionButton onClick={openRefund} label="Refund" tone="destructive" />
      <ActionButton onClick={openBan} label="Ban user" tone="destructive" />
    </SectionShell>
  );
}

// ---------------------------------------------------------------------
// Agents · kill / restart / rotate-key
// ---------------------------------------------------------------------
function AgentsSection({
  openModal,
  onSuccess,
  onError,
}: {
  openModal: ModalOpener;
  onSuccess: (msg: string) => void;
  onError: (e: unknown) => void;
}) {
  const openKill = () => {
    openModal({
      title: "Kill agent",
      description: "Flips AgentPersona.active=false. The fleet loop will stop sending traffic on next poll.",
      requiredText: "KILL AGENT",
      confirmLabel: "Kill",
      destructive: true,
      fields: [
        { name: "agent_id", label: "Agent id", required: true, placeholder: "a001" },
      ],
      onConfirm: async (vals) => {
        try {
          const res = await mutationsApi.agentKill(vals.agent_id);
          onSuccess(res.message);
        } catch (e) {
          onError(e);
          throw e;
        }
      },
    });
  };

  const openRestart = () => {
    openModal({
      title: "Restart agent",
      description: "Flips active off → on and bumps restart_count.",
      requiredText: "RESTART AGENT",
      confirmLabel: "Restart",
      destructive: false,
      fields: [
        { name: "agent_id", label: "Agent id", required: true, placeholder: "a001" },
      ],
      onConfirm: async (vals) => {
        try {
          const res = await mutationsApi.agentRestart(vals.agent_id);
          onSuccess(res.message);
        } catch (e) {
          onError(e);
          throw e;
        }
      },
    });
  };

  const openRotate = () => {
    openModal({
      title: "Rotate agent persona key",
      description:
        "Mints a fresh persona key. The full value is returned ONCE here — copy it before closing the modal. Only the SHA-256 hash is persisted; the audit log records only the first 4 characters.",
      requiredText: "ROTATE KEY",
      confirmLabel: "Rotate key",
      destructive: true,
      fields: [
        { name: "agent_id", label: "Agent id", required: true, placeholder: "a001" },
      ],
      onConfirm: async (vals) => {
        try {
          const res = await mutationsApi.agentRotateKey(vals.agent_id);
          // Pop the full key in a sticky alert + persist via prompt for copy.
          const pretty = `New key (copy now — won't be shown again): ${res.new_key}`;
          window.alert(pretty);
          onSuccess(`key rotated · preview ${res.new_key_preview}`);
        } catch (e) {
          onError(e);
          throw e;
        }
      },
    });
  };

  return (
    <SectionShell title="agents · kill / restart / rotate-key">
      <ActionButton onClick={openKill} label="Kill agent" tone="destructive" />
      <ActionButton onClick={openRestart} label="Restart agent" tone="secondary" />
      <ActionButton onClick={openRotate} label="Rotate key" tone="destructive" />
    </SectionShell>
  );
}

// ---------------------------------------------------------------------
// Shared scaffolding
// ---------------------------------------------------------------------
function SectionShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-neutral-200 bg-white p-5">
      <header>
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-500">
          {title}
        </div>
      </header>
      <div className="mt-3 flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

function ActionButton({
  onClick,
  label,
  tone,
}: {
  onClick: () => void;
  label: string;
  tone: "primary" | "secondary" | "destructive";
}) {
  const cls =
    tone === "primary"
      ? "bg-neutral-900 text-white hover:bg-pink-700"
      : tone === "destructive"
        ? "bg-pink-600 text-white hover:bg-pink-700"
        : "border border-neutral-300 bg-white text-neutral-900 hover:border-pink-500";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 font-mono text-[11px] uppercase tracking-[0.1em] transition ${cls}`}
    >
      {label}
    </button>
  );
}
