/**
 * PostHog sink · consumes the same envelope, emits `posthog.capture()`
 * with the props shape defined by app/observability.py so PostHog
 * dashboards can cross-join with Sentry/HQ on `$correlation_key`.
 *
 * The actual PostHog SDK is env-gated · when `VITE_POSTHOG_KEY` isn't
 * set, the sink no-ops silently. This lets Cohort 0 run without a
 * PostHog project configured.
 */

import type { Envelope, Sink } from "../index";

interface PostHogGlobal {
  capture(event: string, props: Record<string, unknown>): void;
}

function getPostHog(): PostHogGlobal | null {
  try {
    const key = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_POSTHOG_KEY;
    if (!key) return null;
    const g = globalThis as unknown as { posthog?: PostHogGlobal };
    return g.posthog ?? null;
  } catch {
    return null;
  }
}

function correlationKey(envelope: Envelope): string {
  return `${envelope.release}:${envelope.feature_id}:${envelope.correlation_id}`;
}

export const posthogSink: Sink = {
  name: "posthog",
  receive(envelope: Envelope) {
    const ph = getPostHog();
    if (!ph) return;
    const props: Record<string, unknown> = {
      release: envelope.release,
      environment: envelope.environment,
      feature_id: envelope.feature_id,
      journey_id: envelope.journey_id,
      operating_mode: envelope.operating_mode,
      entitlement_class: envelope.entitlement_class,
      onboarding_state: envelope.onboarding_state,
      correlation_id: envelope.correlation_id,
      session_id: envelope.session_id,
      attempt_id: envelope.attempt_id,
      success: envelope.success,
      duration_ms: envelope.duration_ms,
      stable_error_code: envelope.stable_error_code,
      $correlation_key: correlationKey(envelope),
    };
    for (const [k, v] of Object.entries(envelope.payload)) {
      props[`payload_${k}`] = v;
    }
    ph.capture(envelope.event, props);
  },
};
