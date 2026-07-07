// Liquid Clips 2.0 — flow trace ring buffer.
// In-memory, last-N events. No persistence, no network. Diagnostics section
// reads this to render a live activity log. Replaceable later with a real
// telemetry sink behind the same signature.

import type { FlowId } from "../contracts/flowRegistry";
import type { SectionId } from "../shell/sectionIds";

export type FlowStatus = "ok" | "warning" | "critical";

export interface FlowTraceEvent {
  ts: number;
  flowId: FlowId;
  sectionId: SectionId | null;
  actionId: string;
  status: FlowStatus;
  metadata?: Record<string, unknown>;
}

const BUFFER_SIZE = 100;
const buffer: FlowTraceEvent[] = [];
const subscribers = new Set<(event: FlowTraceEvent) => void>();

export function flowTrace(event: Omit<FlowTraceEvent, "ts">): void {
  const stamped: FlowTraceEvent = { ts: Date.now(), ...event };
  buffer.push(stamped);
  if (buffer.length > BUFFER_SIZE) buffer.shift();
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(
      `[flow] ${stamped.flowId} · ${stamped.sectionId ?? "—"} · ${stamped.actionId} · ${stamped.status}`,
      stamped.metadata ?? ""
    );
  }
  for (const fn of subscribers) {
    try {
      fn(stamped);
    } catch {
      // ignore subscriber errors
    }
  }
}

export function getRecentEvents(limit = 20): FlowTraceEvent[] {
  return buffer.slice(-limit).reverse();
}

export function subscribeFlowTrace(fn: (event: FlowTraceEvent) => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function clearFlowTrace(): void {
  buffer.length = 0;
}
