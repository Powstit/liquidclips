/**
 * TimelineStudioRoute · Phase 6D real-route start
 *
 * Wires:
 *   - EngineSessionProvider — picks up bus events
 *   - useKadeFromSession — drives StickyKade per session pose
 *   - Engine→Studio handoff via engineSessionPersistence.selectedClipIdx
 *   - 6 studio bricks each wrapped in EngineErrorBoundary
 *   - Empty state with "Open Clipping Engine" CTA when no clip selected
 *
 * Still NOT touched: backend / auth / payment / release / Thumbnail Studio.
 */

import { useEffect, useState } from "react";
import { motion as fm } from "framer-motion";
import { DesignOSAppShell } from "../components/AppShell";
import { EngineErrorBoundary } from "../components/EngineErrorBoundary";
import { presets } from "../motion";
import {
  ClipPreviewShell,
  CaptionDrawer,
  ReactionControls,
  OverlayTemplateGallery,
  StudioTimelineRail,
  ExportPanel,
} from "../studio";
import { useRuntimeInfo } from "../engine/runtimeInfo";
import {
  readPersistedSession,
  selectClipForStudio,
  useEngineSessionPersistence,
} from "../state/engineSessionPersistence";
import type { Clip } from "../engine/types";
import { EngineSessionProvider, useEngineSession } from "../state/useEngineSession";
import { useKadeFromSession } from "../state/useKadeFromSession";
import { ROUTE_REGISTRY } from "../routing/routeRegistry";
import { bus, useEvent } from "../bridge";
import "./TimelineStudio.css";
import "./SimPage.css";

function StudioBody() {
  const session = useEngineSession();
  const runtime = useRuntimeInfo();
  useEngineSessionPersistence();
  useKadeFromSession("studio");

  const spec = ROUTE_REGISTRY["studio"];
  // 2026-07-14 · Stable-id focus refactor · prefer selectedClipId, fall
  // back to selectedClipIdx only for legacy snapshots. See ExportRoute
  // migration comment for the full rationale.
  const [selectedClipId, setSelectedClipId] = useState<string | null>(() => {
    const p = readPersistedSession();
    return typeof p?.selectedClipId === "string" && p.selectedClipId ? p.selectedClipId : null;
  });
  const [legacySelectedClipIdx, setLegacySelectedClipIdx] = useState<number | null>(() => {
    const p = readPersistedSession();
    return typeof p?.selectedClipIdx === "number" ? p.selectedClipIdx : null;
  });
  const [captionsOpen, setCaptionsOpen] = useState(false);

  // Listen for late persistence updates (e.g. nav from Engine after route mounts)
  useEvent("route:enter", (p) => {
    if (p.route !== "studio") return;
    const s = readPersistedSession();
    if (typeof s?.selectedClipId === "string" && s.selectedClipId) setSelectedClipId(s.selectedClipId);
    if (typeof s?.selectedClipIdx === "number") setLegacySelectedClipIdx(s.selectedClipIdx);
  });
  // Also poll once on mount in case persistence was set before route entered
  useEffect(() => {
    const s = readPersistedSession();
    if (typeof s?.selectedClipId === "string" && s.selectedClipId && s.selectedClipId !== selectedClipId) {
      setSelectedClipId(s.selectedClipId);
    }
    if (typeof s?.selectedClipIdx === "number" && s.selectedClipIdx !== legacySelectedClipIdx) {
      setLegacySelectedClipIdx(s.selectedClipIdx);
    }
  }, []);

  // ───── IRON GATE IG-LC2-016 — see docs/lc2/IRON_GATES_LC2.md ─────
  // Resolve the clip from the LIVE session.project — never FIXTURE_PROJECT.
  // Workstation is the primary editor; this route exists for the timeline
  // surface but MUST share the same single source of truth. If
  // session.project is absent, the empty state fires and the user is sent
  // back to Workstation. See BUG-028.
  const clip: Clip | null = selectedClipId != null
    ? session.project?.clips.find((c) => c.id === selectedClipId) ?? null
    : legacySelectedClipIdx != null
      ? session.project?.clips.find((c) => c.idx === legacySelectedClipIdx) ?? null
      : null;
  // ───── END IRON GATE IG-LC2-016 (TimelineStudio resolution) ─────

  // Caption markers (mock — distribute a few across the clip duration)
  const captionMarkers = clip
    ? [4, 18, 32, 46].filter((s) => s < (clip.end - clip.start))
    : [];

  const goEngine = () => bus.emit("nav:click", { route: "engine" });
  const onClearStudio = () => {
    selectClipForStudio(null);
    setSelectedClipId(null);
    setLegacySelectedClipIdx(null);
    bus.emit("toast", {
      kind: "info",
      title: "Studio",
      body: "Cleared selection · open another clip from Engine.",
    });
  };

  return (
    <DesignOSAppShell
      world="cockpit-home"
      route="studio"
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
            Studio deck
            {runtime.mode === "mock" && (
              <span className="lc-runtime-tag" title="Mock pipeline · real bake lands when the sidecar runtime is installed.">
                Studio preview
              </span>
            )}
          </fm.span>
          <fm.h1 className="sim-h1" variants={presets.staggerItem}>
            {clip ? "Trim · caption · layout · export" : "Pick a candidate to begin"}
          </fm.h1>
          <fm.p className="sim-sub" variants={presets.staggerItem}>
            {clip
              ? "Same workspace · four engines. All previews stay local until the runtime lands."
              : "Open Clipping Engine, choose a clip, and Studio takes it from there."}
          </fm.p>
        </fm.div>

        {/* Toolbar · captions + clear */}
        {clip && (
          <div className="lc-studio-toolbar">
            <button
              type="button"
              className="lc-studio-tool-btn"
              onClick={() => setCaptionsOpen(true)}
              aria-pressed={captionsOpen}
            >
              <span className="lc-studio-tool-eb">Open</span>
              <span>Caption drawer</span>
            </button>
            <button
              type="button"
              className="lc-studio-tool-btn lc-studio-tool-btn-quiet"
              onClick={onClearStudio}
            >
              <span className="lc-studio-tool-eb">Clear</span>
              <span>Studio selection</span>
            </button>
          </div>
        )}

        {/* MAIN GRID — preview + (panels right) */}
        <EngineErrorBoundary route="studio" component="ClipPreviewShell">
          <ClipPreviewShell clip={clip} onGoEngine={goEngine} />
        </EngineErrorBoundary>

        {clip && (
          <>
            <EngineErrorBoundary route="studio" component="StudioTimelineRail">
              <StudioTimelineRail clip={clip} captionMarkers={captionMarkers} />
            </EngineErrorBoundary>

            <div className="lc-studio-bottom">
              <EngineErrorBoundary route="studio" component="ReactionControls">
                <ReactionControls />
              </EngineErrorBoundary>

              <EngineErrorBoundary route="studio" component="OverlayTemplateGallery">
                <OverlayTemplateGallery />
              </EngineErrorBoundary>

              <EngineErrorBoundary route="studio" component="ExportPanel">
                <ExportPanel clip={clip} />
              </EngineErrorBoundary>
            </div>

            <EngineErrorBoundary route="studio" component="CaptionDrawer">
              <CaptionDrawer
                open={captionsOpen}
                onClose={() => setCaptionsOpen(false)}
              />
            </EngineErrorBoundary>
          </>
        )}
      </fm.div>
    </DesignOSAppShell>
  );
}

export function TimelineStudioRoute() {
  return (
    <EngineSessionProvider resetOnRouteEnter>
      <StudioBody />
    </EngineSessionProvider>
  );
}
