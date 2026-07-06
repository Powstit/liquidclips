/**
 * useWatermarkRemovalPaywall · C1-T5 · 2026-07-05
 *
 * Shared paywall trigger for every watermark-removal affordance in
 * the studio (OverlayTemplateGallery toggle · ExportPanel upgrade
 * pill · any future surface).
 *
 * Behaviour:
 *
 *   Free clipper (no active trial, watermark locked):
 *     click → bus.emit("auth:open-panel", {}) — opens the Whop
 *     Founder Access checkout in the OS browser via the existing
 *     App.tsx handler.
 *
 *   Trial-active user (subscriptionStatus === "trial" | "trialing"):
 *     click → confirmation modal ("Charge my card $99.99 now to
 *     remove the watermark?") → confirm →
 *     POST /me/trial/approve via bridgeToBackend →
 *       state === "ended"        → success toast + reload user state
 *       state === "not_trialing" → surface "no active trial" error
 *       state === "unavailable"  → surface Whop-side unavailable error
 *
 * Wrapped in useAuditableAction("watermark.remove", …) so the
 * audit endpoint sees start/success/failure ticks and the
 * `bash scripts/audit-gate.sh` gate can refuse to ship on a red
 * success rate. `surface` is passed through so triage can tell
 * which control fired (OverlayTemplateGallery vs ExportPanel).
 *
 * NOTE on backend path: `trial_convert.py` mounts at prefix
 * `/me/trial` with route `/approve` (POST), returning
 * EndTrialResponse. The plan doc says `POST /me/trial/end` — the
 * real endpoint is `/me/trial/approve`. Using the real path.
 */

import { useCallback, useMemo, useState } from "react";
import { bus } from "../design-os/bridge";
import { useMe } from "../design-os/state/useMe";
import { useAuditableAction } from "./useAuditableAction";
import { bridgeToBackend } from "./bridgeToBackend";
// ag-10 (2026-07-06) · Sovereign-Operator Protocol · this is a MONEY
// MOMENT — the click-through from a watermarked control to a $99.99
// card charge. `confirmCharge` calls POST /me/trial/approve; any
// failure here means the customer either got charged and didn't see
// success or wasn't charged and thought they were. Wrapping propagates
// the failure to the HQ Admin dashboard for Daniel to triage live.
// Weight defaults to 5 in watchdogWrap; a downstream Intercession call
// chain can escalate to weight=10 given the money-moment gravity.
import { watchdogWrap } from "./watchdog";

interface EndTrialResponse {
  state: "ended" | "not_trialing" | "unavailable";
  trial_convert_approved_at: string | null;
  detail?: string;
}

export interface WatermarkRemovalPaywall {
  /** True while the confirmation modal is open (trial-active users only). */
  confirmingTrial: boolean;
  /** True while POST /me/trial/approve is in flight. */
  pending: boolean;
  /** Last user-facing error message. Cleared on each fresh trigger. */
  errorMessage: string | null;
  /** True when the current user is on an active trial and eligible
   *  for the trial→paid confirmation flow. False for Free clippers
   *  (who get routed to Whop checkout instead). */
  isTrialActive: boolean;
  /** Fires from any click on a locked watermark control. `surface`
   *  is the audit tick's `surface` tag so triage can tell which
   *  control fired the paywall. */
  trigger: (surface: string) => void;
  /** Dismisses the confirmation modal. */
  cancelConfirm: () => void;
  /** Fires POST /me/trial/approve · wrapped in useAuditableAction. */
  confirmCharge: () => Promise<void>;
}

// Module-scope wrap so the node registers once (not per-hook-call).
// Every consumer of useWatermarkRemovalPaywall shares this single node —
// FailureScore aggregates across surfaces (OverlayTemplateGallery +
// ExportPanel + any future watermark-removal control).
const watermarkChargeWrapped = watchdogWrap(
  {
    id: "agency/ag-10/watermark-removal-charge",
    label: "Watermark removal · trial-to-paid charge",
    cluster: "agency",
    source: "src/lib/useWatermarkRemovalPaywall.ts:confirmCharge (backend trial_convert.py:123)",
  },
  (): Promise<EndTrialResponse> => bridgeToBackend<EndTrialResponse>("POST", "/me/trial/approve"),
);

export function useWatermarkRemovalPaywall(): WatermarkRemovalPaywall {
  const me = useMe();
  const sub = me.snapshot?.subscriptionStatus ?? null;
  const isTrialActive = sub === "trial" || sub === "trialing";

  const [confirmingTrial, setConfirmingTrial] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [surface, setSurface] = useState<string>("OverlayTemplateGallery");

  const runner = useCallback(
    () => watermarkChargeWrapped(),
    [],
  );

  const action = useAuditableAction<EndTrialResponse>(
    "watermark.remove",
    runner,
    { surface },
  );

  const trigger = useCallback(
    (nextSurface: string) => {
      setSurface(nextSurface);
      setErrorMessage(null);
      if (isTrialActive) {
        setConfirmingTrial(true);
        return;
      }
      // Free clipper · no trial · route to Whop checkout via the
      // existing bus event handled in App.tsx.
      bus.emit("auth:open-panel", {});
    },
    [isTrialActive],
  );

  const cancelConfirm = useCallback(() => {
    setConfirmingTrial(false);
    setErrorMessage(null);
  }, []);

  const confirmCharge = useCallback(async () => {
    setErrorMessage(null);
    const result = await action.fire();
    if (!result) {
      const msg = action.lastError?.message ?? "Charge failed · try again.";
      setErrorMessage(msg);
      return;
    }
    if (result.state === "ended") {
      setConfirmingTrial(false);
      bus.emit("toast", {
        kind: "success",
        title: "Watermark removed",
        body: "Trial ended · you're on the paid plan.",
      });
      // Reload /me so the tier flips and the watermark actually drops
      // on the next render (watermarkLocked becomes false).
      void me.reload();
      return;
    }
    if (result.state === "not_trialing") {
      setConfirmingTrial(false);
      setErrorMessage(result.detail ?? "No active trial to convert.");
      return;
    }
    // "unavailable" · Whop refused early charge · trial will auto-
    // convert on day 8 anyway.
    setConfirmingTrial(false);
    setErrorMessage(
      result.detail
        ?? "Whop couldn't charge your card early · your trial will convert automatically on day 8.",
    );
  }, [action, me]);

  return useMemo(
    () => ({
      confirmingTrial,
      pending: action.pending,
      errorMessage,
      isTrialActive,
      trigger,
      cancelConfirm,
      confirmCharge,
    }),
    [
      confirmingTrial,
      action.pending,
      errorMessage,
      isTrialActive,
      trigger,
      cancelConfirm,
      confirmCharge,
    ],
  );
}
