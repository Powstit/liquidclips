/**
 * WalletStatCard · one of the four hero pipeline stat cards.
 *
 * Pure presentational primitive. Reads from WalletPipelineBlock cents
 * values and renders the brand-tinted card.
 *
 * Tones are 1:1 with the pipeline buckets and pick up the matching
 * border + icon treatment from WalletPanel.css. Money stays white
 * across every card so the wallet reads as one financial system.
 */

import type { ReactNode } from "react";
import { GlassCard } from "../components";

export type WalletStatTone = "in-review" | "approved" | "paid" | "rejected";

export interface WalletStatCardProps {
  tone: WalletStatTone;
  /** Label · short uppercase eyebrow */
  label: string;
  /** Brand-shipped reward icon rendered beside the label. */
  iconSrc: string;
  /** Formatted money / count string · already i18n-aware */
  value: string;
  /** Optional small caption under the value */
  footer?: ReactNode;
  /** Optional data-testid override */
  testId?: string;
}

export function WalletStatCard({
  tone, label, iconSrc, value, footer, testId,
}: WalletStatCardProps) {
  return (
    <GlassCard
      density="default"
      className="lc-wallet-stat"
      data-tone={tone}
      data-testid={testId ?? `wallet-stat-${tone}`}
    >
      <span className="lc-wallet-stat-head">
        <span className="lc-wallet-stat-icon" aria-hidden="true">
          <img src={iconSrc} alt="" />
        </span>
        {label}
      </span>
      <span className="lc-wallet-stat-value">{value}</span>
      {footer ? <span className="lc-wallet-stat-foot">{footer}</span> : null}
    </GlassCard>
  );
}
