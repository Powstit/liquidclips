/**
 * PaywallGate · commitment-point paywall wrapper.
 *
 * Daniel's 2026-06-23 monetisation principle: explore/build/preview is
 * always allowed; the paywall only triggers at the COMMITMENT point
 * (publish · export clean · launch campaign · use paid capacity).
 *
 * Usage:
 *   <PaywallGate
 *     requiredTier="agency"
 *     action="Launch campaign"
 *     onUpgrade={() => navigateToCheckout("agency")}
 *   >
 *     <button onClick={publish}>Launch</button>
 *   </PaywallGate>
 *
 * Behaviour:
 *   - When the user's tier meets `requiredTier` → renders children plain.
 *   - When below required → renders children disabled-looking + a small
 *     "Unlocks at <Tier>" badge inline. Clicking the wrapped button
 *     instead opens the upgrade flow + posts an inbox notification.
 *   - `mode="overlay"` shows a full locked-preview wrapper (used for
 *     Analytics / Campaign Create surfaces that should still render the
 *     content beneath, dimmed).
 *
 * Inbox emission: every blocked commit emits a
 * `billing.upgrade_required` inbox record so the user has a clear
 * follow-up trail.
 */

import { useTierCaps, type Tier } from "../../design-os/state/useTierCaps";
import { PLAN_CATALOG, type PlanKey } from "../../lib/billing/types";
import { useBillingState } from "../../lib/billing/adapter";
import { notifyUpgradeRequired } from "../../inbox/notify";
import "./PaywallGate.css";

const TIER_RANK_GLOBAL: Record<Tier, number> = {
  clipper: 0,
  pro: 1,
  growth: 2,
  agency: 3,
};

const TIER_TO_PLAN: Record<Tier, PlanKey> = {
  clipper: "free",
  pro: "pro",
  growth: "growth",
  agency: "agency",
};

export interface PaywallGateProps {
  requiredTier: Tier;
  /** Short verb that describes the gated commitment (e.g. "Launch campaign"). */
  action: string;
  /** Inline (default): renders children disabled + badge.
   *  Overlay: dims children + overlays a centered upgrade card.
   *  Hidden: renders nothing when below required tier (rare; use for
   *  features you don't want lower tiers to even know exist). */
  mode?: "inline" | "overlay" | "hidden";
  /** Optional override for the upgrade handler. Default opens
   *  Settings → checkout flow via billing adapter. */
  onUpgrade?: () => void;
  children: React.ReactNode;
}

export function PaywallGate({
  requiredTier,
  action,
  mode = "inline",
  onUpgrade,
  children,
}: PaywallGateProps) {
  const tierCtx = useTierCaps();
  const billing = useBillingState();
  const requiredPlan = PLAN_CATALOG[TIER_TO_PLAN[requiredTier]];
  const unlocked = TIER_RANK_GLOBAL[tierCtx.tier] >= TIER_RANK_GLOBAL[requiredTier];

  if (unlocked) return <>{children}</>;
  if (mode === "hidden") return null;

  const fireUpgrade = () => {
    // Log a notification so the user has an inbox trail after dismissing.
    notifyUpgradeRequired({
      action,
      requiredPlan: requiredPlan.displayName,
      currentPlan: PLAN_CATALOG[TIER_TO_PLAN[tierCtx.tier]].displayName,
    });
    if (onUpgrade) {
      onUpgrade();
      return;
    }
    void billing.adapter.startCheckout(TIER_TO_PLAN[requiredTier]);
  };

  // 2026-06-23 · surface checkout_failed state so the user knows their
  // last attempt didn't complete. Single tag, not a blocking dialog —
  // they can click Upgrade again. Cleared automatically by adapter on
  // next successful checkout_started transition.
  const showCheckoutFailedTag = billing.lastCheckoutFailed;

  if (mode === "overlay") {
    return (
      <div className="lc-paywall-overlay" data-testid="paywall-overlay" data-required-tier={requiredTier}>
        <div className="lc-paywall-overlay-dim" aria-hidden="true">{children}</div>
        <div className="lc-paywall-overlay-card">
          <span className="lc-paywall-card-eb">{requiredPlan.displayName} required</span>
          <span className="lc-paywall-card-title">{action}</span>
          <span className="lc-paywall-card-body">{requiredPlan.pitch}</span>
          {showCheckoutFailedTag && (
            <span
              className="lc-paywall-card-checkout-failed"
              data-testid="paywall-checkout-failed-tag"
              role="alert"
            >
              Last checkout didn't complete · try again
            </span>
          )}
          <button
            type="button"
            className="lc-paywall-card-cta"
            data-testid="paywall-upgrade-cta"
            onClick={fireUpgrade}
          >
            {showCheckoutFailedTag ? "Retry checkout" : `Upgrade to ${requiredPlan.displayName} · $${requiredPlan.priceMonthlyUsd}/mo`}
          </button>
          {billing.adapter.isMock && (
            <span className="lc-paywall-card-sim">[simulator] real checkout lands later</span>
          )}
        </div>
      </div>
    );
  }

  // Inline mode (default): wrap children + intercept click.
  return (
    <span
      className="lc-paywall-inline"
      data-testid="paywall-inline"
      data-required-tier={requiredTier}
      data-checkout-failed={String(showCheckoutFailedTag)}
      onClickCapture={(e) => {
        // Stop the inner button's onClick · fire upgrade instead.
        e.stopPropagation();
        e.preventDefault();
        fireUpgrade();
      }}
    >
      {children}
      <span
        className="lc-paywall-inline-badge"
        aria-label={`${action} unlocks at ${requiredPlan.displayName}`}
      >
        {showCheckoutFailedTag ? "↻" : "🔒"} {requiredPlan.displayName}+
      </span>
      {showCheckoutFailedTag && (
        <span
          className="lc-paywall-inline-checkout-failed"
          data-testid="paywall-checkout-failed-tag"
          role="alert"
        >
          Retry — last checkout didn't complete
        </span>
      )}
    </span>
  );
}
