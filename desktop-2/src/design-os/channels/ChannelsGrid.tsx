/**
 * ChannelsGrid · Phase 6I-B
 *
 * Renders one platform section per supported platform · always all 6
 * even when empty (relay-tower deserves a complete map). Each section:
 *   - header: platform name + "X of Y connected" + total
 *   - tiles: one <ChannelTile> per existing channel
 *   - trailing <AddAccountTile> when the user can connect another on
 *     this platform under their tier
 *
 * No OAuth here. AddAccountTile calls `channels.connect(platform)` which
 * the Phase 6I-A stub seeds as a `pending-link` row then flips to
 * `connected` after 3s (toasts visible). Real OAuth lands later.
 */

import { useState } from "react";
import { GlassCard, EngineErrorBoundary } from "../components";
import { useChannels } from "../state/useChannels";
import { useTierCaps } from "../state/useTierCaps";
import { ChannelTile } from "./ChannelTile";
import { ChannelDetailDrawer } from "./ChannelDetailDrawer";
import type { SidecarChannel } from "../engine/sidecar-stub";
import type { Platform } from "../engine/types";
import "./ChannelsGrid.css";

const PLATFORM_ORDER: Platform[] = [
  "tiktok", "instagram", "youtube", "facebook", "x", "linkedin",
];

const PLATFORM_DISPLAY: Record<Platform, string> = {
  tiktok:    "TikTok",
  instagram: "Instagram",
  youtube:   "YouTube",
  facebook:  "Facebook",
  x:         "X",
  linkedin:  "LinkedIn",
};

export interface ChannelsGridProps {
  /** When true, hide brand badges on tiles (Clipper UI). */
  hideBrand?: boolean;
}

export function ChannelsGrid({ hideBrand }: ChannelsGridProps) {
  const channels = useChannels();
  const tier = useTierCaps();
  const [detailChannel, setDetailChannel] = useState<SidecarChannel | null>(null);

  if (channels.loading) {
    return (
      <div className="lc-cg-safe">
        <span className="lc-cg-safe-eb">Loading channels…</span>
      </div>
    );
  }

  return (
    <div className="lc-cg" data-testid="channels-grid">
      {PLATFORM_ORDER.map((platform) => {
        const list = channels.byPlatform[platform] ?? [];
        const connectedHere = channels.connectedByPlatform[platform] ?? 0;
        const canAddHere = channels.canAddOnPlatform(platform);
        const platformCap = tier.caps.perPlatformChannels;

        return (
          <section key={platform} className="lc-cg-section">
            <header className="lc-cg-section-head">
              <div className="lc-cg-section-name">
                <span className="lc-cg-platform">{PLATFORM_DISPLAY[platform]}</span>
                <span className="lc-cg-platform-count">
                  {connectedHere} of {platformCap} connected
                </span>
              </div>
              <span className="lc-cg-section-total">
                {list.length} {list.length === 1 ? "account" : "accounts"}
              </span>
            </header>

            <div className="lc-cg-row">
              {list.map((c) => (
                <ChannelTile
                  key={c.id}
                  channel={c}
                  hideBrand={hideBrand}
                  onClick={() => setDetailChannel(c)}
                />
              ))}

              {canAddHere && <AddAccountTile platform={platform} />}

              {!canAddHere && list.length === 0 && (
                <EmptyPlatformTile platform={platform} />
              )}
            </div>
          </section>
        );
      })}

      {/* Channel detail drawer · drives both ChannelDetailDrawer and
       *  DisconnectConfirmDrawer (the latter chains off the detail). Wrapped
       *  in EngineErrorBoundary so a drawer crash leaves the grid usable. */}
      <EngineErrorBoundary route="channels" component="ChannelDetailDrawer">
        <ChannelDetailDrawer
          channel={detailChannel}
          open={detailChannel !== null}
          onClose={() => setDetailChannel(null)}
          hideBrand={hideBrand}
        />
      </EngineErrorBoundary>
    </div>
  );
}

function AddAccountTile({ platform }: { platform: Platform }) {
  const channels = useChannels();
  // BUG-043 · disable the connect CTA when the channels source is mock.
  // The connect RPC throws an honest error in that path; rather than
  // surface the error toast on click, just refuse the affordance up front.
  const isOffline = channels.source === "mock";
  return (
    <GlassCard density="quiet" className="lc-cg-add" hoverLift>
      <button
        type="button"
        data-testid={`channels-add-${platform}`}
        data-channels-add-state={isOffline ? "coming-soon" : "available"}
        className="lc-cg-add-btn"
        disabled={isOffline}
        aria-disabled={isOffline}
        title={isOffline ? "Channels backend not reachable in this preview" : undefined}
        onClick={() => {
          if (isOffline) return;
          void channels.connect(platform);
        }}
        aria-label={`Connect a new ${PLATFORM_DISPLAY[platform]} account`}
      >
        <span className="lc-cg-add-plus" aria-hidden="true">+</span>
        <span className="lc-cg-add-eb">{isOffline ? "Coming soon" : "Add account"}</span>
        <span className="lc-cg-add-body">{PLATFORM_DISPLAY[platform]}</span>
      </button>
    </GlassCard>
  );
}

function EmptyPlatformTile({ platform }: { platform: Platform }) {
  const tier = useTierCaps();
  return (
    <GlassCard density="quiet" className="lc-cg-empty">
      <span className="lc-cg-empty-eb">{PLATFORM_DISPLAY[platform]}</span>
      <span className="lc-cg-empty-body">
        {tier.tier === "agency"
          ? "Slot cap reached at your tier."
          : "Upgrade to connect this platform."}
      </span>
    </GlassCard>
  );
}
