/**
 * kadeIntentClient · Composer C1 · desktop-side hosted LLM intent client.
 *
 * ⚠ IRON GATE IG-COMPOSER-X · Kade intent contract (desktop side).
 *
 * Composer's command bar can hand raw text to the hosted LLM via
 * junior-backend/routes/proxy_llm.py :: /proxy/llm/intent and receive a
 * normalised { action, capability, resolved_params, needs_ask, reasoning }
 * payload the router can execute directly.
 *
 * Auth: license JWT via authedFetch.
 * Fallback: on network / auth / quota failure, callers should fall
 * back to the local routeIntent() so the command bar never dead-ends.
 *
 * 2026-07-19 · billing wire · 402 (quota exhausted) and 403 (tier not
 * eligible) responses translate into `billing:reserve-refused` bus
 * events so `billingRefusalRouter` opens the correct paywall / message
 * instead of leaving `kade_intent.status_402` as a raw error string in
 * Kade's dialogue stream.
 */

import { authedFetch } from "./authedFetch";
import { bus } from "../design-os/bridge/events";

const BACKEND_URL =
  (import.meta as { env?: { VITE_BACKEND_URL?: string } }).env?.VITE_BACKEND_URL?.replace(
    /\/+$/,
    "",
  ) ?? "https://api.jnremployee.com";

export type IntentAction = "execute" | "ask" | "miss";

export interface KadeIntent {
  action: IntentAction;
  capability: string | null;
  resolved_params: Record<string, string>;
  needs_ask: string[];
  reasoning: string;
}

export interface KadeIntentRequest {
  utterance: string;
  capability_ids: string[];
  context?: Record<string, string>;
}

export interface KadeIntentResponse {
  intent: KadeIntent;
  model: string;
  usage_tokens: number;
  quota_remaining: number | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export async function requestKadeIntent(req: KadeIntentRequest): Promise<KadeIntentResponse> {
  const resp = await authedFetch(`${BACKEND_URL}/proxy/llm/intent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!resp.ok) {
    // 2026-07-19 · billing wire · translate 402 (monthly LLM quota
    // exhausted) and 403 (tier not eligible for hosted LLM) into a
    // typed `billing:reserve-refused` event so `billingRefusalRouter`
    // opens the correct paywall / message. Without this the raw error
    // string `kade_intent.status_402` lands in Kade's dialogue stream
    // and users have no idea what happened or what to do.
    if (resp.status === 402) {
      try {
        bus.emit("billing:reserve-refused", {
          code: "allowance_exceeded",
          http_status: 402,
          source: "kade_intent",
          message: "You've used this month's hosted LLM quota.",
        });
      } catch { /* bus emit best-effort · never blocks the throw */ }
    } else if (resp.status === 403) {
      try {
        bus.emit("billing:reserve-refused", {
          code: "free_bundle_used",
          http_status: 403,
          source: "kade_intent",
          message: "Kade requires Agency. Upgrade to unlock.",
        });
      } catch { /* bus emit best-effort */ }
    }
    throw new Error(`kade_intent.status_${resp.status}`);
  }
  return (await resp.json()) as KadeIntentResponse;
}
