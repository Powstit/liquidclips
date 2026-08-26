/**
 * HomeCampaignCarousel · Agency campaigns Phase 1 (2026-08-26)
 *
 * "Sponsored Campaigns / Earn From Clips" row on Home — the high-
 * visibility discovery surface the campaign spec calls for, separate
 * from the full Campaigns grid (which stays the browse-everything
 * surface). Reuses `useCampaigns()` (same data layer as the Campaigns
 * route) and `CampaignPageShell` (same detail drawer) — no duplicate
 * campaign database, no hardcoded campaigns. Renders nothing when
 * there's nothing published to show — no fake rows.
 *
 * Clipper-mode only, same placement rule as `HomeBanner` — Agency
 * accounts get "Manage Campaigns" instead of a discovery surface on
 * their own Home.
 */

import { useState } from "react";
import { useCampaigns } from "../state/useCampaigns";
import { setActiveCampaignId } from "../../shell/modeStore";
import { EngineErrorBoundary } from "../components/EngineErrorBoundary";
import { CampaignPageShell } from "./CampaignPageShell";
import {
  fmtUsdCents,
  CAMPAIGN_STATUS_LABEL,
  type Campaign,
  payoutLine,
  rewardPoolCents,
} from "./types";
import "./HomeCampaignCarousel.css";

const MAX_CARDS = 8;

export function HomeCampaignCarousel() {
  const camps = useCampaigns();
  const [activeCampaign, setActiveCampaign] = useState<Campaign | null>(null);

  // Honest-empty: no loading skeleton row, no placeholder cards. The
  // section simply isn't there until real published campaigns exist.
  if (camps.loading || camps.visible.length === 0) return null;

  const items = camps.visible.slice(0, MAX_CARDS);

  return (
    <>
      <section className="lc-home-camp-row" aria-label="Sponsored campaigns">
        <header className="lc-home-camp-row-head">
          <span className="lc-home-camp-row-eb">Sponsored Campaigns</span>
          <span className="lc-home-camp-row-sub">Earn from clips</span>
        </header>
        <div className="lc-home-camp-row-scroll" data-testid="home-campaign-row">
          {items.map((c) => (
            <HomeCampaignCard
              key={c.id}
              campaign={c}
              onOpen={() => {
                // Same shared-id pattern the Campaigns route uses (P0-05)
                // so Submit / analytics resolve the same campaign whether
                // opened from Home or from the full grid.
                setActiveCampaignId(c.slug);
                setActiveCampaign(c);
              }}
            />
          ))}
        </div>
      </section>

      <EngineErrorBoundary route="home" component="HomeCampaignCarousel/CampaignPageShell">
        <CampaignPageShell
          campaign={activeCampaign}
          open={activeCampaign !== null}
          onClose={() => {
            setActiveCampaignId(null);
            setActiveCampaign(null);
          }}
        />
      </EngineErrorBoundary>
    </>
  );
}

function HomeCampaignCard({ campaign, onOpen }: { campaign: Campaign; onOpen: () => void }) {
  const [mediaFailed, setMediaFailed] = useState(false);
  const art = campaign.featuredThumbUrl ?? campaign.bannerUrl ?? null;

  return (
    <button
      type="button"
      className="lc-home-camp-card"
      onClick={onOpen}
      aria-label={`View campaign · ${campaign.title}`}
      data-testid={`home-campaign-card-${campaign.slug}`}
    >
      {!mediaFailed && art ? (
        <img
          src={art}
          alt=""
          className="lc-home-camp-card-art"
          onError={() => setMediaFailed(true)}
        />
      ) : (
        <div className="lc-home-camp-card-art lc-home-camp-card-art-empty" aria-hidden="true" />
      )}
      <div className="lc-home-camp-card-body">
        <div className="lc-home-camp-card-head">
          <span className="lc-home-camp-card-brand">{campaign.brand ?? "Liquid Clips"}</span>
          <span className={`lc-home-camp-card-status is-${campaign.status}`}>
            <span className="lc-home-camp-card-status-dot" aria-hidden="true" />
            {CAMPAIGN_STATUS_LABEL[campaign.status]}
          </span>
        </div>
        <h3 className="lc-home-camp-card-title">{campaign.title}</h3>
        {campaign.subtitle && <p className="lc-home-camp-card-sub">{campaign.subtitle}</p>}
        <div className="lc-home-camp-card-meta">
          <span className="lc-home-camp-card-payout">{payoutLine(campaign)}</span>
          <span className="lc-home-camp-card-pool">{fmtUsdCents(rewardPoolCents(campaign))} pool</span>
        </div>
        <span className="lc-home-camp-card-cta">View Campaign →</span>
      </div>
    </button>
  );
}
