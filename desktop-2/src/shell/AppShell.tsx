import { useEffect, useRef } from "react";
import { SideNav } from "./SideNav";
import { TopBar } from "./TopBar";
import { useHashRoute } from "./routes";
import { getSectionById } from "./sectionRegistry";
import { SECTION_IDS } from "./sectionIds";
import { SignalLine } from "../overlays/SignalLine";
import { BrowseRailTab } from "../components/browser";
import { InlineCreatePanel } from "../design-os/components/InlineCreatePanel";
import { flowTrace } from "../lib/flowTrace";
import { FLOW_IDS } from "../contracts/flowRegistry";
import { atmosphereFor } from "../brand/brandAssets";
// Ship-lens P1-003 fix (2026-07-10) · single-point Watchdog +
// EngineErrorBoundary coverage for every section shell body. Previously
// only AccountSection wrapped WalletDetail in a Watchdog (and it
// mounted the Watchdog OUTSIDE the block that contains WalletDetail
// itself). Learn, CampaignsSection, and OutreachSection had ZERO
// boundary coverage — a mid-render crash inside CatalogCarousel,
// EmbedPreviewCard, or SyncMailMoneyDrop would take the whole shell
// down. The AppShell wrap is the single-point solution: every route
// mounted through the section registry inherits the same coverage.
import { Watchdog } from "../lib/watchdog";
import { EngineErrorBoundary } from "../design-os/components/EngineErrorBoundary";

// FRAME-11 fix · 2026-07-05 · dropped 7 deprecated route keys (create ·
// schedule · channels · community · earn · clipper · settings) that
// BUG-047 removed from the section registry; added the two live-but-
// unlisted routes (outreach · learn) so those atmospheres don't fall
// through to the 0.16 default.
const ATMOSPHERE_OPACITY: Record<string, number> = {
  home: 0.18,
  browse: 0.14,
  editor: 0.16,
  projects: 0.14,
  campaigns: 0.18,
  outreach: 0.14,
  learn: 0.14,
  account: 0.10,
  diagnostics: 0.10,
  hq: 0.10,
};

export function AppShell() {
  const activeId = useHashRoute();
  const active = getSectionById(activeId);
  const ActiveComponent = active.component;
  const pageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    flowTrace({
      flowId: FLOW_IDS.FLOW_000_APP_SHELL,
      sectionId: activeId,
      actionId: "section.activated",
      status: "ok",
    });
  }, [activeId]);

  // Cursor parallax lerp (writes --cockpit-px / --cockpit-py to lc-page)
  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    let rafId = 0;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;

    const onMove = (e: PointerEvent) => {
      const r = page.getBoundingClientRect();
      if (!r.width || !r.height) return;
      targetX = ((e.clientX - r.left) / r.width) * 2 - 1;
      targetY = ((e.clientY - r.top) / r.height) * 2 - 1;
      if (!rafId) rafId = requestAnimationFrame(tick);
    };

    const tick = () => {
      currentX += (targetX - currentX) * 0.08;
      currentY += (targetY - currentY) * 0.08;
      page.style.setProperty("--cockpit-px", currentX.toFixed(3));
      page.style.setProperty("--cockpit-py", currentY.toFixed(3));
      if (Math.abs(targetX - currentX) > 0.001 || Math.abs(targetY - currentY) > 0.001) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = 0;
      }
    };

    page.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      page.removeEventListener("pointermove", onMove);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  const atmosphere = atmosphereFor(activeId);
  const opacity = ATMOSPHERE_OPACITY[active.route] ?? 0.16;

  // Nav reconcile (2026-06-20): when Home is active, HomeSection mounts
  // SimulatorRouter which renders its own ConsoleNav with the canonical
  // 12-item route map. Showing both rails creates the "5 items here, 12
  // there" confusion. Suppress the outer SideNav inside Home; leave it
  // visible for legacy hash-deep-link sections (Browse / Editor / Projects /
  // Campaigns OUTER) so they remain reachable.
  const hideOuterSideNav = activeId === SECTION_IDS.SECTION_HOME;

  return (
    <div className="lc-shell" data-outer-nav={hideOuterSideNav ? "hidden" : "visible"}>
      <div className="lc-aurora" aria-hidden="true">
        <div className="lc-aurora-blobs" />
      </div>

      {!hideOuterSideNav && <SideNav activeId={activeId} />}

      <main className="lc-page" ref={pageRef}>
        <TopBar section={active} />
        <div className="lc-canvas">
          {atmosphere && (
            <div
              className="lc-deck-atmosphere"
              style={{
                backgroundImage: `url(${atmosphere})`,
                opacity,
              }}
              aria-hidden="true"
            />
          )}
          <section className="lc-section" key={activeId} data-route={active.route} data-active="true">
            {/* Ship-lens P1-003 fix (2026-07-10) · single-point Watchdog +
                EngineErrorBoundary coverage for every section shell body.
                Watchdog registers a node in the HQ Admin node registry
                keyed by the active route so a mid-render crash routes
                the failure through the Sovereign-Operator dispatch bus
                instead of white-screening the shell.
                Node id shape `shell/section/<route>` is grep-safe. */}
            <Watchdog
              id={`shell/section/${active.route}`}
              label={`Section · ${active.label}`}
              cluster="pipeline"
              source={`src/shell/AppShell.tsx:ActiveComponent (route=${active.route})`}
            >
              <EngineErrorBoundary route={active.route} component="Section">
                <ActiveComponent />
              </EngineErrorBoundary>
            </Watchdog>
          </section>
        </div>
        <SignalLine />
      </main>
      {/* Persistent right-edge Browser pull-tab. Always-on entry point so
          the Browser feature reads like the old app's right-anchored tab.
          Hidden while the overlay is open. */}
      <BrowseRailTab />
      {/* 2026-06-25 · global InlineCreatePanel mount. Lifted out of
          CommandRoom so the lc:browse-url-handoff event from BrowseOverlay
          lands in a panel that survives any route — previously the panel
          unmounted with home before its state could commit.
          2026-08-06 · was mounted as a bare sibling with zero crash
          isolation, contradicting this file's own P1-003 invariant
          ("every user-reachable route" wrapped in Watchdog +
          EngineErrorBoundary) — this is the primary drop-file/paste-URL
          ingest surface, reachable from every route. A render-time throw
          here previously had nothing to catch it short of the root
          BootErrorBoundary, which white-screens the ENTIRE app to a
          "Kade hit a snag" card instead of a scoped inline error. */}
      <Watchdog
        id="shell/inline-create-panel"
        label="Inline Create Panel"
        cluster="pipeline"
        source="src/shell/AppShell.tsx:InlineCreatePanel"
      >
        <EngineErrorBoundary route="shell" component="InlineCreatePanel">
          <InlineCreatePanel />
        </EngineErrorBoundary>
      </Watchdog>
    </div>
  );
}
