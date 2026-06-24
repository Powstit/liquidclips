// Lane 2 — Editor right-rail context strip.
// Pure presentational. Honest empty state when no campaign is active.

import type { FakeCampaign } from "../../fixtures/fakeCampaigns";

interface CampaignContextStripProps {
  campaign: FakeCampaign | undefined;
  /** Defaults to @uncledaniel — the shared fallback stamp. */
  fallbackStamp?: string;
}

export function CampaignContextStrip({
  campaign,
  fallbackStamp = "@uncledaniel",
}: CampaignContextStripProps) {
  const stamp = campaign?.watermarkHandle ?? fallbackStamp;
  const name = campaign?.name ?? "No active campaign";
  const rulesUrl = campaign?.rewardPoolUrl ?? campaign?.inviteUrl ?? null;

  return (
    <div
      className="lc-campaign-context-strip"
      data-engine-slot="campaign context strip"
      aria-label="Editing for campaign"
    >
      <div className="lc-ccs-eyebrow">EDITING FOR</div>

      <div className="lc-ccs-row">
        <div className="lc-ccs-avatar" aria-hidden="true">
          {(campaign?.name ?? "LC").slice(0, 2).toUpperCase()}
        </div>
        <div className="lc-ccs-body">
          <div className="lc-ccs-name" title={name}>
            {name}
          </div>
          <div className="lc-ccs-stamp-row">
            <span className="lc-ccs-stamp-mark" aria-hidden="true" />
            <span className="lc-ccs-stamp">{stamp}</span>
          </div>
        </div>
      </div>

      <div className="lc-ccs-foot">
        <span className="lc-ccs-locked">
          <span className="lc-ccs-lock-dot" aria-hidden="true" />
          Campaign watermark locked
        </span>
        {rulesUrl ? (
          <a
            className="lc-ccs-rules"
            href={rulesUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Rules ↗
          </a>
        ) : (
          <span className="lc-ccs-rules" aria-disabled="true">
            Rules ↗
          </span>
        )}
      </div>
    </div>
  );
}
