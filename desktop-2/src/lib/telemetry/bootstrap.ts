/**
 * Telemetry bootstrap · initTelemetry + register all four sinks.
 * Called once from App.tsx during boot. Idempotent · calling twice is
 * safe (adapter reset happens at init).
 */

import { initTelemetry, registerSink, type AdapterContext } from "./index";
import { backendTelemetrySink } from "./sinks/backendTelemetrySink";
import { posthogSink } from "./sinks/posthogSink";
import { sentrySink } from "./sinks/sentrySink";
import { desktopErrorSink } from "./sinks/desktopErrorSink";
import { sloSink } from "./sinks/sloSink";
// BUG-007 sweep · Wave B1 (2026-07-12) — was `declare const __APP_VERSION__`
// + `__APP_VERSION__ ?? "0.0.0-dev"`. The sink's `release` field is set
// once at boot before any React tree mounts, so the shell fallback is
// the honest answer (the Tauri invoke would race with the very first
// event dispatch). `runtimeVersionSync` is the single caller-safe
// shell-fallback getter.
import { runtimeVersionSync } from "../useRuntimeVersion";

function inferEnvironment(): "dev" | "prod" | "qa" {
  try {
    const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
    if (env?.DEV) return "dev";
    if (env?.VITE_LC_QA === "true" || env?.VITE_LC_QA === true) return "qa";
  } catch {
    /* noop */
  }
  return "prod";
}

/** Bootstrap once at App mount. Session_id and correlation_id defaults
 *  are cheap random strings that live for the app run. */
export function bootstrapTelemetry(): void {
  const sessionId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const ctx: AdapterContext = {
    release: runtimeVersionSync(),
    build: "local",
    environment: inferEnvironment(),
    actor: { kind: "anon", id: sessionId },
    session_id: sessionId,
    operating_mode: "self",
    entitlement_class: "clipper",
    onboarding_state: null,
  };
  initTelemetry(ctx);
  registerSink(backendTelemetrySink);
  registerSink(desktopErrorSink);
  registerSink(posthogSink);
  registerSink(sentrySink);
  registerSink(sloSink);
}
