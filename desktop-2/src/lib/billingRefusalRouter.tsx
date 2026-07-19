/**
 * billingRefusalRouter · Liquid Studio · 2026-07-17
 *
 * Subscribes to `billing:reserve-refused` and routes to the correct
 * existing paywall / setup surface based on the backend's structured
 * `code`. Rules (Daniel · 2026-07-17):
 *
 *   free_bundle_used              → existing Studio $99 paywall
 *   free_bundle_in_progress       → existing Studio $99 paywall
 *   allowance_exceeded            → existing paywall focused on $199
 *   studio_unlimited_key_required → existing OpenAI key setup flow
 *
 * 2026-07-19 · cohort-0 billing polish · when an Agency-tier user hits
 * `allowance_exceeded` (their 8M hosted-LLM monthly quota), routing to
 * the Studio $99 paywall would be a dead-end (they already pay $99.99).
 * Emit an honest "reply to your welcome email and we'll top you up"
 * error + telemetry event `agency_quota_maxed` so HQ + Doctor see the
 * signal. All other tiers get the existing paywall route.
 *
 * Uses the existing `trial:upgrade-request` bus event with the
 * sanctioned `source: "clip-cap-402"` token so the existing paywall
 * consumers already handle it. No new paywall stack.
 */
import { useEffect } from "react";

import { bus } from "../design-os/bridge/events";
import { useTierCaps } from "../design-os/state/useTierCaps";
import { lcDiag } from "./diagnosticLogger";


type RefusalPayload = {
  code?: string;
  http_status?: number;
  message?: string;
  source?: string;
};


export function useBillingRefusalRouter(): void {
  // Read the caller's own tier so `allowance_exceeded` events for
  // paying Agency users don't route them back to the Agency $99.99
  // checkout (paywall dead-end). Cohort-0 rule per scope conversation:
  // Agency users hitting 8M cap get a manual outreach message +
  // telemetry, not another CTA to the plan they already have.
  const tierCaps = useTierCaps();
  const currentTier = tierCaps.tier;
  useEffect(() => {
    return bus.on("billing:reserve-refused", (raw) => {
      const p = raw as RefusalPayload;
      switch (p.code) {
        case "free_bundle_used":
        case "free_bundle_in_progress":
          bus.emit("trial:upgrade-request", { source: "clip-cap-402" });
          break;
        case "allowance_exceeded":
          // Cohort-0 breadcrumb · Agency user hitting the monthly
          // hosted-LLM quota is a rare, high-signal event; no top-up
          // plan exists yet, so route them to a manual outreach
          // message + emit telemetry HQ can surface.
          if (currentTier === "agency") {
            try {
              lcDiag("agency_quota_maxed", {
                source: p.source ?? "unknown",
                http_status: p.http_status ?? 402,
              });
            } catch { /* diag best-effort */ }
            bus.emit("engine:error", {
              kind: "sidecar-died",
              error: "hosted_llm_monthly_quota",
              human:
                p.message
                ?? "You've used this month's hosted LLM. Reply to your welcome email and we'll top you up.",
              code: "agency_quota_maxed",
            });
            break;
          }
          // Other tiers · existing Studio $99 paywall (still the right
          // upgrade CTA for Free/Solo/Pro hitting the cap).
          bus.emit("trial:upgrade-request", { source: "clip-cap-402" });
          break;
        case "studio_unlimited_key_required":
          // Navigate to Settings > API keys. The OpenAIKeyCard is
          // mounted there and already handles the paste + validate
          // flow via the existing method_validate_openai_key RPC.
          try {
            window.location.hash = "#/settings";
          } catch { /* noop */ }
          break;
        default:
          // Unknown refusal code — surface via existing error bus so
          // the desktop's global error boundary can show it. NEVER
          // silently swallow. Uses `sidecar-died` as the closest
          // existing kind (routes through the generic engine error
          // renderer rather than a stage-specific stop-page).
          bus.emit("engine:error", {
            kind: "sidecar-died",
            error: `Analysis refused: ${p.code ?? "unknown"}`,
            human: p.message ?? "Analysis is temporarily unavailable.",
            code: p.code ?? "billing_refused",
          });
      }
    });
    // Include currentTier in deps so a mid-session tier change
    // (upgrade / renewal) hot-swaps the routing without a page reload.
  }, [currentTier]);
}
