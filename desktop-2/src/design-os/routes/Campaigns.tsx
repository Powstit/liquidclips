/**
 * CampaignsRoute · Phase 6N-B
 *
 * First real Campaigns surface. Replaces the SimPage stub.
 *
 * Architecture (Phase 6N-A): Campaign IS the single source of truth.
 * This route renders **projections** of Campaign:
 *   - DiscoveryCard      → <CampaignCard>
 *   - FeaturedSlot       → <CampaignBanner>
 *   - CampaignPage       → <CampaignPageShell> (drawer for now;
 *                          dedicated /campaigns/<slug> URL lands later)
 *   - Discussion         → <RoomDetailDrawer> via campaignToDiscussion
 *   - LeaderboardPreview → reused community surface inside the page shell
 *
 * Out of scope (per Phase 6N-B brief):
 *   - Agency creation flow
 *   - Native discussion entity
 *   - Asset ingestion (Drive/Dropbox OAuth)
 *   - Payment integration
 */

import { useState } from "react";
import { motion as fm } from "framer-motion";
import { DesignOSAppShell } from "../components/AppShell";
import { EngineErrorBoundary } from "../components/EngineErrorBoundary";
import { presets } from "../motion";
import { BakeErrorStrip } from "../engine/BakeErrorStrip";
import { useRuntimeInfo } from "../engine/runtimeInfo";
import { useMode } from "../bridge";
import { CampaignLifecyclePill, type CampaignStatus } from "../components/CampaignLifecyclePill";
import { useTierCaps, canUseAgencyActions } from "../state/useTierCaps";
import { useCampaigns } from "../state/useCampaigns";
import { EngineSessionProvider, useEngineSession } from "../state/useEngineSession";
import { useKadeFromSession } from "../state/useKadeFromSession";
import { ROUTE_HERO } from "../copy/copyMap";
import {
  CampaignBanner,
  CampaignFilters,
  CampaignCard,
  CampaignPageShell,
  type Campaign,
  type CampaignFilterKey,
} from "../campaigns";
import { AgencyCreationFlow } from "../agency-creation";
import { SponsoredRewardCard } from "../earn";
import "./SimPage.css";
import "./Campaigns.css";

/** UI-3 · agency-only manage strip · shows owned campaign lifecycle pills.
 *
 *  BUG-044 · The previous implementation hardcoded a useState of 3
 *  fake campaigns ("Uncle Daniel · Clip Squad 2026" · "DD Beauty ·
 *  Summer clips" · "Femi's Heart · Memorial drop") with fake clipper
 *  counts (47 / 12 / 0) and a fake `navigator.clipboard.writeText`
 *  invite-link. None of these were the agency's real campaigns.
 *
 *  Honest contract: when the campaigns backend is mock, render an
 *  empty-state "Manage your campaigns when backend connects" stub.
 *  No fake invite-link write. No fake clippers number.
 */
function AgencyManageStrip({ source }: { source: "real-rpc" | "real-http" | "mock" }) {
  const isOffline = source === "mock";

  // When the source is real-http / real-rpc, the agency's owned
  // campaigns derive from useCampaigns. The current backend doesn't yet
  // expose `/me/campaigns` ownership filtering, so even the real path
  // would need a follow-up wire to populate this strip with real items.
  // For now: empty list in both modes. Honest no-fake state.
  const items: { slug: string; label: string; status: CampaignStatus; clippers: number }[] = [];

  return (
    <section
      className="lc-camp-manage"
      aria-label="My campaigns"
      data-testid="campaigns-manage-strip"
      data-manage-source={source}
      data-manage-state={isOffline ? "coming-soon" : "empty"}
    >
      <header className="lc-camp-manage-head">
        <span className="lc-camp-manage-eb">My campaigns</span>
        <span className="lc-camp-manage-sub">
          {isOffline
            ? "Backend offline · campaign ownership lands when /me/campaigns is wired."
            : "Manage lifecycle · invite clippers · view submissions"}
        </span>
      </header>
      {items.length === 0 ? (
        <p
          data-testid="campaigns-manage-empty-copy"
          style={{
            margin: "12px 0 0",
            padding: "10px 14px",
            fontSize: 12,
            color: "rgba(255,255,255,.66)",
            border: "1px dashed rgba(255,255,255,.14)",
            borderRadius: 10,
          }}
        >
          {isOffline
            ? "No campaigns to manage in this preview. Connect a backend to see your owned campaigns."
            : "You don't own any campaigns yet. Use the + Create campaign button to launch one."}
        </p>
      ) : (
        <ul className="lc-camp-manage-list">
          {items.map((c) => (
            <li key={c.slug} className="lc-camp-manage-row" data-testid={`campaigns-manage-row-${c.slug}`}>
              <div className="lc-camp-manage-meta">
                <span className="lc-camp-manage-name">{c.label}</span>
                <span className="lc-camp-manage-clippers">{c.clippers} clipper{c.clippers === 1 ? "" : "s"}</span>
              </div>
              <CampaignLifecyclePill
                status={c.status}
                campaignSlug={c.slug}
                manageable
              />
              <button
                type="button"
                data-testid={`campaigns-manage-invite-${c.slug}`}
                className="lc-camp-manage-invite"
                disabled
                aria-disabled
                title="Invite flow lands when backend wires invite tokens"
              >
                Invite · coming soon
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CampaignsBody() {
  const session = useEngineSession();
  const runtime = useRuntimeInfo();
  const tier = useTierCaps();
  const camps = useCampaigns();
  const mode = useMode();
  useKadeFromSession("campaigns");

  const hero = ROUTE_HERO["campaigns"];

  const [filter, setFilter] = useState<CampaignFilterKey>("all");
  const [activeCampaign, setActiveCampaign] = useState<Campaign | null>(null);
  const [creationOpen, setCreationOpen] = useState(false);
  /* P1-1G-c · agency-write gate · MUST require a trusted tier source.
   * Fixture-fallback / unknown / debug-override never unlock create or
   * publish. `canWriteAgency` is the gate the create CTA + flow mount
   * on. Below-Agency users still get a Draft CTA (commitment-point
   * paywall fires at Publish inside the drawer instead). */
  const canWriteAgency = canUseAgencyActions({ tier: tier.tier, source: tier.source });

  // BUG-044 · single source-of-truth signal for the entire surface.
  // When mock, the customer sees an honest empty bounty marketplace +
  // a clear "Backend offline" banner. When real-http/real-rpc, the
  // grid + featured slot + filters render against real backend data.
  const isMockSource = camps.source === "mock";

  /* Featured slot pulls the FIRST featured-or-sponsored campaign. Filter
   * chips operate on the full visible list, so the featured banner stays
   * stable across filter changes (matches the Phase 6L-B FeaturedDiscussion
   * pattern). */
  const featured = camps.featured;
  const filtered = camps.applyFilter(filter);
  /* Skip the featured row inside the grid only when the active filter
   * doesn't already narrow things down · keeps "Featured" filter view
   * focused. */
  const gridList = filter === "featured"
    ? filtered
    : filtered.filter((c) => c.id !== featured?.id);

  return (
    <DesignOSAppShell
      world="cockpit-home"
      route="campaigns"
      defaultKade={session.kade}
      kadePlacement="helper-right"
    >
      <fm.div
        className="sim-stage"
        data-testid="campaigns-stage"
        data-campaigns-source={camps.source}
        data-campaigns-visible-count={String(camps.visible.length)}
        data-campaigns-featured-count={String(camps.byPlacement.featured.length)}
        variants={presets.routeEnter}
        initial="initial"
        animate="animate"
      >
        {/* PHASE 1 · viewport discipline · CampaignBanner / list lands in
            the first viewport. Source/tier/count tags survive as compact
            status pills; the 80px H1 + sub-copy cut. Agency/clipper
            primary-CTA split is a Phase 5 decision — not in scope here. */}
        <div className="lc-route-head" data-kade-anchor data-route-title={hero.eyebrow}>
          <span className="lc-route-head-eb">{hero.eyebrow}</span>
          <div className="lc-route-head-pills">
            {!isMockSource ? (
              <span
                data-testid="campaigns-source-pill"
                data-source={camps.source}
                className="lc-runtime-tag is-live"
                title={`Campaigns source: ${camps.source}.`}
              >
                Live · backend
              </span>
            ) : (
              <span
                data-testid="campaigns-source-pill"
                data-source="mock"
                className="lc-runtime-tag"
                title="Campaigns backend not reachable · install the desktop app or wire a backend URL to see real campaigns."
                style={{ textTransform: "uppercase", letterSpacing: ".15em" }}
              >
                Backend offline · preview only
              </span>
            )}
            {isMockSource && runtime.mode === "mock" && (
              <span className="lc-runtime-tag" style={{ opacity: 0.65 }} title="Vite preview runtime.">
                Studio preview
              </span>
            )}
            <span className="lc-campaigns-tier-tag">{tier.tier.toUpperCase()}</span>
            <span
              className="lc-campaigns-count-tag"
              data-testid="campaigns-count-tag"
              title="Visible campaigns at this tier."
            >
              {camps.visible.length} live · {camps.byPlacement.featured.length} featured
            </span>
          </div>
        </div>

        <BakeErrorStrip />

        {/* BUG-044 · honest offline banner above the grid when source = "mock".
            The banner uses the SAME visible signal as the source pill so the
            customer can't miss it. */}
        {isMockSource && (
          <div
            data-testid="campaigns-offline-banner"
            className="lc-campaigns-empty"
            style={{ marginBottom: 16 }}
          >
            <span className="lc-campaigns-empty-eb">No campaigns to discover</span>
            <span className="lc-campaigns-empty-body">
              The /campaigns endpoint isn't reachable from this build. Real
              campaigns appear here once you connect a backend or install the
              desktop app. No fake bounty data is rendered.
            </span>
          </div>
        )}

        {/* Featured banner · skips when none. */}
        <EngineErrorBoundary route="campaigns" component="CampaignBanner">
          <CampaignBanner
            campaign={featured}
            onOpen={() => featured && setActiveCampaign(featured)}
          />
        </EngineErrorBoundary>

        {/* Filter chips. */}
        {/* UI-3 · Agency-only · manage owned campaign lifecycle. The strip
            now reads `camps.source` so it can be honest in mock mode (BUG-044). */}
        {mode === "agency" && <AgencyManageStrip source={camps.source} />}

        <EngineErrorBoundary route="campaigns" component="CampaignFilters">
          <CampaignFilters active={filter} onChange={setFilter} campaigns={camps.visible} />
        </EngineErrorBoundary>

        {/* 2026-06-23 · $50 Sponsored Reward · pinned ABOVE discovery
         *  grid · IG-SOV-2.2-001 · NOT inside .lc-campaigns-grid so the
         *  campaigns-station BUG-044 spec (zero fake campaigns in grid)
         *  isn't broken by our owned-reward card. */}
        <EngineErrorBoundary route="campaigns" component="SponsoredRewardCard">
          <div
            className="lc-campaigns-sponsored-slot"
            data-testid="sponsored-reward-slot"
            style={{ marginBottom: 16 }}
          >
            <SponsoredRewardCard viewCount={0} />
          </div>
        </EngineErrorBoundary>

        {/* Discovery grid. */}
        <EngineErrorBoundary route="campaigns" component="CampaignsGrid">
          {camps.loading ? (
            <div className="lc-campaigns-loading">Loading campaigns…</div>
          ) : gridList.length === 0 ? (
            <div className="lc-campaigns-empty">
              <span className="lc-campaigns-empty-eb">No matching campaigns</span>
              <span className="lc-campaigns-empty-body">Try a different filter, or check back when a new drop lands.</span>
            </div>
          ) : (
            <div className="lc-campaigns-grid">
              {gridList.map((c) => (
                <CampaignCard
                  key={c.id}
                  campaign={c}
                  onOpen={() => setActiveCampaign(c)}
                />
              ))}
            </div>
          )}
        </EngineErrorBoundary>

        {/* Detail page shell · drawer for 6N-B. */}
        <EngineErrorBoundary route="campaigns" component="CampaignPageShell">
          <CampaignPageShell
            campaign={activeCampaign}
            open={activeCampaign !== null}
            onClose={() => setActiveCampaign(null)}
          />
        </EngineErrorBoundary>

        {/* Agency creation flow · 8-step drawer · Phase 6N-E v1.
         *  P1-1G-c · only mount when the tier source is TRUSTED. Fixture
         *  fallback / debug-override never instantiate the flow. */}
        {canWriteAgency && (
          <EngineErrorBoundary route="campaigns" component="AgencyCreationFlow">
            <AgencyCreationFlow
              open={creationOpen}
              onClose={() => setCreationOpen(false)}
              onPublished={() => void camps.reload()}
            />
          </EngineErrorBoundary>
        )}

        {/* 2026-06-23 monetisation pass · commitment-point paywall.
         *
         * BEFORE: button was hidden for non-Agency users. They never saw
         * the surface, never built emotional commitment.
         *
         * NOW: every tier sees a CTA. Agency users get the live "Create
         * campaign" flow. Below-Agency users open the SAME drawer and
         * build a campaign DRAFT (name · brief · reward rules · assets ·
         * preview). The paywall fires only at the Publish/Launch step
         * inside the drawer (StepReviewPublish → PaywallGate(agency)).
         * Inbox notification on blocked publish fires
         * notifyCampaignPublishBlocked. */}
        {!creationOpen && (
          <button
            type="button"
            className={`lc-campaigns-create-cta ${canWriteAgency ? "" : "is-draft"}`}
            onClick={() => setCreationOpen(true)}
            aria-label={canWriteAgency ? "Create campaign" : "Draft campaign · Agency required to publish"}
            title={
              canWriteAgency
                ? "Create campaign"
                : "Draft a campaign now · upgrade to Agency to publish/launch"
            }
          >
            + {canWriteAgency ? "Create campaign" : "Draft campaign"}
          </button>
        )}
      </fm.div>
    </DesignOSAppShell>
  );
}

export function CampaignsRoute() {
  return (
    <EngineSessionProvider resetOnRouteEnter>
      <CampaignsBody />
    </EngineSessionProvider>
  );
}
