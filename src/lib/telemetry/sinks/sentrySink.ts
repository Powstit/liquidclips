/**
 * Sentry sink · only emits on failure envelopes (success=false OR
 * stable_error_code present). Tags mirror
 * junior-backend/app/observability.py:sentry_tags_for_event so a bug
 * in Sentry cross-joins with the backend audit + Railway deploy view.
 *
 * env-gated · when `VITE_SENTRY_DSN` isn't set, the sink no-ops.
 */

import type { Envelope, Sink } from "../index";

interface SentryGlobal {
  captureMessage(msg: string, opts: { level: string; tags: Record<string, string> }): void;
  captureException(err: unknown, opts: { tags: Record<string, string> }): void;
}

function getSentry(): SentryGlobal | null {
  try {
    const dsn = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SENTRY_DSN;
    if (!dsn) return null;
    const g = globalThis as unknown as { Sentry?: SentryGlobal };
    return g.Sentry ?? null;
  } catch {
    return null;
  }
}

function tagsFor(envelope: Envelope): Record<string, string> {
  return {
    release: envelope.release,
    environment: envelope.environment,
    feature_id: envelope.feature_id,
    journey_id: envelope.journey_id ?? "none",
    operating_mode: envelope.operating_mode,
    entitlement_class: envelope.entitlement_class,
    correlation_id: envelope.correlation_id,
    session_id: envelope.session_id,
    stable_error_code: envelope.stable_error_code ?? "none",
    event_name: envelope.event,
  };
}

export const sentrySink: Sink = {
  name: "sentry",
  receive(envelope: Envelope) {
    const sentry = getSentry();
    if (!sentry) return;
    // Only failures + explicit errors surface to Sentry to keep the
    // event budget bounded.
    if (envelope.success && !envelope.stable_error_code) return;
    const tags = tagsFor(envelope);
    const message = envelope.failure ?? `${envelope.event} · ${envelope.stable_error_code}`;
    sentry.captureMessage(message, { level: "error", tags });
  },
};
