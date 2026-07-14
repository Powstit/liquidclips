/**
 * HQ event schema · L5 → post-RC1 HQ integration foundation.
 *
 * Ships the canonical typed envelope every HQ-bound event uses.
 * Existing `lcDiag(topic, data)` calls in `diagnosticLogger.ts` will
 * migrate to this shape in subsequent commits; the schema below is
 * the source of truth reviewers will look at when triaging future
 * HQ payloads.
 *
 * Rules (per POST_RC1_EXECUTION_PLAN.md § "HQ + Codex integration"):
 *
 *   * HQ is NEVER on the critical clipping path. Transport is
 *     fire-and-forget; the desktop app must continue functioning if
 *     HQ is unavailable.
 *   * NEVER send private video content, captions, or user files. Only
 *     behaviour metadata + sanitized error strings.
 *   * User identifiers are `install_id` (client-generated stable UUID)
 *     + `hashed_handle` (SHA-256 of the customer handle) — never raw
 *     email or handle.
 *   * Every event carries a `correlation_id` so multi-stage flows
 *     (upload → transcribe → cut → export) collapse into one queryable
 *     thread at HQ.
 *
 * Version field is required. HQ backend `/lcos/events/ingest` rejects
 * events whose `schema_version` it does not understand instead of
 * silently discarding fields — see `POST_RC1_EXECUTION_PLAN.md` §
 * "HQ queue contract" for the reciprocal server-side contract.
 */

/** Bump when a breaking envelope change lands. Additive fields keep the
 *  same version; renames or removals need a new integer. */
export const HQ_EVENT_SCHEMA_VERSION = 1 as const;

/** Coarse severity so HQ dashboards can route without parsing bodies. */
export type HqSeverity = "info" | "warn" | "error" | "critical";

/** Categories map 1-1 to Codex triage lanes so classification is a
 *  server-side lookup, not a downstream inference. */
export type HqCategory =
  | "app.health"          // periodic heartbeat + resource metrics
  | "app.crash"           // EngineErrorBoundary caught render throw
  | "action.failed"       // user-visible action didn't complete
  | "processing.failed"   // ingest / transcribe / judge / cut failure
  | "auth.failed"         // Whop / Clerk 401 / 403
  | "payment.mismatch"    // subscription-state drift (past_due, canceled without webhook)
  | "update.health"       // runtime-update beacon state (BUG-006 / 007 / 009 / 012)
  | "support.request"     // user-initiated support click
  | "feature.request"     // user-initiated feature request
  | "diagnostic.bundle";  // full app-state snapshot upload trigger

/** Stable identifiers that thread every event to its user + session. */
export interface HqIdentifiers {
  /** Client-generated stable UUID. Never a Clerk / Whop / email. */
  install_id: string;
  /** Session UUID for this app boot; resets on relaunch. */
  session_id: string;
  /** SHA-256 (hex) of the customer handle. Null when handle not set. */
  hashed_handle: string | null;
  /** Runtime bundle version at time of event. */
  runtime_version: string;
  /** Shell version (Info.plist CFBundleShortVersionString). */
  app_version: string;
  /** macOS arch — `x86_64` or `aarch64`. */
  app_arch: "x86_64" | "aarch64" | null;
}

/** The canonical HQ envelope. Every message crossing the
 *  `/lcos/events/ingest` boundary MUST match this shape. */
export interface HqEvent<T extends Record<string, unknown> = Record<string, unknown>> {
  schema_version: typeof HQ_EVENT_SCHEMA_VERSION;
  category: HqCategory;
  severity: HqSeverity;
  topic: string;
  /** Correlation UUID that groups related events into one flow. Reuse
   *  the same value for every stage of a multi-step operation
   *  (upload → transcribe → judge → cut → export). */
  correlation_id: string;
  /** UTC ms since epoch. */
  ts_ms: number;
  identifiers: HqIdentifiers;
  /** Per-event payload. MUST NOT contain video bytes, transcript text,
   *  raw email, JWTs, or Anthropic responses. */
  data: T;
}

/** Type-guard for downstream consumers (backend + Codex classifiers). */
export function isHqEvent(x: unknown): x is HqEvent {
  if (!x || typeof x !== "object") return false;
  const e = x as Partial<HqEvent>;
  return (
    e.schema_version === HQ_EVENT_SCHEMA_VERSION &&
    typeof e.category === "string" &&
    typeof e.severity === "string" &&
    typeof e.topic === "string" &&
    typeof e.correlation_id === "string" &&
    typeof e.ts_ms === "number" &&
    e.identifiers != null &&
    typeof e.identifiers === "object" &&
    typeof (e.identifiers as HqIdentifiers).install_id === "string" &&
    typeof (e.identifiers as HqIdentifiers).session_id === "string"
  );
}

/**
 * Generates a correlation id for a new multi-stage flow.
 * Consumers should thread this ID through every downstream stage that
 * emits an HQ event so the flow shows as one row at HQ.
 */
export function newCorrelationId(): string {
  const crypto = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (crypto && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for older WebViews. Not cryptographic; correlation IDs
  // don't need to be — collision-avoidance is the only requirement.
  return `corr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * SHA-256(handle) → hex. Used to populate `identifiers.hashed_handle`
 * so HQ dashboards can bucket per user without knowing the raw handle.
 *
 * Returns `null` for empty / null input so callers don't need a wrapper
 * conditional.
 */
export async function hashHandle(handle: string | null): Promise<string | null> {
  if (!handle) return null;
  const crypto = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (!crypto || !crypto.subtle) return null;
  const bytes = new TextEncoder().encode(handle);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}
