/**
 * useWhopReward · Phase 6N-E v1
 *
 * Validates a pasted Whop reward URL or ID against the existing
 * `/agency/whop/validate-reward` proxy (App API Key surface).
 * Debounced 400ms so the agency typing into the input doesn't spam the
 * backend. Honest about source: when validate returns `unreachable` or
 * `not_visible`, those states surface in the UI without a fake
 * "connected" mask.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { agencyWhop } from "../engine/sidecar-stub";
import type {
  ValidateRewardResponse,
  WhopRewardSnapshot,
  WhopRewardSnapshotStatus,
  WhopRewardState,
} from "../engine/sidecar-stub";

export interface WhopRewardApi {
  /** Last successful validate result · null until first run. */
  result: ValidateRewardResponse | null;
  /** Convenience handles. */
  rewardId: string | null;
  snapshot: WhopRewardSnapshot | null;
  rewardState: WhopRewardState;
  /** URL-first · "we tried to enrich" vs "we never tried". */
  snapshotStatus: WhopRewardSnapshotStatus;
  /** Mid-flight indicator. */
  validating: boolean;
  /** Last error message (or null). */
  error: string | null;
  /** Manual revalidate · ignores cache. NEVER throws on no-id / unreachable
   *  — the agency proceeds with URL-only + manual brief. */
  validate: (input: string) => Promise<ValidateRewardResponse>;
  /** Clear · used after agency dismisses a result. */
  reset: () => void;
}

export function useWhopReward(): WhopRewardApi {
  const [result, setResult] = useState<ValidateRewardResponse | null>(null);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const validate = useCallback(async (input: string): Promise<ValidateRewardResponse> => {
    setValidating(true);
    setError(null);
    try {
      const r = await agencyWhop.validateReward({ input });
      setResult(r);
      setError(r.error);
      return r;
    } finally {
      setValidating(false);
    }
  }, []);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return {
    result,
    rewardId: result?.rewardId ?? null,
    snapshot: result?.snapshot ?? null,
    rewardState: result?.rewardState ?? "unlinked",
    snapshotStatus: result?.snapshotStatus ?? "not_attempted",
    validating,
    error,
    validate,
    reset,
  };
}

export type { ValidateRewardResponse, WhopRewardState, WhopRewardSnapshotStatus };
