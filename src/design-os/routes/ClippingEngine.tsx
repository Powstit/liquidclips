/**
 * ClippingEngineRoute · Phase 6C-Lockdown
 *
 * Adds:
 *   - Empty-state guard (no source / no session → EngineEmptyState)
 *   - EngineActions (Resume / Cancel / Retry / Clear) above the rail
 *   - EngineHealthPanel at the foot of the route
 *   - Per-brick EngineErrorBoundary around StageRail / ResultsGrid /
 *     EngineActions / EngineHealthPanel — a crash in one leaves the rest
 *     of the route usable
 *   - Runtime-honest hero copy: shows "Engine preview" tag in mock mode
 *
 * Still NOT touched: backend / auth / payment / release / Studio.
 */

import { DesignOSAppShell } from "../components/AppShell";
import { EngineErrorBoundary } from "../components/EngineErrorBoundary";
import { motion as fm } from "framer-motion";
import { presets } from "../motion";
import { StageRail } from "../engine/StageRail";
import { ResultsGrid } from "../engine/ResultsGrid";
import { EngineEmptyState } from "../engine/EngineEmptyState";
import { EngineActions } from "../engine/EngineActions";
import { EngineHealthPanel } from "../engine/EngineHealthPanel";
import { useRuntimeInfo } from "../engine/runtimeInfo";
import { useEngineSessionPersistence, selectClipForStudio } from "../state/engineSessionPersistence";
import { EngineSessionProvider, useEngineSession } from "../state/useEngineSession";
import { useKadeFromSession } from "../state/useKadeFromSession";
import { ROUTE_REGISTRY } from "../routing/routeRegistry";
import { ROUTE_HERO } from "../copy/copyMap";
import { bus } from "../bridge";
import "./SimPage.css";

function EngineBody() {
  const session = useEngineSession();
  const runtime = useRuntimeInfo();
  const { resume } = useEngineSessionPersistence();
  useKadeFromSession("engine");

  const hero = ROUTE_HERO["engine"];
  const spec = ROUTE_REGISTRY["engine"];

  // Empty-state guard: no live session AND no resumable session.
  const isEmpty = session.phase === "idle" && !resume;

  const goCreate = () => {
    bus.emit("nav:click", { route: "create" });
  };

  return (
    <DesignOSAppShell
      world="cockpit-home"
      route="engine"
      defaultKade={session.kade}
      kadePlacement={spec.kadePlacement}
    >
      <fm.div
        className="sim-stage"
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
            {runtime.mode === "mock" && (
              <span className="lc-runtime-tag" title="Mock pipeline · real ingest lands when the sidecar runtime is installed.">
                Engine preview
              </span>
            )}
          </fm.span>
          <fm.h1 className="sim-h1" variants={presets.staggerItem}>
            {session.phase === "running"
              ? `Scanning · ${session.stage ?? ""}`
              : session.phase === "complete"
                ? "Found candidates"
                : session.phase === "error"
                  ? "Run hit a snag"
                  : hero.h1}
          </fm.h1>
          <fm.p className="sim-sub" variants={presets.staggerItem}>
            {session.note ?? hero.sub}
          </fm.p>
        </fm.div>

        {isEmpty ? (
          <EngineEmptyState onGoCreate={goCreate} />
        ) : (
          <>
            <EngineErrorBoundary route="engine" component="EngineActions">
              <EngineActions onGoCreate={goCreate} />
            </EngineErrorBoundary>

            <EngineErrorBoundary route="engine" component="StageRail">
              <StageRail />
            </EngineErrorBoundary>

            <EngineErrorBoundary route="engine" component="ResultsGrid">
              {/* Ship-lens Batch 2 (Demo-data purge · 2026-07-06) · was
               *  passing FIXTURE_PROJECT to ResultsGrid even when a real
               *  session was active with no project hydrated yet. Real
               *  bakes never populated the grid because the fixture was
               *  the fallback. Now: session.project when hydrated · a
               *  progress placeholder when a bake is running · nothing
               *  when idle (parent isEmpty branch covers that). */}
              {session.project ? (
                <ResultsGrid
                  project={session.project}
                  onOpenClip={(c) => {
                    selectClipForStudio(c.idx);
                    bus.emit("toast", {
                      kind: "info",
                      title: "Studio",
                      body: `Opening clip · ${c.title}`,
                    });
                    bus.emit("nav:click", { route: "studio" });
                  }}
                />
              ) : (
                <div className="lc-empty-state" style={{ padding: "48px 0", textAlign: "center" }}>
                  {/* Ship-lens Batch 2 P1-BATCH2-001 fix (2026-07-06) ·
                   *  during the race window between `engine:complete`
                   *  dispatching phase='complete' and the async
                   *  hydrate_project dispatch, session.project is briefly
                   *  null while phase says complete. The prior default
                   *  showed "No clips yet" — a lie the user sees right
                   *  after watching their bake finish. Add explicit
                   *  complete branch with hydration language. */}
                  <p className="lc-hud-body">
                    {session.phase === "running"
                      ? "Baking clips… results will appear here as they're ready."
                      : session.phase === "complete"
                        ? "Loading clips from the bake…"
                        : session.phase === "error"
                          ? "The bake hit an error before any clips were produced. Retry from the actions above."
                          : "No clips yet. Start a bake from Create to populate this grid."}
                  </p>
                </div>
              )}
            </EngineErrorBoundary>
          </>
        )}

        <EngineErrorBoundary route="engine" component="EngineHealthPanel">
          <EngineHealthPanel />
        </EngineErrorBoundary>
      </fm.div>
    </DesignOSAppShell>
  );
}

export function ClippingEngineRoute() {
  return (
    <EngineSessionProvider resetOnRouteEnter>
      <EngineBody />
    </EngineSessionProvider>
  );
}
