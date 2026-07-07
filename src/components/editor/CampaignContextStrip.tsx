// Lane 2 — Editor right-rail context strip.
// Pure presentational. Honest empty state when no campaign is active.
//
// 2026-07-03 · Step 3 batch 3f · replaced imported `FakeCampaign` type
// with a local minimal shape. Backend campaign row (Step 4) will provide
// the same fields; keeping the shape here means the consumer contract
// is stable across the sever.

import { openInApp } from "../../lib/openInApp";

export interface CampaignContext {
  name?: string;
  watermarkHandle?: string;
  rewardPoolUrl?: string | null;
  inviteUrl?: string | null;
}

interface CampaignContextStripProps {
  campaign: CampaignContext | undefined;
  /** Defaults to @yourhandle — generic, brand-agnostic fallback stamp. */
  fallbackStamp?: string;
}

export function CampaignContextStrip({
  campaign,
  // BUG-004 sister sweep · was "@uncledaniel" (legacy demo handle that
  // leaked into the editor whenever no campaign was active). Sister to
  // the EditorSection.tsx fix already shipped in v2.2.5 commit b7cab2c.
  fallbackStamp = "@yourhandle",
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
            onClick={(event) => {
              event.preventDefault();
              void openInApp(rulesUrl, { intent: "read-only" });
            }}
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
