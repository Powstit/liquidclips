/**
 * FeaturedDiscussion · Phase 6L-B
 *
 * Hero card above the RoomGrid. Reads `useCommunity().featuredDiscussion`
 * (alias of featuredRoom) so the seam between Community rooms and the
 * future Campaign entity is single-line to swap.
 *
 * Behaviour:
 *   - Renders nothing when there's no featured open discussion (no
 *     empty hero · the grid below is enough on its own).
 *   - Click → opens the same RoomDetailDrawer the grid uses.
 *
 * Vocabulary: "Discussion" / "Open discussion" / "Open Whop mirror"
 * everywhere · matches the locked-vocabulary brief.
 */

import { GlassCard } from "../components";
import { bus } from "../bridge";
import { DISCUSSION } from "../copy/copyMap";
import type { CommunityRoom } from "./types";
import "./FeaturedDiscussion.css";

export interface FeaturedDiscussionProps {
  room: CommunityRoom | null;
  onOpenDetail: () => void;
}

export function FeaturedDiscussion({ room, onOpenDetail }: FeaturedDiscussionProps) {
  if (!room) return null;
  const { channel, status, whopUrl } = room;

  const handleOpenWhop = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!whopUrl) return;
    bus.emit("browse:open", {
      url: whopUrl,
      source: "community",
      roomId: channel.id,
      mirror: "whop",
      title: channel.name,
    });
  };

  return (
    <GlassCard density="default" className="lc-fd" hoverLift>
      <button
        type="button"
        className="lc-fd-shell"
        onClick={onOpenDetail}
        aria-label={`Open featured discussion · ${channel.name}`}
      >
        <header className="lc-fd-head">
          <span className="lc-fd-eb">Featured discussion</span>
          <span className={`lc-fd-status is-${status}`}>
            <span className="lc-fd-status-dot" aria-hidden="true" />
            {DISCUSSION.available_pill}
          </span>
        </header>

        <h2 className="lc-fd-title">{channel.name}</h2>
        {channel.purpose && <p className="lc-fd-body">{channel.purpose}</p>}

        <footer className="lc-fd-foot">
          <div className="lc-fd-meta">
            {channel.business_unit && (
              <span className="lc-fd-meta-pill">{channel.business_unit.replace(/_/g, " ")}</span>
            )}
            {channel.mission_lane && (
              <span className="lc-fd-meta-pill is-lane">{channel.mission_lane}</span>
            )}
          </div>
          <div className="lc-fd-cta-group">
            <span className="lc-fd-cta-primary">{DISCUSSION.open_cta}</span>
            {whopUrl && (
              <button
                type="button"
                className="lc-fd-cta-secondary"
                onClick={handleOpenWhop}
                title={DISCUSSION.whop_subtext}
              >
                {DISCUSSION.whop_secondary}
              </button>
            )}
          </div>
        </footer>
      </button>
    </GlassCard>
  );
}
