/**
 * RoomCard · Phase 6L-A
 *
 * One card per CommunityRoom. Pure presentation — click + state come from
 * useCommunity. Status drives the visual state:
 *   - open    → cyan dot · "Open room" CTA
 *   - coming  → amber dot · "Not provisioned yet" CTA (no nav)
 *   - locked  → fuchsia dot · "Upgrade to unlock" CTA
 *   - admin   → muted dot · "Admin only" tag (read-only preview)
 *
 * Uses GlassCard for chrome parity with Channels + Schedule routes.
 */

import { GlassCard } from "../components";
import type { CommunityRoom, RoomTier } from "./types";
import "./RoomCard.css";

export interface RoomCardProps {
  room: CommunityRoom;
  onOpen: () => void;
}

const TIER_LABEL: Record<string, string> = {
  free:        "Open",
  free_paid:   "Open",
  paid:        "Paid",
  paid_admin:  "Admin",
};

function tierLabel(t: RoomTier | string): string {
  return TIER_LABEL[t] ?? t.toUpperCase();
}

const STATUS_LABEL: Record<CommunityRoom["status"], string> = {
  open:   "Open room",
  coming: "Coming soon",
  locked: "Upgrade to unlock",
  admin:  "Admin only",
};

export function RoomCard({ room, onOpen }: RoomCardProps) {
  const { channel, status, locked } = room;
  return (
    <GlassCard density="default" className={`lc-rc is-${status} ${locked ? "is-locked" : ""}`} hoverLift>
      <button
        type="button"
        className="lc-rc-body"
        onClick={onOpen}
        aria-label={`${channel.name} · ${STATUS_LABEL[status]}`}
      >
        <header className="lc-rc-head">
          <span className={`lc-rc-tier is-${channel.required_tier}`}>
            <span className="lc-rc-tier-dot" aria-hidden="true" />
            {tierLabel(channel.required_tier as RoomTier)}
          </span>
          {channel.business_unit && (
            <span className="lc-rc-unit" title={`Business unit · ${channel.business_unit}`}>
              {channel.business_unit.replace(/_/g, " ")}
            </span>
          )}
        </header>

        <h3 className="lc-rc-title">{channel.name}</h3>
        {channel.purpose && <p className="lc-rc-purpose">{channel.purpose}</p>}

        <footer className="lc-rc-foot">
          <span className={`lc-rc-status is-${status}`}>
            <span className="lc-rc-status-dot" aria-hidden="true" />
            {STATUS_LABEL[status]}
          </span>
          {channel.mission_lane && (
            <span className="lc-rc-lane" title={`Mission lane · ${channel.mission_lane}`}>
              {channel.mission_lane}
            </span>
          )}
        </footer>
      </button>
    </GlassCard>
  );
}
