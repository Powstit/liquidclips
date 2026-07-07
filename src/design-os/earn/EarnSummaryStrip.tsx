/**
 * EarnSummaryStrip · Phase 6L-D
 *
 * 5-tile metric strip above the reward-clip list. Reuses GlassCard chrome
 * + DSEG7-styled numerals (consistent with Command Room scoreboards).
 *
 * Tiles · in priority order:
 *   - Total earned (USD)
 *   - Pending payouts (USD · derived from approved-clip clicks × RPM)
 *   - Approved count
 *   - Rejected count
 *   - RPM tier label (free $1 / pro $3 / agency $5)
 */

import { GlassCard } from "../components";
import type { EarnSummary } from "./types";
import "./EarnSummaryStrip.css";

export interface EarnSummaryStripProps {
  summary: EarnSummary;
}

function fmtUsd(n: number): string {
  if (n >= 10000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

export function EarnSummaryStrip({ summary }: EarnSummaryStripProps) {
  return (
    <div className="lc-ess">
      <Tile eb="Total earned"     value={fmtUsd(summary.totalEarnedUsd)}     tone="paid" />
      <Tile eb="Pending payouts"  value={fmtUsd(summary.pendingPayoutsUsd)}  tone="pending" />
      <Tile eb="Approved"         value={String(summary.approvedCount)}      tone="approved" />
      <Tile eb="Rejected"         value={String(summary.rejectedCount)}      tone="rejected" />
      <Tile eb="RPM tier"         value={summary.rpm.label}                  tone="tier" tight />
    </div>
  );
}

function Tile({
  eb, value, tone, tight = false,
}: {
  eb: string;
  value: string;
  tone: "paid" | "pending" | "approved" | "rejected" | "tier";
  tight?: boolean;
}) {
  return (
    <GlassCard density="default" className={`lc-ess-tile is-${tone}`}>
      <span className="lc-ess-eb">{eb}</span>
      <span className={`lc-ess-value ${tight ? "is-tight" : ""}`}>{value}</span>
    </GlassCard>
  );
}
