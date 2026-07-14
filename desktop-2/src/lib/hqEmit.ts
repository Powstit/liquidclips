/**
 * HQ emit bridge · lcDiag ↔ HqEvent envelope.
 *
 * Wraps `lcDiag` with the canonical `HqEvent` shape so future
 * call-sites don't hand-roll identifiers, correlation ids, or
 * severity. Consumers should prefer `emitHqEvent` over raw `lcDiag`
 * for anything HQ dashboards will want to query.
 *
 * Migration policy (soft):
 *   * `lcDiag` remains available so nothing breaks at cutover.
 *   * New call-sites use `emitHqEvent`.
 *   * Old call-sites migrate incrementally per category (Train B was
 *     the last big batch). Each PR touches one category.
 *
 * Runtime contract:
 *   * The envelope is constructed synchronously (except `hashHandle`
 *     which is async — the call is fire-and-forget from the caller's
 *     view; the envelope resolves once the digest lands).
 *   * `install_id` bootstrap happens once per process on first call.
 *   * `session_id` is stable per app boot (delegates to
 *     `diagnosticLogger.getSessionId` via the shared identity).
 *   * `runtime_version` / `app_version` / `app_arch` come from
 *     `window.__lcRuntime` populated by the Tauri shell — nulls when
 *     running under Vite dev.
 */

import { lcDiag } from "./diagnosticLogger";
import {
  HQ_EVENT_SCHEMA_VERSION,
  hashHandle,
  newCorrelationId,
  type HqCategory,
  type HqEvent,
  type HqSeverity,
  type HqIdentifiers,
} from "./hqEvents";
import { getInstallId } from "./installId";

interface RuntimeFingerprint {
  runtime_version: string;
  app_version: string;
  app_arch: "x86_64" | "aarch64" | null;
}

function readRuntimeFingerprint(): RuntimeFingerprint {
  const w = globalThis as unknown as {
    __lcRuntime?: {
      runtime_version?: string;
      app_version?: string;
      app_arch?: string;
    };
  };
  const r = w.__lcRuntime ?? {};
  const arch = r.app_arch === "x86_64" || r.app_arch === "aarch64"
    ? r.app_arch
    : null;
  return {
    runtime_version: r.runtime_version ?? "unknown",
    app_version: r.app_version ?? "unknown",
    app_arch: arch,
  };
}

function readSessionId(): string {
  // Delegates to the same value diagnosticLogger.getSessionId returns.
  // We can't import it directly (private) — piggy-back on the header
  // it sets in the flush path by mirroring the same seed.
  const w = globalThis as unknown as { __lcDiagSession?: string };
  if (w.__lcDiagSession) return w.__lcDiagSession;
  const seed = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  w.__lcDiagSession = seed;
  return seed;
}

function buildIdentifiers(hashedHandle: string | null): HqIdentifiers {
  const rt = readRuntimeFingerprint();
  return {
    install_id: getInstallId(),
    session_id: readSessionId(),
    hashed_handle: hashedHandle,
    runtime_version: rt.runtime_version,
    app_version: rt.app_version,
    app_arch: rt.app_arch,
  };
}

export interface EmitHqEventOptions {
  category: HqCategory;
  severity: HqSeverity;
  topic: string;
  /** Optional correlation id. When omitted, a fresh id is created. */
  correlation_id?: string;
  /** Optional handle for `hashHandle`. Null / undefined → identifiers.hashed_handle = null. */
  handle?: string | null;
  /** Per-event data — MUST NOT include video / captions / files. */
  data?: Record<string, unknown>;
}

/**
 * Emits a canonical HqEvent through the existing `lcDiag` transport.
 *
 * Returns the correlation id (echoed back so a caller starting a
 * multi-stage flow can thread the same id to subsequent stages).
 *
 * Fire-and-forget from the caller's view — the async hashing happens
 * off-thread; the event lands in `lcDiag` synchronously with
 * `hashed_handle` populated on the resolved promise.
 */
export function emitHqEvent(opts: EmitHqEventOptions): string {
  const correlationId = opts.correlation_id ?? newCorrelationId();
  const partialIdentifiers = buildIdentifiers(null);
  const envelopeBase: Omit<HqEvent, "identifiers"> = {
    schema_version: HQ_EVENT_SCHEMA_VERSION,
    category: opts.category,
    severity: opts.severity,
    topic: opts.topic,
    correlation_id: correlationId,
    ts_ms: Date.now(),
    data: opts.data ?? {},
  };

  const emitWith = (identifiers: HqIdentifiers) => {
    const envelope: HqEvent = {
      ...envelopeBase,
      identifiers,
    };
    lcDiag(opts.topic, { hq_event: envelope });
  };

  if (opts.handle) {
    // Async digest; land the event once it resolves. Non-blocking.
    void hashHandle(opts.handle).then((digest) => {
      emitWith({ ...partialIdentifiers, hashed_handle: digest });
    });
  } else {
    emitWith(partialIdentifiers);
  }

  return correlationId;
}
