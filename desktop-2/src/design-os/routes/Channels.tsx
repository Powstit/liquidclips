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
import { useRuntimeInfo } from "../engine/runtimeInfo";
import { useTierCaps } from "../state/useTierCaps";
import { useChannels } from "../state/useChannels";
import { EngineSessionProvider, useEngineSession } from "../state/useEngineSession";
import { useKadeFromSession } from "../state/useKadeFromSession";
import { ROUTE_REGISTRY } from "../routing/routeRegistry";
import { ROUTE_HERO } from "../copy/copyMap";
import "./SimPage.css";
import "./Channels.css";

function ChannelsBody() {
  const session = useEngineSession();
  const runtime = useRuntimeInfo();
  const tier = useTierCaps();
  const channels = useChannels();
  useKadeFromSession("channels");

  const spec = ROUTE_REGISTRY["channels"];
  const hero = ROUTE_HERO["channels"];

  // BUG-043 · single honest signal for the entire surface. When source
  // is "mock" the customer is told (visibly, in EVERY build, not just
  // dev) that no backend is reachable. The grid below renders empty
  // platform sections. Connect buttons are disabled.
  const isMockSource = channels.source === "mock";

  return (
    <DesignOSAppShell
      world="relay-tower"
      route="channels"
      defaultKade={session.kade}
      kadePlacement={spec.kadePlacement}
    >
      <fm.div
        className="sim-stage"
        data-testid="channels-stage"
        data-channels-source={channels.source}
        data-channels-connected-count={String(channels.connectedCount)}
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
            {/* keep the runtime-mode hint as a secondary cue when relevant */}
            {isMockSource && runtime.mode === "mock" && (
              <span className="lc-runtime-tag" style={{ opacity: 0.65 }} title="Vite preview runtime.">
                Studio preview
              </span>
            )}
            <span className="lc-channels-tier-tag">{tier.tier.toUpperCase()}</span>
          </fm.span>
          <fm.h1 className="sim-h1" variants={presets.staggerItem}>
            {hero.h1}
          </fm.h1>
          <fm.p className="sim-sub" variants={presets.staggerItem}>
            {isMockSource
              ? "Channels backend not reachable in this preview. Install the desktop app or connect a backend to manage real account connections — no fake-connected state is shown here."
              : hero.sub}
          </fm.p>
        </fm.div>

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
              The /channels endpoint isn't reachable from this build. You can
              clip and export today; account connection lands when the
              backend is wired.
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
