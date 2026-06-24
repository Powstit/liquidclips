/**
 * CampaignBanner · Phase 6N-B
 *
 * Featured hero card above the discovery grid. Reads one Campaign
 * (the route's `featured` slot) and renders a richer view than
 * CampaignCard: full description teaser, bigger reward + pool numbers,
 * primary CTA opens the detail page.
 *
 * Renders nothing when no featured Campaign exists — no fake hero.
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
  hasWhopSnapshot,
} from "./types";
import "./CampaignBanner.css";

export interface CampaignBannerProps {
  campaign: Campaign | null;
  onOpen: () => void;
}

function deadlineLabel(c: Campaign): string | null {
  if (c.durationLabel) return c.durationLabel;
  if (!c.deadline) return null;
  const diff = Date.parse(c.deadline) - Date.now();
  const days = Math.round(diff / (24 * 3600_000));
  if (days <= 0) return "Last call";
  return `${days} days left`;
}

export function CampaignBanner({ campaign, onOpen }: CampaignBannerProps) {
  if (!campaign) return null;
  const deadline = deadlineLabel(campaign);

  return (
    <GlassCard density="default" className={`lc-camp-banner is-${campaign.placementQuality}`} hoverLift>
      <button
        type="button"
        className="lc-camp-banner-body"
        onClick={onOpen}
        aria-label={`Open featured campaign · ${campaign.title}`}
      >
        {campaign.featuredThumbUrl ? (
          <div className="lc-camp-banner-art-wrap">
            <img src={campaign.featuredThumbUrl} alt="" className="lc-camp-banner-art" />
          </div>
        ) : campaign.bannerUrl ? (
          <div className="lc-camp-banner-art-wrap">
            <img src={campaign.bannerUrl} alt="" className="lc-camp-banner-art" />
          </div>
        ) : null}

        <div className="lc-camp-banner-text">
          <header className="lc-camp-banner-head">
            <span className="lc-camp-banner-eb">
              {PLACEMENT_LABEL[campaign.placementQuality]} · {CAMPAIGN_TYPE_LABEL[campaign.campaignType]}
            </span>
            <span className={`lc-camp-banner-status is-${campaign.status}`}>
              <span className="lc-camp-banner-status-dot" aria-hidden="true" />
              {CAMPAIGN_STATUS_LABEL[campaign.status]}
            </span>
          </header>
          <h2 className="lc-camp-banner-title">{campaign.title}</h2>
          {campaign.subtitle && (
            <p className="lc-camp-banner-sub">{campaign.subtitle}</p>
          )}
          <div className="lc-camp-banner-meta">
            <span className="lc-camp-banner-payout">{payoutLine(campaign)}</span>
            <span className="lc-camp-banner-dot" aria-hidden="true">·</span>
            <span
              className="lc-camp-banner-pool"
              title={hasWhopSnapshot(campaign) ? "Reward pool · via Whop snapshot" : "Reward pool"}
            >
              {fmtUsdCents(rewardPoolCents(campaign))} pool
            </span>
            {hasWhopSnapshot(campaign) && (
              <>
                <span className="lc-camp-banner-dot" aria-hidden="true">·</span>
                <span className="lc-camp-banner-snap-pill">via Whop snapshot</span>
              </>
            )}
            {deadline && (
              <>
                <span className="lc-camp-banner-dot" aria-hidden="true">·</span>
                <span className="lc-camp-banner-deadline">{deadline}</span>
              </>
            )}
          </div>
        </div>

        <div className="lc-camp-banner-cta-wrap">
          <span className="lc-camp-banner-cta">View campaign →</span>
        </div>
      </button>
    </GlassCard>
  );
}
