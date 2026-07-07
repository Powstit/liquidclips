/**
 * AnnouncementsRail · Phase 6L-A
 *
 * Hero-row rail above the RoomGrid. When the backend exposes a public
 * announcements endpoint (deferred · audit gap), this surfaces the
 * latest 3 posts. Until then it renders a single safe "no posts yet"
 * empty state — no fake content.
 */

import { GlassCard } from "../components";
import type { AnnouncementItem } from "./types";
import "./AnnouncementsRail.css";

export interface AnnouncementsRailProps {
  items: ReadonlyArray<AnnouncementItem>;
}

const KIND_LABEL: Record<AnnouncementItem["kind"], string> = {
  mission_drop: "Mission drop",
  payout:       "Payout",
  rule_change:  "Rule change",
  deadline:     "Deadline",
  other:        "Update",
};

function relTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export function AnnouncementsRail({ items }: AnnouncementsRailProps) {
  if (items.length === 0) {
    return (
      <GlassCard density="quiet" className="lc-ann-empty">
        <span className="lc-ann-empty-eb">Announcements</span>
        <span className="lc-ann-empty-body">
          No posts yet. Admin drops surface here when they ship.
        </span>
      </GlassCard>
    );
  }

  return (
    <div className="lc-ann">
      {items.slice(0, 3).map((a) => (
        <GlassCard key={a.id} density="default" className={`lc-ann-card is-${a.kind}`} hoverLift>
          <header className="lc-ann-head">
            <span className={`lc-ann-kind is-${a.kind}`}>
              <span className="lc-ann-kind-dot" aria-hidden="true" />
              {KIND_LABEL[a.kind]}
            </span>
            <span className="lc-ann-time">{relTime(a.publishedAt)}</span>
          </header>
          <h3 className="lc-ann-title">{a.title}</h3>
          {a.body && <p className="lc-ann-body">{a.body}</p>}
        </GlassCard>
      ))}
    </div>
  );
}
