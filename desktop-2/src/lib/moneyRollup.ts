/**
 * Canonical money-rollup client · Train C2 · RC1 sprint.
 *
 * The ONE hook every money surface reads (Wallet · Cancellation ·
 * Affiliate dashboard). Backend endpoint is `GET /me/money-rollup`
 * (see `junior-backend/app/routes/money_rollup.py`).
 *
 * Every visible money value comes from `useMoneyRollup()` — no
 * parallel data sources, no fixture drift. HQ mirror (admin scope)
 * hits `GET /admin/money-rollup/{user_id}` and reads the SAME shape,
 * byte-identical.
 *
 * Class-elimination: BC-005 (UI reading divergent stores) +
 * BC-002 (fixture drift risk on money surfaces).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getJwt } from "./authStorage";

const MONEY_ROLLUP_TIMEOUT_MS = 6_000;

function backendUrl(): string {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  try {
    const v = (import.meta as any).env?.VITE_BACKEND_URL as string | undefined;
    if (typeof v === "string" && v.length > 0) return v;
  } catch { /* noop */ }
  return "https://api.liquidclips.app";
}

export interface WithdrawGates {
  has_balance: boolean;
  affiliate_agreement_signed: boolean;
  whop_connected: boolean;
  payout_ready: boolean;
}

export interface MoneyRollup {
  user_id: string;
  wallet_balance_cents: number;
  affiliate_mrr_cents: number;
  referral_total_cents: number;
  payout_eligible_cents: number;
  total_lifetime_earnings_cents: number;
  as_of_ts_ms: number;
  withdraw_gates: WithdrawGates;
}

export type MoneyRollupFetchResult =
  | { kind: "ok"; rollup: MoneyRollup }
  | { kind: "unauthorized" }
  | { kind: "error"; status?: number; reason: "network" | "http" | "shape" };

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isWithdrawGatesShape(x: unknown): x is WithdrawGates {
  if (!x || typeof x !== "object") return false;
  const g = x as Record<string, unknown>;
  return (
    typeof g.has_balance === "boolean" &&
    typeof g.affiliate_agreement_signed === "boolean" &&
    typeof g.whop_connected === "boolean" &&
    typeof g.payout_ready === "boolean"
  );
}

export function isMoneyRollupShape(x: unknown): x is MoneyRollup {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.user_id === "string" &&
    isNumber(o.wallet_balance_cents) &&
    isNumber(o.affiliate_mrr_cents) &&
    isNumber(o.referral_total_cents) &&
    isNumber(o.payout_eligible_cents) &&
    isNumber(o.total_lifetime_earnings_cents) &&
    isNumber(o.as_of_ts_ms) &&
    isWithdrawGatesShape(o.withdraw_gates)
  );
}

export async function fetchMoneyRollup(): Promise<MoneyRollupFetchResult> {
  const jwt = getJwt();
  if (!jwt) return { kind: "unauthorized" };

  const headers = new Headers();
  headers.set("content-type", "application/json");
  headers.set("authorization", `Bearer ${jwt}`);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MONEY_ROLLUP_TIMEOUT_MS);

  try {
    const r = await fetch(`${backendUrl()}/me/money-rollup`, {
      method: "GET",
      headers,
      signal: ctrl.signal,
    });
    if (r.status === 401 || r.status === 403) return { kind: "unauthorized" };
    if (!r.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[money-rollup] GET /me/money-rollup → ${r.status}`);
      return { kind: "error", status: r.status, reason: "http" };
    }
    const body = (await r.json()) as unknown;
    if (!isMoneyRollupShape(body)) {
      // eslint-disable-next-line no-console
      console.warn("[money-rollup] returned 200 with malformed shape");
      return { kind: "error", reason: "shape" };
    }
    return { kind: "ok", rollup: body };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[money-rollup] fetch failed:", err);
    return { kind: "error", reason: "network" };
  } finally {
    clearTimeout(timer);
  }
}

export interface UseMoneyRollupReturn {
  rollup: MoneyRollup | null;
  loading: boolean;
  errorReason: "network" | "http" | "shape" | null;
  unauthorized: boolean;
  refetch: () => Promise<void>;
}

export function useMoneyRollup(): UseMoneyRollupReturn {
  const [rollup, setRollup] = useState<MoneyRollup | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorReason, setErrorReason] = useState<
    "network" | "http" | "shape" | null
  >(null);
  const [unauthorized, setUnauthorized] = useState<boolean>(false);
  const disposedRef = useRef(false);

  const refetch = useCallback(async () => {
    setLoading(true);
    const result = await fetchMoneyRollup();
    if (disposedRef.current) return;
    if (result.kind === "unauthorized") {
      setRollup(null);
      setUnauthorized(true);
      setErrorReason(null);
    } else if (result.kind === "error") {
      setRollup(null);
      setUnauthorized(false);
      setErrorReason(result.reason);
    } else {
      setRollup(result.rollup);
      setUnauthorized(false);
      setErrorReason(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    void refetch();
    return () => {
      disposedRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { rollup, loading, errorReason, unauthorized, refetch };
}
