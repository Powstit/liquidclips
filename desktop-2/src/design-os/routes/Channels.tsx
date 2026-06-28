/**
 * ChannelsRoute · Phase 6I-B
 *
 * Replaces the SimPage stub. First real Channels surface.
 *
 * Reuses:
 *   - useChannels (Phase 6I-A foundation)
 *   - useTierCaps (Phase 6H)
 *   - AccountChipState as canonical state→visual map (Phase 6H · 11 states)
 *   - EngineErrorBoundary (Phase 6C)
 *   - BakeErrorStrip (Phase 6C — extends across publish failures)
 *   - EngineSessionProvider + useKadeFromSession (Phase 6B/6C-Lockdown)
 *
 * Builds inside this route only:
 *   - <PlanLimitStrip> · tier name · usage bar · attention pill · upgrade
 *   - <ChannelsGrid>   · 6 platform sections · ChannelTiles + AddAccountTile
 *
 * Out of scope (per the Phase 6I-B brief):
 *   - OAuth + "Label this account" Drawer
 *   - Disconnect confirmation
 *   - Connection-health panel
 *   - Schedule + Campaign integration
 */

import { motion as fm } from "framer-motion";
import { DesignOSAppShell } from "../components/AppShell";
import { EngineErrorBoundary } from "../components/EngineErrorBoundary";
import { presets } from "../motion";
import { ChannelsGrid, PlanLimitStrip } from "../channels";
import { BakeErrorStrip } from "../engine/BakeErrorStrip";
import { useTierCaps } from "../state/useTierCaps";
import { useChannels } from "../state/useChannels";
import { EngineSessionProvider, useEngineSession } from "../state/useEngineSession";
import { useKadeFromSession } from "../state/useKadeFromSession";
import { ROUTE_REGISTRY } from "../routing/routeRegistry";
import "./SimPage.css";
import "./Channels.css";

function ChannelsBody() {
  const session = useEngineSession();
  const tier = useTierCaps();
  const channels = useChannels();
  useKadeFromSession("channels");

  const spec = ROUTE_REGISTRY["channels"];

  // BUG-043 · single honest signal for the entire surface. When source
  // is "mock" the customer is told (visibly, in EVERY build, not just
  // dev) that no backend is reachable. The grid below renders empty
  // platform sections. Connect buttons are disabled.
  const isMockSource = channels.source === "mock";

  return (
    <DesignOSAppShell
      world="cockpit-home"
      route="channels"
      defaultKade={session.kade}
      kadePlacement={spec.kadePlacement}
    >
      <fm.div
        className="sim-stage lc-channels-stage"
        data-testid="channels-stage"
        data-channels-source={channels.source}
        data-channels-connected-count={String(channels.connectedCount)}
        variants={presets.routeEnter}
        initial="initial"
        animate="animate"
      >
        <div className="lc-route-head" data-kade-anchor data-route-title="Channels">
          <div className="lc-channels-heading">
            <span className="lc-route-head-eb">Channels</span>
            <span className="lc-channels-heading-copy">
              Connect publishing accounts and monitor their health.
            </span>
          </div>
          <div className="lc-route-head-pills">
            {!isMockSource ? (
              <span
                data-testid="channels-source-pill"
                data-source={channels.source}
                className="lc-runtime-tag is-live"
                title={`Source: ${channels.source} · /channels backend reachable.`}
              >
                Live · backend
              </span>
            ) : (
              <span
                data-testid="channels-source-pill"
                data-source="mock"
                className="lc-runtime-tag"
                title="Channels backend not reachable · install the desktop app or wire a backend URL to manage channels."
                style={{ textTransform: "uppercase", letterSpacing: ".15em" }}
              >
                Backend offline · preview only
              </span>
            )}
            <span className="lc-channels-tier-tag">{tier.tier.toUpperCase()}</span>
          </div>
        </div>

        {/* BUG-043 · honest empty-state banner above the grid when source=mock.
            The grid below still mounts but renders empty platform sections. */}
        {isMockSource && (
          <div
            data-testid="channels-offline-banner"
            className="lc-cg-safe"
            style={{ marginBottom: 16 }}
          >
            <span className="lc-cg-safe-eb">No connected channels</span>
            <p style={{ marginTop: 6, fontSize: 12, color: "rgba(255,255,255,.66)" }}>
              Publishing setup is unavailable right now. You can still create
              and export clips; reconnect before adding an account.
            </p>
          </div>
        )}

        {/* Plan-limit strip */}
        <EngineErrorBoundary route="channels" component="PlanLimitStrip">
          <PlanLimitStrip />
        </EngineErrorBoundary>

        {/* Surfaces publish/bake/regen/thumbnail errors when they fire on this route */}
        <BakeErrorStrip />

        {/* Six platform sections · grid renders empty when source=mock (no FAKE rows). */}
        <EngineErrorBoundary route="channels" component="ChannelsGrid">
          <ChannelsGrid hideBrand={tier.tier === "clipper"} />
        </EngineErrorBoundary>
      </fm.div>
    </DesignOSAppShell>
  );
}

export function ChannelsRoute() {
  return (
    <EngineSessionProvider resetOnRouteEnter>
      <ChannelsBody />
    </EngineSessionProvider>
  );
}
