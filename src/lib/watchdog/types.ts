/**
 * Watchdog · shared types
 *
 * Ship-lens Sovereign-Operator Protocol (2026-07-06) · every user-reachable
 * node in the app registers with the Watchdog registry so that:
 *   - Failures inside the node don't crash the app (KadeRepairScreen renders)
 *   - Failure tracebacks are dispatched to the HQ Admin dashboard for the
 *     Intercession LLM to auto-repair
 *   - Daniel can force-disable a node or inject an API-key override from
 *     the HQ Admin dashboard without redeploying
 *
 * See docs/PROTOCOL_SELF_HEALING_NODES.md for the full architecture.
 */

export type NodeId = string; // convention: "<cluster>/<journey-id>/<component>" e.g. "money/mo-01/assisted-handoff"

export type NodeHealth = "green" | "yellow" | "red";

export interface NodeMeta {
  id: NodeId;
  /** Human-readable label surfaced in HQ Admin. */
  label: string;
  /** Cluster tag for HQ Admin grouping. */
  cluster: "identity" | "pipeline" | "money" | "agency" | "system";
  /** File:line pointer so HQ Admin can jump to source of a failure. */
  source: string;
}

export interface FailureRecord {
  nodeId: NodeId;
  ts: number;
  /** Weighted score: transient = 1, hard error = 10. Sum drives node health. */
  weight: number;
  message: string;
  stack?: string;
  /** Optional captured variable snapshot for the Intercession LLM. */
  context?: Record<string, unknown>;
}

export interface AdminOverride {
  /** If `disabled`, the node's children render a "temporarily paused by admin" placeholder instead of failing. */
  disabled?: boolean;
  /** Optional per-node API-key override. Used when the node calls a third-party API that Daniel wants to swap live. */
  apiKey?: string;
  /** When Daniel resolves an intercession, he sets this so the FailureScore resets. */
  clearedAt?: number;
}

export interface NodeState {
  meta: NodeMeta;
  failureScore: number;
  lastFailure: FailureRecord | null;
  override: AdminOverride;
  health: NodeHealth;
}

/** Threshold for a node to flip yellow → red · triggers Intercession LLM. */
export const RED_THRESHOLD = 10;
export const YELLOW_THRESHOLD = 3;
