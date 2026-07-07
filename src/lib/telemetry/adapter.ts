/**
 * Telemetry adapter — the ONE emission path.
 *
 * Step 5 named assertion contract:
 *   - closed_registry           · enforced at type-check (see eventRegistry.ts)
 *   - unknown_event_rejected    · same
 *   - pii_redacted              · runtime · sanitizeMetadata()
 *   - feature_context_attached  · runtime · adapter fills the envelope
 *   - adapter_failure_nonblocking · runtime · sinks fire via
 *                                    queueMicrotask, wrapped in try/catch
 *                                    so a broken sink never propagates
 *                                    into the caller's control flow
 *
 * Components DO NOT call PostHog / Sentry / the telemetry endpoint
 * directly. Every emission goes through this module.
 */

import { SCHEMA_VERSION, type EventName } from "./eventRegistry.ts";
import type {
  Envelope,
  EmitInput,
  Environment,
  ActorRef,
  OperatingMode,
  EntitlementClass,
} from "./envelope.ts";
import { sanitizeMetadata } from "./redact.ts";

/** Global context set once at adapter bootstrap. */
export interface AdapterContext {
  release: string;
  build: string;
  environment: Environment;
  actor: ActorRef;
  session_id: string;
  operating_mode: OperatingMode;
  entitlement_class: EntitlementClass;
  onboarding_state: string | null;
  /** Optional default correlation id — call sites can override. */
  correlation_id?: string;
}

export interface Sink {
  name: string;
  /** Receive one envelope. MUST NOT throw synchronously (see
   *  ``deliverToSink`` — throws are caught defensively so the adapter
   *  keeps the ``adapter_failure_nonblocking`` guarantee). */
  receive(envelope: Envelope): void | Promise<void>;
}

let _ctx: AdapterContext | null = null;
const _sinks: Sink[] = [];

/**
 * Called once at app startup. Subsequent calls REPLACE the context —
 * useful for tests. Emits before init are silently dropped.
 */
export function initTelemetry(ctx: AdapterContext): void {
  _ctx = ctx;
}

export function registerSink(sink: Sink): void {
  _sinks.push(sink);
}

/**
 * FOR TESTS ONLY — resets the adapter to the "not-initialized" state
 * so a subsequent init call can be verified. Real code never touches
 * this. Named with a leading underscore to signal test-only intent.
 */
export function _resetTelemetryForTests(): void {
  _ctx = null;
  _sinks.length = 0;
}

/**
 * Emit an event. Synchronous return. The adapter:
 *   1. Composes the envelope with global context + call-site slice
 *   2. Sanitizes metadata (bans PII / secrets / raw paths / URLs)
 *   3. Fans out to every registered sink via ``queueMicrotask``
 *      so the caller never blocks on sink I/O
 *   4. Catches every sink error so a broken sink never bubbles up
 */
export function emit<K extends EventName>(input: EmitInput<K>): void {
  if (_ctx === null) {
    // Emit before init — drop silently. Real callers should call
    // initTelemetry() at app boot; this branch keeps SSR / test-loop
    // imports from crashing.
    return;
  }
  const now = new Date().toISOString();
  const envelope: Envelope<K> = {
    event: input.event,
    schema_version: SCHEMA_VERSION[input.event],
    actor: _ctx.actor,
    feature_id: input.feature_id,
    journey_id: input.journey_id ?? null,
    surface: input.surface,
    route: input.route ?? "",
    release: _ctx.release,
    build: _ctx.build,
    environment: _ctx.environment,
    operating_mode: input.operating_mode ?? _ctx.operating_mode,
    entitlement_class: input.entitlement_class ?? _ctx.entitlement_class,
    onboarding_state: input.onboarding_state ?? _ctx.onboarding_state,
    correlation_id: input.correlation_id ?? _ctx.correlation_id ?? cryptoId(),
    session_id: _ctx.session_id,
    attempt_id: input.attempt_id ?? cryptoId(),
    success: input.success ?? true,
    failure: input.failure ?? null,
    duration_ms: input.duration_ms ?? null,
    stable_error_code: input.stable_error_code ?? null,
    payload: input.payload,
    metadata: sanitizeMetadata(input.metadata ?? null),
    emitted_at: now,
  };
  for (const sink of _sinks) {
    deliverToSink(sink, envelope);
  }
}

/** Off-thread + fault-tolerant delivery. Never propagates a throw. */
function deliverToSink(sink: Sink, envelope: Envelope): void {
  const enqueue =
    typeof queueMicrotask === "function"
      ? queueMicrotask
      : (fn: () => void) => setTimeout(fn, 0);
  enqueue(() => {
    try {
      const result = sink.receive(envelope);
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch(() => {
          /* sink error swallowed — adapter_failure_nonblocking */
        });
      }
    } catch {
      /* sink error swallowed — adapter_failure_nonblocking */
    }
  });
}

function cryptoId(): string {
  // Cheap prefix + timestamp when crypto.randomUUID isn't available
  // (test loops, unusual environments). Not for security — just for
  // correlation grouping.
  try {
    const c = (globalThis as unknown as { crypto?: Crypto }).crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
  } catch {
    /* fall through */
  }
  return (
    "id_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 10)
  );
}
