/**
 * EarnRoute · Phase 6L-D
 *
 * Replaces the SimPage stub. First real Earn surface.
 *
 * Reuses:
 *   - useRewardClips()    · /me/reward-clips backend port
 *   - useEarnSummary()    · derived totals + RPM tier
 *   - useTierCaps()       · drives the RPM tile + future Campaign payout
 *   - LeaderboardSection  · Phase 6L-C surface · reused as the snapshot
 *
 * Builds inside this route only:
 *   - EarnSummaryStrip    · 5-tile overview (earned · pending · approved · rejected · RPM tier)
 *   - EarnFilters         · 6-chip status filter
 *   - RewardClipsList     · filtered rows w/ stamp icons + click count
 *   - RewardClipDrawer    · read-only submission detail
 *   - LeaderboardSection  · snapshot of top-5 affiliate earners
 *
 * Architecture alignment (clarification): Earn is the **personal view**
 * of Campaign participation. The `RewardClip` row IS the future
 * Campaign Submission row; this route renames in 6N-B without a data
 * migration. Hooks already alias `submissions` → `clips`.
 *
 * Out of scope (per the Phase 6L-D brief):
 *   - Create / patch reward-clip mutations (POST/PATCH paths exist on
 *     the backend; UI mutations land in a later 6L-D sub-step)
 *   - Native payout settlement integration
 *   - Campaign discovery / brief / brief assets
 */

import { useMemo, useState } from "react";
import { motion as fm } from "framer-motion";
import { DesignOSAppShell } from "../components/AppShell";
import { EngineErrorBoundary } from "../components/EngineErrorBoundary";
import { bus } from "../bridge";
import { openSmart } from "../../lib/openSmart";
import { presets } from "../motion";
import { BakeErrorStrip } from "../engine/BakeErrorStrip";
import { useRuntimeInfo } from "../engine/runtimeInfo";
import { useTierCaps } from "../state/useTierCaps";
import { useRewardClips } from "../state/useRewardClips";
import { useEarnSummary } from "../state/useEarnSummary";
import { EngineSessionProvider, useEngineSession } from "../state/useEngineSession";
import { useKadeFromSession } from "../state/useKadeFromSession";
import { ROUTE_HERO } from "../copy/copyMap";
import { LeaderboardSection } from "../community";
import {
  EarnSummaryStrip,
  EarnFilters,
  RewardClipsList,
  RewardClipDrawer,
  SponsoredRewardModule,
  WalletPanel,
  type RewardClip,
  type EarnFilterKey,
  EARN_FILTER_LABEL,
} from "../earn";
import "./SimPage.css";
import "./Earn.css";

function EarnBody() {
  const session = useEngineSession();
  const runtime = useRuntimeInfo();
  const tier = useTierCaps();
  const clips = useRewardClips();
  const earn = useEarnSummary();
  useKadeFromSession("earn");

  const hero = ROUTE_HERO["earn"];
  const [filter, setFilter] = useState<EarnFilterKey>("all");
  const [activeClip, setActiveClip] = useState<RewardClip | null>(null);

  const visible = useMemo(() => clips.byFilter[filter] ?? [], [clips.byFilter, filter]);
  const honestyTag = clips.source === "mock";

  return (
    <DesignOSAppShell
      world="cockpit-home"
      route="earn"
      defaultKade={session.kade}
      kadePlacement="helper-right"
    >
      <fm.div
        className="sim-stage"
        data-testid="earn-stage"
        data-earn-source={clips.source}
        data-earn-clip-count={String(clips.clips.length)}
        data-earn-lifetime-earned={String(earn.summary.totalEarnedUsd)}
        data-earn-pending={String(earn.summary.pendingPayoutsUsd)}
        variants={presets.routeEnter}
        initial="initial"
        animate="animate"
      >
        {/* PHASE 1 · viewport discipline · earnings summary + Whop payout
            CTA + first reward rows now land in the first viewport.
            Source/tier/RPM tags survive as compact status pills; the
            80px H1 + sub-copy cut. Journey + affiliate links promoted to
            a dedicated compact action row so the primary CTA (affiliate
            dashboard · Whop's payout entry point) stays visible without
            the landing-page hero. */}
        <div className="lc-route-head" data-kade-anchor data-route-title={hero.eyebrow}>
          <span className="lc-route-head-eb">{hero.eyebrow}</span>
          <div className="lc-route-head-pills">
            {!honestyTag ? (
              <span
                data-testid="earn-source-pill"
                data-source={clips.source}
                className="lc-runtime-tag is-live"
                title={`Reward-clips source: ${clips.source}.`}
              >
                Live · backend
              </span>
            ) : (
              <span
                data-testid="earn-source-pill"
                data-source="mock"
                className="lc-runtime-tag"
                title="Reward-clips backend not reachable · install the desktop app or wire a backend URL to see real earnings."
                style={{ textTransform: "uppercase", letterSpacing: ".15em" }}
              >
                Backend offline · preview only
              </span>
            )}
            {honestyTag && runtime.mode === "mock" && (
              <span className="lc-runtime-tag" style={{ opacity: 0.65 }} title="Vite preview runtime.">
                Studio preview
              </span>
            )}
            <span className="lc-earn-tier-tag">{tier.tier.toUpperCase()}</span>
            <span
              className="lc-earn-rpm-tag"
              data-testid="earn-lifetime-tag"
              title="Lifetime earnings × current RPM tier."
            >
              ${earn.summary.totalEarnedUsd.toFixed(2)} earned
            </span>
          </div>
        </div>
        <div className="lc-route-actions">
          <button
            type="button"
            className="lc-earn-journey-link"
            data-testid="earn-open-affiliate"
            data-open-url="https://liquidclips.app/refer"
            onClick={() => { void openSmart("https://liquidclips.app/refer"); }}
          >
            Open affiliate dashboard ↗
          </button>
          <button
            type="button"
            className="lc-earn-journey-link"
            onClick={() => bus.emit("nav:click", { route: "clipper" })}
          >
            Track progress · mission map →
          </button>
        </div>

        {/* Picks up backend errors (publish / earn / bake) when they fire. */}
        <BakeErrorStrip />

        {/* BUG-045 · honest offline banner when no real backend.
            The summary strip below renders zeros honestly — they're
            real-computed (no clips → no clicks → $0.00) not faked. */}
        {honestyTag && (
          <div
            data-testid="earn-offline-banner"
            className="lc-earn-empty"
            style={{
              padding: "14px 18px",
              margin: "0 0 18px",
              border: "1px dashed rgba(255,255,255,.14)",
              borderRadius: 12,
              background: "rgba(255,255,255,.03)",
            }}
          >
            <span style={{ display: "block", fontSize: 11, letterSpacing: ".18em", textTransform: "uppercase", color: "#ff66b8" }}>
              No earnings yet
            </span>
            <span style={{ display: "block", marginTop: 6, fontSize: 12, color: "rgba(255,255,255,.66)" }}>
              The /me/reward-clips endpoint isn't reachable from this build.
              Real earnings, payouts, and the affiliate leaderboard appear here
              once you connect a backend. No fake balance is shown.
            </span>
          </div>
        )}

        {/* 2026-06-24 · Wallet panel · honest pipeline-money breakdown.
         *  Replaces the "Withdraw $X" silent-success risk · sits ABOVE the
         *  SponsoredRewardModule so the clipper's pipeline status is the
         *  first thing they see on Earn. Withdraw button is env-gated
         *  server-side (CARROT_WHOP_LIVE) · same component handles both. */}
        <EngineErrorBoundary route="earn" component="WalletPanel">
          <WalletPanel />
        </EngineErrorBoundary>

        {/* 2026-06-23 · $50 Sponsored Reward module · IG-SOV-2.2-001
         *  Renders the activation-bonus state machine below the wallet so
         *  the carrot context is still right there for clippers who haven't
         *  qualified yet. SOVEREIGN-2.2 marker · backend wires when
         *  Sovereign 2.2 lands. */}
        <EngineErrorBoundary route="earn" component="SponsoredRewardModule">
          <SponsoredRewardModule
            viewCount={Math.max(0, earn.summary.totalClicks ?? 0)}
            referralCount={0}
          />
        </EngineErrorBoundary>

        {/* Summary strip · 5 tiles · DSEG7 totals. */}
        <EngineErrorBoundary route="earn" component="EarnSummaryStrip">
          <EarnSummaryStrip summary={earn.summary} />
        </EngineErrorBoundary>

        {/* Filter chips. */}
        <EngineErrorBoundary route="earn" component="EarnFilters">
          <EarnFilters
            active={filter}
            onChange={setFilter}
            byFilter={clips.byFilter}
          />
        </EngineErrorBoundary>

        {/* List · empty state lives inside the list component. */}
        <EngineErrorBoundary route="earn" component="RewardClipsList">
          <RewardClipsList
            clips={visible}
            rpmUsd={earn.summary.rpm.rpmUsd}
            onOpen={(c) => setActiveClip(c)}
            filterLabel={EARN_FILTER_LABEL[filter]}
            totalCount={clips.clips.length}
          />
        </EngineErrorBoundary>

        {/* Leaderboard snapshot · reuses the Phase 6L-C surface. */}
        <EngineErrorBoundary route="earn" component="LeaderboardSection">
          <LeaderboardSection />
        </EngineErrorBoundary>

        {/* Read-only submission drawer. */}
        <EngineErrorBoundary route="earn" component="RewardClipDrawer">
          <RewardClipDrawer
            clip={activeClip}
            open={activeClip !== null}
            onClose={() => setActiveClip(null)}
            rpmUsd={earn.summary.rpm.rpmUsd}
          />
        </EngineErrorBoundary>
      </fm.div>
    </DesignOSAppShell>
  );
}

export function EarnRoute() {
  return (
    <EngineSessionProvider resetOnRouteEnter>
      <EarnBody />
    </EngineSessionProvider>
  );
}
