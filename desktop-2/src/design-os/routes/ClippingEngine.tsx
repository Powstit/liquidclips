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
import { FIXTURE_PROJECT } from "../engine/types";
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
      world="cutting-floor"
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
              <ResultsGrid
                project={FIXTURE_PROJECT}
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
