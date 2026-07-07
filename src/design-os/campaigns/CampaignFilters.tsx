/**
 * CampaignFilters · Phase 6N-B
 *
 * Chip filters above the discovery grid. Mirrors EarnFilters /
 * ScheduleFilters so the mental model carries.
 */

import {
  CAMPAIGN_FILTER_ORDER,
  CAMPAIGN_FILTER_LABEL,
  applyCampaignFilter,
  type Campaign,
  type CampaignFilterKey,
} from "./types";
import "./CampaignFilters.css";

export interface CampaignFiltersProps {
  active: CampaignFilterKey;
  onChange: (k: CampaignFilterKey) => void;
  campaigns: ReadonlyArray<Campaign>;
}

export function CampaignFilters({ active, onChange, campaigns }: CampaignFiltersProps) {
  return (
    <div className="lc-camp-filters" role="tablist" aria-label="Campaign filters">
      {CAMPAIGN_FILTER_ORDER.map((k) => {
        const isActive = active === k;
        const count = applyCampaignFilter(campaigns, k).length;
        return (
          <button
            key={k}
            type="button"
            data-testid={`campaign-filter-${k}`}
            role="tab"
            aria-selected={isActive}
            className={`lc-camp-filter-chip is-${k} ${isActive ? "is-active" : ""}`}
            onClick={() => onChange(k)}
          >
            <span className="lc-camp-filter-label">{CAMPAIGN_FILTER_LABEL[k]}</span>
            <span className="lc-camp-filter-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
