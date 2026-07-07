/**
 * Watchdog · React error boundary + async wrapper for every user-reachable
 * node in the app.
 *
 * Ship-lens Sovereign-Operator Protocol (2026-07-06). Every fail:
 *   1. Never crashes the shell (renders KadeRepairScreen instead)
 *   2. Records a FailureRecord in the nodeRegistry (localStorage-backed)
 *   3. Dispatches an intercession event to HQ Admin for the Intercession LLM
 *   4. Respects Admin overrides (disabled → paused placeholder · apiKey injection)
 *
 * Usage:
 *   <Watchdog nodeId="money/mo-01/assisted-handoff" label="Publish walk-around" cluster="money" source="assistedSchedule.ts:211">
 *     <YourComponent />
 *   </Watchdog>
 *
 * Async wrap:
 *   export const startAssistedHandoff = watchdogWrap(
 *     { id: "money/mo-01/assisted-handoff", label: "Publish walk-around", cluster: "money", source: "assistedSchedule.ts:211" },
 *     async (job) => { … }
 *   );
 *
 * See docs/PROTOCOL_SELF_HEALING_NODES.md for architecture.
 */

import {
  Component,
  useEffect,
  useMemo,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { KadeRepairScreen } from "./KadeRepairScreen";
import { dispatchIntercession } from "./interceptionBus";
import { registerNode, subscribe, getNodeState } from "./nodeRegistry";
import type { NodeMeta } from "./types";

// ═════════════════════════════════════════════════════════════════
// React component version — wraps a JSX subtree.
// ═════════════════════════════════════════════════════════════════

export interface WatchdogProps extends NodeMeta {
  children: ReactNode;
  /** Optional custom fallback. Defaults to KadeRepairScreen. */
  fallback?: (err: Error, retry: () => void) => ReactNode;
}

interface WatchdogState {
  err: Error | null;
}

export class Watchdog extends Component<WatchdogProps, WatchdogState> {
  override state: WatchdogState = { err: null };

  static getDerivedStateFromError(err: Error): WatchdogState {
    return { err };
  }

  override componentDidMount(): void {
    const { children: _children, fallback: _fallback, ...meta } = this.props;
    registerNode(meta);
  }

  override componentDidCatch(err: Error, info: ErrorInfo): void {
    dispatchIntercession({
      nodeId: this.props.id,
      ts: Date.now(),
      weight: 10, // React error boundary catches are hard crashes.
      message: err.message,
      stack: err.stack,
      context: { componentStack: info.componentStack ?? undefined },
    });
  }

  reset = (): void => {
    this.setState({ err: null });
  };

  override render(): ReactNode {
    // Admin override · disabled section shows a placeholder instead of children.
    const state = getNodeState(this.props.id);
    if (state?.override.disabled) {
      return (
        <div
          className="lc-watchdog-paused"
          role="status"
          aria-live="polite"
          style={{
            padding: "24px",
            border: "1px dashed rgba(255, 26, 140, 0.35)",
            borderRadius: 12,
            color: "rgba(244, 241, 234, 0.7)",
            fontFamily: "Geist Mono, monospace",
            fontSize: 12,
            textAlign: "center",
          }}
        >
          {this.props.label} paused by admin
        </div>
      );
    }

    if (this.state.err) {
      if (this.props.fallback) return this.props.fallback(this.state.err, this.reset);
      return (
        <KadeRepairScreen
          nodeId={this.props.id}
          sectionLabel={this.props.label}
          onRetry={this.reset}
        />
      );
    }
    return this.props.children;
  }
}

// ═════════════════════════════════════════════════════════════════
// Async function wrapper — for RPC calls / event handlers / any
// non-render async work.
// ═════════════════════════════════════════════════════════════════

export function watchdogWrap<TArgs extends unknown[], TResult>(
  meta: NodeMeta,
  fn: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  // Register at wrap-time so HQ Admin sees the node before its first call.
  registerNode(meta);
  return async (...args: TArgs): Promise<TResult> => {
    const state = getNodeState(meta.id);
    if (state?.override.disabled) {
      throw new Error(`node_disabled:${meta.id}`);
    }
    try {
      return await fn(...args);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      dispatchIntercession({
        nodeId: meta.id,
        ts: Date.now(),
        weight: 5,
        message: e.message,
        stack: e.stack,
        context: { args: safeSerialize(args) },
      });
      throw e;
    }
  };
}

// ═════════════════════════════════════════════════════════════════
// Hook — read live node state (health, failureScore, override).
// Used by HQ Admin dashboard components.
// ═════════════════════════════════════════════════════════════════

export function useNodeState(id: string) {
  const [, setTick] = useState(0);
  useEffect(() => subscribe(() => setTick((t) => t + 1)), []);
  return useMemo(() => getNodeState(id), [id]);
}

function safeSerialize(v: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return "[unserializable]";
  }
}
