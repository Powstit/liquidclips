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
 */

import { authedFetch } from "./authedFetch";

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
    throw new Error(`kade_intent.status_${resp.status}`);
  }
  return (await resp.json()) as KadeIntentResponse;
}
