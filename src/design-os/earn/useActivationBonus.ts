/**
 * useActivationBonus · React hook over the activation-bonus state machine.
 *
 * Sources:
 *   - viewCount (real-ish) — sum of `clickCount` across all tracking links
 *     in /me/reward-clips. Until the real hook is wired, returns 0.
 *   - subscriptionActive (real) — from useBillingState.
 *   - clearance timer state (mock) — localStorage-backed, labelled
 *     [simulator] in any UI that consumes the snapshot.
 *
 * Fires inbox notifications on EVERY state transition (all 7 helpers
 * now wired) · approved/rejected/paid are simulator-only until the
 * Sovereign 2.2 backend lands · UI labels them clearly.
 *
 * Action surface (mock-only · clearly labelled):
 *   - claim()              · transition milestone_reached → subscription_required
 *   - simulateApproval()   · transition pending_clearance → approved
 *   - simulateRejection(r) · transition pending_clearance → rejected
 *   - withdraw()           · transition approved → paid
 *   - reset()              · wipe persisted state · puppeteer-only seam
 *
 * // SOVEREIGN-2.2 · these actions become real RPCs once backend lands.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useBillingState } from "../../lib/billing/adapter";
import {
  notifyBonusMilestoneReached,
  notifyBonusSubscriptionRequired,
  notifyBonusPendingClearance,
  notifyBonusApproved,
  notifyBonusRejected,
  notifyBonusPaid,
} from "../../inbox/notify";
import {
  ACTIVATION_BONUS_VIEW_THRESHOLD,
  deriveActivationBonusSnapshot,
  type ActivationBonusSnapshot,
} from "./activationBonus";
import { SPONSORED_REWARD_AMOUNT_USD } from "./sponsoredReward";

const STORAGE_KEY = "lc.activation-bonus.v1";

interface PersistedActivationBonusState {
  clearanceStartedAt: string | null;
  clearanceVerdict: "approved" | "rejected" | null;
  paidAt: string | null;
  /** Notified once-per-transition flags · avoid inbox spam. */
  notifiedMilestone: boolean;
  notifiedSubscriptionRequired: boolean;
  notifiedClearance: boolean;
  notifiedApproved: boolean;
  notifiedRejected: boolean;
  notifiedPaid: boolean;
}

const EMPTY_STATE: PersistedActivationBonusState = {
  clearanceStartedAt: null,
  clearanceVerdict: null,
  paidAt: null,
  notifiedMilestone: false,
  notifiedSubscriptionRequired: false,
  notifiedClearance: false,
  notifiedApproved: false,
  notifiedRejected: false,
  notifiedPaid: false,
};

function loadPersisted(): PersistedActivationBonusState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_STATE };
    // Merge with EMPTY_STATE so newly added notification flags don't
    // crash older persisted blobs.
    return { ...EMPTY_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...EMPTY_STATE };
  }
}

function savePersisted(state: PersistedActivationBonusState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* honest no-op · privacy mode etc. */ }
}

export interface ActivationBonusApi {
  snapshot: ActivationBonusSnapshot;
  /** Mock-only · claim attempt when milestone reached but no sub. Fires
   *  the subscription_required notification. */
  claim: () => void;
  /** Mock-only · advance pending_clearance → approved. Labelled [simulator]. */
  simulateApproval: () => void;
  /** Mock-only · advance pending_clearance → rejected. Labelled [simulator]. */
  simulateRejection: (reason: string) => void;
  /** Mock-only · advance approved → paid. Labelled [simulator]. */
  withdraw: () => void;
  /** Puppeteer-only seam · reset all persisted state. */
  reset: () => void;
}

export function useActivationBonus(viewCount: number = 0): ActivationBonusApi {
  const billing = useBillingState();
  const subscriptionActive = billing.state === "active";

  const [persisted, setPersisted] = useState<PersistedActivationBonusState>(() => loadPersisted());

  // Persist any state change.
  useEffect(() => {
    savePersisted(persisted);
  }, [persisted]);

  // State transition: milestone reached + sub active → start 7-day clearance.
  useEffect(() => {
    if (
      viewCount >= ACTIVATION_BONUS_VIEW_THRESHOLD &&
      subscriptionActive &&
      !persisted.clearanceStartedAt &&
      !persisted.clearanceVerdict &&
      !persisted.paidAt
    ) {
      setPersisted((p) => ({
        ...p,
        clearanceStartedAt: new Date().toISOString(),
      }));
    }
  }, [viewCount, subscriptionActive, persisted]);

  // Notification: milestone reached (fire-once).
  useEffect(() => {
    if (
      viewCount >= ACTIVATION_BONUS_VIEW_THRESHOLD &&
      !persisted.notifiedMilestone &&
      !persisted.paidAt
    ) {
      notifyBonusMilestoneReached(viewCount);
      setPersisted((p) => ({ ...p, notifiedMilestone: true }));
    }
  }, [viewCount, persisted]);

  // Notification: clearance started (fire-once).
  useEffect(() => {
    if (
      persisted.clearanceStartedAt &&
      !persisted.notifiedClearance &&
      !persisted.clearanceVerdict
    ) {
      notifyBonusPendingClearance();
      setPersisted((p) => ({ ...p, notifiedClearance: true }));
    }
  }, [persisted]);

  // Notification: approved (fire-once).
  useEffect(() => {
    if (persisted.clearanceVerdict === "approved" && !persisted.notifiedApproved) {
      notifyBonusApproved();
      setPersisted((p) => ({ ...p, notifiedApproved: true }));
    }
  }, [persisted]);

  // Notification: rejected (fire-once).
  useEffect(() => {
    if (persisted.clearanceVerdict === "rejected" && !persisted.notifiedRejected) {
      notifyBonusRejected("Engagement-ratio audit failed · contact support");
      setPersisted((p) => ({ ...p, notifiedRejected: true }));
    }
  }, [persisted]);

  // Notification: paid (fire-once).
  useEffect(() => {
    if (persisted.paidAt && !persisted.notifiedPaid) {
      notifyBonusPaid(SPONSORED_REWARD_AMOUNT_USD);
      setPersisted((p) => ({ ...p, notifiedPaid: true }));
    }
  }, [persisted]);

  /* ──────── Action surface (mock-only) ──────── */

  const claim = useCallback(() => {
    // Fire the subscription_required notification when user clicks "Claim"
    // without active sub at milestone_reached.
    if (
      viewCount >= ACTIVATION_BONUS_VIEW_THRESHOLD &&
      !subscriptionActive &&
      !persisted.notifiedSubscriptionRequired
    ) {
      notifyBonusSubscriptionRequired();
      setPersisted((p) => ({ ...p, notifiedSubscriptionRequired: true }));
    }
  }, [viewCount, subscriptionActive, persisted]);

  const simulateApproval = useCallback(() => {
    setPersisted((p) => ({ ...p, clearanceVerdict: "approved" }));
  }, []);

  const simulateRejection = useCallback((_reason: string) => {
    setPersisted((p) => ({ ...p, clearanceVerdict: "rejected" }));
  }, []);

  const withdraw = useCallback(() => {
    setPersisted((p) => ({ ...p, paidAt: new Date().toISOString() }));
  }, []);

  const reset = useCallback(() => {
    setPersisted({ ...EMPTY_STATE });
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
  }, []);

  // Puppeteer-only test seam · matches __lcDebugSetTier / __lcDebugSeedChannels pattern.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as unknown as {
      __lcDebugActivationBonus?: {
        claim: () => void;
        simulateApproval: () => void;
        simulateRejection: (r: string) => void;
        withdraw: () => void;
        reset: () => void;
      };
    };
    w.__lcDebugActivationBonus = { claim, simulateApproval, simulateRejection, withdraw, reset };
    return () => {
      if (w.__lcDebugActivationBonus) delete w.__lcDebugActivationBonus;
    };
  }, [claim, simulateApproval, simulateRejection, withdraw, reset]);

  const snapshot = useMemo(
    () =>
      deriveActivationBonusSnapshot({
        viewCount,
        subscriptionActive,
        clearanceStartedAt: persisted.clearanceStartedAt,
        clearanceVerdict: persisted.clearanceVerdict,
        paidAt: persisted.paidAt,
      }),
    [viewCount, subscriptionActive, persisted],
  );

  return { snapshot, claim, simulateApproval, simulateRejection, withdraw, reset };
}
