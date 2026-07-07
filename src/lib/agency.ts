/**
 * Agency cockpit client — Stage 5 client-hook layer.
 *
 * Wraps the 12 `/agency/*` endpoints (roster + invites + payout-splits
 * + rules + whop-sync) shipped in `junior-backend/app/routes/agency.py`
 * behind:
 *   • Async fetchers · 1:1 with the backend contract, typed responses,
 *     transport-error boundaries that return a `{state, error}` result
 *     rather than throwing (matches the pattern in `src/lib/chat.ts`).
 *   • React hooks `useAgencyRoster` / `usePayoutSplits` /
 *     `useAgencyRules` · poll-on-mount + on-`activation:complete`,
 *     stale-response guards, and consistent `{data, isLoading, state,
 *     error, reload}` return shape.
 *   • `validatePayoutBatch()` · mirrors the backend Pydantic
 *     `PayoutSplitBatchIn._sum_to_100_and_unique` validator so the UI
 *     catches drift BEFORE hitting the network.
 *
 * Intentionally does NOT render anything. `Settings.tsx` is locked; a
 * follow-up sprint will consume these hooks under the visual-approval
 * lift documented at `CLAUDE_DESKTOP2_UI_MASTER.md:852`.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { getJwt } from "./authStorage";
import { useEvent } from "../design-os/bridge";
// ag-03 / ag-04 / ag-05 / ag-06 (2026-07-06) · Sovereign-Operator Protocol
// wraps the roster mutation helpers so every failed invite / revoke /
// remove / role flip lands in the HQ Admin dashboard for triage instead
// of being lost inside a per-panel try/catch. See
// docs/PROTOCOL_SELF_HEALING_NODES.md.
import { watchdogWrap } from "./watchdog";

// ---------------------------------------------------------------------
// Types — mirror `junior-backend/app/routes/agency.py` Pydantic shapes
// ---------------------------------------------------------------------

export type MemberRole = "member" | "mod";
export type MemberStatus = "active" | "disabled";
export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export interface AgencyMember {
  id: number;
  agency_id: string;
  user_id: string;
  email: string | null;
  handle: string | null;
  role: MemberRole;
  status: MemberStatus;
  joined_at: string;
  invited_by_user_id: string | null;
}

export interface AgencyInvite {
  id: string;
  agency_id: string;
  email: string;
  role: MemberRole;
  status: InviteStatus;
  expires_at: string;
  created_at: string;
}

export interface Roster {
  members: AgencyMember[];
  pending_invites: AgencyInvite[];
}

export interface MemberSplit {
  member_user_id: string;
  percent_bps: number;
  updated_at: string;
  updated_by_user_id: string;
}

export interface PayoutSplitList {
  splits: MemberSplit[];
  total_bps: number;
  sums_to_100: boolean;
}

/** Client-side draft split — used by the UI before a batch is
 *  submitted. `updated_at` / `updated_by_user_id` are server-owned. */
export interface DraftSplit {
  member_user_id: string;
  percent_bps: number;
}

export type RuleValue = null | boolean | number | string | RuleValue[] | { [k: string]: RuleValue };

export interface AgencyRule {
  key: string;
  value: RuleValue;
  updated_at: string;
  updated_by_user_id: string;
}

export interface RulesList {
  rules: AgencyRule[];
}

export interface WhopSyncItem {
  member_user_id: string;
  previous_status: MemberStatus;
  new_status: MemberStatus;
  subscription_status: string | null;
  paid_until: string | null;
}

export interface WhopSyncResult {
  checked: number;
  changed: number;
  items: WhopSyncItem[];
}

export type AgencyConnectionState =
  | "idle"
  | "loading"
  | "ready"
  | "forbidden"
  | "offline"
  | "error";

export interface FetchResult<T> {
  data: T | null;
  state: Exclude<AgencyConnectionState, "idle" | "loading">;
  error: string | null;
  /** Response HTTP status when reachable; null when the request never
   *  landed (fetch threw / network offline). */
  status: number | null;
}

// ---------------------------------------------------------------------
// URL + auth helpers · match the pattern in src/lib/chat.ts
// ---------------------------------------------------------------------

const BPS_TOTAL = 10_000;
const POLL_INTERVAL_MS = 10_000;

function backendUrl(): string {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const v = (import.meta as any).env?.VITE_BACKEND_URL as string | undefined;
    if (typeof v === "string" && v.length > 0) return v;
  } catch {
    /* noop */
  }
  return "https://api.liquidclips.app";
}

function authHeader(): Record<string, string> {
  const jwt = getJwt();
  return jwt ? { authorization: `Bearer ${jwt}` } : {};
}

async function agencyFetch<T>(
  path: string,
  init: RequestInit = {},
  isValid?: (value: unknown) => value is T,
): Promise<FetchResult<T>> {
  const jwt = getJwt();
  if (!jwt) {
    return {
      data: null,
      state: "forbidden",
      error: "Sign in to reach the agency cockpit.",
      status: 401,
    };
  }
  try {
    const r = await fetch(`${backendUrl()}${path}`, {
      cache: "no-store",
      ...init,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...authHeader(),
        ...(init.headers as Record<string, string> | undefined ?? {}),
      },
    });
    if (r.status === 204) {
      return { data: null, state: "ready", error: null, status: 204 };
    }
    let bodyText: string | null = null;
    let parsed: unknown = null;
    try {
      bodyText = await r.text();
      parsed = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      parsed = null;
    }
    if (r.status === 401 || r.status === 403) {
      return {
        data: null,
        state: "forbidden",
        error: extractDetail(parsed) ?? "Not authorised for this agency.",
        status: r.status,
      };
    }
    if (!r.ok) {
      return {
        data: null,
        state: "error",
        error: extractDetail(parsed) ?? `${path} returned ${r.status}.`,
        status: r.status,
      };
    }
    if (isValid && !isValid(parsed)) {
      return {
        data: null,
        state: "error",
        error: `${path} returned an invalid response.`,
        status: r.status,
      };
    }
    return { data: parsed as T, state: "ready", error: null, status: r.status };
  } catch {
    return {
      data: null,
      state: "offline",
      error: "Agency cockpit is offline. Check your connection and retry.",
      status: null,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRoster(value: unknown): value is Roster {
  return isRecord(value)
    && Array.isArray(value.members)
    && Array.isArray(value.pending_invites);
}

function isPayoutSplitList(value: unknown): value is PayoutSplitList {
  return isRecord(value)
    && Array.isArray(value.splits)
    && typeof value.total_bps === "number"
    && typeof value.sums_to_100 === "boolean";
}

function isRulesList(value: unknown): value is RulesList {
  return isRecord(value) && Array.isArray(value.rules);
}

/** FastAPI validation errors return `{detail: [{msg, ...}]}`; server
 *  errors return `{detail: "message"}`. This helper flattens both. */
function extractDetail(parsed: unknown): string | null {
  if (parsed == null || typeof parsed !== "object") return null;
  const detail = (parsed as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((d) => (d && typeof d === "object" ? (d as { msg?: string }).msg : null))
      .filter((m): m is string => typeof m === "string" && m.length > 0);
    if (messages.length > 0) return messages.join(" · ");
  }
  return null;
}

// ---------------------------------------------------------------------
// Fetchers · 1:1 with the backend router
// ---------------------------------------------------------------------

export const fetchRoster = (agencyId: string): Promise<FetchResult<Roster>> =>
  agencyFetch<Roster>(
    `/agency/${encodeURIComponent(agencyId)}/roster`,
    {},
    isRoster,
  );

export const postInvite = watchdogWrap(
  {
    id: "agency/ag-03/roster-invite",
    label: "Roster invite by email",
    cluster: "agency",
    source: "src/lib/agency.ts:postInvite (backend agency.py:429)",
  },
  (
    agencyId: string,
    payload: { email: string; role?: MemberRole },
  ): Promise<FetchResult<AgencyInvite>> =>
    agencyFetch<AgencyInvite>(
      `/agency/${encodeURIComponent(agencyId)}/roster/invite`,
      { method: "POST", body: JSON.stringify(payload) },
    ),
);

export const postAcceptInvite = (
  token: string,
): Promise<FetchResult<{ ok: boolean; agency_id: string; member_id: number; role: MemberRole }>> =>
  agencyFetch(
    `/agency/invites/${encodeURIComponent(token)}/accept`,
    { method: "POST" },
  );

export const postRevokeInvite = watchdogWrap(
  {
    id: "agency/ag-04/revoke-invite",
    label: "Revoke pending invite",
    cluster: "agency",
    source: "src/lib/agency.ts:postRevokeInvite (backend agency.py:700)",
  },
  (
    agencyId: string,
    inviteId: string,
  ): Promise<FetchResult<AgencyInvite>> =>
    agencyFetch<AgencyInvite>(
      `/agency/${encodeURIComponent(agencyId)}/roster/invite/${encodeURIComponent(inviteId)}/revoke`,
      { method: "POST" },
    ),
);

export const deleteMember = watchdogWrap(
  {
    id: "agency/ag-05/remove-member",
    label: "Remove roster member",
    cluster: "agency",
    source: "src/lib/agency.ts:deleteMember (backend agency.py:743)",
  },
  (
    agencyId: string,
    memberUserId: string,
  ): Promise<FetchResult<AgencyMember>> =>
    agencyFetch<AgencyMember>(
      `/agency/${encodeURIComponent(agencyId)}/roster/${encodeURIComponent(memberUserId)}`,
      { method: "DELETE" },
    ),
);

export const postChangeRole = watchdogWrap(
  {
    id: "agency/ag-06/change-role",
    label: "Change member role",
    cluster: "agency",
    source: "src/lib/agency.ts:postChangeRole (backend agency.py:799)",
  },
  (
    agencyId: string,
    memberUserId: string,
    role: MemberRole,
  ): Promise<FetchResult<AgencyMember>> =>
    agencyFetch<AgencyMember>(
      `/agency/${encodeURIComponent(agencyId)}/roster/${encodeURIComponent(memberUserId)}/role`,
      { method: "POST", body: JSON.stringify({ role }) },
    ),
);

export const fetchPayoutSplits = (
  agencyId: string,
): Promise<FetchResult<PayoutSplitList>> =>
  agencyFetch<PayoutSplitList>(
    `/agency/${encodeURIComponent(agencyId)}/payout-splits`,
    {},
    isPayoutSplitList,
  );

// ag-08 (2026-07-06) · Sovereign-Operator Protocol wraps the payout-
// splits PUT so a mid-save network hiccup or 5xx surfaces on the HQ
// Admin dashboard instead of being lost in PayoutSplitPanel's try/catch.
// This is a MONEY MOMENT — every clipper's income is defined here.
export const putPayoutSplits = watchdogWrap(
  {
    id: "agency/ag-08/payout-splits-put",
    label: "Save payout splits",
    cluster: "agency",
    source: "src/lib/agency.ts:putPayoutSplits (backend agency.py PUT /payout-splits)",
  },
  (
    agencyId: string,
    splits: DraftSplit[],
  ): Promise<FetchResult<PayoutSplitList>> =>
    agencyFetch<PayoutSplitList>(
      `/agency/${encodeURIComponent(agencyId)}/payout-splits`,
      { method: "PUT", body: JSON.stringify({ splits }) },
    ),
);

export const fetchRules = (
  agencyId: string,
): Promise<FetchResult<RulesList>> =>
  agencyFetch<RulesList>(
    `/agency/${encodeURIComponent(agencyId)}/rules`,
    {},
    isRulesList,
  );

export const putRule = (
  agencyId: string,
  key: string,
  value: RuleValue,
): Promise<FetchResult<AgencyRule>> =>
  agencyFetch<AgencyRule>(
    `/agency/${encodeURIComponent(agencyId)}/rules/${encodeURIComponent(key)}`,
    { method: "PUT", body: JSON.stringify({ value }) },
  );

export const deleteRule = (
  agencyId: string,
  key: string,
): Promise<FetchResult<null>> =>
  agencyFetch<null>(
    `/agency/${encodeURIComponent(agencyId)}/rules/${encodeURIComponent(key)}`,
    { method: "DELETE" },
  );

export const postWhopSync = (
  agencyId: string,
): Promise<FetchResult<WhopSyncResult>> =>
  agencyFetch<WhopSyncResult>(
    `/agency/${encodeURIComponent(agencyId)}/whop-sync`,
    { method: "POST" },
  );

// ---------------------------------------------------------------------
// Client-side payout-batch validator · mirrors the backend Pydantic
// `PayoutSplitBatchIn._sum_to_100_and_unique` invariant so the UI
// intercepts bad input BEFORE the network round-trip.
// ---------------------------------------------------------------------

export interface PayoutValidation {
  ok: boolean;
  total_bps: number;
  error: string | null;
  /** When known, the offending member id (duplicate case). */
  offending_member_id: string | null;
}

/** Validate a draft batch against the sum-to-100 + unique-member
 *  invariants BEFORE hitting the network. Returns `{ok:true}` when the
 *  batch is safe to send; otherwise a precise error message the UI can
 *  surface as a toast. */
export function validatePayoutBatch(splits: DraftSplit[]): PayoutValidation {
  // Guard non-integer / negative / oversize values up front — the
  // backend rejects them via `Field(..., ge=0, le=10_000)` but a
  // client-side check saves a round-trip and lets the UI point at the
  // bad row directly.
  for (const s of splits) {
    if (!Number.isInteger(s.percent_bps)) {
      return {
        ok: false,
        total_bps: 0,
        error: `${s.member_user_id}: percent must be a whole basis-points integer (1% = 100 bps).`,
        offending_member_id: s.member_user_id,
      };
    }
    if (s.percent_bps < 0 || s.percent_bps > BPS_TOTAL) {
      return {
        ok: false,
        total_bps: 0,
        error: `${s.member_user_id}: percent must be between 0 and ${BPS_TOTAL} bps (0..100%).`,
        offending_member_id: s.member_user_id,
      };
    }
  }
  // Duplicate-member guard.
  const seen = new Set<string>();
  for (const s of splits) {
    if (seen.has(s.member_user_id)) {
      return {
        ok: false,
        total_bps: splits.reduce((t, x) => t + x.percent_bps, 0),
        error: `Duplicate member in splits batch: ${s.member_user_id}. Every member appears at most once.`,
        offending_member_id: s.member_user_id,
      };
    }
    seen.add(s.member_user_id);
  }
  const total = splits.reduce((t, x) => t + x.percent_bps, 0);
  if (total !== BPS_TOTAL) {
    const asPct = (total / 100).toFixed(2);
    return {
      ok: false,
      total_bps: total,
      error: `Splits must sum to 100% (${BPS_TOTAL} bps). Currently ${asPct}%.`,
      offending_member_id: null,
    };
  }
  return { ok: true, total_bps: total, error: null, offending_member_id: null };
}

// ---------------------------------------------------------------------
// React hooks · poll-on-mount + reload on activation:complete.
// Every hook returns the same shape so callers can render consistently:
// `{data, isLoading, state, error, reload}` — plus per-hook mutation
// callbacks where the pane needs to write.
// ---------------------------------------------------------------------

function useReloadableFetch<T>(
  fetcher: (() => Promise<FetchResult<T>>) | null,
): {
  data: T | null;
  isLoading: boolean;
  state: AgencyConnectionState;
  error: string | null;
  status: number | null;
  reload: () => Promise<void>;
} {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [state, setState] = useState<AgencyConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [statusCode, setStatusCode] = useState<number | null>(null);
  const cancelled = useRef(false);
  // Latest fetcher captured in a ref so `reload` has a stable identity
  // even when the caller passes an inline arrow.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = useCallback(async () => {
    const fn = fetcherRef.current;
    if (!fn) return;
    setLoading(true);
    setState((current) => (current === "idle" ? "loading" : current));
    const result = await fn();
    if (cancelled.current) return;
    setData(result.data);
    setState(result.state);
    setError(result.error);
    setStatusCode(result.status);
    setLoading(false);
  }, []);

  useEffect(() => {
    cancelled.current = false;
    if (!fetcher) {
      setData(null);
      setState("idle");
      setError(null);
      setStatusCode(null);
      return () => {
        cancelled.current = true;
      };
    }
    void reload();
    const id = window.setInterval(() => {
      void reload();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled.current = true;
      window.clearInterval(id);
    };
    // Callers pass a NEW inline `fetcher` on every render; `reload`
    // itself is stable via ref. Trigger the effect only on the
    // agency-id-derived change signalled by the caller (see the
    // callsite hook wrappers below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(fetcher), reload]);

  useEvent("activation:complete", () => {
    void reload();
  });

  return { data, isLoading, state, error, status: statusCode, reload };
}

/** Roster hook · returns members + pending invites plus 4 mutation
 *  helpers. Pass `null` for `agencyId` to disable the poll. */
export function useAgencyRoster(agencyId: string | null): {
  data: Roster | null;
  isLoading: boolean;
  state: AgencyConnectionState;
  error: string | null;
  reload: () => Promise<void>;
  invite: (email: string, role?: MemberRole) => Promise<FetchResult<AgencyInvite>>;
  revokeInvite: (inviteId: string) => Promise<FetchResult<AgencyInvite>>;
  removeMember: (memberUserId: string) => Promise<FetchResult<AgencyMember>>;
  changeRole: (memberUserId: string, role: MemberRole) => Promise<FetchResult<AgencyMember>>;
  syncWhop: () => Promise<FetchResult<WhopSyncResult>>;
} {
  const fetcher = agencyId ? () => fetchRoster(agencyId) : null;
  const base = useReloadableFetch<Roster>(fetcher);

  const invite = useCallback(
    async (email: string, role: MemberRole = "member") => {
      if (!agencyId) return offlineResult<AgencyInvite>("Not signed in to an agency.");
      const result = await postInvite(agencyId, { email, role });
      if (result.state === "ready") await base.reload();
      return result;
    },
    [agencyId, base],
  );
  const revokeInvite = useCallback(
    async (inviteId: string) => {
      if (!agencyId) return offlineResult<AgencyInvite>("Not signed in to an agency.");
      const result = await postRevokeInvite(agencyId, inviteId);
      if (result.state === "ready") await base.reload();
      return result;
    },
    [agencyId, base],
  );
  const removeMember = useCallback(
    async (memberUserId: string) => {
      if (!agencyId) return offlineResult<AgencyMember>("Not signed in to an agency.");
      const result = await deleteMember(agencyId, memberUserId);
      if (result.state === "ready") await base.reload();
      return result;
    },
    [agencyId, base],
  );
  const changeRole = useCallback(
    async (memberUserId: string, role: MemberRole) => {
      if (!agencyId) return offlineResult<AgencyMember>("Not signed in to an agency.");
      const result = await postChangeRole(agencyId, memberUserId, role);
      if (result.state === "ready") await base.reload();
      return result;
    },
    [agencyId, base],
  );
  const syncWhop = useCallback(async () => {
    if (!agencyId) return offlineResult<WhopSyncResult>("Not signed in to an agency.");
    const result = await postWhopSync(agencyId);
    if (result.state === "ready") await base.reload();
    return result;
  }, [agencyId, base]);

  return {
    data: base.data,
    isLoading: base.isLoading,
    state: base.state,
    error: base.error,
    reload: base.reload,
    invite,
    revokeInvite,
    removeMember,
    changeRole,
    syncWhop,
  };
}

/** Payout-splits hook · read state + a batch-replace mutator that runs
 *  the client-side sum-to-100 + unique-member validator BEFORE the
 *  network call. The validation result is returned so the pane can
 *  show a precise toast on rejection. */
export function usePayoutSplits(agencyId: string | null): {
  data: PayoutSplitList | null;
  isLoading: boolean;
  state: AgencyConnectionState;
  error: string | null;
  reload: () => Promise<void>;
  /** Replace the entire splits table. Runs `validatePayoutBatch`
   *  first — if it returns `{ok:false}`, the network call is skipped
   *  and the validation object is surfaced as `.validation`. */
  replaceSplits: (splits: DraftSplit[]) => Promise<{
    validation: PayoutValidation;
    result: FetchResult<PayoutSplitList> | null;
  }>;
} {
  const fetcher = agencyId ? () => fetchPayoutSplits(agencyId) : null;
  const base = useReloadableFetch<PayoutSplitList>(fetcher);

  const replaceSplits = useCallback(
    async (splits: DraftSplit[]) => {
      const validation = validatePayoutBatch(splits);
      if (!validation.ok || !agencyId) {
        return { validation, result: null };
      }
      const result = await putPayoutSplits(agencyId, splits);
      if (result.state === "ready") await base.reload();
      return { validation, result };
    },
    [agencyId, base],
  );

  return {
    data: base.data,
    isLoading: base.isLoading,
    state: base.state,
    error: base.error,
    reload: base.reload,
    replaceSplits,
  };
}

/** Rules hook · read + upsert + delete. `upsertRule` writes a single
 *  key; the value is opaque JSON to the server (typed as `RuleValue`
 *  here so the client compiler enforces JSON-serialisability). */
export function useAgencyRules(agencyId: string | null): {
  data: RulesList | null;
  isLoading: boolean;
  state: AgencyConnectionState;
  error: string | null;
  reload: () => Promise<void>;
  upsertRule: (key: string, value: RuleValue) => Promise<FetchResult<AgencyRule>>;
  removeRule: (key: string) => Promise<FetchResult<null>>;
} {
  const fetcher = agencyId ? () => fetchRules(agencyId) : null;
  const base = useReloadableFetch<RulesList>(fetcher);

  const upsertRule = useCallback(
    async (key: string, value: RuleValue) => {
      if (!agencyId) return offlineResult<AgencyRule>("Not signed in to an agency.");
      const result = await putRule(agencyId, key, value);
      if (result.state === "ready") await base.reload();
      return result;
    },
    [agencyId, base],
  );
  const removeRule = useCallback(
    async (key: string) => {
      if (!agencyId) return offlineResult<null>("Not signed in to an agency.");
      const result = await deleteRule(agencyId, key);
      if (result.state === "ready") await base.reload();
      return result;
    },
    [agencyId, base],
  );

  return {
    data: base.data,
    isLoading: base.isLoading,
    state: base.state,
    error: base.error,
    reload: base.reload,
    upsertRule,
    removeRule,
  };
}

function offlineResult<T>(msg: string): FetchResult<T> {
  return { data: null, state: "forbidden", error: msg, status: null };
}
