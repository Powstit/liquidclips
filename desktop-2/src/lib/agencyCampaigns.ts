/**
 * Agency Campaign Builder client — Sprint D (2026-07-02).
 *
 * Wraps the shipped agency-campaigns endpoints in
 * `junior-backend/app/routes/agency_campaigns.py`:
 *
 *   POST   /agency/campaigns                    · create-draft
 *   PATCH  /agency/campaigns/{slug}             · edit
 *   POST   /agency/campaigns/{slug}/connect-reward
 *   POST   /agency/campaigns/{slug}/publish
 *   POST   /agency/campaigns/{slug}/refresh-reward
 *   POST   /agency/whop/validate-reward         · optional pre-flight
 *
 * Deliberately kept as its own file so the campaign builder route stays
 * decoupled from `lib/agency.ts` (roster + payout-split + rules). Both
 * files share the same `agencyFetch` transport pattern + `FetchResult<T>`
 * shape so a future consolidation is a rename, not a refactor.
 */
import { getJwt } from "./authStorage";

// ---------------------------------------------------------------------
// Types — mirror junior-backend/app/routes/agency_campaigns.py Pydantic
// ---------------------------------------------------------------------

export type CampaignType = "clip" | "coordination" | "affiliate" | "submission";

export type RewardState =
  | "unlinked"
  | "linked"
  | "active"
  | "closed"
  | "unreachable"
  | "not_visible"
  | "real";

export type SnapshotStatus =
  | "not_attempted"
  | "enriched"
  | "not_enriched"
  | "unreachable";

export type CampaignStatus =
  | "draft"
  | "pending_reward"
  | "coming_soon"
  | "partially_funded"
  | "funded"
  | "live"
  | "closed";

export interface CampaignBlock {
  id: string;
  slug: string;
  title: string;
  description: string;
  campaign_type: string;
  status: CampaignStatus;
  whop_reward_id: string | null;
  whop_reward_url: string | null;
  whop_reward_state: RewardState | null;
  whop_reward_snapshot_status: SnapshotStatus;
  whop_reward_snapshot: Record<string, unknown> | null;
  whop_reward_snapshot_business_goal: string | null;
  whop_reward_snapshot_bounty_type: string | null;
  whop_reward_synced_at: string | null;
  whop_reward_last_error: string | null;
  banner_url: string | null;
  business_unit: string | null;
  required_tier: string | null;
  visibility_tiers: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignCreatePayload {
  title: string;
  slug: string;
  campaign_type?: CampaignType;
  description?: string;
  whop_reward_url?: string | null;
  whop_reward_id?: string | null;
  business_unit?: string | null;
  required_tier?: string | null;
  visibility_tiers?: string[] | null;
}

export interface CampaignPatchPayload {
  title?: string;
  description?: string;
  campaign_type?: CampaignType;
  business_unit?: string | null;
  required_tier?: string | null;
  visibility_tiers?: string[] | null;
  banner_url?: string | null;
  mission_lane?: string | null;
}

export interface ConnectRewardPayload {
  whop_reward_url?: string | null;
  whop_reward_id?: string | null;
}

// ---------------------------------------------------------------------
// FetchResult + agencyFetch — MATCHES the pattern in lib/agency.ts.
// Kept inline here rather than imported so this file stands alone even
// if a future refactor moves lib/agency.ts around.
// ---------------------------------------------------------------------

export type AgencyConnectionState =
  | "idle"
  | "loading"
  | "ready"
  | "forbidden"
  | "offline"
  | "error";

export interface FetchResult<T> {
  data: T | null;
  state: Exclude<AgencyConnectionState, "idle" | "loading">;
  error: string | null;
  status: number | null;
}

function backendUrl(): string {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const v = (import.meta as any).env?.VITE_BACKEND_URL as string | undefined;
    if (typeof v === "string" && v.length > 0) return v;
  } catch {
    /* noop */
  }
  return "https://api.liquidclips.app";
}

function extractDetail(parsed: unknown): string | null {
  if (parsed == null || typeof parsed !== "object") return null;
  const detail = (parsed as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((d) => (d && typeof d === "object" ? (d as { msg?: string }).msg : null))
      .filter((m): m is string => typeof m === "string" && m.length > 0);
    if (messages.length > 0) return messages.join(" · ");
  }
  return null;
}

async function agencyFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<FetchResult<T>> {
  const jwt = getJwt();
  if (!jwt) {
    return {
      data: null,
      state: "forbidden",
      error: "Sign in to reach the campaign builder.",
      status: 401,
    };
  }
  try {
    const r = await fetch(`${backendUrl()}${path}`, {
      cache: "no-store",
      ...init,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        authorization: `Bearer ${jwt}`,
        ...(init.headers as Record<string, string> | undefined ?? {}),
      },
    });
    if (r.status === 204) {
      return { data: null, state: "ready", error: null, status: 204 };
    }
    let bodyText: string | null = null;
    let parsed: unknown = null;
    try {
      bodyText = await r.text();
      parsed = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      parsed = null;
    }
    if (r.status === 401 || r.status === 403) {
      return {
        data: null,
        state: "forbidden",
        error: extractDetail(parsed) ?? "Agency-tier subscription required.",
        status: r.status,
      };
    }
    if (!r.ok) {
      return {
        data: null,
        state: "error",
        error: extractDetail(parsed) ?? `${path} returned ${r.status}.`,
        status: r.status,
      };
    }
    return { data: parsed as T, state: "ready", error: null, status: r.status };
  } catch {
    return {
      data: null,
      state: "offline",
      error: "Campaign builder is offline. Check your connection and retry.",
      status: null,
    };
  }
}

// ---------------------------------------------------------------------
// Fetchers · 1:1 with the backend router
// ---------------------------------------------------------------------

export const listMyCampaigns = (): Promise<FetchResult<CampaignBlock[]>> =>
  agencyFetch<CampaignBlock[]>("/agency/campaigns");

export const createCampaign = (
  payload: CampaignCreatePayload,
): Promise<FetchResult<CampaignBlock>> =>
  agencyFetch<CampaignBlock>("/agency/campaigns", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const patchCampaign = (
  slug: string,
  payload: CampaignPatchPayload,
): Promise<FetchResult<CampaignBlock>> =>
  agencyFetch<CampaignBlock>(`/agency/campaigns/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

export const connectReward = (
  slug: string,
  payload: ConnectRewardPayload,
): Promise<FetchResult<CampaignBlock>> =>
  agencyFetch<CampaignBlock>(
    `/agency/campaigns/${encodeURIComponent(slug)}/connect-reward`,
    { method: "POST", body: JSON.stringify(payload) },
  );

export const publishCampaign = (
  slug: string,
): Promise<FetchResult<CampaignBlock>> =>
  agencyFetch<CampaignBlock>(
    `/agency/campaigns/${encodeURIComponent(slug)}/publish`,
    { method: "POST" },
  );

export const refreshReward = (
  slug: string,
): Promise<FetchResult<CampaignBlock>> =>
  agencyFetch<CampaignBlock>(
    `/agency/campaigns/${encodeURIComponent(slug)}/refresh-reward`,
    { method: "POST" },
  );

// ---------------------------------------------------------------------
// Slug helper — derived from title, safe for the backend regex.
// Match server contract: min_length=2, max_length=120, [a-z0-9_-].
// ---------------------------------------------------------------------

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 120);
}
