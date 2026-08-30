/**
 * SponsoredRewardModule · top-of-Earn module for the $50 Sponsored Reward.
 *
 * Full programme dashboard · renders the activation-bonus state machine
 * with YouTube-Partner-Programme-style requirements, two-path progress
 * (views OR affiliates), payout breakdown including 5% protocol fee, $10
 * minimum withdrawal threshold, pool depletion meter, and the canonical
 * rules section.
 *
 * Honest copy rules (Daniel-locked):
 *   - Pending money is NOT withdrawable
 *   - Subscription is NOT paid from the bonus
 *   - Payout is NOT promised before clearance
 *
 * ⚠ IRON GATE IG-SOV-2.2-001 · Sponsored Reward Rules
 * Changing the threshold (5,000 views / 5 affiliates), payout ($50), fee
 * (5%), or min withdraw ($10) requires an explicit override in the same
 * turn. See src/design-os/earn/sponsoredReward.ts for canonical constants.
 *
 * // SOVEREIGN-2.2 · withdraw button currently disabled · enables when
 * backend wires Shinami zkLogin + Sui USDC payout rail.
 */

import { useEffect, useState } from "react";
import { GlassCard } from "../components";
// Watchdog Rollout · mo-17 (2026-07-06) · sponsored reward module.
// Wraps the top-of-Earn $50 activation-bonus dashboard. Nested wraps
// live inside (mo-13 in RewardRules for the Sui payout copy) · this
// wrap covers the outer state-machine + payout math + pool meter so a
// failure there renders KadeRepairScreen instead of blanking the whole
// Earn tab. See docs/PROTOCOL_SELF_HEALING_NODES.md.
import { Watchdog } from "../../lib/watchdog";
import { useActivationBonus } from "./useActivationBonus";
import { useBillingState } from "../../lib/billing/adapter";
import { RewardRules, SPONSORED_REWARD_RULES } from "./RewardRules";
import { claimCarrot, getCarrot, onboardCarrot, type CarrotSnapshot } from "../../lib/carrot";
import { openInApp } from "../../lib/openInApp";
import { bus } from "../bridge";
import { SafeVideo } from "../../components/safe";
import {
  SPONSORED_REWARD_AMOUNT_USD,
  SPONSORED_REWARD_VIEW_THRESHOLD,
  SPONSORED_REWARD_AFFILIATE_THRESHOLD,
  SPONSORED_REWARD_BANNER_MP4,
  SPONSORED_REWARD_POOL_NOTIONAL_USD,
  SOVEREIGN_PROTOCOL_FEE_PCT,
  SOVEREIGN_WITHDRAWAL_MIN_USD,
  netPayoutUsd,
  protocolFeeUsd,
} from "./sponsoredReward";
import { getSponsoredRewardCopy } from "./rewardCopy";
import "./SponsoredRewardModule.css";

export interface SponsoredRewardModuleProps {
  /** Current cumulative authenticated tracked views. Default 0. */
  viewCount?: number;
  /** Current count of paying-sub referrals for the alternative qualification
   *  path. Default 0 (until backend wires referral data). */
  referralCount?: number;
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function fmtPct(used: number, cap: number): number {
  return Math.min(100, Math.max(0, Math.round((used / cap) * 100)));
}

const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  tracking: "Tracking",
  milestone_reached: "Milestone reached",
  subscription_required: "Subscription required",
  pending_clearance: "Pending clearance",
  approved: "Approved",
  rejected: "Rejected",
  paid: "Paid",
};

const STATUS_TONE: Record<string, string> = {
  not_started: "muted",
  tracking: "active",
  milestone_reached: "primary",
  subscription_required: "warn",
  pending_clearance: "primary",
  approved: "success",
  rejected: "error",
  paid: "muted",
};

export function SponsoredRewardModule({
  viewCount = 0,
  referralCount = 0,
}: SponsoredRewardModuleProps) {
  const bonus = useActivationBonus(viewCount);
  const billing = useBillingState();

  // 2026-06-24 · live carrot snapshot from /me/carrot · null until first poll
  // resolves. When present, overrides the local simulator state for the
  // status badge + view counts. Backend is feature-flag gated (CARROT_WHOP_LIVE
  // default false) · is_mock=true while in dev mode but the round-trip still
  // works · production with the flag flipped moves real USDC.
  const [carrot, setCarrot] = useState<CarrotSnapshot | null>(null);
  useEffect(() => {
    void getCarrot().then(setCarrot);
  }, []);

  const snap = bonus.snapshot;
  const isPaidSub = billing.state === "active";

  // Two-path progress.
  const viewsPct = fmtPct(viewCount, SPONSORED_REWARD_VIEW_THRESHOLD);
  const affiliatesPct = fmtPct(referralCount, SPONSORED_REWARD_AFFILIATE_THRESHOLD);

  // Payout breakdown (when approved).
  const gross = snap.approvedUsd > 0 ? snap.approvedUsd : SPONSORED_REWARD_AMOUNT_USD;
  const fee = protocolFeeUsd(gross);
  const net = netPayoutUsd(gross);
  const canWithdraw = snap.approvedUsd >= SOVEREIGN_WITHDRAWAL_MIN_USD;

  // Pool meter (notional · $1M with mock "depleted" trickle).
  // SOVEREIGN-2.2 · real depletion driven by backend ledger sum.
  const poolRemaining = SPONSORED_REWARD_POOL_NOTIONAL_USD - 12_750; // mock trickle

  const statusLabel = STATUS_LABEL[snap.state] ?? snap.state;
  const statusTone = STATUS_TONE[snap.state] ?? "muted";

  return (
    <Watchdog
      id="money/mo-17/sponsored-reward"
      label="Sponsored reward module (viewCount + referralCount + payout)"
      cluster="money"
      source="src/design-os/earn/SponsoredRewardModule.tsx:SponsoredRewardModule"
    >
      <GlassCard
      density="default"
      className="lc-srm"
      data-testid="sponsored-reward-module"
      data-state={snap.state}
      data-is-mock={String(snap.isMock)}
    >
      {/* Banner with MP4 background */}
      <div className="lc-srm-banner">
        <SafeVideo
          className="lc-srm-banner-video"
          src={SPONSORED_REWARD_BANNER_MP4}
          autoPlay
          loop
          muted
          playsInline
          aria-hidden="true"
        />
        <div className="lc-srm-banner-overlay" />
        <div className="lc-srm-banner-head">
          <span className="lc-srm-pill" data-testid="sponsored-reward-pill">
            <span className="lc-srm-pill-dot" aria-hidden="true" />
            Sponsored Reward
          </span>
          {snap.isMock && (
            <span className="lc-srm-sim" data-testid="sponsored-reward-sim-chip">
              [simulator]
            </span>
          )}
        </div>
        <div className="lc-srm-banner-body">
          {(() => {
            const copy = getSponsoredRewardCopy();
            return (
              <>
                <h2 className="lc-srm-title">{copy.title}</h2>
                <p className="lc-srm-sub">{copy.sub}</p>
              </>
            );
          })()}
        </div>
      </div>

      {/* Status badge */}
      <div className="lc-srm-status-row">
        <span
          className={`lc-srm-status-badge is-${statusTone}`}
          data-testid="sponsored-reward-status-badge"
        >
          <span className="lc-srm-status-dot" aria-hidden="true" />
          {statusLabel}
        </span>
        <span className="lc-srm-status-copy" data-testid="sponsored-reward-status-copy">
          {snap.statusCopy}
        </span>
      </div>

      {/* Two-path progress */}
      <div className="lc-srm-paths">
        <div className="lc-srm-path" data-testid="sponsored-reward-views-progress">
          <div className="lc-srm-path-head">
            <span className="lc-srm-path-eb">Path A · Views</span>
            <span className="lc-srm-path-count">
              {viewCount.toLocaleString()} / {SPONSORED_REWARD_VIEW_THRESHOLD.toLocaleString()}
            </span>
          </div>
          <div className="lc-srm-path-bar" aria-hidden="true">
            <div
              className={`lc-srm-path-fill ${viewsPct >= 100 ? "is-full" : ""}`}
              style={{ width: `${viewsPct}%` }}
            />
          </div>
          <span className="lc-srm-path-pct">{viewsPct}% of threshold</span>
        </div>
        <div className="lc-srm-path-sep" aria-hidden="true">OR</div>
        <div className="lc-srm-path" data-testid="sponsored-reward-affiliates-progress">
          <div className="lc-srm-path-head">
            <span className="lc-srm-path-eb">Path B · Affiliates</span>
            <span className="lc-srm-path-count">
              {referralCount} / {SPONSORED_REWARD_AFFILIATE_THRESHOLD}
            </span>
          </div>
          <div className="lc-srm-path-bar" aria-hidden="true">
            <div
              className={`lc-srm-path-fill ${affiliatesPct >= 100 ? "is-full" : ""}`}
              style={{ width: `${affiliatesPct}%` }}
            />
          </div>
          <span className="lc-srm-path-pct">{affiliatesPct}% of threshold</span>
        </div>
      </div>

      {/* Balances · pending vs approved vs paid */}
      <div className="lc-srm-balances">
        <div className="lc-srm-bal" data-testid="sponsored-reward-pending">
          <span className="lc-srm-bal-eb">Pending</span>
          <span className="lc-srm-bal-amt">{fmtUsd(snap.pendingUsd)}</span>
          <span className="lc-srm-bal-note">Not withdrawable</span>
        </div>
        <div className="lc-srm-bal" data-testid="sponsored-reward-approved">
          <span className="lc-srm-bal-eb">Approved</span>
          <span className="lc-srm-bal-amt is-emphasis">{fmtUsd(snap.approvedUsd)}</span>
          <span className="lc-srm-bal-note">Ready to claim</span>
        </div>
        <div className="lc-srm-bal" data-testid="sponsored-reward-paid">
          <span className="lc-srm-bal-eb">Paid</span>
          <span className="lc-srm-bal-amt">{fmtUsd(snap.paidUsd)}</span>
          <span className="lc-srm-bal-note">Historical</span>
        </div>
      </div>

      {/* Payout breakdown (visible when approved) */}
      {snap.state === "approved" && (
        <div className="lc-srm-breakdown" data-testid="sponsored-reward-breakdown">
          <h4 className="lc-srm-breakdown-h">Reward credit</h4>
          <ul className="lc-srm-breakdown-list">
            <li><span>Gross bonus</span><span>{fmtUsd(gross)}</span></li>
            <li>
              <span>Liquid Clips protocol fee · {SOVEREIGN_PROTOCOL_FEE_PCT}%</span>
              <span>−{fmtUsd(fee)}</span>
            </li>
            <li className="is-net">
              <span>Net to your Whop balance</span>
              <span>{fmtUsd(net)}</span>
            </li>
          </ul>
          {!canWithdraw && (
            <p className="lc-srm-breakdown-note">
              Claiming unlocks at {fmtUsd(SOVEREIGN_WITHDRAWAL_MIN_USD)} approved balance · {fmtUsd(SOVEREIGN_WITHDRAWAL_MIN_USD - snap.approvedUsd)} away.
            </p>
          )}
        </div>
      )}

      {/* CTA per state · backend-first · falls back to local simulator
          when /me/carrot is unreachable (offline preview / harness). */}
      <div className="lc-srm-cta-row">
        <SponsoredRewardCta
          state={snap.state}
          isPaidSub={isPaidSub}
          canWithdraw={canWithdraw}
          onClaim={async () => {
            // milestone_reached · trigger Whop sub-merchant onboarding
            const res = await onboardCarrot();
            // Type-narrow via the success-only field (`onboarding_url`)
            // rather than `error`, which is shared with ClaimResponse.
            if (!("onboarding_url" in res)) {
              bus.emit("toast", {
                kind: "warning",
                title: "Couldn't open onboarding",
                body: res.error,
              });
              return;
            }
            try { await openInApp(res.onboarding_url); } catch { /* noop */ }
            bus.emit("toast", {
              kind: "info",
              title: "Whop wallet onboarding opened",
              body: res.is_live
                ? "Complete the steps on Whop · we'll auto-detect when you're done."
                : "Payout setup is not live yet.",
            });
          }}
          onWithdraw={async () => {
            // approved · credit the connected Whop balance
            const res = await claimCarrot();
            // Type-narrow via `transfer_id` (only on ClaimResponse).
            if (!("transfer_id" in res)) {
              bus.emit("toast", {
                kind: "warning",
                title: "Claim failed",
                body: res.error,
              });
              return;
            }
            bus.emit("toast", {
              kind: "success",
              title: "Paid · $50 reward",
              body: `$${res.net_usd.toFixed(2)} ${res.currency.toUpperCase()} → your Whop balance · fee $${res.fee_usd.toFixed(2)}`,
            });
            bonus.withdraw();
            void getCarrot().then(setCarrot);
          }}
          onUpgrade={() => {
            // LC-UI-P0-001: await + visible failure feedback. No silent ok:true.
            void (async () => {
              try {
                const outcome = await billing.adapter.startCheckout("pro");
                if (!outcome.ok) {
                  bus.emit("toast", {
                    kind: "error",
                    title: "Couldn't open checkout",
                    body: outcome.error ?? "Open Settings → Plan → Manage plan on Whop and pick the right tier from there.",
                  });
                }
              } catch (err) {
                bus.emit("toast", {
                  kind: "error",
                  title: "Couldn't open checkout",
                  body: err instanceof Error && err.message ? err.message : "Open Settings → Plan → Manage plan on Whop and pick the right tier from there.",
                });
              }
            })();
          }}
        />
        {carrot && (
          <span
            className="lc-srm-backend-pill"
            data-testid="sponsored-reward-backend-pill"
            data-is-live={String(carrot.is_live)}
            style={{
              display: "inline-block",
              marginTop: 8,
              fontFamily: "var(--lc-mono, ui-monospace)",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: carrot.is_live
                ? "var(--lc-emerald, #4ADE80)"
                : "var(--lc-text-tertiary, rgba(255,255,255,.45))",
            }}
          >
            {carrot.is_live ? "● Live Whop rail" : "○ Whop payouts · coming soon"}
          </span>
        )}
      </div>

      {/* Pool depletion meter */}
      <div className="lc-srm-pool" data-testid="sponsored-reward-pool">
        <div className="lc-srm-pool-head">
          <span className="lc-srm-pool-eb">Reward pool</span>
          <span className="lc-srm-pool-amt">{fmtUsd(poolRemaining)} of {fmtUsd(SPONSORED_REWARD_POOL_NOTIONAL_USD)} left</span>
        </div>
        <div className="lc-srm-pool-bar" aria-hidden="true">
          <div
            className="lc-srm-pool-fill"
            style={{
              width: `${(poolRemaining / SPONSORED_REWARD_POOL_NOTIONAL_USD) * 100}%`,
            }}
          />
        </div>
      </div>

      {/* Rules */}
      <RewardRules
        title="Rules"
        rules={SPONSORED_REWARD_RULES}
        footer={snap.isMock ? "[simulator] · pool ledger + view attribution land with Sovereign 2.2" : undefined}
        testId="sponsored-reward-rules"
      />
    </GlassCard>
    </Watchdog>
  );
}

/* ──────── CTA rendered per state ──────── */

function SponsoredRewardCta({
  state,
  isPaidSub,
  canWithdraw,
  onClaim,
  onWithdraw,
  onUpgrade,
}: {
  state: string;
  isPaidSub: boolean;
  canWithdraw: boolean;
  onClaim: () => void;
  onWithdraw: () => void;
  onUpgrade: () => void;
}) {
  // SOVEREIGN-2.2 · real withdraw lands when Sui rail is live · today it's
  // a mock action that just flips the state for demo purposes.
  switch (state) {
    case "not_started":
    case "tracking":
      return (
        <button
          type="button"
          className="lc-srm-cta is-quiet"
          data-testid="sponsored-reward-cta"
          data-cta-kind="keep-clipping"
          onClick={() => { /* no-op · informational */ }}
          disabled
          title="Reach 5,000 authenticated tracked views to unlock the next step"
        >
          Keep clipping → views unlock at 5,000
        </button>
      );
    case "milestone_reached":
      return (
        <button
          type="button"
          className="lc-srm-cta is-primary"
          data-testid="sponsored-reward-cta"
          data-cta-kind="activate-plan"
          onClick={() => { onClaim(); onUpgrade(); }}
        >
          {isPaidSub ? "Start clearance review" : "Activate Agency · $99.99/mo"}
        </button>
      );
    case "subscription_required":
      return (
        <button
          type="button"
          className="lc-srm-cta is-primary"
          data-testid="sponsored-reward-cta"
          data-cta-kind="upgrade-to-pro"
          onClick={onUpgrade}
        >
          Upgrade to Agency · $99.99/mo
        </button>
      );
    case "pending_clearance":
      return (
        <button
          type="button"
          className="lc-srm-cta is-quiet"
          data-testid="sponsored-reward-cta"
          data-cta-kind="pending-clearance"
          disabled
        >
          Pending clearance · 7-day review
        </button>
      );
    case "approved":
      return (
        <div className="lc-srm-cta-stack" data-testid="sponsored-reward-cta-stack">
          <button
            type="button"
            className="lc-srm-cta is-primary"
            data-testid="sponsored-reward-cta"
            data-cta-kind="withdraw"
            onClick={onWithdraw}
            disabled={!canWithdraw}
            title={canWithdraw ? "Withdrawal rail opens soon · we'll DM you" : "Reward pending · payouts unlock when the withdrawal rail goes live"}
          >
            {canWithdraw
              ? "Reward approved · payout when rail is live"
              : "Reward pending · payouts unlock when rail is live"}
          </button>
          <span
            className="lc-srm-rail-pill"
            data-testid="sponsored-reward-rail-pill"
            aria-label="Withdrawal rail coming soon"
          >
            Withdrawal rail coming soon
          </span>
        </div>
      );
    case "rejected":
      return (
        <button
          type="button"
          className="lc-srm-cta is-warn"
          data-testid="sponsored-reward-cta"
          data-cta-kind="view-reason"
          disabled
        >
          Rejected · contact support to review
        </button>
      );
    case "paid":
      return (
        <button
          type="button"
          className="lc-srm-cta is-quiet"
          data-testid="sponsored-reward-cta"
          data-cta-kind="view-history"
          disabled
        >
          Paid out · view history (coming with Sovereign 2.2)
        </button>
      );
    default:
      return null;
  }
}
