// agency-campaigns.ts
//
// Typed client + Pydantic-mirrored types for the Agency Campaign UI
// (account-app/src/app/agency/*). Mirrors the shapes defined in
// junior-backend/app/routes/agency_campaigns.py — keep in sync if the
// backend Pydantic models change.
//
// All calls go through the local proxy at /api/agency/<backend-path>.
// The proxy gates by Clerk session + tier check ('agency' or admin),
// mints / reuses a license JWT, and never exposes the internal secret
// or the user's JWT to the browser.

// ── Reward / snapshot vocabulary (mirrors backend RewardState) ─────────
export type RewardState =
  | "unlinked"
  | "pending_reward"
  | "connected"
  | "live"
  | "funded"
  | "partially_funded"
  | "capacity_reached"
  | "closed"
  | "unreachable"
  | "not_visible"
  | "stale";

export type SnapshotStatus =
  | "not_attempted"
  | "enriched"
  | "not_enriched"
  | "unreachable";

export type CampaignType = "clip" | "coordination" | "affiliate" | "submission";

// ── Campaign block (mirrors backend CampaignBlock) ─────────────────────
export type CampaignBlock = {
  id: string;
  slug: string;
  title: string;
  description: string;
  campaign_type: string;
  status: string; // draft | pending_reward | coming_soon | partially_funded | funded | live | closed
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
};

export type CampaignCreatePayload = {
  title: string;
  slug: string;
  campaign_type: CampaignType;
  description: string;
  whop_reward_url?: string | null;
  whop_reward_id?: string | null;
  business_unit?: string | null;
  required_tier?: string | null;
  visibility_tiers?: string[] | null;
};

export type CampaignPatchPayload = {
  title?: string | null;
  description?: string | null;
  campaign_type?: CampaignType | null;
  business_unit?: string | null;
  required_tier?: string | null;
  visibility_tiers?: string[] | null;
  banner_url?: string | null;
  mission_lane?: string | null;
};

export type ConnectRewardPayload = {
  whop_reward_url?: string | null;
  whop_reward_id?: string | null;
};

export type ValidateRewardResponse = {
  reward_id: string | null;
  snapshot: Record<string, unknown> | null;
  reward_state: RewardState;
  business_goal: string | null;
  bounty_type: string | null;
  source: "real" | "cache" | "unreachable" | "not_visible" | "invalid_input";
  snapshot_status: SnapshotStatus;
  error: string | null;
};

export type AgencySubmissionRow = {
  id: string;
  user_id: string;
  campaign_id: string;
  clip_url: string;
  moment_type: string;
  status: string;
  rejection_reason: string | null;
  verified_views: number;
  payout_usd_cents: number;
  whop_submission_id: string | null;
  created_at: string;
};

export type TopClipperRow = {
  user_id: string;
  paid_count: number;
  total_payout_usd_cents: number;
};

export type AgencyCampaignAnalytics = {
  campaign_slug: string;
  total_submissions: number;
  status_counts: Record<string, number>;
  total_verified_views: number;
  total_payout_usd_cents: number;
  top_clippers: TopClipperRow[];
};

// ── Errors ─────────────────────────────────────────────────────────────
export class AgencyApiError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "AgencyApiError";
    this.status = status;
    this.body = body;
  }
}

// ── Slugify helper (client-side conflict guard pre-empts 409) ──────────
//
// Backend enforces slug uniqueness via 409. The form uses this to derive
// a slug from the title and surface the conflict client-side before POST.
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

// ── Fetcher ────────────────────────────────────────────────────────────
//
// Single fetcher used by every page/component. Throws AgencyApiError so
// the UI can render the 401/403/409/422 paths distinctly (paywall vs
// slug conflict vs validation error).
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/agency/${path}`, { cache: "no-store", ...init });
  const text = await res.text();
  if (!res.ok) {
    throw new AgencyApiError(
      `${res.status} ${text.slice(0, 300)}`,
      res.status,
      text,
    );
  }
  if (!text) return undefined as unknown as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

// ── API surface ────────────────────────────────────────────────────────
// Backend list endpoint isn't defined in agency_campaigns.py — list comes
// from the public /campaigns route (mirrored through the proxy) and is
// filtered client-side to campaigns owned by the signed-in agency.

export async function listMyCampaigns(): Promise<CampaignBlock[]> {
  // The public list returns { campaigns: [...] } from /admin/campaigns,
  // but for the agency surface we hit /agency-list which the proxy maps
  // to the same backend feed + filters by created_by server-side.
  const j = await call<{ campaigns: CampaignBlock[] }>("list");
  return j.campaigns ?? [];
}

export async function getCampaign(slug: string): Promise<CampaignBlock> {
  return call<CampaignBlock>(`campaigns/${encodeURIComponent(slug)}`);
}

export async function createCampaign(
  payload: CampaignCreatePayload,
): Promise<CampaignBlock> {
  return call<CampaignBlock>("campaigns", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function patchCampaign(
  slug: string,
  payload: CampaignPatchPayload,
): Promise<CampaignBlock> {
  return call<CampaignBlock>(`campaigns/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function connectReward(
  slug: string,
  payload: ConnectRewardPayload,
): Promise<CampaignBlock> {
  return call<CampaignBlock>(
    `campaigns/${encodeURIComponent(slug)}/connect-reward`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export async function publishCampaign(slug: string): Promise<CampaignBlock> {
  return call<CampaignBlock>(`campaigns/${encodeURIComponent(slug)}/publish`, {
    method: "POST",
  });
}

export async function refreshReward(slug: string): Promise<CampaignBlock> {
  return call<CampaignBlock>(
    `campaigns/${encodeURIComponent(slug)}/refresh-reward`,
    { method: "POST" },
  );
}

export async function validateReward(
  input: string,
): Promise<ValidateRewardResponse> {
  return call<ValidateRewardResponse>("whop/validate-reward", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input }),
  });
}

export async function listSubmissions(
  slug: string,
  statusFilter?: string | null,
): Promise<AgencySubmissionRow[]> {
  const qs = statusFilter
    ? `?status_filter=${encodeURIComponent(statusFilter)}`
    : "";
  return call<AgencySubmissionRow[]>(
    `campaigns/${encodeURIComponent(slug)}/submissions${qs}`,
  );
}

export async function campaignAnalytics(
  slug: string,
): Promise<AgencyCampaignAnalytics> {
  return call<AgencyCampaignAnalytics>(
    `campaigns/${encodeURIComponent(slug)}/analytics`,
  );
}

// Archive isn't a dedicated endpoint — the public spec maps it to a
// PATCH that sets status='closed'. We surface it as `archiveCampaign`
// so the UI vocabulary stays consistent ("archive" verb).
export async function archiveCampaign(slug: string): Promise<CampaignBlock> {
  // Backend PATCH only accepts the documented CampaignPatch fields;
  // status flips happen via /publish or admin /campaigns/{slug}. We
  // reuse the admin-side close path via the proxy's allow-list which
  // maps /agency/campaigns/{slug}/archive → admin DELETE under the hood.
  return call<CampaignBlock>(
    `campaigns/${encodeURIComponent(slug)}/archive`,
    { method: "POST" },
  );
}
