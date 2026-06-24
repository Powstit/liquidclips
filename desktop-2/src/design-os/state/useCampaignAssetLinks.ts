/**
 * useCampaignAssetLinks · Phase 6N-D v1
 *
 * Shared data layer for the v1 Campaign asset-link surface. Mirrors the
 * useCommunity / useRewardClips / useCampaigns templates · real-RPC →
 * HTTP → mock fallback (the one swap point lives in `sidecar-stub.ts`).
 *
 * V1 rule: assets are BRIEF LINKS. No OAuth, no ingestion, no picker UI.
 * Agency creates rows; clipper reads + opens externally.
 */

import { useCallback, useEffect, useState } from "react";
import { campaignAssetLinks as api } from "../engine/sidecar-stub";
import { bus } from "../bridge";
import type {
  CampaignAssetLink,
  CampaignAssetLinkCreate,
  CampaignAssetLinkPatch,
} from "../engine/sidecar-stub";

type Source = "real-rpc" | "real-http" | "mock";

export interface CampaignAssetLinksApi {
  links: ReadonlyArray<CampaignAssetLink>;
  loading: boolean;
  error: string | null;
  source: Source;
  reload: () => Promise<void>;
  createLink: (payload: CampaignAssetLinkCreate) => Promise<CampaignAssetLink | null>;
  patchLink: (id: string, payload: CampaignAssetLinkPatch) => Promise<CampaignAssetLink | null>;
  removeLink: (id: string) => Promise<boolean>;
  reorderLinks: (items: Array<{ id: string; sortOrder: number }>) => Promise<CampaignAssetLink[]>;
}

export function useCampaignAssetLinks(slug: string | null): CampaignAssetLinksApi {
  const [links, setLinks] = useState<CampaignAssetLink[]>([]);
  const [loading, setLoading] = useState<boolean>(!!slug);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<Source>("mock");

  const reload = useCallback(async () => {
    if (!slug) {
      setLinks([]);
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const r = await api.list({ slug });
      setLinks(r.links);
      setSource(r.source);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      bus.emit("toast", { kind: "error", title: "Couldn't load brief links", body: msg });
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { void reload(); }, [reload]);

  const createLink = useCallback(async (payload: CampaignAssetLinkCreate): Promise<CampaignAssetLink | null> => {
    if (!slug) return null;
    try {
      const r = await api.create({ slug, payload });
      if (r.link) {
        setLinks((cur) => [...cur, r.link!].sort((a, b) => a.sortOrder - b.sortOrder));
      }
      return r.link;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [slug]);

  const patchLink = useCallback(async (id: string, payload: CampaignAssetLinkPatch): Promise<CampaignAssetLink | null> => {
    if (!slug) return null;
    try {
      const r = await api.patch({ slug, id, payload });
      if (r.link) {
        setLinks((cur) => cur.map((x) => x.id === id ? r.link! : x).sort((a, b) => a.sortOrder - b.sortOrder));
      }
      return r.link;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [slug]);

  const removeLink = useCallback(async (id: string): Promise<boolean> => {
    if (!slug) return false;
    try {
      const r = await api.remove({ slug, id });
      if (r.ok) {
        setLinks((cur) => cur.filter((x) => x.id !== id));
      }
      return r.ok;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, [slug]);

  const reorderLinks = useCallback(async (items: Array<{ id: string; sortOrder: number }>): Promise<CampaignAssetLink[]> => {
    if (!slug) return [];
    try {
      const r = await api.reorder({ slug, items });
      setLinks(r.links);
      return r.links;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return [];
    }
  }, [slug]);

  return {
    links,
    loading,
    error,
    source,
    reload,
    createLink,
    patchLink,
    removeLink,
    reorderLinks,
  };
}

export type { CampaignAssetLink, CampaignAssetLinkCreate, CampaignAssetLinkPatch };
