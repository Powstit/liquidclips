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
        <GlassCard density="default" className="lc-eb-card">
          <div className="lc-eb-row">
            <div className="lc-eb-icon" aria-hidden="true">!</div>
            <div className="lc-eb-body">
              <span className="lc-eb-eb">{component} crashed</span>
              <span className="lc-eb-msg" title={this.state.err.message}>
                {this.state.err.message}
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
