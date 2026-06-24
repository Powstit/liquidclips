import { useEffect, useRef } from "react";
import { SideNav } from "./SideNav";
import { TopBar } from "./TopBar";
import { useHashRoute } from "./routes";
import { getSectionById } from "./sectionRegistry";
import { SECTION_IDS } from "./sectionIds";
import { SignalLine } from "../overlays/SignalLine";
import { BrowseRailTab } from "../components/browser";
import { flowTrace } from "../lib/flowTrace";
import { FLOW_IDS } from "../contracts/flowRegistry";
import { atmosphereFor } from "../brand/brandAssets";

const ATMOSPHERE_OPACITY: Record<string, number> = {
  home: 0.18,
  create: 0.18,
  browse: 0.14,
  editor: 0.16,
  projects: 0.14,
  schedule: 0.16,
  channels: 0.16,
  community: 0.12,
  earn: 0.20,
  campaign: 0.18,
  clipper: 0.16,
  settings: 0.10,
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
            <ActiveComponent />
          </section>
        </div>
        <SignalLine />
      </main>
      {/* Persistent right-edge Browser pull-tab. Always-on entry point so
          the Browser feature reads like the old app's right-anchored tab.
          Hidden while the overlay is open. */}
      <BrowseRailTab />
    </div>
  );
}
