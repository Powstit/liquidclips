// ship-lens v0.7.13 C4 — Contract hook for Kimi K-γ (StudioTour + CoachMark).
// Kimi defines the actual step order in his K-γ component. This hook owns
// the persistence: a single "completed" flag in keychain (LIQUIDCLIPS_ONBOARDED)
// + an in-memory current-step index for the current session.
//
// Step IDs are strings so Kimi can rename / reorder without touching this hook.

import { useCallback, useEffect, useState } from "react";
import { sidecar, humanError } from "../lib/sidecar";

export type UseOnboardingStepResult = {
  /** Current step id, or null when the tour is dismissed / finished. */
  stepId: string | null;
  /** True if the user has finished the tour at least once (keychain flag). */
  isDone: boolean;
  /** True while reading the keychain flag on mount. */
  hydrating: boolean;
  /** Last error, humanError-formatted. */
  error: string | null;
  /** Begin the tour with the supplied step order. Kimi calls this from his
   *  StudioTour component once on mount. */
  begin: (steps: string[]) => void;
  /** Advance to the next step in the supplied order. No-op if at the end. */
  advance: () => void;
  /** Skip remaining steps + mark as done. */
  skip: () => Promise<void>;
  /** Finish the tour + mark as done. */
  finish: () => Promise<void>;
  /** Reset the tour so it re-fires on next launch — settings-page entry point. */
  reset: () => Promise<void>;
};

export function useOnboardingStep(): UseOnboardingStepResult {
  const [steps, setSteps] = useState<string[]>([]);
  const [stepIdx, setStepIdx] = useState<number | null>(null);
  const [isDone, setIsDone] = useState(false);
  const [hydrating, setHydrating] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await sidecar.secretsStatus();
        if (cancelled) return;
        setIsDone(!!r.secrets.LIQUIDCLIPS_ONBOARDED);
      } catch (e) {
        if (cancelled) return;
        setError(humanError(e));
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const begin = useCallback((s: string[]) => {
    if (s.length === 0) return;
    setSteps(s);
    setStepIdx(0);
  }, []);

  const advance = useCallback(() => {
    setStepIdx((i) => {
      if (i === null) return null;
      const next = i + 1;
      return next >= steps.length ? null : next;
    });
  }, [steps.length]);

  const markDone = useCallback(async () => {
    try {
      await sidecar.secretSet("LIQUIDCLIPS_ONBOARDED", "v1");
      setIsDone(true);
    } catch (e) {
      setError(humanError(e));
    }
  }, []);

  const skip = useCallback(async () => {
    setStepIdx(null);
    await markDone();
  }, [markDone]);

  const finish = useCallback(async () => {
    setStepIdx(null);
    await markDone();
  }, [markDone]);

  const reset = useCallback(async () => {
    try {
      await sidecar.secretDelete("LIQUIDCLIPS_ONBOARDED");
      setIsDone(false);
      setStepIdx(null);
    } catch (e) {
      setError(humanError(e));
    }
  }, []);

  const stepId = stepIdx === null ? null : steps[stepIdx] ?? null;

  return { stepId, isDone, hydrating, error, begin, advance, skip, finish, reset };
}
