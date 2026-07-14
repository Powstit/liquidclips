/**
 * interceptionBus · dispatches Watchdog failures to the Constellation
 * Engine (Railway pool).
 *
 * Ship-lens Sovereign-Operator Protocol (2026-07-06). Every Watchdog
 * failure emits two paths:
 *   1. Local bus event `system:intercession` so the shell can render
 *      a KadeRepairScreen + surface an inbox notification.
 *   2. Best-effort POST to `/hq/nodes/intercession` on the write-active
 *      Constellation pool member. Falls through on 5xx/timeout to the
 *      next healthy pool member.
 *
 * Pool config loads LIVE from GET /hq/nodes/state (polled every 30s).
 * HQ enters pool URLs via the admin panel · client picks them up on
 * the next poll without a restart. Empty pool falls back to the
 * default backend URL (single-Railway mode).
 */

import { bus } from "../../design-os/bridge";
import type { FailureRecord } from "./types";
import { getNodeState, recordFailure, setOverride } from "./nodeRegistry";

const INTERCESSION_PATH = "/hq/nodes/intercession";
const STATE_PATH = "/hq/nodes/state";
const POOL_CACHE_KEY = "lc.constellation.pool.v1";
const OVERRIDE_CACHE_KEY = "lc.constellation.overrides.v1";
const STATE_POLL_MS = 30_000;

type PoolMember = { slot: number; name: string; url: string };

function defaultBackendUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env || {};
  return env.VITE_BACKEND_URL || "https://api.liquidclips.app";
}

function readPoolCache(): PoolMember[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(POOL_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePoolCache(pool: PoolMember[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(POOL_CACHE_KEY, JSON.stringify(pool));
  } catch {
    /* noop */
  }
}

function activePoolUrls(): string[] {
  const pool = readPoolCache();
  const urls = pool
    .filter((m) => m.url && m.url.length > 0)
    .sort((a, b) => a.slot - b.slot)
    .map((m) => m.url);
  return urls.length > 0 ? urls : [defaultBackendUrl()];
}

let dispatchInFlight = 0;
const DISPATCH_INFLIGHT_CAP = 8;

async function postWithFailover(record: EnrichedFailure): Promise<void> {
  const urls = activePoolUrls();
  for (const base of urls) {
    try {
      const r = await fetch(`${base}${INTERCESSION_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(record),
        keepalive: true,
      });
      if (r.status < 500) {
        // 2xx / 4xx = we reached this member (4xx is our bug, not a
        // failover reason). Done.
        return;
      }
      // 5xx · try next member
    } catch {
      // network error · try next member
    }
  }
  // All pool members exhausted · silent drop (Watchdog crash already
  // captured locally in nodeRegistry / localStorage).
}

type EnrichedFailure = {
  nodeId: string;
  label: string;
  cluster: string;
  source: string | null;
  weight: number;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  app_version?: string;
};

// AU-D-audit high-risk AMBER #4 (2026-07-10) · sanitize message/stack/
// context before POST to Constellation. Prior implementation posted
// raw values that could contain bearer tokens, JWTs, emails, or long
// hex secrets — Railway logs would then permanently retain them.
function sanitizeString(input: string): string {
  return input
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer <redacted>")
    .replace(/\bey[JI][A-Za-z0-9._-]{20,}/g, "<jwt-redacted>")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email-redacted>")
    .replace(/\b[0-9a-fA-F]{32,}\b/g, "<hex-redacted>");
}
function sanitizeContext(ctx: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!ctx) return ctx;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (typeof v === "string") out[k] = sanitizeString(v);
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
    else out[k] = "<opaque>"; // don't recursively serialize · avoid PII leak
  }
  return out;
}
function enrich(record: FailureRecord): EnrichedFailure {
  const registered = getNodeState(record.nodeId);
  const meta = registered?.meta;
  const versionAny = typeof window !== "undefined"
    ? (window as unknown as { __LC_APP_VERSION__?: string }).__LC_APP_VERSION__
    : undefined;
  return {
    nodeId: record.nodeId,
    label: meta?.label ?? record.nodeId,
    cluster: meta?.cluster ?? "system",
    source: meta?.source ?? null,
    weight: record.weight,
    message: sanitizeString(record.message),
    stack: record.stack ? sanitizeString(record.stack) : record.stack,
    context: sanitizeContext(record.context),
    app_version: versionAny,
  };
}

export function dispatchIntercession(record: FailureRecord): void {
  // Local: record in registry + fire bus event for the shell to react.
  const state = recordFailure(record);
  bus.emit("system:intercession", {
    nodeId: record.nodeId,
    health: state.health,
    failureScore: state.failureScore,
    message: record.message,
    ts: record.ts,
  });

  // Remote: best-effort POST with pool failover. Never awaits. Never
  // throws. Cap in-flight requests so a flood doesn't drown the network.
  if (dispatchInFlight >= DISPATCH_INFLIGHT_CAP) return;
  dispatchInFlight++;
  void postWithFailover(enrich(record)).finally(() => {
    dispatchInFlight--;
  });
}

/**
 * Poll GET /hq/nodes/state every 30s so the client picks up new pool
 * members + admin-pushed overrides without a restart. Idempotent to
 * call more than once — cancels the previous poll first.
 */
let pollHandle: ReturnType<typeof setInterval> | null = null;

async function pollStateOnce(): Promise<void> {
  const urls = activePoolUrls();
  for (const base of urls) {
    try {
      const r = await fetch(`${base}${STATE_PATH}`, { method: "GET" });
      if (r.status >= 500) continue;
      if (!r.ok) return;
      const body = await r.json();
      if (Array.isArray(body.pool_config)) {
        writePoolCache(body.pool_config as PoolMember[]);
      }
      if (body.overrides && typeof body.overrides === "object") {
        applyOverrides(body.overrides as Record<string, { disabled?: boolean; cleared_at?: string | null }>);
      }
      return;
    } catch {
      // try next member
    }
  }
}

function applyOverrides(map: Record<string, { disabled?: boolean; cleared_at?: string | null }>): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(OVERRIDE_CACHE_KEY, JSON.stringify(map));
    } catch {
      /* noop */
    }
  }
  for (const [nodeId, o] of Object.entries(map)) {
    const clearedAt = o.cleared_at ? new Date(o.cleared_at).getTime() : undefined;
    setOverride(nodeId, {
      disabled: o.disabled,
      clearedAt,
    });
  }
}

export function startInterceptionStatePolling(): () => void {
  if (typeof window === "undefined") return () => {};
  if (pollHandle) clearInterval(pollHandle);
  void pollStateOnce();
  pollHandle = setInterval(() => {
    void pollStateOnce();
  }, STATE_POLL_MS);
  return () => {
    if (pollHandle) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
  };
}
