/**
 * SponsoredRewardCard · campaign-grid card for /campaigns.
 *
 * Visually consistent with CampaignCard but powered by the activation-bonus
 * state machine instead of a real Whop campaign. Tapping it opens the
 * Earn route (where the full SponsoredRewardModule lives).
 *
 * Why a separate component vs a fixture campaign:
 *   - Drives off useActivationBonus (per-user state), not a static fixture.
 *   - "Sponsored Reward" pill distinguishes it from agency/whop campaigns.
 *   - MP4 banner (we own this · agency campaigns get static banners).
 *
 * ⚠ IRON GATE IG-SOV-2.2-001 · Sponsored Reward Rules
 *
 * // SOVEREIGN-2.2 · view-count + pool depletion become real backend reads later.
 */

import { GlassCard } from "../components";
import { useActivationBonus } from "./useActivationBonus";
import { bus } from "../bridge";
import { SafeVideo } from "../../components/safe";
import {
  SPONSORED_REWARD_AMOUNT_USD,
  SPONSORED_REWARD_VIEW_THRESHOLD,
  SPONSORED_REWARD_BANNER_MP4,
} from "./sponsoredReward";
import "./SponsoredRewardCard.css";

export interface SponsoredRewardCardProps {
  viewCount?: number;
}

export function SponsoredRewardCard({ viewCount = 0 }: SponsoredRewardCardProps) {
  const bonus = useActivationBonus(viewCount);
  const snap = bonus.snapshot;
  const pct = Math.min(100, Math.round((viewCount / SPONSORED_REWARD_VIEW_THRESHOLD) * 100));

  const onOpen = () => bus.emit("nav:click", { route: "earn" });

  return (
    <GlassCard
      density="default"
      className="lc-src is-sponsored"
      data-testid="sponsored-reward-card"
      data-state={snap.state}
      hoverLift
    >
      <button
        type="button"
        className="lc-src-body"
        onClick={onOpen}
        aria-label={`Open Sponsored Reward · ${snap.statusCopy}`}
      >
        {/* Banner */}
        <div className="lc-src-banner">
          <SafeVideo
            className="lc-src-banner-video"
            src={SPONSORED_REWARD_BANNER_MP4}
            autoPlay
            loop
            muted
            playsInline
            aria-hidden="true"
          />
          <div className="lc-src-banner-overlay" />
          <span className="lc-src-pill" data-testid="sponsored-reward-card-pill">
            <span className="lc-src-pill-dot" aria-hidden="true" />
            Sponsored Reward
          </span>
          {snap.isMock && (
            <span className="lc-src-sim">[simulator]</span>
          )}
          <div className="lc-src-banner-foot">
            <span className="lc-src-amt">${SPONSORED_REWARD_AMOUNT_USD}</span>
            <span className="lc-src-amt-sub">per {SPONSORED_REWARD_VIEW_THRESHOLD.toLocaleString()} views</span>
          </div>
        </div>

        <div className="lc-src-meta">
          <h3 className="lc-src-title">Claim your $50</h3>
          <p className="lc-src-sub">
            Hit 5,000 authenticated tracked views OR refer 5 paying subscribers · pay nothing · cancel anytime.
          </p>

          <div className="lc-src-progress">
            <div className="lc-src-progress-bar" aria-hidden="true">
              <div
                className={`lc-src-progress-fill ${pct >= 100 ? "is-full" : ""}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="lc-src-progress-label">
              {viewCount.toLocaleString()} / {SPONSORED_REWARD_VIEW_THRESHOLD.toLocaleString()} views · {pct}%
            </span>
          </div>

          <div className="lc-src-cta-row">
            <span className="lc-src-status">{snap.statusCopy}</span>
            <span className="lc-src-arrow" aria-hidden="true">View reward →</span>
          </div>
        </div>
      </button>
    </GlassCard>
  );
}
