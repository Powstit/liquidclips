/**
 * SponsoredRewardStrip · compact carrot tile shown on Home (clipper mode).
 *
 * Deep-links to Earn route for the full SponsoredRewardModule. Surfaces
 * progress + amount inline so the user sees the carrot every time they
 * land on home.
 *
 * ⚠ IRON GATE IG-SOV-2.2-001 · Sponsored Reward Rules
 * Strip copy must match the canonical rules · don't promise withdrawal.
 *
 * // SOVEREIGN-2.2 · view-count source becomes real backend hook later.
 */

import { useActivationBonus } from "./useActivationBonus";
import { bus } from "../bridge";
import {
  SPONSORED_REWARD_VIEW_THRESHOLD,
} from "./sponsoredReward";
import { getSponsoredRewardCopy } from "./rewardCopy";
import { useCarrot, computePendingBalanceUsdCents } from "./useCarrot";
import "./SponsoredRewardStrip.css";

export interface SponsoredRewardStripProps {
  viewCount?: number;
}

export function SponsoredRewardStrip({ viewCount = 0 }: SponsoredRewardStripProps) {
  const bonus = useActivationBonus(viewCount);
  const snap = bonus.snapshot;
  // 2026-08-31 · real /me/carrot pending balance · falls back to the
  // caller-supplied viewCount when the backend fetch hasn't landed.
  const carrot = useCarrot();
  const pendingCents = computePendingBalanceUsdCents(carrot.state);
  const copy = getSponsoredRewardCopy(pendingCents);
  const realViews = carrot.state.source === "live"
    ? carrot.state.data.progress.views
    : viewCount;
  const pct = Math.min(100, Math.round((realViews / SPONSORED_REWARD_VIEW_THRESHOLD) * 100));

  const goEarn = () => bus.emit("nav:click", { route: "earn" });

  // Short status label · the full programme dashboard lives on Earn.
  const shortStatus = (() => {
    switch (snap.state) {
      case "approved":             return "Approved · withdraw on Earn";
      case "pending_clearance":    return "Pending clearance · review";
      case "milestone_reached":    return "Milestone reached · activate plan";
      case "subscription_required":return "Subscription required to claim";
      case "rejected":             return "Rejected · view reason";
      case "paid":                 return "Paid · view history";
      default:                     return `${viewCount.toLocaleString()} / ${SPONSORED_REWARD_VIEW_THRESHOLD.toLocaleString()} views`;
    }
  })();

  return (
    <button
      type="button"
      className="lc-srs"
      data-testid="sponsored-reward-strip"
      data-state={snap.state}
      data-is-mock={String(snap.isMock)}
      onClick={goEarn}
      aria-label="Open Sponsored Reward on Earn"
    >
      <span className="lc-srs-pill" aria-hidden="true">
        <span className="lc-srs-pill-dot" />
        SPONSORED REWARD
      </span>
      <span className="lc-srs-amt">{copy.stripAmount}</span>
      <span className="lc-srs-sep" aria-hidden="true">·</span>
      <span className="lc-srs-status">{shortStatus}</span>
      <span className="lc-srs-spacer" />
      <span className="lc-srs-bar-wrap" aria-hidden="true">
        <span className="lc-srs-bar">
          <span
            className={`lc-srs-bar-fill ${pct >= 100 ? "is-full" : ""}`}
            style={{ width: `${pct}%` }}
          />
        </span>
        <span className="lc-srs-pct">{pct}%</span>
      </span>
      <span className="lc-srs-arrow" aria-hidden="true">→</span>
    </button>
  );
}
