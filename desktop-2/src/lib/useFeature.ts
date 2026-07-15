/**
 * useFeature · canary-rollout hook for desktop.
 *
 * Reads /me/canary once on mount and every 5 min after. Returns the
 * boolean verdict for a specific feature key. When the backend is
 * unreachable OR the user isn't authenticated, defaults to `false` so
 * new features never leak to guests before rollout.
 *
 * Ships 2026-07-07 · Sprint Final §1G launch-safety.
 *
 * Usage:
 *   const walletV2 = useFeature("wallet_dashboard_v2");
 *   if (walletV2) return <WalletDashboardV2 />;
 *   return <WalletPanel />;
 *
 * HQ dials each feature via `POST /admin/canary/{feature} { percent }`.
 * Bucketing is deterministic per (user_id, feature) so a user's verdict
 * doesn't flip randomly across renders. Cache TTL server-side is 60s,
 * client re-fetch every 5 min.
 */
import { useEffect, useState } from "react";
import { authedFetch } from "./authedFetch";

export type FeatureKey =
  | "ransom_paywall"
  | "crew_match"
  | "whop_bounty_syndicate"
  | "sui_payouts"
  | "wallet_dashboard_v2"
  | "referral_pipeline"
  | "gap_email_subject";

interface CanaryMeResponse {
  features: Record<string, boolean>;
}

const REFRESH_MS = 5 * 60 * 1000;
const BACKEND = (): string => {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env || {};
  return env.VITE_BACKEND_URL || "https://api.liquidclips.app";
};

/** Shared cache across all useFeature callers · one fetch per interval. */
let _cache: Record<string, boolean> = {};
let _lastFetch = 0;
let _inflight: Promise<void> | null = null;
const _subscribers = new Set<() => void>();

async function refresh(force: boolean = false): Promise<void> {
  const now = Date.now();
  if (!force && now - _lastFetch < REFRESH_MS) return;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      // L1-parity fix (see ReferralPipelineTile.tsx) · used to read the
      // wrong `lc:license-jwt` localStorage key directly, which was
      // always empty — every canary check silently ran unauthenticated
      // and fell back to the all-false default. authedFetch attaches
      // the real JWT. skip401Handler: true — this is a background poll
      // (every 5 min, no user action), so a 401 here should degrade
      // silently to cached/default flags, not fire the disruptive
      // expired-session toast; that belongs to user-initiated calls.
      const r = await authedFetch(`${BACKEND()}/me/canary`, { skip401Handler: true });
      if (!r.ok) return;
      const data = (await r.json()) as CanaryMeResponse;
      _cache = { ..._cache, ...(data.features ?? {}) };
      _lastFetch = now;
      _subscribers.forEach((cb) => cb());
    } catch {
      /* backend unreachable · keep the last cache · fail closed via default */
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

export function useFeature(feature: FeatureKey): boolean {
  const [value, setValue] = useState<boolean>(_cache[feature] ?? false);

  useEffect(() => {
    const onUpdate = (): void => {
      setValue(_cache[feature] ?? false);
    };
    _subscribers.add(onUpdate);
    void refresh();
    const t = setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      _subscribers.delete(onUpdate);
      clearInterval(t);
    };
  }, [feature]);

  return value;
}

/** Force a refresh · used by admin surfaces after dialing a value. */
export function refreshFeatures(): void {
  void refresh(true);
}
