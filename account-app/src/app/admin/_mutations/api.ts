// HQ Agent 3 · Mutations tab — typed client.
//
// All calls go through /api/admin/mutations/[...path], the catch-all proxy
// owned by this tab (see route.ts in the sibling api/ directory). The
// browser never sees the internal admin secret.

export type ActionResult = {
  ok: boolean;
  action: string;
  target_type: string;
  target_id: string;
  audit_id: number | null;
  message: string;
};

export type SaleRow = {
  event_kind: string;
  user_id: string | null;
  email_masked: string | null;
  tier: string | null;
  subscription_status: string | null;
  provider: string | null;
  paid_until: string | null;
  at: string | null;
};

export type RecentSales = {
  count: number;
  since_hours: number;
  rows: SaleRow[];
  note: string;
};

export type CampaignRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  rpm_cents: number;
  banner_url: string | null;
  updated_at: string | null;
};

export type CampaignEditPayload = {
  title?: string;
  payout_per_view?: number;
  banner_url?: string;
  status?: string;
};

export type CampaignCreatePayload = {
  title: string;
  slug: string;
  payout_per_view: number;
  banner_url?: string;
  status?: string;
};

export type TierChangePayload = {
  tier: "free" | "solo" | "pro" | "growth" | "agency";
  reason: string;
};

// Backend admin_mutations.py:630 · `ChatRoleIn.role: Literal["member", "mod"]`.
// The endpoint's docstring is explicit: staff + founder badges derive from
// `is_admin_email` + `founder_flag`; only the "member ↔ mod" transition is
// mutable here.
export type ChatRolePayload = {
  role: "member" | "mod";
  reason: string;
};

// P1-009: RefundPayload / RefundResult types and `refund()` API removed.
// Whop owns sponsored-reward refunds, Stripe owns subscription refunds —
// the log-only stub was misleading customers with a fake green check.

export type AgentCountResponse = {
  count: number;
};

export type BanPayload = {
  reason: string;
  until?: string | null; // ISO date · null = indefinite
};

export type RotateKeyResult = {
  ok: boolean;
  action: string;
  target_id: string;
  audit_id: number | null;
  new_key: string;
  new_key_preview: string;
  message: string;
};

export type AuditRow = {
  id: number;
  actor_email: string;
  action: string;
  target_type: string;
  target_id: string;
  payload: Record<string, unknown>;
  result: string;
  error_message: string | null;
  created_at: string | null;
};

export type AuditLogResponse = {
  count: number;
  rows: AuditRow[];
};

type Init = Omit<RequestInit, "body"> & { body?: unknown; idempotenceKey?: string };

async function call<T>(path: string, init?: Init): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (init?.idempotenceKey) {
    headers["idempotence-key"] = init.idempotenceKey;
  }
  const res = await fetch(`/api/admin/mutations/${path}`, {
    cache: "no-store",
    ...init,
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      const parsed = JSON.parse(text);
      message = (parsed as { detail?: string }).detail ?? text;
    } catch {
      /* leave as text */
    }
    throw new Error(`${res.status} ${message.slice(0, 240)}`);
  }
  return JSON.parse(text) as T;
}

function freshIdem(prefix: string): string {
  // Browser-side idempotence key. Re-fired across user double-clicks in the
  // same modal session; rotate-key + critical mutations should pass this so
  // a duplicate submit in <24h is refused by the backend.
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${rand}`;
}

export const mutationsApi = {
  recentSales: (sinceHours = 72, limit = 50) =>
    call<RecentSales>(`recent-sales?limit=${limit}&since_hours=${sinceHours}`),
  campaignEdit: (slug: string, body: CampaignEditPayload) =>
    call<CampaignRow>(`campaigns/${encodeURIComponent(slug)}/edit`, {
      method: "POST",
      body,
      idempotenceKey: freshIdem(`camp-edit-${slug}`),
    }),
  campaignCreate: (body: CampaignCreatePayload) =>
    call<CampaignRow>(`campaigns/create`, {
      method: "POST",
      body,
      idempotenceKey: freshIdem(`camp-create-${body.slug}`),
    }),
  campaignArchive: (slug: string) =>
    call<ActionResult>(`campaigns/${encodeURIComponent(slug)}/archive`, {
      method: "POST",
      idempotenceKey: freshIdem(`camp-arch-${slug}`),
    }),
  tierChange: (userId: string, body: TierChangePayload) =>
    call<ActionResult>(`users/${encodeURIComponent(userId)}/tier-change`, {
      method: "POST",
      body,
      idempotenceKey: freshIdem(`tier-${userId}`),
    }),
  chatRole: (userId: string, body: ChatRolePayload) =>
    call<ActionResult>(`users/${encodeURIComponent(userId)}/chat-role`, {
      method: "POST",
      body,
      idempotenceKey: freshIdem(`chat-role-${userId}`),
    }),
  // P1-009: refund() removed — see RefundPayload comment above.
  agentsCount: () => call<AgentCountResponse>(`agents/count`),
  ban: (userId: string, body: BanPayload) =>
    call<ActionResult>(`users/${encodeURIComponent(userId)}/ban`, {
      method: "POST",
      body,
      idempotenceKey: freshIdem(`ban-${userId}`),
    }),
  agentKill: (agentId: string) =>
    call<ActionResult>(`agents/${encodeURIComponent(agentId)}/kill`, {
      method: "POST",
      idempotenceKey: freshIdem(`agent-kill-${agentId}`),
    }),
  agentRestart: (agentId: string) =>
    call<ActionResult>(`agents/${encodeURIComponent(agentId)}/restart`, {
      method: "POST",
      idempotenceKey: freshIdem(`agent-restart-${agentId}`),
    }),
  agentRotateKey: (agentId: string) =>
    call<RotateKeyResult>(`agents/${encodeURIComponent(agentId)}/rotate-key`, {
      method: "POST",
      idempotenceKey: freshIdem(`agent-rotate-${agentId}`),
    }),
  auditLog: (params?: {
    limit?: number;
    sinceHours?: number;
    userId?: string;
    action?: string;
    actor?: string;
  }) => {
    const sp = new URLSearchParams();
    if (params?.limit) sp.set("limit", String(params.limit));
    if (params?.sinceHours) sp.set("since_hours", String(params.sinceHours));
    if (params?.userId) sp.set("user_id", params.userId);
    if (params?.action) sp.set("action", params.action);
    if (params?.actor) sp.set("actor", params.actor);
    const q = sp.toString();
    return call<AuditLogResponse>(`audit-log${q ? `?${q}` : ""}`);
  },
};
