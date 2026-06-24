/**
 * Carrot API client · 2026-06-24 · talks to junior-backend /me/carrot.
 *
 * Three endpoints:
 *   GET  /me/carrot         → carrot state + progress + wallet info
 *   POST /me/carrot/onboard → returns Whop hosted onboarding URL
 *   POST /me/carrot/claim   → triggers transfers.create (gated by paid sub +
 *                              5K views OR 5 affiliates + onboarded)
 *
 * Backend defaults to MOCK mode (CARROT_WHOP_LIVE=false) so all 3 endpoints
 * return deterministic synthetic data — safe to call without touching real
 * money. When Daniel flips the env var the same calls move real USDC.
 *
 * IRON GATE IG-SOV-2.2-001 · economics (5% LC fee · $10 min withdraw · $50
 * gross per 5K views) must match backend whop_payments.py constants.
 */

import { getJwt } from "./authStorage";

function backendUrl(): string {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  try {
    const v = (import.meta as any).env?.VITE_BACKEND_URL as string | undefined;
    if (typeof v === "string" && v.length > 0) return v;
  } catch { /* noop */ }
  return "https://api.liquidclips.app";
}

/* ──────── Response shapes (mirror backend Pydantic models) ──────── */

export interface CarrotWalletBlock {
  address: string | null;
  network: string | null; // solana | ethereum | bitcoin
  onboarded: boolean;
  capabilities_crypto_payout: string;
}

export interface CarrotEconomicsBlock {
  gross_usd: number;
  lc_protocol_fee_pct: number;
  lc_protocol_fee_usd: number;
  net_to_clipper_usd: number;
  currency: string;
  min_withdrawal_usd: number;
}

export interface CarrotProgressBlock {
  views: number;
  views_threshold: number;
  affiliates: number;
  affiliates_threshold: number;
  qualified: boolean;
  qualified_via: "views" | "affiliates" | null;
}

export type CarrotState =
  | "not_started"
  | "tracking"
  | "tracking_paused"
  | "milestone_reached"
  | "subscription_required"
  | "pending_clearance"
  | "approved"
  | "rejected"
  | "paid";

export interface CarrotSnapshot {
  state: CarrotState;
  is_live: boolean;
  is_mock: boolean;
  progress: CarrotProgressBlock;
  economics: CarrotEconomicsBlock;
  wallet: CarrotWalletBlock | null;
  sub_merchant_id: string | null;
  lifetime_paid_usd: number;
  last_claim_at: string | null;
  status_copy: string;
}

export interface OnboardResponse {
  sub_merchant_id: string;
  onboarding_url: string;
  is_live: boolean;
}

export interface ClaimResponse {
  state: CarrotState;
  transfer_id: string | null;
  gross_usd: number;
  fee_usd: number;
  net_usd: number;
  currency: string;
  error: string | null;
  is_live: boolean;
}

/* ──────── Fetchers ──────── */

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const jwt = getJwt();
  const headers = new Headers(init.headers ?? {});
  if (jwt) headers.set("authorization", `Bearer ${jwt}`);
  headers.set("content-type", "application/json");
  return fetch(`${backendUrl()}${path}`, { ...init, headers });
}

export async function getCarrot(): Promise<CarrotSnapshot | null> {
  try {
    const r = await authedFetch("/me/carrot");
    if (!r.ok) return null;
    return (await r.json()) as CarrotSnapshot;
  } catch {
    return null;
  }
}

export async function onboardCarrot(): Promise<OnboardResponse | { error: string }> {
  try {
    const r = await authedFetch("/me/carrot/onboard", { method: "POST" });
    if (!r.ok) {
      const detail = await r.json().catch(() => null);
      return { error: (detail as { detail?: string } | null)?.detail ?? `HTTP ${r.status}` };
    }
    return (await r.json()) as OnboardResponse;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "network error" };
  }
}

export async function claimCarrot(): Promise<ClaimResponse | { error: string }> {
  try {
    const r = await authedFetch("/me/carrot/claim", { method: "POST" });
    if (!r.ok) {
      const detail = await r.json().catch(() => null);
      return { error: (detail as { detail?: string } | null)?.detail ?? `HTTP ${r.status}` };
    }
    return (await r.json()) as ClaimResponse;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "network error" };
  }
}
