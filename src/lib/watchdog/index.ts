/**
 * Watchdog · barrel export.
 *
 * Ship-lens Sovereign-Operator Protocol (2026-07-06). Every user-reachable
 * node in the app registers here so failures don't crash the shell + so
 * HQ Admin sees live health telemetry.
 *
 * See docs/PROTOCOL_SELF_HEALING_NODES.md for the full architecture.
 */

export { Watchdog, watchdogWrap, useNodeState } from "./Watchdog";
export { KadeRepairScreen } from "./KadeRepairScreen";
export { dispatchIntercession, startInterceptionStatePolling } from "./interceptionBus";
export {
  registerNode,
  recordFailure,
  setOverride,
  getNodeState,
  listNodes,
  subscribe,
} from "./nodeRegistry";
export type {
  NodeId,
  NodeHealth,
  NodeMeta,
  FailureRecord,
  AdminOverride,
  NodeState,
} from "./types";
export { RED_THRESHOLD, YELLOW_THRESHOLD } from "./types";
