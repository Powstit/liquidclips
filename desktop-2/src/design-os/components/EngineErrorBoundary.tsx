/**
 * EngineErrorBoundary · per-brick crash isolation with structured metadata
 *
 * Phase 6C-Lockdown. Wraps each engine brick (UploadPortal, StageRail,
 * ResultsGrid, ClipCard) so a single brick crashing leaves the rest of the
 * route operable. Captures Sentry-ready metadata (route · component ·
 * sessionId · runtimeMode) but DOES NOT call Sentry — that's a separate
 * install. If Sentry lands later, the only change is uncommenting the
 * `sendToSentry` import.
 *
 * Fallback UI:
 *   - GlassCard with tone=danger language
 *   - Brick name + brief message
 *   - "Reload brick" button — clears the boundary, re-mounts children
 *   - Console.error for dev
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { GlassCard } from "./GlassCard";
import { getRuntimeInfo } from "../engine/runtimeInfo";
import { sanitizeError } from "../../components/SectionWithFallback";
import "./EngineErrorBoundary.css";

export interface EngineBoundaryMeta {
  /** Which Design OS route hosts the brick. */
  route: "create" | "engine" | "studio" | "schedule" | "library" | string;
  /** Brick name (used as the error-boundary surface label). */
  component: "UploadPortal" | "StageRail" | "ResultsGrid" | "ClipCard" | string;
  /** Active session id when the crash happened. Optional. */
  sessionId?: string;
}

export interface EngineErrorBoundaryProps extends EngineBoundaryMeta {
  children: ReactNode;
  /** Optional override of the rendered fallback. */
  fallback?: (err: Error, reset: () => void, meta: EngineBoundaryMeta) => ReactNode;
}

interface State {
  err: Error | null;
}

export class EngineErrorBoundary extends Component<EngineErrorBoundaryProps, State> {
  override state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  override componentDidCatch(err: Error, info: ErrorInfo): void {
    const { route, component, sessionId } = this.props;
    const runtimeMode = getRuntimeInfo().mode;
    const payload = {
      route,
      component,
      sessionId,
      runtimeMode,
      stack: info.componentStack,
      time: new Date().toISOString(),
    };
    // eslint-disable-next-line no-console
    console.error("[lc:engine] boundary caught", payload, err);
    // D1-cluster-A · 2026-07-12 · mirror the React componentStack +
    // err.stack to a global window array so future crash triage can
    // read the boundary catch off `window.__lcEngineBoundaryCrashes`
    // without re-instrumenting. Safe: read-only append, bounded to 20
    // entries, no PII (err.message + component stack only).
    try {
      if (typeof window !== "undefined") {
        const w = window as unknown as {
          __lcEngineBoundaryCrashes?: Array<Record<string, unknown>>;
        };
        w.__lcEngineBoundaryCrashes = w.__lcEngineBoundaryCrashes ?? [];
        w.__lcEngineBoundaryCrashes.push({
          route,
          component,
          sessionId,
          runtimeMode,
          message: err.message,
          errStack: err.stack,
          componentStack: info.componentStack,
          time: payload.time,
        });
        if (w.__lcEngineBoundaryCrashes.length > 20) {
          w.__lcEngineBoundaryCrashes.shift();
        }
      }
    } catch {
      /* instrumentation must never throw */
    }
    // 2026-07-13 · Post-RC1 · fire a canonical `app.crash` HqEvent so
    // HQ dashboards + Codex classifiers see the boundary hit with the
    // full envelope (install_id + session_id + correlation_id + schema
    // version). Data carries the sanitised error message only — no
    // stack, no PII (Audit D pattern honoured).
    try {
      void import("../../lib/hqEmit").then((h) => {
        void import("../../components/SectionWithFallback").then((s) => {
          const safeMessage = s.sanitizeError(err);
          h.emitHqEvent({
            category: "app.crash",
            severity: "error",
            topic: "engine.boundary.caught",
            data: {
              route,
              component,
              session_id: sessionId ?? null,
              runtime_mode: runtimeMode,
              message: safeMessage,
              // React componentStack + err.stack intentionally omitted
              // from the HQ envelope — those still land on the local
              // `window.__lcEngineBoundaryCrashes` buffer above for
              // triage bundle uploads.
            },
          });
        });
      });
    } catch {
      /* instrumentation must never throw */
    }
    // Sentry hook · uncomment when @sentry/react is installed
    // sendToSentry(err, payload);
  }

  reset = (): void => {
    this.setState({ err: null });
  };

  override render() {
    if (this.state.err) {
      const { route, component, sessionId, fallback } = this.props;
      if (fallback) return fallback(this.state.err, this.reset, { route, component, sessionId });

      return (
        <GlassCard density="default" className="lc-eb-card" role="alert" aria-live="assertive">
          <div className="lc-eb-row">
            <div className="lc-eb-icon" aria-hidden="true">!</div>
            <div className="lc-eb-body">
              <span className="lc-eb-eb">{component} crashed</span>
              {/* Audit D fix · sanitize bearer/JWT/email/hex before any
                  customer-visible render. Raw err.message is unsafe when
                  the wrapped brick catches a fetch reject that embeds
                  Authorization headers or Whop OAuth error payloads. */}
              <span className="lc-eb-msg" title={sanitizeError(this.state.err)}>
                {sanitizeError(this.state.err)}
              </span>
              <span className="lc-eb-meta">
                route: {route} · runtime: {getRuntimeInfo().mode}
              </span>
            </div>
            <button type="button" className="lc-eb-reload" onClick={this.reset}>
              Reload brick
            </button>
          </div>
        </GlassCard>
      );
    }
    return this.props.children;
  }
}
