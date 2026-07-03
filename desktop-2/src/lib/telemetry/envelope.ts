/**
 * Envelope contract for every emitted telemetry event — Step 5 of
 * SELF_ONBOARDING_RELEASE_MASTER.md.
 *
 * The master doc lists the required envelope fields:
 *   event name, event schema version, anonymous/internal actor
 *   reference, journey and feature ids, surface and route, release
 *   and build identifiers, environment, operating mode and
 *   entitlement class, onboarding state, correlation/session/attempt
 *   ids, success, failure, duration, stable error code, sanitized
 *   metadata.
 */

import type { EventName, EventPayloadMap } from "./eventRegistry.ts";

export type Environment = "dev" | "prod" | "qa";
export type OperatingMode = "self" | "demo" | "support";
export type EntitlementClass =
  | "clipper"
  | "pro"
  | "growth"
  | "agency"
  | "admin";

/**
 * Actor reference — server-issued internal user id when the caller
 * has one, anonymous session id otherwise. Never an email, never a
 * JWT, never a raw Clerk id (which is PII-adjacent).
 */
export interface ActorRef {
  kind: "internal" | "anon";
  id: string; // hashed session id for anon; server user_id for internal
}

/**
 * The complete envelope. Sinks read this shape verbatim; do not
 * mutate. Every field is required so a downstream ingestion service
 * can assert on the full contract.
 */
export interface Envelope<K extends EventName = EventName> {
  // ---- Identity ----
  event: K;
  schema_version: number;
  actor: ActorRef;

  // ---- Context (feature + journey) ----
  feature_id: string;
  journey_id: string | null;
  surface: string;
  route: string;

  // ---- Release / build / env ----
  release: string;
  build: string;
  environment: Environment;

  // ---- Operating mode + entitlement ----
  operating_mode: OperatingMode;
  entitlement_class: EntitlementClass;

  // ---- Onboarding state ----
  onboarding_state: string | null;

  // ---- Correlation ----
  correlation_id: string;
  session_id: string;
  attempt_id: string;

  // ---- Outcome ----
  success: boolean;
  failure: string | null;
  duration_ms: number | null;
  stable_error_code: string | null;

  // ---- Payload + metadata ----
  payload: EventPayloadMap[K];
  metadata: Record<string, unknown> | null;

  // ---- Server-set at ingestion time — never client-populated ----
  emitted_at: string; // ISO-8601 UTC
}

/**
 * The mutable slice a caller supplies. The adapter fills in the
 * global context (release, build, environment, actor, session,
 * correlation) so each call site only names the event + payload +
 * per-call context.
 */
export interface EmitInput<K extends EventName> {
  event: K;
  payload: EventPayloadMap[K];
  feature_id: string;
  journey_id?: string | null;
  surface: string;
  route?: string;
  operating_mode?: OperatingMode;
  entitlement_class?: EntitlementClass;
  onboarding_state?: string | null;
  correlation_id?: string;
  attempt_id?: string;
  success?: boolean;
  failure?: string | null;
  duration_ms?: number;
  stable_error_code?: string | null;
  metadata?: Record<string, unknown> | null;
}
