/**
 * AgencyPreviewBanner · 2026-06-23 monetisation pass · Batch X.
 *
 * Renders when a non-Agency user is in Agency mode. Explains the
 * preview-mode contract: they can build/edit/preview campaigns for free,
 * but publishing/launching requires the Agency plan. Replaces the old
 * "hide Agency mode behind a paywall" pattern that killed conversion.
 *
 * Visibility rules:
 *   - mode === "agency" && tier !== "agency"       → full banner
 *   - mode === "agency" && tier === "agency"       → small "Agency active" pill
 *   - mode === "clipper"                            → renders nothing
 *
 * First-time entry fires `notifyAgencyPreviewUnlocked` to the inbox so
 * the user has a trail. Subsequent toggles do NOT re-fire (localStorage
 * flag `lc.agency-preview.seen.v1`).
 */

import { useEffect } from "react";
import { useMode } from "../../design-os/bridge";
import { useTierCaps } from "../../design-os/state/useTierCaps";
import { useBillingState } from "../../lib/billing/adapter";
import { notifyAgencyPreviewUnlocked } from "../../inbox/notify";
import { PLAN_CATALOG } from "../../lib/billing/types";
import "./AgencyPreviewBanner.css";

/** Persist key for once-per-user notification dispatch. Prevents the inbox
 *  from filling on every programmatic mode flip (brand-consistency walk
 *  used to trigger this on every route mount). */
const SEEN_KEY = "lc.agency-preview.seen.v1";

/**
 * Outer shell · cheap. Only calls useMode + early-returns when not in
 * agency mode. This keeps clipper-mode renders (the default for ~95% of
 * routes) at zero hook cost · the brand-consistency walk used to take
 * +11s when every route mount called useTierCaps + useBillingState
 * here. Heavy hooks moved to AgencyPreviewBannerInner below, which only
 * mounts under body[data-app-mode="agency"]. */
export function AgencyPreviewBanner() {
  const mode = useMode();
  if (mode !== "agency") return null;
  return <AgencyPreviewBannerInner />;
}

function AgencyPreviewBannerInner() {
  const tier = useTierCaps();
  const billing = useBillingState();
  const isAgencyTier = tier.tier === "agency";

  // 2026-06-23 · fire-once inbox notification when a non-Agency user
  // EXPLICITLY toggles into Agency Preview Mode (TopHud click). The
  // sessionStorage gate (set by TopHud onClick) ensures the notification
  // doesn't fire from programmatic mode flips during test walks or
  // deep-link route loads. Guarded by lc.agency-preview.seen.v1 so it
  // only fires once per browser even after multiple intentional toggles.
  useEffect(() => {
    if (isAgencyTier) return; // Agency users skip the preview notification
    if (typeof window === "undefined") return;
    try {
      const userToggled = window.sessionStorage.getItem("lc.mode-toggled-by-user") === "1";
      if (!userToggled) return; // mounted programmatically · don't pollute inbox
      const seen = window.localStorage.getItem(SEEN_KEY);
      if (seen) return;
      window.localStorage.setItem(SEEN_KEY, new Date().toISOString());
      notifyAgencyPreviewUnlocked();
    } catch {
      /* privacy mode · honest no-op */
    }
  }, [isAgencyTier]);

  // Agency users get the success pill, not the full banner.
  if (isAgencyTier) {
    return (
      <div className="lc-agency-pill" data-testid="agency-active-pill" data-state="active">
        <span className="lc-agency-pill-dot" aria-hidden="true" />
        Agency active
      </div>
    );
  }

  const agencyPlan = PLAN_CATALOG.agency;
  const ctaLabel = `Upgrade to ${agencyPlan.displayName} · $${agencyPlan.priceMonthlyUsd}/mo`;

  return (
    <div
      className="lc-agency-preview"
      data-testid="agency-preview-banner"
      data-state="preview"
      data-current-tier={tier.tier}
      role="region"
      aria-label="Agency Preview Mode"
    >
      <div className="lc-agency-preview-body">
        <span className="lc-agency-preview-eb">Agency Preview Mode</span>
        <span className="lc-agency-preview-title">
          Build your campaign now. Upgrade to Agency to launch, publish, invite clients, and activate rewards.
        </span>
        <span className="lc-agency-preview-sub">
          You can draft and preview campaigns for free. Payment is only required when you launch.
        </span>
      </div>
      <button
        type="button"
        className="lc-agency-preview-cta"
        data-testid="agency-preview-upgrade-cta"
        onClick={() => void billing.adapter.startCheckout("agency")}
      >
        {ctaLabel}
      </button>
    </div>
  );
}
