/**
 * CampaignCard · Phase 6N-B
 *
 * Discovery-grid card. Compact view of a Campaign: type badge, placement
 * chip, title, subtitle, payout summary, capacity / deadline tag, brand.
 * Click opens the detail page.
 *
 * Reuses existing brand assets per the 6M-A audit. No new art.
 */

import { GlassCard } from "../components";
import {
  fmtUsdCents,
  CAMPAIGN_TYPE_LABEL,
  CAMPAIGN_STATUS_LABEL,
  PLACEMENT_LABEL,
  type Campaign,
  payoutLine,
  rewardPoolCents,
  fundedPct,
  hasWhopSnapshot,
} from "./types";
import "./CampaignCard.css";

export interface CampaignCardProps {
  campaign: Campaign;
  onOpen: () => void;
}

function fmtCapacity(c: Campaign): string | null {
  if (c.capacityTotal === null) return null;
  return `${c.capacityUsed.toLocaleString()} / ${c.capacityTotal.toLocaleString()}`;
}

function fmtDeadline(iso: string | null): string | null {
  if (!iso) return null;
  const diff = Date.parse(iso) - Date.now();
  const abs = Math.abs(diff);
  const days = Math.round(abs / (24 * 3600_000));
  if (days <= 0) return diff > 0 ? "Today" : "Closed";
  return diff > 0 ? `${days}d left` : `${days}d ago`;
}

export function CampaignCard({ campaign, onOpen }: CampaignCardProps) {
  const capacity = fmtCapacity(campaign);
  const deadline = fmtDeadline(campaign.deadline);

  return (
    <GlassCard density="default" className={`lc-camp-card is-${campaign.campaignType} is-${campaign.placementQuality}`} hoverLift>
      <button
        type="button"
        className="lc-camp-card-body"
        onClick={onOpen}
        aria-label={`Open campaign · ${campaign.title}`}
      >
        <header className="lc-camp-card-head">
          <span className={`lc-camp-type is-${campaign.campaignType}`}>
            <span className="lc-camp-type-dot" aria-hidden="true" />
            {CAMPAIGN_TYPE_LABEL[campaign.campaignType]}
          </span>
          {campaign.placementQuality !== "standard" && (
            <span className={`lc-camp-placement is-${campaign.placementQuality}`}>
              {PLACEMENT_LABEL[campaign.placementQuality]}
            </span>
          )}
        </header>

        <h3 className="lc-camp-title">{campaign.title}</h3>
        {campaign.subtitle && (
          <p className="lc-camp-sub">{campaign.subtitle}</p>
        )}

        <div className="lc-camp-meta-row">
          <span className="lc-camp-payout">{payoutLine(campaign)}</span>
          <span
            className="lc-camp-pool"
            title={hasWhopSnapshot(campaign) ? "Reward pool · via Whop snapshot" : "Reward pool"}
          >
            {fmtUsdCents(rewardPoolCents(campaign))} pool
          </span>
        </div>

        {/* Funded bar · 6N-G · snapshot-derived when present. */}
        <div className="lc-camp-funded">
          {(() => {
            const pct = fundedPct(campaign);
            return (
              <>
                <div
                  className={`lc-camp-funded-fill ${pct >= 100 ? "is-full" : ""}`}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
                <span className="lc-camp-funded-label">{pct}% funded</span>
              </>
            );
          })()}
        </div>

        <footer className="lc-camp-foot">
          <div className="lc-camp-foot-left">
            <span className={`lc-camp-status is-${campaign.status}`}>
              <span className="lc-camp-status-dot" aria-hidden="true" />
              {CAMPAIGN_STATUS_LABEL[campaign.status]}
            </span>
            {campaign.brand && (
              <span className="lc-camp-brand">· {campaign.brand}</span>
            )}
          </div>
          <div className="lc-camp-foot-right">
            {capacity && (
              <span className="lc-camp-capacity" title="Capacity used / total">
                {capacity}
              </span>
            )}
            {deadline && (
              <span className="lc-camp-deadline">{deadline}</span>
            )}
          </div>
        </footer>
      </button>
    </GlassCard>
  );
}
