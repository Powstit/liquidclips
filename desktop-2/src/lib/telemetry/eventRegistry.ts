/**
 * Closed event registry — Step 5 of SELF_ONBOARDING_RELEASE_MASTER.md.
 *
 * Adding an event requires editing this file. Any component that tries
 * to emit an event name not listed here fails at TypeScript compile
 * time (the ``EventName`` type is a literal union). That is the
 * ``closed_registry`` + ``unknown_event_rejected`` assertions from the
 * master doc's Step 5 named-assertion list.
 *
 * Each event schema is versioned (``SCHEMA_VERSION`` per event) so
 * downstream sinks can validate payload shape without a heavy
 * runtime dependency.
 */

/**
 * Closed set of event names. New events require editing this union AND
 * the ``EventPayloadMap`` below. The compiler enforces the pairing.
 */
export type EventName =
  // ---- Feature lifecycle ----
  | "feature_started"
  | "feature_succeeded"
  | "feature_failed"
  | "feature_abandoned"
  // ---- Authz / access ----
  | "permission_denied"
  // ---- Onboarding journeys (Step 4) ----
  | "milestone_reached"
  | "journey_resumed"
  // ---- Empty state UX ----
  | "empty_state_seen"
  // ---- Arcade ----
  | "arcade_score_submitted"
  | "arcade_prize_viewed"
  // ---- Publish / schedule ----
  | "clip_published"
  | "schedule_created";

/**
 * Required custom fields per event name. Envelope-level fields
 * (release, build, actor, surface, route, correlation_id, etc.) are
 * declared once in ``envelope.ts`` and NOT repeated here.
 */
export interface EventPayloadMap {
  feature_started: { feature_id: string; journey_id?: string };
  feature_succeeded: {
    feature_id: string;
    journey_id?: string;
    duration_ms?: number;
  };
  feature_failed: {
    feature_id: string;
    journey_id?: string;
    stable_error_code: string;
    duration_ms?: number;
  };
  feature_abandoned: {
    feature_id: string;
    journey_id?: string;
    duration_ms?: number;
  };
  permission_denied: {
    capability: string;
    reason: string;
    resource_kind?: string;
  };
  milestone_reached: {
    journey: "clipper" | "agency";
    prev_state: string | null;
    next_state: string;
    source_surface: string;
  };
  journey_resumed: {
    journey: "clipper" | "agency";
    resume_at_state: string;
  };
  empty_state_seen: {
    surface: string;
    reason: "loading" | "unavailable" | "real_empty" | "error";
  };
  arcade_score_submitted: {
    score: number;
    wave: number;
    duration_ms: number;
  };
  arcade_prize_viewed: {
    month: string;
    prize_amount_cents: number;
  };
  clip_published: {
    channels_count: number;
    cadence: "now" | "scheduled" | "drip";
    campaign_id: string | null;
  };
  schedule_created: {
    channels_count: number;
    scheduled_for_epoch_ms: number;
  };
}

/**
 * Per-event schema version — bump when the payload shape changes so
 * downstream sinks can gate on it.
 */
export const SCHEMA_VERSION: Record<EventName, number> = {
  feature_started: 1,
  feature_succeeded: 1,
  feature_failed: 1,
  feature_abandoned: 1,
  permission_denied: 1,
  milestone_reached: 1,
  journey_resumed: 1,
  empty_state_seen: 1,
  arcade_score_submitted: 1,
  arcade_prize_viewed: 1,
  clip_published: 1,
  schedule_created: 1,
};

/**
 * Runtime allow-set for ingestion validation — mirrors the type union
 * so backend/CLI callers that cannot leverage TS can still enforce the
 * closed registry.
 */
export const KNOWN_EVENT_NAMES: ReadonlySet<EventName> = new Set([
  "feature_started",
  "feature_succeeded",
  "feature_failed",
  "feature_abandoned",
  "permission_denied",
  "milestone_reached",
  "journey_resumed",
  "empty_state_seen",
  "arcade_score_submitted",
  "arcade_prize_viewed",
  "clip_published",
  "schedule_created",
] as const);

export function isKnownEventName(name: string): name is EventName {
  return (KNOWN_EVENT_NAMES as Set<string>).has(name);
}
