/**
 * useMe · P1-1G-a · real /me-backed account state
 *
 * Fetches the authenticated `/me` endpoint and exposes the resulting
 * snapshot through a small React hook. Reuses the P1-1F-a hardened
 * auth path:
 *   - 401/403 → calls `notifyAuthFailure()` (single-shot dampener +
 *     clears JWT + flips activation state to "failed")
 *   - network / 500 / malformed JSON → `degraded=true`, JWT preserved,
 *     last-known snapshot kept (don't blank out the UI on a flake)
 *   - 200 → snapshot updated, source = "real-http"
 *
 * Hard rules honored (P1-1G locks):
 *   - No new OAuth.
 *   - No new backend endpoints (this hook calls existing /me only).
 *   - No billing logic.
 *   - No subscription system.
 *   - No bounty:create.
 *   - No native rewards.
 *   - No UI polish.
 *   - No token logged.
 */

import { useCallback, useEffect, useState } from "react";
import { getJwt } from "../../lib/authStorage";
import { notifyAuthFailure, type FetchOutcome } from "../../lib/activation";

/* ─── Public types ──────────────────────────────────────────────────── */

export interface MeSnapshot {
  email: string | null;
  userId: string | null;            // backend_user_id
  clerkId: string | null;
  whopUserId: string | null;
  affiliateId: string | null;
  rawTier: string | null;
  effectiveTier: string | null;     // post admin-override · the value tier UI should read
  adminOverride: boolean | null;
  billingProvider: "whop" | "clerk" | null;
  subscriptionStatus: string | null;
  paidUntil: string | null;         // ISO-8601
  // 2026-07-03 · Step 2 batch 2f · server-owned authorization projection.
  // Preferred over `adminOverride` + `effectiveTier` client inference for
  // any new UI gate. See `src/lib/authz/capabilities.ts` + hasCapability().
  // adminOverride remains populated for one compat release.
  platformRole: "none" | "staff" | "admin" | null;
  capabilities: string[];            // closed-registry strings from CAP
  tenantContexts: Array<{ tenantId: string; role: string }>;
  operatingMode: "self" | "demo" | "support" | null;
  targetTenantId: string | null;
  capabilitySchemaVersion: number | null;
  /**
   * Lane 2 (Max · SPRINT_FINAL §1C · 2026-07-07) · Whop company id
   * for agency-tier users. Populated by the backend `/me` endpoint
   * once the migration lands (idempotent ALTER TABLE + selector at
   * `junior-backend/app/routes/me.py`). Frontend gates
   * "Post to Whop marketplace" button on presence · null until
   * backend catches up.
   */
  whopCompanyId?: string | null;
}

export type MeSource =
  | "real-http"      // fetched live and cached
  | "session-cache"  // returned cached value · last fetch was real
  | "unknown";       // never fetched · no cache

export interface MeApi {
  snapshot: MeSnapshot | null;
  loading: boolean;
  error: string | null;
  /** True when the last fetch failed for a non-auth reason (network /
   *  5xx / malformed JSON). The snapshot is the previous live value
   *  when this is true · OR null if we never had one. */
  degraded: boolean;
  source: MeSource;
  reload: () => Promise<void>;
}

/* ─── Module-private cache ──────────────────────────────────────────── */

let cachedSnapshot: MeSnapshot | null = null;
let cachedSource: MeSource = "unknown";
let cachedError: string | null = null;
let cachedDegraded = false;
let inFlight: Promise<void> | null = null;

const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/* ─── Backend URL helper · inlined to keep this module self-contained */

function lcBackendUrl(): string {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const v = (import.meta as any).env?.VITE_BACKEND_URL as string | undefined;
    if (typeof v === "string" && v.length > 0) return v;
  } catch { /* noop */ }
  return "https://api.liquidclips.app";
}

/* ─── Backend response shape (snake_case) ───────────────────────────── */

interface MeBackendResponse {
  backend_user_id?: string;
  clerk_id?: string;
  email?: string;
  whop_user_id?: string | null;
  affiliate_id?: string | null;
  raw_tier?: string;
  effective_tier?: string;
  admin_override?: boolean;
  billing_provider?: "whop" | "clerk";
  subscription_status?: string;
  paid_until?: string | null;
  // 2026-07-03 · Step 2 batch 2b/2f additions.
  platform_role?: "none" | "staff" | "admin";
  capabilities?: string[];
  tenant_contexts?: Array<{ tenant_id: string; role: string }>;
  operating_mode?: "self" | "demo" | "support";
  target_tenant_id?: string | null;
  capability_schema_version?: number;
}

function adaptMe(b: MeBackendResponse): MeSnapshot {
  return {
    email:              typeof b.email === "string" ? b.email : null,
    userId:             typeof b.backend_user_id === "string" ? b.backend_user_id : null,
    clerkId:            typeof b.clerk_id === "string" ? b.clerk_id : null,
    whopUserId:         typeof b.whop_user_id === "string" ? b.whop_user_id : null,
    affiliateId:        typeof b.affiliate_id === "string" ? b.affiliate_id : null,
    rawTier:            typeof b.raw_tier === "string" ? b.raw_tier : null,
    effectiveTier:      typeof b.effective_tier === "string" ? b.effective_tier : null,
    adminOverride:      typeof b.admin_override === "boolean" ? b.admin_override : null,
    billingProvider:    b.billing_provider === "whop" || b.billing_provider === "clerk" ? b.billing_provider : null,
    subscriptionStatus: typeof b.subscription_status === "string" ? b.subscription_status : null,
    paidUntil:          typeof b.paid_until === "string" ? b.paid_until : null,
    platformRole:       b.platform_role === "none" || b.platform_role === "staff" || b.platform_role === "admin" ? b.platform_role : null,
    capabilities:       Array.isArray(b.capabilities) ? b.capabilities.filter((c): c is string => typeof c === "string") : [],
    tenantContexts:     Array.isArray(b.tenant_contexts)
                          ? b.tenant_contexts
                              .filter((t): t is { tenant_id: string; role: string } =>
                                !!t && typeof t.tenant_id === "string" && typeof t.role === "string")
                              .map((t) => ({ tenantId: t.tenant_id, role: t.role }))
                          : [],
    operatingMode:      b.operating_mode === "self" || b.operating_mode === "demo" || b.operating_mode === "support" ? b.operating_mode : null,
    targetTenantId:     typeof b.target_tenant_id === "string" ? b.target_tenant_id : null,
    capabilitySchemaVersion: typeof b.capability_schema_version === "number" ? b.capability_schema_version : null,
  };
}

/* ─── Hardened /me fetch · reuses P1-1F-a FetchOutcome pattern ──────── */

async function safeFetchMe(jwt: string): Promise<FetchOutcome<MeBackendResponse>> {
  try {
    const r = await fetch(`${lcBackendUrl()}/me`, {
      cache: "no-store",
      headers: { authorization: `Bearer ${jwt}` },
    });
    if (r.status === 401 || r.status === 403) {
      return { kind: "auth-fail", status: r.status };
    }
    if (!r.ok) {
      return { kind: "server-error", status: r.status };
    }
    try {
      const data = (await r.json()) as MeBackendResponse;
      return { kind: "ok", data };
    } catch {
      return { kind: "server-error", status: r.status };
    }
  } catch {
    return { kind: "network" };
  }
}

/* ─── Public loader · single-flight ─────────────────────────────────── */

/** Trigger a /me fetch. Single-flight · if a fetch is already in flight,
 *  subsequent calls await the same promise. */
export async function loadMe(): Promise<void> {
  if (inFlight) return inFlight;
  const jwt = getJwt();
  if (!jwt) {
    // No license · no snapshot to fetch · honest reset.
    cachedSnapshot = null;
    cachedSource = "unknown";
    cachedError = null;
    cachedDegraded = false;
    emit();
    return;
  }
  inFlight = (async () => {
    try {
      const out = await safeFetchMe(jwt);
      if (out.kind === "auth-fail") {
        // P1-1F-a integration · single-shot self-heal · backend
        // rejected this JWT explicitly.
        notifyAuthFailure(
          "Session was rejected by /me · please sign in again.",
        );
        cachedSnapshot = null;
        cachedSource = "unknown";
        cachedError = `Backend rejected the license (${out.status}).`;
        cachedDegraded = false;
        emit();
        return;
      }
      if (out.kind === "ok") {
        cachedSnapshot = adaptMe(out.data);
        cachedSource = "real-http";
        cachedError = null;
        cachedDegraded = false;
        emit();
        return;
      }
      // network or server-error · preserve last snapshot · mark degraded.
      if (cachedSnapshot) {
        cachedSource = "session-cache";
      }
      cachedDegraded = true;
      cachedError = out.kind === "network"
        ? "Couldn't reach backend · /me network failure."
        : `Backend returned ${out.status} on /me.`;
      emit();
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/* ─── React hook ────────────────────────────────────────────────────── */

export function useMe(): MeApi {
  // useState carries a tick counter so each emit triggers a re-render.
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    /* Trigger an initial fetch only if we don't have a cached value.
     * Multiple consumers landing on first mount share the same in-flight
     * promise via the loadMe() single-flight guard. */
    if (cachedSource === "unknown" && !inFlight) {
      void loadMe();
    }
    return () => { listeners.delete(listener); };
  }, []);

  const reload = useCallback(async () => {
    await loadMe();
  }, []);

  return {
    snapshot: cachedSnapshot,
    loading: !!inFlight,
    error: cachedError,
    degraded: cachedDegraded,
    source: cachedSource,
    reload,
  };
}

/* ─── Test seam ─────────────────────────────────────────────────────── */

/** Reset the module-private cache. Test-only. */
export function _resetMeForTests(): void {
  cachedSnapshot = null;
  cachedSource = "unknown";
  cachedError = null;
  cachedDegraded = false;
  inFlight = null;
  listeners.clear();
}
