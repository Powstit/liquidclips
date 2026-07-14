/**
 * useCrewPipeline · shared reader for GET /me/crew/pipeline.
 *
 * R2 (2026-07-11) · CancellationIntercept needs the same clipper
 * count + monthly earnings numbers the wallet's ReferralPipelineTile
 * renders — but they used to be hardcoded fixtures inside PER_STATE
 * ("15 clippers · $742.50/mo"). Every user saw the same string.
 *
 * This hook centralises the fetch so:
 *   1. CancellationIntercept renders the signed-in user's real
 *      pipeline numbers (or a plain-English zero-state when none
 *      exist yet — no lying loss table).
 *   2. ReferralPipelineTile keeps its existing behavior; it wraps
 *      this hook so both surfaces share the same source of truth.
 *   3. `crew:invite-sent` bus events refresh both places at once.
 *
 * Returns `{ data: null, loading: false }` when the JWT is missing
 * or the backend fetch failed — the caller renders an honest empty
 * state instead of fabricating "0 clippers · $0/mo".
 */
import { useCallback, useEffect, useState } from "react";
import { useEvent } from "../bridge";
import { authedFetch } from "../../lib/authedFetch";

export interface CrewPipelineData {
  invites_sent: number;
  activated_count: number;
  earning_count: number;
  monthly_earnings_cents: number;
  total_earned_cents: number;
  next_milestone: string;
}

export interface UseCrewPipelineReturn {
  data: CrewPipelineData | null;
  loading: boolean;
  refetch: () => Promise<void>;
}

function backendUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env || {};
  return env.VITE_BACKEND_URL || "https://api.liquidclips.app";
}

async function fetchCrewPipeline(): Promise<CrewPipelineData | null> {
  try {
    // L1 · 2026-07-11 · use authedFetch so 401s route through the
    // global expired-session interceptor (same rail
    // ReferralPipelineTile now uses). authedFetch reads the JWT from
    // authStorage (canonical key: LICENSE_JWT_STORAGE_KEY) — no
    // duplicate localStorage read here.
    const r = await authedFetch(`${backendUrl()}/me/crew/pipeline`);
    if (!r.ok) return null;
    return (await r.json()) as CrewPipelineData;
  } catch {
    return null;
  }
}

export function useCrewPipeline(): UseCrewPipelineReturn {
  const [data, setData] = useState<CrewPipelineData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetchCrewPipeline();
    setData(d);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEvent("crew:invite-sent", () => {
    void load();
  });

  return { data, loading, refetch: load };
}
