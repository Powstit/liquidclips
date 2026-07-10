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

import { useCallback, useEffect, useRef, useState } from "react";
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
  setup_available: boolean;
  payout_ready: boolean;
  payout_status: string;
  available_usd_cents: number;
  pending_usd_cents: number;
  reserve_usd_cents: number;
  destination_wallet: string | null;
}

// G2 · Layer 6 · additive ledger surface. The backend returns these
// four fields at the top level of WalletSummaryResponse. Kept optional
// on the TS side so any pre-Layer-6 backend response (or a shape drift
// during rollout) still parses cleanly — the wallet UI degrades to the
// legacy campaigns/activity render when the ledger fields are absent.
export type WalletLedgerRowType = "credit" | "debit" | "payout";

export interface WalletLedgerRow {
  id: string;
  type: WalletLedgerRowType;
  amount_cents: number;
  currency: string;
  source: string;
  whop_membership_id: string | null;
  period_start: string | null;
  created_at: string;
}

export interface WalletSummary {
  pipeline: WalletPipelineBlock;
  stats: WalletStatsBlock;
  campaigns: WalletCampaignRow[];
  recent_activity: WalletActivityRow[];
  withdraw: WalletWithdrawBlock;
  balance_cents?: number;
  pending_cents?: number;
  next_payout_at?: string | null;
  recent_ledger?: WalletLedgerRow[];
}

/* ──────── Fetcher ──────── */

/** Defensive validator · a 200 with malformed JSON should NEVER reach
 *  the UI. The bike-on-the-road audit (2026-06-26) found that a 200
 *  with an empty body crashed WalletPanel on `stats.total_submissions`.
 *  Source of truth: the WalletSummary interface above; if any of the
 *  five top-level blocks is missing or non-object, return null so the
 *  panel renders the "Wallet briefly out of reach" state. */
function isWalletSummaryShape(x: unknown): x is WalletSummary {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);
  const isFiniteNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);
  const isNullableString = (value: unknown): value is string | null =>
    value === null || typeof value === "string";

  if (!isRecord(x)) return false;
  const o = x;
  if (!isRecord(o.pipeline) || !isRecord(o.stats) || !isRecord(o.withdraw)) return false;

  const pipeline = o.pipeline;
  const stats = o.stats;
  const withdraw = o.withdraw;
  const pipelineFields = [
    "in_review_usd_cents",
    "approved_usd_cents",
    "paid_usd_cents",
    "rejected_usd_cents",
    "total_pipeline_usd_cents",
  ];
  const statsFields = [
    "lifetime_views",
    "total_submissions",
    "approval_rate_pct",
    "affiliate_revenue_usd_cents",
  ];

  return (
    pipelineFields.every((field) => isFiniteNumber(pipeline[field])) &&
    statsFields.every((field) => isFiniteNumber(stats[field])) &&
    Array.isArray(o.campaigns) &&
    o.campaigns.every((row) =>
      isRecord(row) &&
      typeof row.slug === "string" &&
      typeof row.title === "string" &&
      isNullableString(row.brand) &&
      isNullableString(row.banner_url) &&
      isFiniteNumber(row.views) &&
      isFiniteNumber(row.submissions) &&
      isFiniteNumber(row.approved) &&
      isFiniteNumber(row.earned_usd_cents) &&
      typeof row.status === "string"
    ) &&
    Array.isArray(o.recent_activity) &&
    o.recent_activity.every((row) =>
      isRecord(row) &&
      typeof row.at === "string" &&
      ["submitted", "approved", "paid", "rejected"].includes(String(row.kind)) &&
      typeof row.label === "string" &&
      isNullableString(row.campaign_slug) &&
      (row.amount_usd_cents === null || isFiniteNumber(row.amount_usd_cents))
    ) &&
    typeof withdraw.is_live === "boolean" &&
    isFiniteNumber(withdraw.min_withdrawal_usd) &&
    isFiniteNumber(withdraw.lc_fee_pct) &&
    typeof withdraw.currency === "string" &&
    typeof withdraw.setup_available === "boolean" &&
    typeof withdraw.payout_ready === "boolean" &&
    typeof withdraw.payout_status === "string" &&
    isFiniteNumber(withdraw.available_usd_cents) &&
    isFiniteNumber(withdraw.pending_usd_cents) &&
    isFiniteNumber(withdraw.reserve_usd_cents) &&
    isNullableString(withdraw.destination_wallet) &&
    // Ledger surface — optional. When present, each field validates.
    (o.balance_cents === undefined || isFiniteNumber(o.balance_cents)) &&
    (o.pending_cents === undefined || isFiniteNumber(o.pending_cents)) &&
    (o.next_payout_at === undefined ||
      o.next_payout_at === null ||
      typeof o.next_payout_at === "string") &&
    (o.recent_ledger === undefined ||
      (Array.isArray(o.recent_ledger) &&
        o.recent_ledger.every(
          (row) =>
            isRecord(row) &&
            typeof row.id === "string" &&
            (row.type === "credit" || row.type === "debit" || row.type === "payout") &&
            isFiniteNumber(row.amount_cents) &&
            typeof row.currency === "string" &&
            typeof row.source === "string" &&
            isNullableString(row.whop_membership_id) &&
            isNullableString(row.period_start) &&
            typeof row.created_at === "string",
        )))
  );
}

/* ──────── Claim / withdraw · click-wrap agreement gate ──────── */
//
// Task D · 2026-07-04 · desktop-2 wallet Claim button wire.
// Mirrors the ClaimResponse Pydantic model in
// `junior-backend/app/routes/me_wallet.py`. The endpoint short-
// circuits with `blocked=true` when the user hasn't signed the
// Partner & Affiliate Agreement; the frontend opens
// `blocked_reason.signature_url` inside the browse overlay, listens
// for the `affiliate_agreement_signed` postMessage, then re-POSTs.

export type ClaimBlockedCode =
  | "signature_required"
  | "signature_frozen"
  // Forward-compat · unknown codes render the server-provided message.
  | (string & { __brand?: "ClaimBlockedCode" });

export interface ClaimBlockedReason {
  code: ClaimBlockedCode;
  message: string;
  signature_url: string;
}

export interface ClaimResponse {
  ok: boolean;
  blocked: boolean;
  blocked_reason: ClaimBlockedReason | null;
  receipt_sha256: string | null;
  contract_version: string | null;
  amount_released_cents: number | null;
  payout_id: string | null;
}

/** Copy that maps a blocked_reason code → user-facing button/toast
 *  string. The backend already carries a full `message` string; this
 *  map is the short heading the UI shows above it. */
export const CLAIM_BLOCKED_HEADING: Record<string, string> = {
  signature_required:
    "Sign your Partner Agreement to release payouts. Takes about a minute · one-time.",
  signature_frozen:
    "Your agreement is frozen following a payment dispute. Contact support before further payouts.",
};

/** POST /me/wallet/claim.
 *
 *  Returns the server response when the fetch resolved with a 2xx +
 *  a valid shape. Returns null on network / auth / malformed-shape
 *  errors so the UI can render an honest "wallet briefly unreachable"
 *  state instead of a fake success.
 */
export async function postWalletClaim(): Promise<ClaimResponse | null> {
  const jwt = getJwt();
  const headers = new Headers();
  headers.set("content-type", "application/json");
  if (jwt) headers.set("authorization", `Bearer ${jwt}`);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WALLET_TIMEOUT_MS);

  try {
    const r = await fetch(`${backendUrl()}/me/wallet/claim`, {
      method: "POST",
      headers,
      signal: ctrl.signal,
    });
    if (!r.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[wallet] POST /me/wallet/claim → ${r.status}`);
      return null;
    }
    const body = (await r.json()) as unknown;
    if (!isClaimResponseShape(body)) {
      // eslint-disable-next-line no-console
      console.warn("[wallet] /me/wallet/claim returned 200 with malformed shape · treating as null");
      return null;
    }
    return body;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[wallet] claim fetch failed:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isClaimResponseShape(x: unknown): x is ClaimResponse {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.ok !== "boolean") return false;
  if (typeof o.blocked !== "boolean") return false;
  const nullOr = <T,>(v: unknown, pred: (v: unknown) => v is T): v is T | null =>
    v === null || pred(v);
  const isString = (v: unknown): v is string => typeof v === "string";
  const isNumber = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v);
  if (!nullOr(o.receipt_sha256, isString)) return false;
  if (!nullOr(o.contract_version, isString)) return false;
  if (!nullOr(o.amount_released_cents, isNumber)) return false;
  if (!nullOr(o.payout_id, isString)) return false;
  if (o.blocked_reason === null) return true;
  if (typeof o.blocked_reason !== "object") return false;
  const br = o.blocked_reason as Record<string, unknown>;
  return (
    isString(br.code) &&
    isString(br.message) &&
    isString(br.signature_url)
  );
}

/* ──────── Post-signature bridge · postMessage event contract ──────── */
//
// The account-app signature page posts this event to `window.parent`
// when the user submits the click-wrap form. desktop-2 doesn't own
// an iframe parent context, but the browse-panel webview forwards
// this message up to the parent React window so WalletDetail can
// react to it and re-POST /claim.

export const AGREEMENT_SIGNED_EVENT = "affiliate_agreement_signed";

export interface AgreementSignedMessage {
  type: typeof AGREEMENT_SIGNED_EVENT;
  receipt_sha256: string;
}

export function isAgreementSignedMessage(x: unknown): x is AgreementSignedMessage {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    o.type === AGREEMENT_SIGNED_EVENT &&
    typeof o.receipt_sha256 === "string" &&
    o.receipt_sha256.length > 0
  );
}

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
    const body = await r.json();
    if (!isWalletSummaryShape(body)) {
      // eslint-disable-next-line no-console
      console.warn("[wallet] /me/wallet/summary returned 200 with malformed shape · treating as null");
      return null;
    }
    return body;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[wallet] fetch failed:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ──────── useWalletSummary · shared cache across multiple mount points ──── */
//
// 2026-07-10 · Agent #2 wire sprint · WalletPanel (hero + stats + withdraw)
// and the new Earn-level Recent-payouts + Active-campaigns cards must
// render off ONE fetch, not two. This hook keeps a module-level cache
// so multiple subscribers share the same in-flight request + cached
// summary. Subscribers refetch together on `activation:complete` and
// on manual refresh.
//
// The hook returns { summary, loading, refresh } — kept intentionally
// small; components that need the tagged 401 / error distinction can
// still use `useWalletLedger()` above.

type WalletSubscriber = (state: {
  summary: WalletSummary | null;
  loading: boolean;
}) => void;

const walletSubs = new Set<WalletSubscriber>();
let walletCache: { summary: WalletSummary | null; loading: boolean } = {
  summary: null,
  loading: true,
};
let walletInflight: Promise<void> | null = null;

function notifyWalletSubs(): void {
  for (const sub of walletSubs) {
    try {
      sub(walletCache);
    } catch {
      /* subscriber crash · non-fatal */
    }
  }
}

async function fetchAndBroadcast(kind: "initial" | "refresh"): Promise<void> {
  // De-dupe concurrent callers · they all await the same promise.
  if (walletInflight) return walletInflight;
  walletCache = { summary: walletCache.summary, loading: kind === "initial" };
  notifyWalletSubs();
  const p = (async () => {
    const s = await getWalletSummary();
    walletCache = { summary: s, loading: false };
    walletInflight = null;
    notifyWalletSubs();
  })();
  walletInflight = p;
  return p;
}

export interface UseWalletSummaryReturn {
  summary: WalletSummary | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useWalletSummary(): UseWalletSummaryReturn {
  const [state, setState] = useState(walletCache);

  useEffect(() => {
    const sub: WalletSubscriber = (next) => setState(next);
    walletSubs.add(sub);
    // Kick off the first fetch on first subscription of the session.
    if (walletCache.summary === null && !walletInflight) {
      void fetchAndBroadcast("initial");
    } else {
      // Late subscriber · deliver current cached snapshot immediately.
      setState(walletCache);
    }
    return () => {
      walletSubs.delete(sub);
    };
  }, []);

  const refresh = useCallback(async () => {
    await fetchAndBroadcast("refresh");
  }, []);

  return { summary: state.summary, loading: state.loading, refresh };
}

/* ──────── Tagged fetch · discriminates 401 from network / shape errors ──── */
//
// C1-T1 · 2026-07-05 · WalletDetail needs to render 5 explicit states
// (loading · empty · populated · error · unauthorized). Legacy
// `getWalletSummary()` collapses every failure into `null`, which
// prevented WalletDetail from surfacing a Sign-in CTA on 401 vs a
// retry CTA on network error. This tagged variant preserves the
// distinction without breaking the callers of the null-returning fn.

export type WalletFetchResult =
  | { kind: "ok"; summary: WalletSummary }
  | { kind: "unauthorized" }
  | { kind: "error"; status?: number; reason: "network" | "http" | "shape" };

export async function fetchWalletSummaryResult(): Promise<WalletFetchResult> {
  const jwt = getJwt();
  if (!jwt) return { kind: "unauthorized" };

  const headers = new Headers();
  headers.set("content-type", "application/json");
  headers.set("authorization", `Bearer ${jwt}`);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WALLET_TIMEOUT_MS);

  try {
    const r = await fetch(`${backendUrl()}/me/wallet/summary`, {
      method: "GET",
      headers,
      signal: ctrl.signal,
    });
    if (r.status === 401 || r.status === 403) {
      return { kind: "unauthorized" };
    }
    if (!r.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[wallet] GET /me/wallet/summary → ${r.status}`);
      return { kind: "error", status: r.status, reason: "http" };
    }
    const body = (await r.json()) as unknown;
    if (!isWalletSummaryShape(body)) {
      // eslint-disable-next-line no-console
      console.warn("[wallet] summary returned malformed shape · treating as error");
      return { kind: "error", reason: "shape" };
    }
    return { kind: "ok", summary: body };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[wallet] fetch failed:", err);
    return { kind: "error", reason: "network" };
  } finally {
    clearTimeout(timer);
  }
}

/* ──────── useWalletLedger · React hook for the WalletDetail page ──── */
//
// Returns the same 5 states the wallet UI must render explicitly:
//
//   loading                       fetch in-flight (first mount or refetch)
//   unauthorized                  no JWT · backend returned 401/403
//   error                         network / http / shape failure
//   empty                         200 · summary has no ledger rows and no submissions
//   populated                     200 · summary has actual user data
//   expired-affiliate-agreement   claim was attempted and returned signature_frozen
//
// The last state is not derivable from /wallet/summary alone (that
// endpoint doesn't carry signature status). The consumer sets it via
// `markSignatureExpired()` after a failed Claim call.

export type WalletUIState =
  | "loading"
  | "unauthorized"
  | "error"
  | "empty"
  | "populated"
  | "expired-affiliate-agreement";

export interface UseWalletLedgerReturn {
  uiState: WalletUIState;
  summary: WalletSummary | null;
  errorReason: "network" | "http" | "shape" | null;
  refetch: () => Promise<void>;
  markSignatureExpired: () => void;
  clearSignatureExpired: () => void;
}

function isSummaryEmpty(s: WalletSummary): boolean {
  const balance = s.balance_cents ?? 0;
  const pending = s.pending_cents ?? 0;
  const ledgerLen = s.recent_ledger?.length ?? 0;
  const activityLen = s.recent_activity.length;
  const totalSubs = s.stats.total_submissions;
  const lifetimePaid = s.pipeline.paid_usd_cents;
  return (
    balance === 0 &&
    pending === 0 &&
    ledgerLen === 0 &&
    activityLen === 0 &&
    totalSubs === 0 &&
    lifetimePaid === 0
  );
}

export function useWalletLedger(): UseWalletLedgerReturn {
  const [summary, setSummary] = useState<WalletSummary | null>(null);
  const [uiState, setUiState] = useState<WalletUIState>("loading");
  const [errorReason, setErrorReason] = useState<
    "network" | "http" | "shape" | null
  >(null);
  const [signatureExpired, setSignatureExpired] = useState(false);
  const disposedRef = useRef(false);

  const refetch = useCallback(async () => {
    setUiState((prev) =>
      prev === "expired-affiliate-agreement" ? prev : "loading",
    );
    const result = await fetchWalletSummaryResult();
    if (disposedRef.current) return;
    if (result.kind === "unauthorized") {
      setSummary(null);
      setErrorReason(null);
      setUiState("unauthorized");
      return;
    }
    if (result.kind === "error") {
      setSummary(null);
      setErrorReason(result.reason);
      setUiState("error");
      return;
    }
    setSummary(result.summary);
    setErrorReason(null);
    if (signatureExpired) {
      setUiState("expired-affiliate-agreement");
    } else {
      setUiState(isSummaryEmpty(result.summary) ? "empty" : "populated");
    }
  }, [signatureExpired]);

  const markSignatureExpired = useCallback(() => {
    setSignatureExpired(true);
    setUiState("expired-affiliate-agreement");
  }, []);

  const clearSignatureExpired = useCallback(() => {
    setSignatureExpired(false);
    // Recompute state from the last fetched summary.
    setUiState((prev) => {
      if (prev !== "expired-affiliate-agreement") return prev;
      if (!summary) return "loading";
      return isSummaryEmpty(summary) ? "empty" : "populated";
    });
  }, [summary]);

  useEffect(() => {
    disposedRef.current = false;
    void refetch();
    return () => {
      disposedRef.current = true;
    };
    // Intentionally excluded `refetch` from deps · a fresh refetch
    // fires only on mount + on external `refetch()` calls. Re-running
    // this effect on every render would spam the endpoint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    uiState,
    summary,
    errorReason,
    refetch,
    markSignatureExpired,
    clearSignatureExpired,
  };
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
