/**
 * RoomGrid · Phase 6L-A
 *
 * Renders the 4 fixed sections (announcements / free_lobby / paid_core /
 * mission) as collapsible sections, each with a header + grid of
 * <RoomCard>. Empty sections still render their header so the layout
 * doesn't collapse on a small backend.
 */

import { useCommunity } from "../state/useCommunity";
import { RoomCard } from "./RoomCard";
import { SECTION_META, SECTION_ORDER, type CommunityRoom } from "./types";
import "./RoomGrid.css";

export interface RoomGridProps {
  /** Called when a card is clicked. The route owns drawer state. */
  onOpenDetail: (room: CommunityRoom) => void;
}

export function RoomGrid({ onOpenDetail }: RoomGridProps) {
  const community = useCommunity();

  if (community.loading) {
    return (
      <div className="lc-rg-safe">
        <span className="lc-rg-safe-eb">Loading rooms…</span>
      </div>
    );
  }

  if (community.error) {
    return (
      <div className="lc-rg-safe is-error">
        <span className="lc-rg-safe-eb">Couldn't load community</span>
        <p className="lc-rg-safe-body">{community.error}</p>
        <button type="button" className="lc-rg-retry" onClick={() => void community.reload()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="lc-rg">
      {SECTION_ORDER.map((section) => {
        const list = community.roomsBySection[section] ?? [];
        const meta = SECTION_META[section];
        return (
          <section key={section} className="lc-rg-section">
            <header className="lc-rg-section-head">
              <div className="lc-rg-section-name">
                <span className="lc-rg-section-label">{meta.label}</span>
                <span className="lc-rg-section-sub">{meta.sub}</span>
              </div>
              <span className="lc-rg-section-total">
                {list.length} {list.length === 1 ? "room" : "rooms"}
              </span>
            </header>

            {list.length === 0 ? (
              <div className="lc-rg-empty-row">
                No rooms in this section yet.
              </div>
            ) : (
              <div className="lc-rg-row">
                {list.map((room) => (
                  <RoomCard
                    key={room.channel.id}
                    room={room}
                    onOpen={() => onOpenDetail(room)}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
