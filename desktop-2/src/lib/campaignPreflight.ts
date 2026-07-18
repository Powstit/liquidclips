/**
 * campaignPreflight · Composer C6 · desktop-side rule preflight client.
 *
 * ⚠ IRON GATE IG-COMPOSER-Y · Campaign preflight contract (desktop side).
 *
 * Before the Composer's "Send to clipper →" button submits to a Whop
 * bounty, it POSTs the clip meta to
 * junior-backend/routes/campaign_preflight.py :: POST
 * /campaigns/{campaign_id}/preflight and reads back a pass/fail verdict
 * per rule so the button can be blocked with an actionable message
 * instead of a silent Whop rejection downstream.
 */

import { authedFetch } from "./authedFetch";

const BACKEND_URL =
  (import.meta as { env?: { VITE_BACKEND_URL?: string } }).env?.VITE_BACKEND_URL?.replace(
    /\/+$/,
    "",
  ) ?? "https://api.jnremployee.com";

export interface PreflightClipMeta {
  duration_s: number;
  aspect: "9:16" | "16:9" | "1:1";
  has_watermark: boolean;
  has_caption: boolean;
  watermark_handle?: string | null;
}

export interface PreflightRuleFailure {
  rule: string;
  message: string;
  actionable: string;
}

export interface PreflightWarning {
  rule: string;
  message: string;
}

export interface PreflightResponse {
  ok: boolean;
  failures: PreflightRuleFailure[];
  warnings: PreflightWarning[];
}

export async function runCampaignPreflight(
  campaignId: string,
  meta: PreflightClipMeta,
): Promise<PreflightResponse> {
  const resp = await authedFetch(
    `${BACKEND_URL}/campaigns/${encodeURIComponent(campaignId)}/preflight`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(meta),
    },
  );
  if (!resp.ok) {
    throw new Error(`campaign_preflight.status_${resp.status}`);
  }
  return (await resp.json()) as PreflightResponse;
}
