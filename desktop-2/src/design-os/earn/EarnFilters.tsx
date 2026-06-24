/**
 * EarnFilters · Phase 6L-D
 *
 * Status chip filters above the reward-clip list. Mirrors
 * `schedule/ScheduleFilters.tsx` so the user mental model carries.
 */

import { EARN_FILTER_ORDER, EARN_FILTER_LABEL, type EarnFilterKey } from "./types";
import type { RewardClip } from "./types";
import "./EarnFilters.css";

export interface EarnFiltersProps {
  active: EarnFilterKey;
  onChange: (k: EarnFilterKey) => void;
  byFilter: Readonly<Record<EarnFilterKey, RewardClip[]>>;
}

export function EarnFilters({ active, onChange, byFilter }: EarnFiltersProps) {
  return (
    <div className="lc-ef" role="tablist" aria-label="Earn filters">
      {EARN_FILTER_ORDER.map((k) => {
        const isActive = active === k;
        const count = (byFilter[k] ?? []).length;
        return (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`lc-ef-chip is-${k} ${isActive ? "is-active" : ""}`}
            onClick={() => onChange(k)}
          >
            <span className="lc-ef-label">{EARN_FILTER_LABEL[k]}</span>
            <span className="lc-ef-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
