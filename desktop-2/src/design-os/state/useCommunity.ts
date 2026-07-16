/**
 * useCommunity · Phase 6L-A foundation
 *
 * Wraps the legacy/backend Community endpoints behind the Design OS
 * data-layer pattern (matches useChannels + useSchedule).
 *
 * Reads from:
 *   - `community.listChannels({ clerkUserId })`     · /community/channels
 *   - `community.leaderboardPreview()`              · top 5 from /leaderboard/earnings
 *   - `community.listAnnouncements()`               · empty fallback today (audit gap)
 *
 * Whop handoff via `openWhopRoom(roomId)` — uses Tauri's shell plugin
 * through `openSmart` when available, falls back to `window.open` in
 * browser preview. Surfaces a toast on success/failure so the user
 * always gets feedback when the in-app browser overlay isn't wired yet.
 *
 * Tier gating runs through `useTierCaps()` so the locked / unlocked
 * decision matches the rest of the app (Channels, Schedule).
 */

import { humanError } from "../../lib/humanError";
import { useCallback, useEffect, useMemo, useState } from "react";
import { community } from "../engine/sidecar-stub";
import { useTierCaps } from "./useTierCaps";
import { bus } from "../bridge";
/* Side-effect import · mounts the default `browse:open` subscriber so any
 *  surface that emits the event gets openSmart → window.open → toast. */
import "../bridge/browseOpenSubscriber";
import {
  resolveRoom,
  SECTION_ORDER,
  type CommunityChannel,
  type CommunityRoom,
  type LeaderboardPreviewRow,
  type AnnouncementItem,
  type BannerItem,
  type RoomSection,
} from "../community/types";

type Source = "real-rpc" | "real-http" | "mock";

export interface CommunityApi {
  /** Raw channel rows from the sidecar (real or mock). */
  channels: ReadonlyArray<CommunityChannel>;
  /** Caller-resolved rooms · one per visible channel · grouped & sorted. */
  rooms: ReadonlyArray<CommunityRoom>;
  /** Rooms grouped by section · respects SECTION_ORDER. */
  roomsBySection: Readonly<Record<RoomSection, CommunityRoom[]>>;
  /** Locked rooms only (status === "locked"). */
  lockedRooms: ReadonlyArray<CommunityRoom>;
  /** Single featured room · first open room in announcements > paid_core. */
  featuredRoom: CommunityRoom | null;
  /** Forward-compat alias for `featuredRoom`. When Phase 6M's Campaign
   *  entity lands and rooms collapse into campaign discussions, callers
   *  that read `featuredDiscussion` keep working unchanged. */
  featuredDiscussion: CommunityRoom | null;
  /** Top-5 leaderboard preview · empty until first fetch resolves. */
  leaderboardPreview: ReadonlyArray<LeaderboardPreviewRow>;
  /** Latest announcements (today: empty · audit found no public endpoint). */
  announcements: ReadonlyArray<AnnouncementItem>;
  /** Active banners targeted at the `community_top` placement. Empty when
   *  the admin hasn't published any · CommunityBanner skips render. */
  communityTopBanners: ReadonlyArray<BannerItem>;
  /** Whether channels are still loading on first paint. */
  loading: boolean;
  /** Last error from any list/preview call · null after a clean reload. */
  error: string | null;
  /** True when this surface is reading from the seeded mock rather than
   *  a real backend · drives the "Studio preview" honesty tag. */
  isMockFallback: boolean;
  /** Where the channels came from on the last load. */
  channelsSource: Source;
  /* ---- Actions ---- */
  /** Re-fetch all three slices. */
  reload: () => Promise<void>;
  /** Generic "open this room" — locked / coming / admin fire toasts; only
   *  status === "open" actually opens the Whop chat. */
  openRoom: (roomId: string) => Promise<void>;
  /** Direct Whop handoff · bypasses status gating · used by the room
   *  card's tap target after status check. */
  openWhopRoom: (roomId: string) => Promise<void>;
}

/* Premium-tier mapping into the legacy Community tier strings.
 *   useTierCaps() returns "clipper" | "pro" | "agency"
 *   legacy "premium" set ≈ everything except clipper · agency users are
 *   admins by convention. */
function tierToCommunityTier(tier: "clipper" | "pro" | "growth" | "agency"): string {
  if (tier === "agency") return "growth";
  if (tier === "pro") return "pro";
  return "free";
}

export function useCommunity(): CommunityApi {
  const tier = useTierCaps();
  const callerTier = tierToCommunityTier(tier.tier);
  const callerIsAdmin = tier.tier === "agency";

  const [channels, setChannels] = useState<CommunityChannel[]>([]);
  const [channelsSource, setChannelsSource] = useState<Source>("mock");
  const [leaderboard, setLeaderboard] = useState<LeaderboardPreviewRow[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [communityTopBanners, setCommunityTopBanners] = useState<BannerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMockFallback, setIsMockFallback] = useState(true);

  const reload = useCallback(async () => {
    // IG-COMMUNITY-RETRY-OBSERVABLE · Reliability Sprint L1 (2026-07-22)
    // Retry MUST flip `loading=true` so the consumer surface can render a
    // visible spinner AND expose aria-busy · nielsen H1 visibility of
    // status. Previous behaviour: setError(null) + start fetch = user
    // sees nothing changing during the roundtrip. Audit + real users both
    // interpreted this as "click did nothing".
    setLoading(true);
    setError(null);
    try {
      const [chans, lb, ann, bans] = await Promise.all([
        community.listChannels({}),
        community.leaderboardPreview(),
        community.listAnnouncements(),
        community.listBanners({ placement: "community_top" }),
      ]);
      setChannels(chans.channels);
      setChannelsSource(chans.source);
      setIsMockFallback(chans.source === "mock");
      setLeaderboard(lb.rows);
      setAnnouncements(ann.items);
      setCommunityTopBanners(bans.items);
    } catch (e) {
      setError(humanError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  /* ============================================================
     Derived views
     ============================================================ */

  const rooms = useMemo<CommunityRoom[]>(() => {
    const out: CommunityRoom[] = [];
    for (const c of channels) {
      const room = resolveRoom(c, callerTier, callerIsAdmin);
      /* Hide rooms that the backend has marked as not even previewable
       *  for locked viewers. Matches legacy CommunityTab behaviour. */
      if (room.locked && !c.is_locked_preview_enabled) continue;
      out.push(room);
    }
    return out;
  }, [channels, callerTier, callerIsAdmin]);

  const roomsBySection = useMemo(() => {
    const acc: Record<RoomSection, CommunityRoom[]> = {
      announcements: [], free_lobby: [], paid_core: [], mission: [],
    };
    for (const r of rooms) {
      const k = (r.channel.section as RoomSection) in acc
        ? (r.channel.section as RoomSection)
        : "mission";
      acc[k].push(r);
    }
    for (const k of SECTION_ORDER) {
      acc[k].sort((a, b) => a.channel.sort_order - b.channel.sort_order);
    }
    return acc;
  }, [rooms]);

  const lockedRooms = useMemo(
    () => rooms.filter((r) => r.status === "locked"),
    [rooms],
  );

  /* Pick the first open room in announcements → paid_core → mission as
   * the featured tile. Avoid coming/locked/admin since they aren't
   * actionable. */
  const featuredRoom = useMemo<CommunityRoom | null>(() => {
    const priority: RoomSection[] = ["announcements", "paid_core", "mission", "free_lobby"];
    for (const sec of priority) {
      const candidate = roomsBySection[sec].find((r) => r.status === "open");
      if (candidate) return candidate;
    }
    return null;
  }, [roomsBySection]);

  /* ============================================================
     Whop handoff actions
     ============================================================ */

  const openWhopRoom = useCallback(async (roomId: string): Promise<void> => {
    const room = rooms.find((r) => r.channel.id === roomId || r.channel.slug === roomId);
    if (!room) {
      bus.emit("toast", { kind: "error", title: "Discussion not found", body: "That discussion is no longer listed." });
      return;
    }
    if (!room.whopUrl) {
      bus.emit("toast", {
        kind: "info",
        title: "No mirror yet",
        body: `${room.channel.name} · no Whop mirror provisioned, native discussion lands later.`,
      });
      return;
    }
    /* Phase 6L-B · route through `browse:open`. The default subscriber
     * opens the globally mounted in-app browser store; its documented
     * system fallback is reserved for an unavailable desktop webview. */
    bus.emit("browse:open", {
      url: room.whopUrl,
      source: "community",
      roomId: room.channel.id,
      mirror: "whop",
      title: room.channel.name,
    });
  }, [rooms]);

  const openRoom = useCallback(async (roomId: string): Promise<void> => {
    const room = rooms.find((r) => r.channel.id === roomId || r.channel.slug === roomId);
    if (!room) {
      bus.emit("toast", { kind: "error", title: "Room not found", body: "That community room is no longer listed." });
      return;
    }
    switch (room.status) {
      case "open":
        await openWhopRoom(room.channel.id);
        return;
      case "coming":
        bus.emit("toast", {
          kind: "info",
          title: "Not provisioned yet",
          body: `${room.channel.name} doesn't have a Whop chat yet · check back soon.`,
        });
        return;
      case "locked":
        bus.emit("toast", {
          kind: "info",
          title: "Premium room",
          body: `${room.channel.name} unlocks on a paid plan.`,
        });
        return;
      case "admin":
        bus.emit("toast", {
          kind: "info",
          title: "Admin only",
          body: `${room.channel.name} is read-only for non-admins.`,
        });
        return;
    }
  }, [rooms, openWhopRoom]);

  return {
    channels,
    rooms,
    roomsBySection,
    lockedRooms,
    featuredRoom,
    featuredDiscussion: featuredRoom,
    leaderboardPreview: leaderboard,
    announcements,
    communityTopBanners,
    loading,
    error,
    isMockFallback,
    channelsSource,
    reload,
    openRoom,
    openWhopRoom,
  };
}
