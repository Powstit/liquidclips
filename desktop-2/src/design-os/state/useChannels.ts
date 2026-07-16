/**
 * useChannels · Phase 6I-A foundation
 *
 * Shared data layer for every multi-account surface in the app:
 *   - Export route · `AddAccountPopover` + `TargetAccountsRow`
 *   - Channels route · grid + connection cards (Phase 6I-B)
 *   - Schedule route · per-row account column (Phase 6J)
 *   - Campaigns route · account-template editor (Phase 7)
 *
 * Reads from `channels.list()` in sidecar-stub (real-Tauri-first /
 * mock-fallback). When the real sidecar lands, the single import in
 * sidecar-stub.ts flips. No surface that consumes this hook needs to
 * change.
 *
 * Respects `useTierCaps()` for connection-add gating. Multi-account per
 * platform supported throughout.
 */

import { humanError } from "../../lib/humanError";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  channels as channelsApi,
  channelToTargetAccount,
  type SidecarChannel,
  type ChannelStatus,
} from "../engine/sidecar-stub";
import { useTierCaps } from "./useTierCaps";
import type { Platform } from "../engine/types";
import type { TargetAccount } from "../export/types";

export interface ChannelsApi {
  /** Raw channel list as returned by the sidecar. */
  channels: ReadonlyArray<SidecarChannel>;
  /** Same data adapted to TargetAccount for AccountChipState rendering. */
  asTargetAccounts: ReadonlyArray<TargetAccount>;
  /** Channels grouped by platform · stable insertion order. */
  byPlatform: Readonly<Record<string, SidecarChannel[]>>;
  /** Total connected channels (status === "connected"). */
  connectedCount: number;
  /** Per-platform connected count. */
  connectedByPlatform: Readonly<Record<string, number>>;
  /** Count of channels in non-connected lifecycle states (expired/failed/pending-link). */
  needsAttentionCount: number;
  /** Reactive loading state for the initial fetch. */
  loading: boolean;
  /** Last error from a list/connect/disconnect/refresh call. */
  error: string | null;
  /** Where the last list() resolved from · drives the "Live · backend" vs
   *  "Studio preview" honesty pill on the route hero. */
  source: "real-rpc" | "real-http" | "mock";
  /** Whether the user can connect another account at this tier. */
  canAddAccount: boolean;
  /** Per-platform "can add another at this tier" answer. */
  canAddOnPlatform: (platform: Platform) => boolean;
  /** Reason why an add is blocked (or null). */
  addBlockedReason: string | null;
  /* ---- Actions ---- */
  connect: (platform: Platform, label?: string) => Promise<SidecarChannel | null>;
  disconnect: (id: string) => Promise<boolean>;
  refresh: (id: string) => Promise<SidecarChannel | null>;
  /** Re-fetch the full list (e.g. after a webhook hint). */
  reload: () => Promise<void>;
}

export function useChannels(): ChannelsApi {
  const tier = useTierCaps();
  const [channels, setChannels] = useState<SidecarChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"real-rpc" | "real-http" | "mock">("mock");

  const reload = useCallback(async () => {
    setError(null);
    try {
      const r = await channelsApi.list();
      setChannels(r.channels);
      setSource(r.source);
    } catch (e) {
      setError(humanError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => { void reload(); }, [reload]);

  // 2026-06-23 · puppeteer-only test seam · lets the platform-icons-and-
  // accountpack-proof spec force a re-fetch after seeding the sidecar-stub
  // channelState mid-test (used to prove the +$6/mo CTA visibility at-cap).
  // Safe in production — only invoked when a test sets the function.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as unknown as { __lcDebugReloadChannels?: () => Promise<void> };
    w.__lcDebugReloadChannels = reload;
    return () => { if (w.__lcDebugReloadChannels === reload) delete w.__lcDebugReloadChannels; };
  }, [reload]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onSeed = (ev: Event) => {
      const detail = (ev as CustomEvent<{
        channels?: SidecarChannel[];
        source?: "real-rpc" | "real-http" | "mock";
      }>).detail;
      if (!Array.isArray(detail?.channels)) return;
      setChannels(detail.channels);
      setSource(detail.source ?? "real-http");
      setLoading(false);
      setError(null);
    };
    window.addEventListener("lc:debug-channels-seeded", onSeed);
    return () => window.removeEventListener("lc:debug-channels-seeded", onSeed);
  }, []);

  /* ============================================================
     Derived views
     ============================================================ */

  const byPlatform = useMemo(() => {
    const acc: Record<string, SidecarChannel[]> = {};
    for (const c of channels) {
      if (!acc[c.platform]) acc[c.platform] = [];
      acc[c.platform].push(c);
    }
    return acc;
  }, [channels]);

  const connectedByPlatform = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const c of channels) {
      if (c.status === "connected") {
        acc[c.platform] = (acc[c.platform] ?? 0) + 1;
      }
    }
    return acc;
  }, [channels]);

  const connectedCount = useMemo(
    () => channels.filter((c) => c.status === "connected").length,
    [channels],
  );

  const needsAttentionCount = useMemo(
    () => channels.filter((c) => c.status === "expired" || c.status === "failed" || c.status === "pending-link").length,
    [channels],
  );

  const asTargetAccounts = useMemo(
    () => channels.map(channelToTargetAccount),
    [channels],
  );

  /* ============================================================
     Tier gating
     ============================================================ */

  const canAddAccount = connectedCount < tier.caps.totalChannels;

  const canAddOnPlatform = useCallback((platform: Platform): boolean => {
    if (!canAddAccount) return false;
    const current = connectedByPlatform[platform] ?? 0;
    return current < tier.caps.perPlatformChannels;
  }, [canAddAccount, connectedByPlatform, tier.caps.perPlatformChannels]);

  const addBlockedReason = !canAddAccount
    ? `${tier.tier.toUpperCase()} plan · ${connectedCount} of ${tier.caps.totalChannels} channels used`
    : null;

  /* ============================================================
     Actions · optimistic local update then re-sync
     ============================================================ */

  const connect = useCallback(async (platform: Platform, label?: string): Promise<SidecarChannel | null> => {
    if (!canAddOnPlatform(platform)) {
      setError(`Tier cap reached for ${platform}.`);
      return null;
    }
    try {
      const r = await channelsApi.connect(platform, label);
      // The stub seeds a pending-link row immediately and flips after 3s.
      // Pull fresh state so we pick up both transitions.
      await reload();
      // Schedule a re-pull after the 3s mock window for the connected flip.
      setTimeout(() => { void reload(); }, 3500);
      return r.channel;
    } catch (e) {
      setError(humanError(e));
      return null;
    }
  }, [canAddOnPlatform, reload]);

  const disconnect = useCallback(async (id: string): Promise<boolean> => {
    try {
      const r = await channelsApi.disconnect(id);
      if (r.ok) {
        setChannels((cur) => cur.filter((c) => c.id !== id));
      }
      return r.ok;
    } catch (e) {
      setError(humanError(e));
      return false;
    }
  }, []);

  const refresh = useCallback(async (id: string): Promise<SidecarChannel | null> => {
    try {
      const r = await channelsApi.refresh(id);
      // Re-pull after a beat so the lifecycle (pending-link → connected)
      // is reflected end-to-end.
      await reload();
      setTimeout(() => { void reload(); }, 3500);
      return r.channel;
    } catch (e) {
      setError(humanError(e));
      return null;
    }
  }, [reload]);

  return {
    channels,
    asTargetAccounts,
    byPlatform,
    connectedCount,
    connectedByPlatform,
    needsAttentionCount,
    loading,
    error,
    source,
    canAddAccount,
    canAddOnPlatform,
    addBlockedReason,
    connect,
    disconnect,
    refresh,
    reload,
  };
}

export { type ChannelStatus };
