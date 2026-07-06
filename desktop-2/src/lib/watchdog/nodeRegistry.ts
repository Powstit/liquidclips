/**
 * nodeRegistry · in-memory registry of every Watchdog-wrapped node.
 *
 * Ship-lens Sovereign-Operator Protocol (2026-07-06). Every mount of a
 * <Watchdog nodeId="…"> registers with this store. Failures increment
 * failureScore. HQ Admin polls (or subscribes via bus events) to read
 * live health + push overrides.
 *
 * Persistence: writes to localStorage on every failure so a page reload
 * doesn't lose the score. Overrides also persist so a Daniel-set
 * "disabled" flag survives across sessions until he clears it.
 */

import type {
  AdminOverride,
  FailureRecord,
  NodeHealth,
  NodeId,
  NodeMeta,
  NodeState,
} from "./types";
import { RED_THRESHOLD, YELLOW_THRESHOLD } from "./types";

const NODE_STATE_KEY = "lc.watchdog.nodes.v1";

const nodes = new Map<NodeId, NodeState>();
const listeners = new Set<() => void>();

function health(score: number): NodeHealth {
  if (score >= RED_THRESHOLD) return "red";
  if (score >= YELLOW_THRESHOLD) return "yellow";
  return "green";
}

function emit(): void {
  listeners.forEach((fn) => fn());
  persist();
}

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    const dump = Array.from(nodes.entries()).map(([id, s]) => ({
      id,
      failureScore: s.failureScore,
      lastFailure: s.lastFailure,
      override: s.override,
    }));
    window.localStorage.setItem(NODE_STATE_KEY, JSON.stringify(dump));
  } catch {
    // localStorage quota / private-mode · non-fatal.
  }
}

function readPersisted(): Map<NodeId, { failureScore: number; lastFailure: FailureRecord | null; override: AdminOverride }> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = window.localStorage.getItem(NODE_STATE_KEY);
    if (!raw) return new Map();
    const dump: Array<{ id: NodeId; failureScore: number; lastFailure: FailureRecord | null; override: AdminOverride }> = JSON.parse(raw);
    return new Map(dump.map((d) => [d.id, { failureScore: d.failureScore, lastFailure: d.lastFailure, override: d.override }]));
  } catch {
    return new Map();
  }
}

const persisted = readPersisted();

export function registerNode(meta: NodeMeta): NodeState {
  let s = nodes.get(meta.id);
  if (!s) {
    const p = persisted.get(meta.id);
    s = {
      meta,
      failureScore: p?.failureScore ?? 0,
      lastFailure: p?.lastFailure ?? null,
      override: p?.override ?? {},
      health: health(p?.failureScore ?? 0),
    };
    nodes.set(meta.id, s);
    emit();
  }
  return s;
}

export function recordFailure(record: FailureRecord): NodeState {
  const s = nodes.get(record.nodeId);
  if (!s) {
    // Node never registered · register a placeholder so HQ still sees it.
    return registerNode({
      id: record.nodeId,
      label: record.nodeId,
      cluster: "system",
      source: "unknown",
    });
  }
  s.failureScore += record.weight;
  s.lastFailure = record;
  s.health = health(s.failureScore);
  emit();
  return s;
}

export function setOverride(id: NodeId, override: Partial<AdminOverride>): void {
  const s = nodes.get(id);
  if (!s) return;
  s.override = { ...s.override, ...override };
  if (override.clearedAt) {
    s.failureScore = 0;
    s.lastFailure = null;
    s.health = "green";
  }
  emit();
}

export function getNodeState(id: NodeId): NodeState | undefined {
  return nodes.get(id);
}

export function listNodes(): NodeState[] {
  return Array.from(nodes.values());
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Clear ALL state — for tests. */
export function _resetForTests(): void {
  nodes.clear();
  listeners.clear();
  if (typeof window !== "undefined") {
    try { window.localStorage.removeItem(NODE_STATE_KEY); } catch { /* noop */ }
  }
}
