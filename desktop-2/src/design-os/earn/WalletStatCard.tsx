/**
 * WalletStatCard · one of the four hero pipeline stat cards.
 *
 * Pure presentational primitive. Reads from WalletPipelineBlock cents
 * values and renders the brand-tinted card.
 *
 * Tones are 1:1 with the pipeline buckets and pick up the matching
 * border + value colour from WalletPanel.css.
 */

import type { ReactNode } from "react";
import { GlassCard } from "../components";

export type WalletStatTone = "in-review" | "approved" | "paid" | "rejected";

export interface WalletStatCardProps {
  tone: WalletStatTone;
  /** Label · short uppercase eyebrow */
  label: string;
  /** Glyph rendered to the left of the eyebrow · plain string (emoji or
   *  single character). Stays in scope of the bespoke-craft skill because
   *  emoji is brand-permitted at the eyebrow rung (no Lucide). */
  glyph: string;
  /** Formatted money / count string · already i18n-aware */
  value: string;
  /** Optional small caption under the value */
  footer?: ReactNode;
  /** Optional data-testid override */
  testId?: string;
}

export function WalletStatCard({
  tone, label, glyph, value, footer, testId,
}: WalletStatCardProps) {
  return (
    <GlassCard
      density="default"
      className="lc-wallet-stat"
      data-tone={tone}
      data-testid={testId ?? `wallet-stat-${tone}`}
    >
      <span className="lc-wallet-stat-head">
        <span className="lc-wallet-stat-icon" aria-hidden="true">{glyph}</span>
        {label}
      </span>
      <span className="lc-wallet-stat-value">{value}</span>
      {footer ? <span className="lc-wallet-stat-foot">{footer}</span> : null}
    </GlassCard>
  );
}
