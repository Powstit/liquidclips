/**
 * interceptionBus · dispatches Watchdog failures to HQ Admin.
 *
 * Ship-lens Sovereign-Operator Protocol (2026-07-06). Every Watchdog
 * failure emits two paths:
 *   1. Local bus event `system:intercession` so the shell can render
 *      a KadeRepairScreen + surface an inbox notification.
 *   2. Best-effort POST to `/hq/nodes/intercession` on the backend for
 *      the HQ Admin dashboard + Intercession LLM to consume.
 *
 * Backend endpoint is not yet built (see docs/PROTOCOL_SELF_HEALING_NODES.md
 * for the schema). Until it lands, the POST is skipped when unreachable —
 * failures still record locally via nodeRegistry so HQ Admin can read
 * the localStorage dump for now.
 */

import { bus } from "../../design-os/bridge";
import type { FailureRecord } from "./types";
import { recordFailure } from "./nodeRegistry";

const INTERCESSION_ENDPOINT = "/hq/nodes/intercession";

function backendUrl(): string {
  // Reuse the same env resolution pattern as other backend callers.
  if (typeof window !== "undefined") {
    const winAny = window as unknown as { __LC_BACKEND_URL__?: string };
    if (winAny.__LC_BACKEND_URL__) return winAny.__LC_BACKEND_URL__;
  }
  return "https://api.liquidclips.app";
}

let backendReachable = true; // pessimistic-flip on first fail; keeps trying every 60s

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

  // Remote: best-effort POST. Never awaits. Never throws.
  if (!backendReachable) return;
  try {
    void fetch(`${backendUrl()}${INTERCESSION_ENDPOINT}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record),
      keepalive: true,
    }).catch(() => {
      // Backend unreachable · flip cooldown for 60s.
      backendReachable = false;
      setTimeout(() => { backendReachable = true; }, 60_000);
    });
  } catch {
    backendReachable = false;
    setTimeout(() => { backendReachable = true; }, 60_000);
  }
}
