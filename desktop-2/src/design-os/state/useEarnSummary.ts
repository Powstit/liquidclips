/**
 * useEarnSummary · Phase 6L-D · AU-B-4 canonical-source alignment (2026-07-10).
 *
 * Lightweight summary on top of `useRewardClips()` for lifecycle
 * counts, but the MONEY numbers (`totalEarnedUsd`, `pendingPayoutsUsd`)
 * now come from the wallet canonical source (`useWalletLedger()` →
 * `/me/wallet/summary`) — the SAME hook WalletDetail reads.
 *
 * Why the change: Earn and Wallet were reading two different rails:
 *   - Wallet:  `pipeline.paid_usd_cents` (real ledger, reconciled)
 *              + `pending_cents`         (real Whop pending)
 *   - Earn:    `totalClicks × RPM ÷ 1000` (theoretical, click-derived)
 *              + `approved clips × RPM`   (theoretical)
 *
 * A user opening Earn and Wallet in the same session could see two
 * different lifetime totals + two different pending numbers, both
 * presented as truth. AU-B-4 fixes that by pinning both surfaces to
 * `useWalletLedger()` for the money fields. Click × RPM math still
 * drives `totalClicks` (RPM display strip) but is no longer surfaced
 * as "earned" — the wallet ledger is the truth.
 *
 * When the wallet hook is in a loading / error / unauthorized state,
 * Earn degrades gracefully: money fields fall back to $0.00 and the
 * `loading` boolean is OR-ed with the clips loader so consumers don't
 * flash inconsistent numbers during hydrate.
 *
 * RPM tier still comes from `useTierCaps()` per the locked tier matrix
 * (free $1 / pro $3 / agency $5).
 */

import { useMemo } from "react";
import { useRewardClips } from "./useRewardClips";
import { useTierCaps } from "./useTierCaps";
import { useWalletLedger } from "../../lib/wallet";
import { RPM_TIERS, type EarnSummary } from "../earn/types";

function rpmForTier(t: "clipper" | "pro" | "growth" | "agency") {
  if (t === "agency") return RPM_TIERS.agency;
  // Growth uses the pro RPM band until a dedicated growth RPM tier ships
  // in the backend earn schema. Conservative · prevents Growth getting
  // less reward than Pro by accident.
  if (t === "pro" || t === "growth") return RPM_TIERS.pro;
  return RPM_TIERS.free;
}

export interface EarnSummaryApi {
  summary: EarnSummary;
  loading: boolean;
  error: string | null;
}

export function useEarnSummary(): EarnSummaryApi {
  const clips = useRewardClips();
  const tier = useTierCaps();
  // AU-B-4 · canonical money source. WalletDetail reads the same hook
  // → the two surfaces cannot render different balances for the same
  // metric.
  const wallet = useWalletLedger();

  const summary = useMemo<EarnSummary>(() => {
    const rpm = rpmForTier(tier.tier);
    const totalClicks = clips.totalClicks;

    // Canonical money fields — read straight from the wallet summary.
    // Fall back to 0 when the wallet hook is in loading / error /
    // unauthorized state so we never render a fake number.
    const lifetimePaidCents = wallet.summary?.pipeline.paid_usd_cents ?? 0;
    const pendingCents = wallet.summary?.pending_cents ?? 0;
    const totalEarnedUsd = Math.round(lifetimePaidCents) / 100;
    const pendingPayoutsUsd = Math.round(pendingCents) / 100;

    const approvedClips = clips.byStatus.approved ?? [];
    return {
      totalEarnedUsd,
      pendingPayoutsUsd,
      approvedCount: approvedClips.length,
      rejectedCount: (clips.byStatus.denied ?? []).length,
      pendingCount: (clips.byStatus.submitted ?? []).length,
      paidCount: (clips.byStatus.paid ?? []).length,
      rpm,
      totalClicks,
      updatedAt: new Date().toISOString(),
    };
  }, [clips, tier.tier, wallet.summary]);

  return {
    summary,
    // OR both loaders so consumers block on either data source. The
    // wallet's `expired-affiliate-agreement` state isn't a "loading"
    // state · it's a terminal one · so we only wait on the true
    // wire-loading state, not on data states.
    loading: clips.loading || wallet.uiState === "loading",
    // Prefer the earlier error message so consumers can bubble one
    // single reason without inventing a joint error string.
    error: clips.error ?? (wallet.uiState === "error" ? "wallet unavailable" : null),
  };
}
