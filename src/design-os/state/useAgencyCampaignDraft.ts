/**
 * useAgencyCampaignDraft · Phase 6N-E v1
 *
 * State container for the agency creation flow. Wraps the
 * `agencyCampaigns.{create,patch,connectReward,publish,refreshReward}`
 * sidecar surface. The campaign row is the source of truth · the hook
 * holds the latest snapshot in component state for cheap renders.
 */

import { useCallback, useState } from "react";
import { agencyCampaigns } from "../engine/sidecar-stub";
import { bus } from "../bridge";
import type {
  AgencyCampaignBlock,
  AgencyCampaignCreate,
  AgencyCampaignPatch,
} from "../engine/sidecar-stub";

export interface AgencyCampaignDraftApi {
  campaign: AgencyCampaignBlock | null;
  saving: boolean;
  publishing: boolean;
  publishErrors: string[] | null;
  /** Create or resume. */
  initialize: (initial: AgencyCampaignCreate) => Promise<AgencyCampaignBlock | null>;
  /** Edit any field. */
  save: (payload: AgencyCampaignPatch) => Promise<AgencyCampaignBlock | null>;
  /** Connect / swap the Whop reward.
   *  URL-first · URL is canonical. The id is only used when the agency
   *  pastes a bare id (rare). */
  connectReward: (input: { whopRewardUrl?: string; whopRewardId?: string }) => Promise<AgencyCampaignBlock | null>;
  /** Refresh snapshot from Whop. */
  refreshReward: () => Promise<AgencyCampaignBlock | null>;
  /** Run publish gate · 3-gate check on the backend. */
  publish: () => Promise<{ ok: boolean; errors?: string[] }>;
  /** Clear local state. */
  reset: () => void;
}

export function useAgencyCampaignDraft(): AgencyCampaignDraftApi {
  const [campaign, setCampaign] = useState<AgencyCampaignBlock | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishErrors, setPublishErrors] = useState<string[] | null>(null);

  const initialize = useCallback(async (initial: AgencyCampaignCreate): Promise<AgencyCampaignBlock | null> => {
    setSaving(true);
    try {
      const row = await agencyCampaigns.create(initial);
      if (row) setCampaign(row);
      return row;
    } finally {
      setSaving(false);
    }
  }, []);

  const save = useCallback(async (payload: AgencyCampaignPatch): Promise<AgencyCampaignBlock | null> => {
    if (!campaign) return null;
    setSaving(true);
    try {
      const row = await agencyCampaigns.patch({ slug: campaign.slug, payload });
      if (row) setCampaign(row);
      return row;
    } finally {
      setSaving(false);
    }
  }, [campaign]);

  const connectReward = useCallback(async (input: { whopRewardUrl?: string; whopRewardId?: string }): Promise<AgencyCampaignBlock | null> => {
    if (!campaign) return null;
    setSaving(true);
    try {
      const row = await agencyCampaigns.connectReward({
        slug: campaign.slug,
        whopRewardUrl: input.whopRewardUrl,
        whopRewardId: input.whopRewardId,
      });
      if (row) setCampaign(row);
      return row;
    } finally {
      setSaving(false);
    }
  }, [campaign]);

  const refreshReward = useCallback(async (): Promise<AgencyCampaignBlock | null> => {
    if (!campaign) return null;
    setSaving(true);
    try {
      const row = await agencyCampaigns.refreshReward({ slug: campaign.slug });
      if (row) setCampaign(row);
      return row;
    } finally {
      setSaving(false);
    }
  }, [campaign]);

  const publish = useCallback(async (): Promise<{ ok: boolean; errors?: string[] }> => {
    if (!campaign) return { ok: false, errors: ["No campaign loaded."] };
    setPublishing(true);
    setPublishErrors(null);
    try {
      const r = await agencyCampaigns.publish({ slug: campaign.slug });
      if (r.ok && r.campaign) {
        setCampaign(r.campaign);
        bus.emit("toast", {
          kind: "success",
          title: "Published",
          body: `${r.campaign.title} is now ${r.campaign.status.replace("_", " ")}.`,
        });
        return { ok: true };
      }
      setPublishErrors(r.errors ?? ["Couldn't publish."]);
      return { ok: false, errors: r.errors };
    } finally {
      setPublishing(false);
    }
  }, [campaign]);

  const reset = useCallback(() => {
    setCampaign(null);
    setPublishErrors(null);
  }, []);

  return {
    campaign,
    saving,
    publishing,
    publishErrors,
    initialize,
    save,
    connectReward,
    refreshReward,
    publish,
    reset,
  };
}

export type { AgencyCampaignBlock, AgencyCampaignCreate, AgencyCampaignPatch };
