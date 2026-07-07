/**
 * PlanLimitStrip · Phase 6I-B
 *
 * Tier + usage summary shown at the top of the Channels route.
 *   - Current tier
 *   - Connected accounts (used/cap)
 *   - Accounts needing attention (expired + failed + pending-link)
 *   - Upgrade CTA when at or near cap
 *
 * Reused by the Channels route and (Phase 7+) Settings / Billing surfaces.
 * The same vocabulary is mirrored inside AddAccountPopover's plan strip —
 * keep both in sync if the copy changes.
 */

import { GlassCard } from "../components";
import { useChannels } from "../state/useChannels";
import { useTierCaps, type Tier } from "../state/useTierCaps";
import { bus } from "../bridge";
import { useBillingState } from "../../lib/billing/adapter";
import type { PlanKey } from "../../lib/billing/types";
import "./PlanLimitStrip.css";

export interface PlanLimitStripProps {
  /** Defaults to true. When false, hide the brand badge (Clipper tier). */
  showAttention?: boolean;
}

const NEXT_TIER_LABEL: Record<Tier, string | null> = {
  clipper: "Upgrade to Pro",
  pro:     "Upgrade to Growth",
  growth:  "Upgrade to Agency",
  agency:  null,
};

export function PlanLimitStrip({ showAttention = true }: PlanLimitStripProps) {
  const tier = useTierCaps();
  const channels = useChannels();
  const billing = useBillingState();

  // LC-UI-P0-001: await checkout, surface a visible failure if the opener
  // never ran. Shared between the accountpack add-on CTA and the tier
  // upgrade CTA so both behave identically.
  const handleCheckout = async (plan: PlanKey) => {
    try {
      const outcome = await billing.adapter.startCheckout(plan);
      if (!outcome.ok) {
        bus.emit("toast", {
          kind: "error",
          title: "Couldn't open checkout",
          body:
            outcome.error ??
            "Open Settings → Plan → Manage plan on Whop and pick the right tier from there.",
        });
      }
    } catch (err) {
      bus.emit("toast", {
        kind: "error",
        title: "Couldn't open checkout",
        body: err instanceof Error && err.message
          ? err.message
          : "Open Settings → Plan → Manage plan on Whop and pick the right tier from there.",
      });
    }
  };

  const used = channels.connectedCount;
  const cap = tier.caps.totalChannels;
  const overCap = used > cap;
  const atCap = used >= cap && !overCap;
  const showAccountPackCta = tier.tier === "clipper" && (atCap || overCap);
  const attention = channels.needsAttentionCount;
  const nextLabel = NEXT_TIER_LABEL[tier.tier];

  const fill = Math.min(1, used / Math.max(1, cap));

  return (
    <GlassCard density="default" className="lc-pls" hoverLift>
      <div className="lc-pls-top">
        <div className="lc-pls-left">
          <span className="lc-pls-eb">{tier.tier.toUpperCase()} plan</span>
          <span className="lc-pls-h">
            {used} of {cap === Infinity ? "∞" : cap} channel slots
          </span>
          <span className="lc-pls-sub">
            {overCap
              ? `${used - cap} over · upgrade to keep every connected account live`
              : atCap
                ? "Cap reached · upgrade to connect more accounts"
                : `${cap - used} more slot${cap - used === 1 ? "" : "s"} available`}
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {showAccountPackCta && (
            <button
              type="button"
              className="lc-pls-cta lc-pls-addon-cta"
              data-testid="accountpack-cta"
              onClick={() => void handleCheckout("accountpack")}
              title="Add one more connected social account. Checkout opens the current Pro upgrade path until the Whop add-on plan is live."
            >
              Add account slot · +$6/mo
            </button>
          )}
          {nextLabel && (
            <button
              type="button"
              className="lc-pls-cta"
              data-testid="upgrade-cta"
              onClick={() => {
                // Open the upgrade flow when one exists for this tier;
                // adapter routes pro/growth/agency to the right plan UI.
                const targetPlan: PlanKey | null = tier.tier === "clipper" ? "pro"
                  : tier.tier === "pro" ? "growth"
                  : tier.tier === "growth" ? "agency"
                  : null;
                if (targetPlan) {
                  void handleCheckout(targetPlan);
                } else {
                  bus.emit("toast", { kind: "info", title: "Plan", body: "You're on the top tier." });
                }
              }}
            >
              {nextLabel}
            </button>
          )}
        </div>
      </div>

      <div className="lc-pls-bar" aria-hidden="true">
        <div
          className={`lc-pls-bar-fill ${overCap ? "is-over" : atCap ? "is-at-cap" : ""}`}
          style={{ width: `${Math.min(100, fill * 100)}%` }}
        />
      </div>

      {showAttention && (
        <div className="lc-pls-attn-row">
          <span className={`lc-pls-attn-pill ${attention > 0 ? "is-active" : ""}`}>
            <span className="lc-pls-attn-glyph">!</span>
            {attention} need{attention === 1 ? "s" : ""} attention
          </span>
          {attention > 0 && (
            <span className="lc-pls-attn-detail">
              {expiredCount(channels.channels.map((c) => c.status))}
            </span>
          )}
        </div>
      )}
    </GlassCard>
  );
}

function expiredCount(statuses: string[]): string {
  const expired = statuses.filter((s) => s === "expired").length;
  const failed  = statuses.filter((s) => s === "failed").length;
  const pending = statuses.filter((s) => s === "pending-link").length;
  const parts: string[] = [];
  if (expired) parts.push(`${expired} expired`);
  if (failed)  parts.push(`${failed} failed`);
  if (pending) parts.push(`${pending} linking`);
  return parts.join(" · ");
}
