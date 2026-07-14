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
import { lcDiag } from "../../lib/diagnosticLogger";

/* ─── Public types ──────────────────────────────────────────────────── */

/**
 * BUG-015 · BC-002 class-elimination · 2026-07-12.
 *
 * Canonical union type for the identity ladder rung a consumer must
 * render. Every hook / selector returning a runtime ``kind`` MUST type
 * it as ``IdentityKind`` (or ``IdentityKind | null`` for surfaces that
 * legitimately have "no identity yet" — pre-JWT idle state).
 *
 * Membership:
 *   - ``handle``            — user-picked ``@handle`` present.
 *   - ``lc-id``             — canonical LC-XXXXXX id present, no handle.
 *   - ``email-local``       — email local-part is the last honest rung.
 *   - ``signing-in``        — JWT present but /me hydration in progress.
 *   - ``complete-profile``  — hydrated snapshot but ladder produced no
 *                             renderable name; user needs to claim one.
 *
 * Any code path that would emit a value outside this union is either a
 * bug or a needed union extension. The runtime assertion in ``useMe``
 * fires ``me_hydration_kind_drift`` telemetry in dev builds when drift
 * is observed so the drift is visible, not silent. Do NOT throw — this
 * is an observability rail, not a control-flow gate.
 */
export type IdentityKind =
  | "handle"
  | "lc-id"
  | "email-local"
  | "signing-in"
  | "complete-profile";

/** Runtime allow-list · MUST match ``IdentityKind`` exactly. Used by the
 *  dev-only drift assertion in ``useMe`` since TS types are erased. */
const IDENTITY_KIND_SET: ReadonlySet<string> = new Set<IdentityKind>([
  "handle",
  "lc-id",
  "email-local",
  "signing-in",
  "complete-profile",
]);

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
  /**
   * Wave 1 · Cluster 1 · identity ladder (2026-07-12).
   *
   * ``lcId`` — customer-facing sign-in ID, format ``LC-XXXXXX``. Lazy-
   * minted on Whop membership_valid or via ``POST /lc-ids/mint-for-user``.
   * TopHud + SplashLeaderboard use this as the second rung of the
   * identity ladder (below ``handle``, above transient ``Signing in…``).
   *
   * ``handle`` — self-picked public handle, format
   * ``^[a-z0-9_]{3,20}$``. Set via the first-run ``ClaimHandleSheet``
   * (``POST /me/lc-id/claim``) or the legacy ``PATCH /me/handle`` in
   * AffiliateWidget. Highest rung of the ladder.
   *
   * Both are null until the backend response provides them; TopHud
   * NEVER falls to the string ``"Guest"`` for a JWT-holding user —
   * during pure hydration it renders ``"Signing in…"`` and after
   * hydration it renders whichever ladder rung is available (handle →
   * lc_id → null-render).
   */
  lcId: string | null;
  handle: string | null;
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
  /**
   * BUG-015 · BC-002 · identity ladder classification (2026-07-12).
   *
   * Canonical rung the consumer should render. ``null`` means "no
   * identity yet" — pre-JWT idle state. Every non-null value is a
   * member of ``IdentityKind``. Consumers may safely narrow on this
   * union in exhaustive switches. The dev-only runtime assertion
   * inside ``useMe`` emits ``me_hydration_kind_drift`` if a value
   * outside the union ever reaches this field.
   */
  kind: IdentityKind | null;
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

/* ─── BUG-015 · BC-002 · hydration state machine ────────────────────── */

/**
 * Hydration state machine · 4 transitions (2026-07-12).
 *
 *   idle            ──loadMe()──▶     started
 *   started         ──/me 200──▶     succeeded
 *   started         ──/me err──▶     failed
 *   started         ──8s no r──▶     stalled
 *
 * Each transition emits a topic on the ``lcDiag`` rail. Payloads are
 * intentionally boolean / scalar only — no PII / no JWT / no email.
 * See BUG-015 in ``lcos/09_BUG_LEDGER.md`` for close-only conditions.
 *
 * ``me_snapshot_hydrated`` is preserved (BUG-002 close conditions cite
 * it). ``me_hydration_succeeded`` is the successor topic — new
 * consumers should subscribe to it. Do NOT remove ``me_snapshot_hydrated``
 * until every consumer is migrated (deferred to a later wave).
 */

/** Configurable stall threshold. Contract value: 8000ms. Exposed as
 *  constant so tests can advance a fake timer past it deterministically. */
export const ME_HYDRATION_STALL_MS = 8000;

let hydrationStartTs: number | null = null;
let hydrationStallTimer: ReturnType<typeof setTimeout> | null = null;
let hydrationResolved = false; // true once succeeded / failed / stalled fired

function clearHydrationStallTimer(): void {
  if (hydrationStallTimer !== null) {
    clearTimeout(hydrationStallTimer);
    hydrationStallTimer = null;
  }
}

function emitHydrationTransition(
  topic:
    | "me_hydration_started"
    | "me_hydration_succeeded"
    | "me_hydration_stalled"
    | "me_hydration_failed",
  extra: Record<string, unknown> = {},
): void {
  try {
    const now = Date.now();
    const elapsedMs =
      hydrationStartTs === null ? 0 : Math.max(0, now - hydrationStartTs);
    lcDiag(topic, {
      hasJwt: getJwt() !== null,
      source: cachedSource,
      elapsedMs,
      hasLcId: !!cachedSnapshot?.lcId,
      hasHandle: !!cachedSnapshot?.handle,
      ...extra,
    });
  } catch {
    /* diagnostic failures never block a state emit */
  }
}

function beginHydration(): void {
  clearHydrationStallTimer();
  hydrationStartTs = Date.now();
  hydrationResolved = false;
  emitHydrationTransition("me_hydration_started");
  // 8s stall watchdog · fires once, only if neither succeeded nor failed
  // resolved the machine first. Any timer platform (jsdom / node / real
  // browser) is fine — clamp is milliseconds.
  hydrationStallTimer = setTimeout(() => {
    if (!hydrationResolved) {
      hydrationResolved = true;
      emitHydrationTransition("me_hydration_stalled");
    }
    hydrationStallTimer = null;
  }, ME_HYDRATION_STALL_MS);
}

function resolveHydrationSucceeded(): void {
  if (hydrationResolved) return;
  hydrationResolved = true;
  clearHydrationStallTimer();
  emitHydrationTransition("me_hydration_succeeded");
}

function resolveHydrationFailed(payload: {
  cause: "network" | "server-error" | "auth-fail";
  status?: number;
}): void {
  if (hydrationResolved) return;
  hydrationResolved = true;
  clearHydrationStallTimer();
  emitHydrationTransition("me_hydration_failed", payload);
}

/**
 * Wave 1 · identity ladder telemetry.
 *
 * Fire ``me_snapshot_hydrated`` when the source transitions FROM
 * ``unknown`` TO a real value (``real-http`` or ``session-cache``).
 * Downstream consumers (HQ + Doctor) use this to prove the identity
 * ladder had data to render at the moment TopHud attempted to derive
 * its identity copy. Payload is intentionally boolean-only so no PII
 * leaks into the diagnostic rail. See ``lcos/09_BUG_LEDGER.md``
 * BUG-002 closes_only_when #4.
 */
function emitHydratedTelemetry(nextSource: MeSource): void {
  if (nextSource !== "real-http" && nextSource !== "session-cache") return;
  try {
    lcDiag("me_snapshot_hydrated", {
      source: nextSource,
      hasLcId: !!cachedSnapshot?.lcId,
      hasHandle: !!cachedSnapshot?.handle,
    });
  } catch {
    /* diagnostic failures never block a state emit */
  }
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
  // Lane 2 (Max · SPRINT_FINAL §1C · 2026-07-07) · agency whop id.
  whop_company_id?: string | null;
  // Wave 1 · identity ladder (2026-07-12) · snake_case from backend.
  lc_id?: string | null;
  handle?: string | null;
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
    whopCompanyId:      typeof b.whop_company_id === "string" ? b.whop_company_id : null,
    // Wave 1 · identity ladder · snake_case → camelCase. Backend returns
    // null when either column is empty; we preserve null (never coerce
    // to empty string) so TopHud's ladder can honestly detect the
    // "no handle yet" state.
    lcId:               typeof b.lc_id === "string" && b.lc_id.length > 0 ? b.lc_id : null,
    handle:             typeof b.handle === "string" && b.handle.length > 0 ? b.handle : null,
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
    // No license · no snapshot to fetch · honest reset. Do NOT enter the
    // hydration state machine here — no fetch was attempted, so there is
    // no transition to observe.
    cachedSnapshot = null;
    cachedSource = "unknown";
    cachedError = null;
    cachedDegraded = false;
    emit();
    return;
  }
  // BUG-015 · begin hydration state machine (emit `me_hydration_started`
  // + start 8s stall watchdog). Must happen BEFORE the async fetch so a
  // never-resolving fetch is caught by the stall timer.
  beginHydration();
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
        // BUG-015 · auth-fail resolves the hydration machine as
        // failed. A user with a rejected JWT is neither "still hydrating"
        // nor "hydrated" — we surface the auth reason so HQ can
        // distinguish it from a network flake.
        resolveHydrationFailed({ cause: "auth-fail", status: out.status });
        emit();
        return;
      }
      if (out.kind === "ok") {
        cachedSnapshot = adaptMe(out.data);
        cachedSource = "real-http";
        cachedError = null;
        cachedDegraded = false;
        // Wave 1 · fire ``me_snapshot_hydrated`` AFTER cachedSnapshot
        // is updated so the ``hasLcId`` / ``hasHandle`` booleans reflect
        // this hydration, not a stale one.
        emitHydratedTelemetry(cachedSource);
        // BUG-015 · new successor topic emitted alongside preserved
        // legacy `me_snapshot_hydrated`. `me_hydration_succeeded` is
        // the one HQ + Doctor should key their new dashboards on.
        resolveHydrationSucceeded();
        emit();
        return;
      }
      // network or server-error · preserve last snapshot · mark degraded.
      if (cachedSnapshot) {
        cachedSource = "session-cache";
        // Fire on the transition to session-cache too — a customer with
        // a cached snapshot is still "hydrated" as far as the ladder is
        // concerned.
        emitHydratedTelemetry(cachedSource);
      }
      cachedDegraded = true;
      cachedError = out.kind === "network"
        ? "Couldn't reach backend · /me network failure."
        : `Backend returned ${out.status} on /me.`;
      // BUG-015 · resolve as failed regardless of whether the
      // session-cache branch fired `me_snapshot_hydrated`. Failure is a
      // transition of the machine, independent of the cache-preservation
      // convenience above.
      resolveHydrationFailed({
        cause: out.kind === "network" ? "network" : "server-error",
        status: out.kind === "server-error" ? out.status : undefined,
      });
      emit();
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/* ─── BUG-015 · identity kind classifier ────────────────────────────── */

/**
 * Derive the identity ladder rung from the current cache. Returns null
 * for the pre-JWT idle state (no snapshot, no fetch attempted). Every
 * non-null return is a member of ``IdentityKind`` — the dev-only
 * assertion in the hook fires ``me_hydration_kind_drift`` if this ever
 * regresses.
 *
 * Rungs (highest to lowest priority):
 *   1. ``handle``            — snapshot has ``handle``.
 *   2. ``lc-id``             — snapshot has ``lcId`` (no handle).
 *   3. ``email-local``       — snapshot has ``email`` (no handle / lcId).
 *   4. ``signing-in``        — JWT present, no hydrated snapshot yet.
 *   5. ``complete-profile``  — JWT present, snapshot hydrated, but
 *                              ladder produced no renderable name.
 *
 * Signed-out (no JWT, no snapshot) → null. This is intentional — the
 * union doesn't include a "none" member. Consumers render nothing (or
 * a sign-in CTA) for null.
 */
function classifyIdentityKind(): IdentityKind | null {
  const snap = cachedSnapshot;
  if (snap) {
    if (snap.handle) return "handle";
    if (snap.lcId) return "lc-id";
    if (snap.email) {
      // Only treat email as a rung if it has a local-part. Defensive —
      // the backend already validates but the classifier is honest.
      const at = snap.email.indexOf("@");
      if (at > 0) return "email-local";
    }
    // Snapshot present but no renderable name → complete-profile CTA.
    return "complete-profile";
  }
  // No snapshot. If a JWT exists we're mid-hydration.
  if (getJwt() !== null) return "signing-in";
  return null;
}

/** Dev-only runtime drift assertion. Fires when a kind value that is
 *  not a member of ``IdentityKind`` reaches the hook return. Non-null
 *  guard because ``null`` (signed-out) is a legitimate non-union value.
 *  Uses ``import.meta.env.DEV`` per the BUG-015 spec — do NOT throw. */
function assertIdentityKind(kind: IdentityKind | null): void {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const isDev = Boolean((import.meta as any).env?.DEV);
    if (!isDev) return;
    if (kind === null) return;
    if (IDENTITY_KIND_SET.has(kind)) return;
    // eslint-disable-next-line no-console
    console.error(
      `[useMe] identity kind drift · value "${String(kind)}" not in IdentityKind union`,
    );
    lcDiag("me_hydration_kind_drift", {
      observed: String(kind),
      allowed: Array.from(IDENTITY_KIND_SET),
    });
  } catch {
    /* dev-only telemetry never blocks a render */
  }
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

    /* Ship-lens P1-01/02 (2026-07-11) · after OTP verify the shell
     * emits `auth:signed-in` on the bus. Without this listener,
     * `cachedSource` was already non-"unknown" (initial pre-signin
     * 401 flipped it), so the "load only if unknown" guard above
     * never re-fired — TopHud stayed on "SIGN IN" and SideNav stayed
     * on "Guest / GU / Free" until a hard reload. Dynamic bus import
     * avoids a circular dep with `design-os/bridge`.
     *
     * RC1 state-drift trifecta · P0/P1-A (2026-07-11) · mirror
     * subscriber for `activation:complete` so the Whop deep-link flow
     * (`liquidclips://activate` → handleActivationUrl → JWT stored →
     * emit `activation:complete`) refetches /me. Without this the
     * `whopUserId` field stayed null after a Whop link even though
     * the JWT was already fresh — TopHud's "Connect Whop" pill kept
     * asking the user to link a Whop that was already linked. Same
     * structure as the `auth:signed-in` subscriber above so
     * additions to the trigger set follow one mental model.
     */
    let cancelled = false;
    let unsubscribeSignedIn: (() => void) | null = null;
    let unsubscribeActivation: (() => void) | null = null;
    void (async () => {
      try {
        const { bus } = await import("../bridge");
        if (cancelled) return;
        unsubscribeSignedIn = bus.on("auth:signed-in", () => { void loadMe(); });
        unsubscribeActivation = bus.on("activation:complete", () => { void loadMe(); });
      } catch {
        /* bridge unavailable in this build target — silent. */
      }
    })();

    return () => {
      cancelled = true;
      unsubscribeSignedIn?.();
      unsubscribeActivation?.();
      listeners.delete(listener);
    };
  }, []);

  const reload = useCallback(async () => {
    await loadMe();
  }, []);

  // BUG-015 · classify + dev-only drift assertion. Both fire on every
  // render; the assertion is a no-op in prod builds.
  const kind = classifyIdentityKind();
  assertIdentityKind(kind);

  return {
    snapshot: cachedSnapshot,
    loading: !!inFlight,
    error: cachedError,
    degraded: cachedDegraded,
    source: cachedSource,
    kind,
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
  // BUG-015 · reset hydration state machine so a fresh test starts on
  // ``idle`` (no timer, no start ts, no resolved flag). Without this,
  // a stall timer scheduled in one test would fire during the next.
  clearHydrationStallTimer();
  hydrationStartTs = null;
  hydrationResolved = false;
}
