/**
 * RoomDetailDrawer · Phase 6L-B
 *
 * Generic discussion-aware drawer. Reads the future-proof `Discussion`
 * shape (NOT raw CommunityChannel) so when Phase 6M's Campaign entity
 * lands, this file accepts `campaignToDiscussion(c)` output without a
 * prop migration.
 *
 * Filename keeps "Room" today for parity with the brief — it will be
 * re-aliased to `CampaignDiscussionDrawer` (re-exports both names) when
 * the campaign route lands. Drawer body never says "room": it says
 * "discussion" everywhere.
 */

import { useEffect, useState } from "react";
import { Drawer, GlassCard } from "../components";
import { bus } from "../bridge";
import { DISCUSSION, CTA as COPY_CTA } from "../copy/copyMap";
import { useBillingState } from "../../lib/billing/adapter";
import type { Discussion } from "./discussion";
import { loadVisitedSet, saveVisitedSet } from "./discussion";
import "./RoomDetailDrawer.css";

export interface RoomDetailDrawerProps {
  /** Generic discussion shape · accepts both room-derived and (future)
   *  campaign-derived discussions. */
  discussion: Discussion | null;
  open: boolean;
  onClose: () => void;
}

const TIER_LABEL: Record<string, string> = {
  free:        "Open",
  free_paid:   "Open",
  paid:        "Paid",
  paid_admin:  "Admin",
};

function tierLabel(t: string): string {
  return TIER_LABEL[t] ?? t.toUpperCase();
}

const STATUS_LABEL: Record<Discussion["status"], string> = {
  open:   "Discussion available",
  coming: "Not provisioned yet",
  locked: "Locked discussion",
  admin:  "Admin only",
};

const KIND_LABEL: Record<Discussion["kind"], string> = {
  campaign:     "Campaign",
  announcement: "Announcement",
  support:      "Support / Help",
  other:        "General",
};

export function RoomDetailDrawer({ discussion, open, onClose }: RoomDetailDrawerProps) {
  const [visitedSet, setVisitedSet] = useState<Set<string>>(() => loadVisitedSet());
  // 2026-06-23 · billing adapter wired for upgrade CTA (replaces Phase 7+ toast)
  const billing = useBillingState();

  /* Re-load the visited set whenever a new discussion is shown — keeps
   *  the toggle visually in sync with localStorage if another surface
   *  edits it mid-session. */
  useEffect(() => {
    if (open) setVisitedSet(loadVisitedSet());
  }, [open, discussion?.id]);

  if (!discussion) {
    return (
      <Drawer
        open={false}
        onClose={onClose}
        eyebrow="Discussion"
        title=""
        width={460}
        id="community-room-detail-drawer"
      >
        <div />
      </Drawer>
    );
  }

  const isVisited = visitedSet.has(discussion.id);
  const toggleVisited = () => {
    const next = new Set(visitedSet);
    if (next.has(discussion.id)) next.delete(discussion.id);
    else next.add(discussion.id);
    setVisitedSet(next);
    saveVisitedSet(next);
  };

  const handleOpenDiscussion = () => {
    /* Today: only Whop mirror exists. When native lands, the same CTA
     *  emits browse:open with `mirror: "native"` and a different url
     *  source — no JSX change. */
    if (discussion.whopMirrorUrl) {
      bus.emit("browse:open", {
        url: discussion.whopMirrorUrl,
        source: "community",
        roomId: discussion.id,
        mirror: "whop",
        title: discussion.title,
      });
    } else {
      bus.emit("toast", {
        kind: "info",
        title: DISCUSSION.coming_eb,
        body: DISCUSSION.coming_body,
      });
    }
  };

  const handleUpgrade = () => {
    // 2026-06-23 · wire to real billing adapter (no more Phase 7+ toast).
    // Required tier for locked discussions is typically "paid" or higher;
    // start by upselling Pro · billing handles the route to /dashboard#plans.
    void billing.adapter.startCheckout("pro");
  };

  const perks = discussion.perks ?? DISCUSSION.perks_default;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Discussion"
      title={discussion.title}
      width={460}
      id="community-room-detail-drawer"
    >
      <div className="lc-rdd">
        {/* Header status pills */}
        <header className="lc-rdd-head">
          <span className={`lc-rdd-tier is-${discussion.requiredTier}`}>
            <span className="lc-rdd-tier-dot" aria-hidden="true" />
            {tierLabel(discussion.requiredTier)}
          </span>
          <span className={`lc-rdd-status is-${discussion.status}`}>
            <span className="lc-rdd-status-dot" aria-hidden="true" />
            {STATUS_LABEL[discussion.status]}
          </span>
        </header>

        {/* Purpose */}
        {discussion.purpose && <p className="lc-rdd-purpose">{discussion.purpose}</p>}

        {/* Meta grid */}
        <GlassCard density="quiet" className="lc-rdd-meta">
          <div className="lc-rdd-meta-row">
            <span className="lc-rdd-meta-k">Kind</span>
            <span className="lc-rdd-meta-v">{KIND_LABEL[discussion.kind]}</span>
          </div>
          <div className="lc-rdd-meta-row">
            <span className="lc-rdd-meta-k">Section</span>
            <span className="lc-rdd-meta-v mono">{String(discussion.section)}</span>
          </div>
          {discussion.businessUnit && (
            <div className="lc-rdd-meta-row">
              <span className="lc-rdd-meta-k">Business unit</span>
              <span className="lc-rdd-meta-v">{discussion.businessUnit.replace(/_/g, " ")}</span>
            </div>
          )}
          {discussion.missionLane && (
            <div className="lc-rdd-meta-row">
              <span className="lc-rdd-meta-k">Lane</span>
              <span className="lc-rdd-meta-v">{discussion.missionLane}</span>
            </div>
          )}
          <div className="lc-rdd-meta-row">
            <span className="lc-rdd-meta-k">Whop mirror</span>
            <span className="lc-rdd-meta-v mono">
              {discussion.whopMirrorId ?? "—"}
            </span>
          </div>
        </GlassCard>

        {/* Locked info · "what you get" perks */}
        {discussion.status === "locked" && (
          <GlassCard density="default" className="lc-rdd-locked">
            <span className="lc-rdd-locked-eb">{DISCUSSION.locked_eb}</span>
            <p className="lc-rdd-locked-body">{DISCUSSION.locked_body}</p>
            <div className="lc-rdd-perks">
              <span className="lc-rdd-perks-eb">{DISCUSSION.perks_eb}</span>
              <ul className="lc-rdd-perks-list">
                {perks.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          </GlassCard>
        )}

        {/* Coming-soon info */}
        {discussion.status === "coming" && (
          <GlassCard density="default" className="lc-rdd-coming">
            <span className="lc-rdd-coming-eb">{DISCUSSION.coming_eb}</span>
            <p className="lc-rdd-coming-body">{DISCUSSION.coming_body}</p>
          </GlassCard>
        )}

        {/* Admin-only info */}
        {discussion.status === "admin" && (
          <GlassCard density="default" className="lc-rdd-admin">
            <span className="lc-rdd-admin-eb">{DISCUSSION.admin_eb}</span>
            <p className="lc-rdd-admin-body">{DISCUSSION.admin_body}</p>
          </GlassCard>
        )}

        {/* No-mirror notice when room is otherwise open but lacks a Whop URL */}
        {discussion.status === "open" && !discussion.whopMirrorUrl && (
          <GlassCard density="quiet" className="lc-rdd-nomirror">
            <span className="lc-rdd-nomirror-body">{DISCUSSION.no_mirror_note}</span>
          </GlassCard>
        )}

        {/* Mark-as-visited toggle */}
        <label className="lc-rdd-visited">
          <input
            type="checkbox"
            checked={isVisited}
            onChange={toggleVisited}
          />
          <span className="lc-rdd-visited-label">{DISCUSSION.mark_visited}</span>
          <span className="lc-rdd-visited-note">(local · not synced)</span>
        </label>

        {/* Footer CTAs */}
        <footer className="lc-rdd-foot">
          {discussion.status === "open" && (
            <>
              <button
                type="button"
                className="lc-rdd-btn lc-rdd-btn-primary"
                onClick={handleOpenDiscussion}
              >
                {DISCUSSION.open_cta}
              </button>
              {discussion.whopMirrorUrl && (
                <span className="lc-rdd-mirror-note" title={DISCUSSION.whop_subtext}>
                  {DISCUSSION.whop_secondary} · <span className="lc-rdd-mirror-sub">External · Whop-hosted</span>
                </span>
              )}
            </>
          )}
          {discussion.status === "locked" && (
            <button
              type="button"
              className="lc-rdd-btn lc-rdd-btn-primary"
              onClick={handleUpgrade}
            >
              {DISCUSSION.upgrade_cta}
            </button>
          )}
          {discussion.status === "coming" && (
            <button
              type="button"
              className="lc-rdd-btn"
              disabled
              title={DISCUSSION.coming_body}
            >
              {DISCUSSION.coming_eb}
            </button>
          )}
          {discussion.status === "admin" && (
            <button
              type="button"
              className="lc-rdd-btn"
              disabled
              title={DISCUSSION.admin_body}
            >
              {DISCUSSION.admin_eb}
            </button>
          )}
          <button
            type="button"
            className="lc-rdd-btn lc-rdd-btn-quiet"
            onClick={onClose}
          >
            {COPY_CTA.dismiss}
          </button>
        </footer>
      </div>
    </Drawer>
  );
}
