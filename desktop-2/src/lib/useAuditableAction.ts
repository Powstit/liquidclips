/**
 * useAuditableAction · 2.2.24 · the single-hook coverage layer.
 *
 * Wrap every user-facing action in this hook. Guarantees the action's
 * lifecycle (start · success · failure) reaches BOTH:
 *   1. The local `flowTrace` event bus (existing telemetry surface)
 *   2. The backend `/audit/tick` endpoint (new · feeds `/audit/state`)
 *
 * 2026-07-05 · ship-lens P1-D-003 · earlier drafts claimed PostHog
 * `capture` here too; it doesn't (PostHog fires from the runner's
 * own success/error path when relevant). Docstring corrected so a
 * future reader isn't misled about where user analytics land.
 *
 * That lets `bash scripts/audit-gate.sh` refuse to ship if a critical
 * user journey (auth.sign-in, wallet.claim, publish.multi-platform,
 * campaign.create, watermark.remove) has a red success rate in the
 * last N events.
 *
 * Usage:
 *
 *   const claim = useAuditableAction("wallet.claim", async () => {
 *     const r = await fetch(`${backendUrl}/me/wallet/claim`, {
 *       method: "POST",
 *       headers: authHeaders(),
 *     });
 *     if (!r.ok) throw new Error(`claim_http_${r.status}`);
 *     return r.json();
 *   });
 *
 *   <button
 *     onClick={() => claim.fire()}
 *     disabled={claim.pending}
 *     data-audit-id="wallet.claim"
 *   >
 *     {claim.pending ? "Claiming…" : "Claim"}
 *   </button>
 *
 * The action_id is the CANONICAL journey identifier · must match a key
 * in `_CRITICAL_JOURNEYS` in backend/routes/audit.py to feed the gate.
 * Non-critical actions can use any id — they still appear in the
 * rolling window for post-hoc debugging.
 */

import { useCallback, useRef, useState } from "react";
import { flowTrace } from "./flowTrace";
import { FLOW_IDS } from "../contracts/flowRegistry";

interface AuditableActionState<T> {
  pending: boolean;
  lastError: Error | null;
  lastResult: T | null;
}

export interface AuditableAction<T> extends AuditableActionState<T> {
  /** Fire the wrapped action. Idempotent while pending — subsequent
   *  calls are no-ops until the previous run resolves. */
  fire: () => Promise<T | null>;
}

interface UseAuditableActionOpts {
  /** Free-form context tag emitted with every tick. Helps triage which
   *  surface fired the action (e.g. "TopHud", "WalletDetail"). */
  surface?: string;
  /** Best-effort user identifier · opaque · NEVER a JWT or secret. */
  userRef?: string;
  /** Override backend URL for testing. Defaults to production. */
  backendUrl?: string;
}

function defaultBackend(): string {
  const env = (import.meta as { env?: { VITE_BACKEND_URL?: string } }).env;
  const override = env?.VITE_BACKEND_URL;
  if (override) return override.replace(/\/+$/, "");
  // Canonical production host (matches the 40+ other call sites). The old
  // `api.jnremployee.com` alias still resolves today, but it's the retired
  // brand — pinning to it here silently dropped audit ticks if that alias
  // is ever turned off. Both serve the same Railway backend.
  return "https://api.liquidclips.app";
}

function postTick(
  backendUrl: string,
  payload: {
    action_id: string;
    outcome: "start" | "success" | "failure";
    duration_ms?: number;
    error_code?: string;
    surface?: string;
    user_ref?: string;
  },
): void {
  // Fire-and-forget. The audit endpoint is telemetry; a failed tick
  // MUST NOT break the user's action. `keepalive` lets the browser
  // finish the POST even during navigation / unmount.
  //
  // 2026-07-13 · E2E transport gate. Playwright's page.route does not
  // reliably intercept keepalive fetches (they go through a separate
  // pool outside CDP routing). The button audit sets
  // `window.__LCOS_E2E__ = true` so this telemetry no-ops under E2E,
  // eliminating cosmetic CORS console errors against the real prod
  // origin. Production keepalive behaviour preserved.
  if (
    typeof window !== "undefined" &&
    (window as unknown as { __LCOS_E2E__?: boolean }).__LCOS_E2E__ === true
  ) {
    return;
  }
  try {
    void fetch(`${backendUrl}/audit/tick`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
      // No `credentials: "include"` — the endpoint is unauthenticated
      // for the telemetry write path (cheap + shape-only + opaque
      // user_ref). Reads (/audit/state) may add auth later.
    }).catch(() => {
      /* silent · telemetry never breaks the user */
    });
  } catch {
    /* silent · telemetry never breaks the user */
  }
}

export function useAuditableAction<T>(
  actionId: string,
  runner: () => Promise<T>,
  opts: UseAuditableActionOpts = {},
): AuditableAction<T> {
  const [state, setState] = useState<AuditableActionState<T>>({
    pending: false,
    lastError: null,
    lastResult: null,
  });
  const inflight = useRef<boolean>(false);
  const backend = opts.backendUrl ?? defaultBackend();

  const fire = useCallback(async (): Promise<T | null> => {
    if (inflight.current) return null;
    inflight.current = true;
    setState((prev) => ({ ...prev, pending: true, lastError: null }));

    const startTs = Date.now();
    flowTrace({
      flowId: FLOW_IDS.FLOW_000_APP_SHELL,
      sectionId: null,
      actionId: `${actionId}.start`,
      status: "ok",
    });
    postTick(backend, {
      action_id: actionId,
      outcome: "start",
      surface: opts.surface,
      user_ref: opts.userRef,
    });

    try {
      const result = await runner();
      const duration = Date.now() - startTs;
      flowTrace({
        flowId: FLOW_IDS.FLOW_000_APP_SHELL,
        sectionId: null,
        actionId: `${actionId}.success`,
        status: "ok",
      });
      postTick(backend, {
        action_id: actionId,
        outcome: "success",
        duration_ms: duration,
        surface: opts.surface,
        user_ref: opts.userRef,
      });
      setState({ pending: false, lastError: null, lastResult: result });
      return result;
    } catch (rawErr) {
      const duration = Date.now() - startTs;
      const err = rawErr instanceof Error ? rawErr : new Error(String(rawErr));
      // Emit a stable error_code when the runner throws a
      // machine-shaped Error("code_x") · otherwise "unknown".
      const looksLikeCode = /^[a-z][a-z0-9_]*$/i.test(err.message);
      const errorCode = looksLikeCode ? err.message : "unknown";
      flowTrace({
        flowId: FLOW_IDS.FLOW_000_APP_SHELL,
        sectionId: null,
        actionId: `${actionId}.failure`,
        status: "warning",
        metadata: { code: errorCode },
      });
      postTick(backend, {
        action_id: actionId,
        outcome: "failure",
        duration_ms: duration,
        error_code: errorCode,
        surface: opts.surface,
        user_ref: opts.userRef,
      });
      setState({ pending: false, lastError: err, lastResult: null });
      return null;
    } finally {
      inflight.current = false;
    }
  }, [actionId, backend, opts.surface, opts.userRef, runner]);

  return {
    pending: state.pending,
    lastError: state.lastError,
    lastResult: state.lastResult,
    fire,
  };
}
