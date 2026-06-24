/**
 * Wallet API client · 2026-06-24 · talks to junior-backend /me/wallet/summary.
 *
 * Single endpoint returns the full denormalised wallet payload (pipeline
 * buckets + stats + per-campaign rows + activity feed + withdraw block) so
 * the UI doesn't have to choreograph 4 round-trips. Mirrors the Pydantic
 * models defined in junior-backend/app/routes/me_wallet.py.
 *
 * Auth: license JWT bearer via getJwt() from authStorage.ts.
 * Timeout: 6s · the call is read-only and aggregates fast (single user scope).
 * Error handling: log + return null · the UI falls back to a beautiful
 * empty/error state, never to a fake balance.
 *
 * Withdraw is env-gated server-side via `withdraw.is_live`. The UI hides
 * the withdraw button when false · the carrot.ts client is still the
 * caller for the actual transfers.create call.
 */

import { getJwt } from "./authStorage";

const WALLET_TIMEOUT_MS = 6_000;

function backendUrl(): string {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  try {
    const v = (import.meta as any).env?.VITE_BACKEND_URL as string | undefined;
    if (typeof v === "string" && v.length > 0) return v;
  } catch { /* noop */ }
  return "https://api.liquidclips.app";
}

/* ──────── Response shapes (mirror backend Pydantic models) ──────── */

export interface WalletPipelineBlock {
  in_review_usd_cents: number;
  approved_usd_cents: number;
  paid_usd_cents: number;
  rejected_usd_cents: number;
  total_pipeline_usd_cents: number;
}

export interface WalletStatsBlock {
  lifetime_views: number;
  total_submissions: number;
  approval_rate_pct: number;
  affiliate_revenue_usd_cents: number;
}

export interface WalletCampaignRow {
  slug: string;
  title: string;
  brand: string | null;
  banner_url: string | null;
  views: number;
  submissions: number;
  approved: number;
  earned_usd_cents: number;
  status: string;
}

export type WalletActivityKind = "submitted" | "approved" | "paid" | "rejected";

export interface WalletActivityRow {
  at: string;
  kind: WalletActivityKind;
  label: string;
  campaign_slug: string | null;
  amount_usd_cents: number | null;
}

export interface WalletWithdrawBlock {
  is_live: boolean;
  min_withdrawal_usd: number;
  lc_fee_pct: number;
  currency: string;
  destination_wallet: string | null;
}

export interface WalletSummary {
  pipeline: WalletPipelineBlock;
  stats: WalletStatsBlock;
  campaigns: WalletCampaignRow[];
  recent_activity: WalletActivityRow[];
  withdraw: WalletWithdrawBlock;
}

/* ──────── Fetcher ──────── */

export async function getWalletSummary(): Promise<WalletSummary | null> {
  const jwt = getJwt();
  const headers = new Headers();
  headers.set("content-type", "application/json");
  if (jwt) headers.set("authorization", `Bearer ${jwt}`);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WALLET_TIMEOUT_MS);

  try {
    const r = await fetch(`${backendUrl()}/me/wallet/summary`, {
      method: "GET",
      headers,
      signal: ctrl.signal,
    });
    if (!r.ok) {
      // Log non-2xx for diagnostics · don't surface mock data.
      // eslint-disable-next-line no-console
      console.warn(`[wallet] GET /me/wallet/summary → ${r.status}`);
      return null;
    }
    return (await r.json()) as WalletSummary;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[wallet] fetch failed:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ──────── Display helpers (small + pure · safe to share across components) ──── */

export function fmtUsdCents(cents: number): string {
  const usd = cents / 100;
  if (Math.abs(usd) >= 10_000) return `$${(usd / 1000).toFixed(1)}k`;
  return `$${usd.toFixed(2)}`;
}

export function fmtViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function fmtRelativeTime(iso: string, nowMs: number = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const deltaSec = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (deltaSec < 60) return "just now";
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)} min ago`;
  if (deltaSec < 86_400) return `${Math.floor(deltaSec / 3600)} hr ago`;
  if (deltaSec < 604_800) return `${Math.floor(deltaSec / 86_400)} d ago`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
