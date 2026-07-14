/**
 * Diagnostic bundle · user-triggered support snapshot.
 *
 * Ninth HQ event category. Collects a small, redacted snapshot of the
 * runtime state that support can attach to a customer report without
 * ever hitting the sidecar / shell / disk.
 *
 * Contract:
 *   * Runs entirely in the runtime — no Rust IPC, no disk write.
 *   * Payload is redacted (no email, no JWT, no source paths, no
 *     video / captions / file bytes).
 *   * Emits a `diagnostic.bundle` HqEvent so HQ dashboards see the
 *     support trigger correlated to the customer's install_id +
 *     session_id.
 *   * Returns the bundle as a JSON string so a caller can copy it to
 *     clipboard or paste it into a support ticket.
 *
 * Callers (UI): a Support-panel "Copy diagnostic bundle" button. See
 * `POST_RC1_EXECUTION_PLAN.md` § HQ deliverable 8 for the roadmap.
 */

import { emitHqEvent } from "./hqEmit";
import { HQ_EVENT_SCHEMA_VERSION, newCorrelationId } from "./hqEvents";
import { getInstallId } from "./installId";

interface EngineBoundaryCrash {
  route?: unknown;
  component?: unknown;
  runtimeMode?: unknown;
  message?: unknown;
  time?: unknown;
  // Intentionally NOT surfaced: err.stack, componentStack, sessionId
  // (those live locally only for triage-bundle triage — we don't
  // egress them to HQ from the runtime).
}

interface DiagnosticBundle {
  schema_version: typeof HQ_EVENT_SCHEMA_VERSION;
  correlation_id: string;
  generated_at_ms: number;
  install_id: string;
  runtime_version: string | null;
  app_version: string | null;
  app_arch: "x86_64" | "aarch64" | null;
  navigator: {
    user_agent: string | null;
    online: boolean | null;
    language: string | null;
  };
  crashes: EngineBoundaryCrash[];
  event_categories_active: string[];
}

const EVENT_CATEGORIES_ACTIVE = [
  "app.health",
  "app.crash",
  "action.failed",
  "auth.failed",
  "processing.failed",
  "update.health",
  "support.request",
  "payment.mismatch",
  "diagnostic.bundle",
] as const;

function readRuntimeFingerprint(): {
  runtime_version: string | null;
  app_version: string | null;
  app_arch: "x86_64" | "aarch64" | null;
} {
  const w = globalThis as unknown as {
    __lcRuntime?: {
      runtime_version?: string;
      app_version?: string;
      app_arch?: string;
    };
  };
  const r = w.__lcRuntime ?? {};
  const arch = r.app_arch === "x86_64" || r.app_arch === "aarch64" ? r.app_arch : null;
  return {
    runtime_version: r.runtime_version ?? null,
    app_version: r.app_version ?? null,
    app_arch: arch,
  };
}

function readBoundaryCrashes(): EngineBoundaryCrash[] {
  const w = globalThis as unknown as {
    __lcEngineBoundaryCrashes?: Array<Record<string, unknown>>;
  };
  const arr = w.__lcEngineBoundaryCrashes ?? [];
  return arr.map((c) => ({
    route: c.route,
    component: c.component,
    runtimeMode: c.runtimeMode,
    message: c.message,
    time: c.time,
    // stack + componentStack intentionally stripped
  }));
}

function readNavigator(): DiagnosticBundle["navigator"] {
  if (typeof navigator === "undefined") {
    return { user_agent: null, online: null, language: null };
  }
  return {
    user_agent: typeof navigator.userAgent === "string" ? navigator.userAgent : null,
    online: typeof navigator.onLine === "boolean" ? navigator.onLine : null,
    language: typeof navigator.language === "string" ? navigator.language : null,
  };
}

/**
 * Generates a redacted diagnostic bundle snapshot AND emits the
 * `diagnostic.bundle` HQ event. Returns the bundle as a JSON string
 * suitable for `navigator.clipboard.writeText` / support paste.
 *
 * NEVER writes to disk. NEVER touches the sidecar. NEVER carries
 * PII.
 */
export function generateDiagnosticBundle(): string {
  const correlationId = newCorrelationId();
  const rt = readRuntimeFingerprint();
  const bundle: DiagnosticBundle = {
    schema_version: HQ_EVENT_SCHEMA_VERSION,
    correlation_id: correlationId,
    generated_at_ms: Date.now(),
    install_id: getInstallId(),
    ...rt,
    navigator: readNavigator(),
    crashes: readBoundaryCrashes(),
    event_categories_active: [...EVENT_CATEGORIES_ACTIVE],
  };

  // Emit the trigger so HQ can correlate a customer paste with the
  // in-app trigger event (same correlation_id).
  emitHqEvent({
    category: "diagnostic.bundle",
    severity: "info",
    topic: "diagnostic.bundle.generated",
    correlation_id: correlationId,
    data: {
      crash_count: bundle.crashes.length,
      event_categories_active: bundle.event_categories_active.length,
    },
  });

  return JSON.stringify(bundle, null, 2);
}
