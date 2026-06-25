/**
 * CommunityRoute · Phase 6L-A
 *
 * Replaces the SimPage stub. First real Community surface.
 *
 * Reuses:
 *   - useCommunity (Phase 6L-A foundation)
 *   - useTierCaps (Phase 6H · feeds caller tier into useCommunity)
 *   - EngineErrorBoundary (Phase 6C)
 *   - BakeErrorStrip (Phase 6C · picks up publish/community errors)
 *   - EngineSessionProvider + useKadeFromSession (Phase 6B/6C-Lockdown)
 *
 * Builds inside this route only:
 *   - AnnouncementsRail · top hero rail (safe empty when no posts)
 *   - RoomGrid          · 4 sections of CommunityRoom cards
 *
 * Out of scope (per the Phase 6L-A brief):
 *   - Leaderboard surface (preview slice exists in the hook; no UI yet)
 *   - Profile / room-detail Drawer
 *   - Wall of Clippers
 *   - Reward Clips full port (Phase 6L-late)
 */

import { useState } from "react";
import { motion as fm } from "framer-motion";
import { DesignOSAppShell } from "../components/AppShell";
import { EngineErrorBoundary } from "../components/EngineErrorBoundary";
import { presets } from "../motion";
import { BakeErrorStrip } from "../engine/BakeErrorStrip";
import { useRuntimeInfo } from "../engine/runtimeInfo";
import { useTierCaps } from "../state/useTierCaps";
import { useCommunity } from "../state/useCommunity";
import { EngineSessionProvider, useEngineSession } from "../state/useEngineSession";
import { useKadeFromSession } from "../state/useKadeFromSession";
import { ROUTE_HERO } from "../copy/copyMap";
import {
  RoomGrid,
  AnnouncementsRail,
  RoomDetailDrawer,
  FeaturedDiscussion,
  LeaderboardSection,
  CommunityBanner,
  AchievementToast,
  channelToDiscussion,
  type CommunityRoom,
} from "../community";
import "./SimPage.css";
import "./Community.css";

function CommunityBody() {
  const session = useEngineSession();
  const runtime = useRuntimeInfo();
  const tier = useTierCaps();
  const community = useCommunity();
  useKadeFromSession("community");
  const [detailRoom, setDetailRoom] = useState<CommunityRoom | null>(null);

  const hero = ROUTE_HERO["community"];
  const featured = community.featuredDiscussion;

  return (
    <DesignOSAppShell
      world="cockpit-home"
      route="community"
      defaultKade={session.kade}
      kadePlacement="helper-right"
    >
      <fm.div
        className="sim-stage"
        variants={presets.routeEnter}
        initial="initial"
        animate="animate"
      >
        <fm.div
          className="sim-welcome"
          data-kade-anchor
          variants={presets.staggerContainer}
          initial="initial"
          animate="animate"
        >
          <fm.span className="sim-eb" variants={presets.staggerItem}>
            {hero.eyebrow}
            {(runtime.mode === "mock" || community.isMockFallback) && (
              <span
                className="lc-runtime-tag"
                title={`Channels source: ${community.channelsSource} · real Whop wiring lands in later phases.`}
              >
                Studio preview
              </span>
            )}
            <span className="lc-community-tier-tag">{tier.tier.toUpperCase()}</span>
            <span className="lc-community-rooms-tag" title="Rooms visible at this tier (locked-preview rows included).">
              {community.rooms.length} rooms · {community.lockedRooms.length} locked
            </span>
          </fm.span>
          <fm.h1 className="sim-h1" variants={presets.staggerItem}>
            {hero.h1}
          </fm.h1>
          <fm.p className="sim-sub" variants={presets.staggerItem}>
            {hero.sub}
          </fm.p>
        </fm.div>

        {/* BakeErrorStrip picks up publish/community errors when they fire here. */}
        <BakeErrorStrip />

        {/* Community-top banner placement · skips render when empty. */}
        <EngineErrorBoundary route="community" component="CommunityBanner">
          <CommunityBanner items={community.communityTopBanners} />
        </EngineErrorBoundary>

        {/* Announcements rail · safe empty state until backend exposes it. */}
        <EngineErrorBoundary route="community" component="AnnouncementsRail">
          <AnnouncementsRail items={community.announcements} />
        </EngineErrorBoundary>

        {/* Featured discussion hero · skips when no open discussion exists.
         *  Long-term this becomes the active campaign's discussion · the
         *  underlying hook prop already aliases to `featuredDiscussion`. */}
        <EngineErrorBoundary route="community" component="FeaturedDiscussion">
          <FeaturedDiscussion
            room={featured}
            onOpenDetail={() => setDetailRoom(featured)}
          />
        </EngineErrorBoundary>

        {/* RoomGrid · 4 sections of CommunityRoom cards. Clicks open the
         *  generic discussion drawer instead of jumping to Whop directly. */}
        <EngineErrorBoundary route="community" component="RoomGrid">
          <RoomGrid onOpenDetail={(r) => setDetailRoom(r)} />
        </EngineErrorBoundary>

        {/* Leaderboard preview · top-5 affiliate earners + caller pin. Fires
         *  `top_100_leaderboard` achievement unlock when the caller is in
         *  the visible window. */}
        <EngineErrorBoundary route="community" component="LeaderboardSection">
          <LeaderboardSection />
        </EngineErrorBoundary>

        {/* Generic discussion drawer · accepts the future-proof Discussion
         *  shape so the Campaign entity slots in without prop migration. */}
        <EngineErrorBoundary route="community" component="RoomDetailDrawer">
          <RoomDetailDrawer
            discussion={detailRoom ? channelToDiscussion(detailRoom) : null}
            open={detailRoom !== null}
            onClose={() => setDetailRoom(null)}
          />
        </EngineErrorBoundary>

        {/* Achievement toast · listens to `achievement:unlocked` bus event.
         *  Mounted on Community for now since the only unlock trigger today
         *  fires from LeaderboardSection. A future global mount in AppShell
         *  is a single-import promotion. */}
        <EngineErrorBoundary route="community" component="AchievementToast">
          <AchievementToast />
        </EngineErrorBoundary>
      </fm.div>
    </DesignOSAppShell>
  );
}

export function CommunityRoute() {
  return (
    <EngineSessionProvider resetOnRouteEnter>
      <CommunityBody />
    </EngineSessionProvider>
  );
}
