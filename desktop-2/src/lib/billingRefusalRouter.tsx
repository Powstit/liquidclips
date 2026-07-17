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
 * Uses the existing `trial:upgrade-request` bus event with the
 * sanctioned `source: "clip-cap-402"` token so the existing paywall
 * consumers already handle it. No new paywall stack.
 */
import { useEffect } from "react";

import { bus } from "../design-os/bridge/events";


type RefusalPayload = {
  code?: string;
  http_status?: number;
  message?: string;
};


export function useBillingRefusalRouter(): void {
  useEffect(() => {
    return bus.on("billing:reserve-refused", (raw) => {
      const p = raw as RefusalPayload;
      switch (p.code) {
        case "free_bundle_used":
        case "free_bundle_in_progress":
          bus.emit("trial:upgrade-request", { source: "clip-cap-402" });
          break;
        case "allowance_exceeded":
          // Same paywall trigger; the paywall itself will show both
          // Studio and Studio Unlimited cards. See Phase C P1-3.
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
  }, []);
}
