/**
 * Step 5 · telemetry adapter public surface.
 *
 * Import path convention: components use ``import { emit } from
 * "@/lib/telemetry"`` (or relative equivalent). Never import from
 * individual sub-files — the closed registry lives here.
 */

export {
  emit,
  initTelemetry,
  registerSink,
  _resetTelemetryForTests,
  type AdapterContext,
  type Sink,
} from "./adapter.ts";
export type {
  EventName,
  EventPayloadMap,
} from "./eventRegistry.ts";
export { SCHEMA_VERSION, isKnownEventName, KNOWN_EVENT_NAMES } from "./eventRegistry.ts";
export type {
  Envelope,
  EmitInput,
  ActorRef,
  Environment,
  OperatingMode,
  EntitlementClass,
} from "./envelope.ts";
export { sanitizeMetadata } from "./redact.ts";
