// Simulator-only plan/trial state.
// No auth. No real tier check. No billing check.
// Default = "free". Optional localStorage key = "lc:user-plan:v1".

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PlanTier = "free" | "trial" | "agency";

export const DEFAULT_PLAN: PlanTier = "free";

export const PLAN_STORAGE_KEY = "lc:user-plan:v1";

export interface PlanState {
  plan: PlanTier;
  setPlan: (plan: PlanTier) => void;
}

export const usePlanStore = create<PlanState>()(
  persist(
    (set) => ({
      plan: DEFAULT_PLAN,
      setPlan: (plan) => set({ plan }),
    }),
    {
      name: PLAN_STORAGE_KEY,
    },
  ),
);

export function isPaidPlan(plan: PlanTier): boolean {
  return plan === "agency";
}
