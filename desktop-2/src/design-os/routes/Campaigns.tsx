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

import { useEffect, useState } from "react";
// 2026-07-14 · Campaign nav perf Phase 2 · dropped `framer-motion` from
// the Campaigns lazy chunk. The only usage was the route-mount enter
// fade (`presets.routeEnter` = `opacity 0 → 1` over 120ms · `E.out`).
// That's a two-line CSS class — see `.lc-campaigns-stage.lc-route-enter`
// in Campaigns.css. Removing the fm import shrinks the lazy chunk +
// removes the framer-motion runtime overhead from the nav-click →
// interactive-ready critical path (Phase 1 target — BUG-001 / BUG-010).
import { DesignOSAppShell } from "../components/AppShell";
import { EngineErrorBoundary } from "../components/EngineErrorBoundary";
import { BakeErrorStrip } from "../engine/BakeErrorStrip";
import { bus, useMode } from "../bridge";
import { setActiveCampaignId } from "../../shell/modeStore";
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
import {
  markRouteMountStart,
  markFirstContentfulRender,
  markInteractiveReady,
  attachRoutePerformanceObservers,
} from "../../lib/navPerf";
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
            ? "Campaign management is temporarily unavailable."
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
            ? "No campaigns are available right now. Reconnect, then try again."
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
              {/* Control Tower #3 · 2026-07-09 — removed dead Invite button.
                  Was `disabled=true` with "Invite flow lands when backend wires
                  invite tokens" — pure placeholder with no handler. Adds back
                  when POST /admin/campaigns/{slug}/invite lands. */}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CampaignsBody() {
  // Perf Phase 1 · MARK 2 · route_mount_start.
  // MUST be the first line of the render body so it captures wall
  // clock the moment React commits the CampaignsRoute render — this
  // includes lazy-chunk streaming + parse time from the nav_click.
  // Deduped inside navPerf per nav_click t0 so re-renders inside the
  // same click cycle only emit once.
  markRouteMountStart("campaigns");

  const session = useEngineSession();
  const tier = useTierCaps();
  const camps = useCampaigns();
  const mode = useMode();
  useKadeFromSession("campaigns");

  // Perf Phase 1 · MARK 3 · first_contentful_render.
  // Runs once on mount, deferred via requestAnimationFrame so the
  // mark lands AFTER the browser has painted the initial DOM commit.
  // Delta from route_mount_start captures the React render + framer
  // entrance cost. Deduped inside navPerf per nav_click t0.
  useEffect(() => {
    let cancelled = false;
    const raf = window.requestAnimationFrame(() => {
      if (cancelled) return;
      markFirstContentfulRender("campaigns");
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Perf Phase 1 · MARK 4 · interactive_ready.
  // Fires the tick the campaigns data source flips out of "loading"
  // AND the source has resolved to a real value (real-http / real-rpc
  // / mock). Delta from FCR captures /campaigns HTTP fetch + tier-cap
  // hook resolution. Deduped per nav_click t0.
  useEffect(() => {
    if (camps.loading) return;
    markInteractiveReady("campaigns", {
      campaigns_data_source: camps.source,
      campaigns_count: camps.visible.length,
    });
  }, [camps.loading, camps.source, camps.visible.length]);

  // Perf Phase 1 · PerformanceObserver rail · paint + longtask +
  // layout-shift. Attached once per Campaigns mount, detached on
  // unmount so observers don't leak across route swaps. Each entry
  // is emitted as a separate lcDiag event (paint_performance /
  // long_task_performance / layout_shift_performance) so the Railway
  // side can slot them into the same waterfall alongside the four
  // marks. Guarded inside navPerf so older Chromium missing any
  // observer type doesn't kill the rest.
  useEffect(() => {
    const detach = attachRoutePerformanceObservers("campaigns");
    return detach;
  }, []);

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
  // When mock, the customer sees an honest empty clip-job marketplace +
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
      <>
      <div
        className="sim-stage lc-campaigns-stage lc-route-enter"
        data-testid="campaigns-stage"
        data-campaigns-source={camps.source}
        data-campaigns-visible-count={String(camps.visible.length)}
        data-campaigns-featured-count={String(camps.byPlacement.featured.length)}
      >
        {/* PHASE 1 · viewport discipline · CampaignBanner / list lands in
            the first viewport. Source/tier/count tags survive as compact
            status pills; the 80px H1 + sub-copy cut. Agency/clipper
            primary-CTA split is a Phase 5 decision — not in scope here. */}
        <div className="lc-route-head" data-kade-anchor data-route-title={hero.eyebrow}>
          <div className="lc-campaigns-heading">
            {/* Ship-lens Batch 4 (Heading + touch sweep · 2026-07-06) ·
             *  primary route heading now <h1> for screen-reader nav. */}
            <h1 className="lc-route-head-eb">Campaigns</h1>
            <span className="lc-campaigns-heading-copy">
              Browse paid Content Rewards or manage campaigns you own.
            </span>
          </div>
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
              Campaigns could not be loaded. Check your connection and try
              again; nothing shown here is placeholder reward data.
            </span>
            <button
              type="button"
              className="lc-campaigns-retry"
              onClick={() => {
                bus.emit("toast", {
                  kind: "info",
                  title: "Refreshing campaigns",
                  body: "Checking for available Content Rewards.",
                });
                void camps.reload();
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Featured banner · skips when none. */}
        <EngineErrorBoundary route="campaigns" component="CampaignBanner">
          <CampaignBanner
            campaign={featured}
            onOpen={() => {
              if (!featured) return;
              // P0-05 (Claude 1 split · 2026-07-06) · unify campaign
              // ID source · setting mode-store's activeCampaignId lets
              // PublishModule's mint step + campaign-watermark composite
              // both resolve the same campaign without a second lookup.
              setActiveCampaignId(featured.slug);
              setActiveCampaign(featured);
            }}
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
         *  isn't broken by our owned-reward card.
         *
         *  2026-06-26 · C2 · clipper-only · the $50 Sponsored Reward
         *  is paid TO clippers for activation. Agency users don't earn
         *  it (they fund campaigns), so hiding the card in agency mode
         *  removes a mode-mismatch on the Campaigns surface. */}
        {mode === "clipper" && (
          <EngineErrorBoundary route="campaigns" component="SponsoredRewardCard">
            <div
              className="lc-campaigns-sponsored-slot"
              data-testid="sponsored-reward-slot"
              style={{ marginBottom: 16 }}
            >
              <SponsoredRewardCard viewCount={0} />
            </div>
          </EngineErrorBoundary>
        )}

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
                  onOpen={() => {
                    // P0-05 · same unification as the featured-banner
                    // pick above · slug becomes the shared campaign id
                    // across editor + publish + campaign-watermark.
                    setActiveCampaignId(c.slug);
                    setActiveCampaign(c);
                  }}
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
            onClose={() => {
              // P0-05 · clear mode-store when the drawer closes so a
              // subsequent publish doesn't attribute to a campaign the
              // user is no longer looking at.
              setActiveCampaignId(null);
              setActiveCampaign(null);
            }}
          />
        </EngineErrorBoundary>

        {/* Agency creation flow · 8-step drawer · Phase 6N-E v1.
         *
         * LC-UI-P0-001 (2026-06-26) — the prior `canWriteAgency && (...)`
         * gate around the mount silently swallowed every lower-tier click
         * on the "Draft campaign" button: setCreationOpen flipped to true
         * but the drawer never existed in the tree. Per Codex root-cause
         * fix: every tier opens the drawer; publish/launch is the only
         * paywalled commitment, and that gate lives inside the drawer at
         * StepReviewPublish → PaywallGate(requiredTier="agency"). */}
        <EngineErrorBoundary route="campaigns" component="AgencyCreationFlow">
          <AgencyCreationFlow
            open={creationOpen}
            onClose={() => setCreationOpen(false)}
            onPublished={() => void camps.reload()}
          />
        </EngineErrorBoundary>

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
      </div>
      {/* Keep the fixed CTA outside the animated fm.div. A transformed
       * ancestor changes fixed-position containment and caused the button
       * to render under the root hit-test layer after scrolling. */}
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
      </>
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
