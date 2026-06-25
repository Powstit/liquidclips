/**
 * Workstation · UI-1 unified screen
 *
 * Replaces the four-route engine maze (engine → studio → export → schedule)
 * with one screen. The clip grid, stage rail, engine actions and health panel
 * already work as one body — they get rendered here under the `workstation`
 * route id with a BottomCockpit shell placeholder pinned at the bottom for
 * UI-2 to dock the Reaction / Caption / Trim / Style / Schedule modules into.
 *
 * No new RPC. No engine logic changes. Pure surface rewire.
 *
 * Iron Gate IG-002 (sidecar contract) untouched.
 */

import { useEffect, useMemo, useState } from "react";
import { DesignOSAppShell } from "../components/AppShell";
import { EngineErrorBoundary } from "../components/EngineErrorBoundary";
import { CockpitDock } from "../engine/cockpit/CockpitDock";
import { CockpitProvider } from "../engine/cockpit/CockpitContext";
import { FIXTURE_PROJECT } from "../engine/types";
import { SubmitToWhopModal } from "../components/SubmitToWhopModal";
import { WorkstationFrame } from "../components/WorkstationFrame";
import { motion as fm } from "framer-motion";
import { presets } from "../motion";
import { StageRail } from "../engine/StageRail";
import { ResultsGrid } from "../engine/ResultsGrid";
import { EngineEmptyState } from "../engine/EngineEmptyState";
import { EngineActions } from "../engine/EngineActions";
import { EngineHealthPanel } from "../engine/EngineHealthPanel";
import { ClipPreviewShell } from "../studio";
import { attachEngineSfx } from "../sfx/engineSfx";
import { KadeIgnition } from "../components/KadeIgnition";
import { useRuntimeInfo } from "../engine/runtimeInfo";
import { useEngineSessionPersistence, selectClipForStudio } from "../state/engineSessionPersistence";
import { EngineSessionProvider, useEngineSession } from "../state/useEngineSession";
import { useKadeFromSession } from "../state/useKadeFromSession";
import { ROUTE_REGISTRY } from "../routing/routeRegistry";
import { ROUTE_HERO } from "../copy/copyMap";
import { bus } from "../bridge";
import "./SimPage.css";
import "./Workstation.css";

function WorkstationBody() {
  const session = useEngineSession();
  const runtime = useRuntimeInfo();
  const { resume } = useEngineSessionPersistence();
  useKadeFromSession("workstation");

  const hero = ROUTE_HERO["workstation"];
  const spec = ROUTE_REGISTRY["workstation"];

  const isEmpty = session.phase === "idle" && !resume;

  // Item 3 — lifted selection count for the WorkstationFrame title bar.
  // ResultsGrid owns the multi-select Set locally and pushes the size up
  // via onSelectionChange. Zero on the empty stage (no grid mounted).
  const [selectedCount, setSelectedCount] = useState(0);

  // BUG-026 · CockpitDock focused-clip wiring.
  // ResultsGrid's onOpenClip writes selectedClipIdx into the persisted
  // session, but CockpitDock was mounted without a focusedClip prop so
  // it fell back to FIXTURE_PROJECT.clips[0]. Hold the focus locally so
  // we can both react to grid clicks and auto-pick clip[0] the moment
  // session.project hydrates (so the editor never shows fixture state
  // once real clips exist). Persistence is best-effort write so a route
  // remount still resumes at the last focus.
  const [focusedClipIdx, setFocusedClipIdx] = useState<number | null>(
    typeof resume?.selectedClipIdx === "number" ? resume.selectedClipIdx : null,
  );
  useEffect(() => {
    const n = session.project?.clips.length ?? 0;
    if (n === 0) return;
    // Clamp out-of-range (e.g. a stale persisted idx after a fresh shorter run).
    if (focusedClipIdx == null || focusedClipIdx >= n) {
      setFocusedClipIdx(0);
      selectClipForStudio(0);
    }
  }, [session.project, focusedClipIdx]);
  // ───── IRON GATE IG-LC2-016 — see docs/lc2/IRON_GATES_LC2.md ─────
  // focusedClip is resolved from LIVE session.project.clips. Never from
  // FIXTURE_PROJECT. CockpitDock + ClipPreviewShell read this same value
  // so the editor is one source of truth. See BUG-028.
  const focusedClip = session.project && focusedClipIdx != null
    ? session.project.clips[focusedClipIdx]
    : undefined;
  // ───── END IRON GATE IG-LC2-016 (focusedClip resolution) ─────

  // Tick once per second so derived `Date.now() - lastEventAt` stays fresh
  // (drives "Still working…" copy + elapsed pill). Cheap; only mounts when
  // a run is in flight.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (session.phase !== "running") return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [session.phase]);

  // BUG-029.1 · sound feedback on engine milestones (start / batch
  // complete / export complete-or-error). Mounted once per Workstation
  // entry; cleans up on unmount. Listens to existing bus events only —
  // no engine changes.
  useEffect(() => attachEngineSfx(), []);

  // BUG-023 · resume hydration. After a reload, the persisted session
  // carries the slug of the last run but the in-memory session reducer
  // is back at IDLE. Re-fire engine:complete{kind:"bake"} so the existing
  // hydration handler in useEngineSession picks up project.json — without
  // this, the grid would be empty after a reload while it was showing
  // fixture clips pre-fix.
  useEffect(() => {
    if (!resume?.slug) return;
    if (resume.status !== "complete") return;
    if (session.project) return;
    // BUG-032 P0 harness · causal-proof fix · the engine session provider's
    // useEvent("engine:complete") listener attaches in a PARENT useEffect,
    // while this child useEffect runs BEFORE the parent's. Emitting
    // synchronously from this commit cycle would land before the listener
    // is wired — the event is dropped and `session.project` never hydrates
    // on resume. The harness caught this directly: pre-fix, the Workstation
    // shows "Generating clips…" forever on reload of a previously-complete
    // session. setTimeout(..., 0) defers the emit to the next macrotask
    // after all useEffect commits run, which guarantees every useEvent
    // subscription is attached before the bake-complete fires.
    const t = window.setTimeout(() => {
      bus.emit("engine:complete", { kind: "bake", slug: resume.slug });
    }, 0);
    return () => window.clearTimeout(t);
  }, [resume?.slug, resume?.status, session.project]);

  // BUG-023 · chrome counters now read the live engine session.
  // While running: clipsReady advances as sidecar reports `segments_done`;
  // clipsTotal comes from the first stage_progress payload that includes
  // a target N. After bake_complete: session.project is hydrated via the
  // get_project RPC, so counts switch to ground-truth project.json data.
  const chromeClipCount = isEmpty
    ? 0
    : session.project?.clips.length ?? session.clipsTotal ?? 0;
  const chromeReadyCount = useMemo(() => {
    if (isEmpty) return 0;
    if (session.project) {
      // Post-bake: count clips that actually have a vertical render landed.
      return session.project.clips.filter((c) => !!c.vertical_path).length;
    }
    // Mid-render: advance from sidecar's segments_done counter.
    return session.clipsReady;
  }, [isEmpty, session.project, session.clipsReady]);
  const chromeProjectName = isEmpty
    ? "no session"
    : session.project?.name ?? "Generating clips…";
  const chromeSourceLabel = isEmpty
    ? null
    : (session.project?.source_url ?? session.project?.source_path ?? session.url ?? null);
  const chromeSessionStatus = session.phase;
  const chromeSessionStage = session.stage;

  // "Still working…" surface — fires after 30s of silence from sidecar
  // during an active run. Sidecar doesn't emit a per-clip heartbeat during
  // the long ffmpeg encodes (BUG-023 sidecar gap), so this client-side
  // ticker keeps the surface honest even when the channel goes quiet.
  const elapsedSecs = session.startedAt
    ? Math.max(0, Math.floor((Date.now() - session.startedAt) / 1000))
    : 0;
  const silentSecs = session.lastEventAt
    ? Math.max(0, Math.floor((Date.now() - session.lastEventAt) / 1000))
    : 0;
  const stillWorking = session.phase === "running" && silentSecs >= 30;

  const openCreatePanel = () => {
    // UI-1 · home tile opens panel; from workstation, route home then open.
    bus.emit("nav:click", { route: "home" });
    window.setTimeout(() => bus.emit("home:open-panel", { tab: "url" }), 60);
  };

  // BUG-032 P0 · slug is the persistence namespace for the lifted
  // CockpitProvider (was previously pulled inside CockpitDock). Empty
  // string falls back to no-op storage so the provider still mounts
  // cleanly when the session hasn't bound a project yet.
  const slug = session.project?.slug ?? session.slug ?? undefined;

  // ───── IRON GATE IG-LC2-018 — see BUG-032 P0 AFTER FIX (harness) ─────
  // CockpitProvider is mounted ONCE, ALWAYS. The clip passed in is the
  // focused clip when one exists; otherwise FIXTURE_PROJECT.clips[0] is
  // used as a stable structural placeholder so the provider's identity
  // (and therefore React's reconciliation of every child below it) does
  // not change when `focusedClip` toggles. The harness caught the
  // alternative (conditional wrap) causing a route:enter → reset loop:
  // each toggle of focusedClip remounted DesignOSAppShell, which re-emitted
  // route:enter, which reset the engine session, which set focusedClip
  // back to undefined, which remounted again. Real consumers (CockpitDock,
  // ClipPreviewShell) still gate their own visible behaviour on
  // `focusedClip` truthy so the fixture-clip provider never reaches
  // user pixels.
  const providerClip = focusedClip ?? FIXTURE_PROJECT.clips[0];

  return (
    <CockpitProvider clip={providerClip} slug={slug}>
    <DesignOSAppShell
      world="cockpit-home"
      route="workstation"
      defaultKade={session.kade}
      kadePlacement={spec.kadePlacement}
    >
      <fm.div
        className="sim-stage lc-ws-stage"
        variants={presets.routeEnter}
        initial="initial"
        animate="animate"
      >
      <WorkstationFrame
        projectName={chromeProjectName}
        sourceLabel={chromeSourceLabel}
        clipCount={chromeClipCount}
        selectedCount={selectedCount}
        readyCount={chromeReadyCount}
        sessionStatus={chromeSessionStatus}
        sessionStage={chromeSessionStage}
      >
        {/* PHASE 1 · viewport discipline · the 80px H1 + sub-copy hero
            was a landing-page block on a tool route. Identity already
            lives in TopHud + ConsoleNav. State-dependent phrasing
            (scanning / clips ready / error) survives as a compact status
            pill — same info, ~140px less vertical real estate, clip
            grid + actions now land in the first viewport. */}
        <div className="lc-route-head" data-kade-anchor>
          <span className="lc-route-head-eb">{hero.eyebrow}</span>
          <div className="lc-route-head-pills">
            <span className="lc-runtime-tag" data-testid="ws-phase-pill">
              {session.phase === "running"
                ? `Scanning · ${session.stage ?? ""}`
                : session.phase === "complete"
                  ? "Clips ready"
                  : session.phase === "error"
                    ? "Run hit a snag"
                    : hero.h1}
            </span>
            {runtime.mode === "mock" && import.meta.env.DEV && (
              <span className="lc-runtime-tag" title="Mock pipeline · real ingest lands when the sidecar runtime is installed.">
                Preview
              </span>
            )}
          </div>
        </div>

        {isEmpty ? (
          <EngineEmptyState onGoCreate={openCreatePanel} />
        ) : (
          <>
            <EngineErrorBoundary route="workstation" component="EngineActions">
              <EngineActions onGoCreate={openCreatePanel} />
            </EngineErrorBoundary>

            {/* BUG-029.6 · Kade ignition — big 3D-float loading state
                immediately after Analyze & Clip. Auto-clears the moment
                the first generated clip lands (clipsReady > 0) so the
                ResultsGrid + ClipPreviewShell take over without
                competing for the user's eye. */}
            <EngineErrorBoundary route="workstation" component="KadeIgnition">
              <KadeIgnition />
            </EngineErrorBoundary>

            <EngineErrorBoundary route="workstation" component="StageRail">
              <StageRail />
            </EngineErrorBoundary>

            {/* BUG-023 · live heartbeat strip — positioned ABOVE the grid so
                it stays above the cockpit dock fold. */}
            {session.phase === "running" && (
              <div className="lc-engine-heartbeat" role="status" aria-live="polite">
                <span className="lc-engine-heartbeat-eb">
                  {stillWorking ? "Still working…" : "Generating clips…"}
                </span>
                <span className="lc-engine-heartbeat-meta">
                  {formatElapsed(elapsedSecs)}
                  {session.clipsReady > 0 && (
                    <> · {session.clipsReady}{session.clipsTotal != null ? ` of ${session.clipsTotal}` : ""} ready</>
                  )}
                  {stillWorking && silentSecs >= 30 && (
                    <> · last update {silentSecs}s ago</>
                  )}
                </span>
              </div>
            )}
            {session.phase === "complete" && (
              <div className="lc-engine-heartbeat lc-engine-heartbeat-done" role="status">
                <span className="lc-engine-heartbeat-eb">Clips ready</span>
                <span className="lc-engine-heartbeat-meta">
                  {chromeReadyCount} of {chromeClipCount} rendered{elapsedSecs > 0 ? ` in ${formatElapsed(elapsedSecs)}` : ""}
                </span>
              </div>
            )}
            {session.phase === "error" && session.error && (
              <div className="lc-engine-heartbeat lc-engine-heartbeat-error" role="alert">
                <span className="lc-engine-heartbeat-eb">
                  Stalled at {session.stage ?? "engine"}
                </span>
                <span className="lc-engine-heartbeat-meta">
                  {session.error.human ?? session.error.message}
                </span>
              </div>
            )}

            {/* ───── IRON GATE IG-LC2-016 — see docs/lc2/IRON_GATES_LC2.md ─────
                Workstation IS the editor. ClipPreviewShell mounts here
                directly, fed by `focusedClip` resolved from
                session.project.clips (NOT FIXTURE_PROJECT). When
                session.project exists, fixture-sourced clips in the editor
                are forbidden. See BUG-028. */}
            {focusedClip && (
              <EngineErrorBoundary route="workstation" component="ClipPreviewShell">
                <ClipPreviewShell clip={focusedClip} />
              </EngineErrorBoundary>
            )}
            {/* ───── END IRON GATE IG-LC2-016 (mount site) ───── */}

            <EngineErrorBoundary route="workstation" component="ResultsGrid">
              <ResultsGrid
                project={session.project}
                pendingCount={Math.max(session.clipsReady, session.clipsTotal ?? 0)}
                onSelectionChange={setSelectedCount}
                onOpenClip={(c) => {
                  setFocusedClipIdx(c.idx);
                  selectClipForStudio(c.idx);
                  bus.emit("toast", {
                    kind: "info",
                    title: "Selected",
                    body: `Focused clip · ${c.title}`,
                  });
                }}
              />
            </EngineErrorBoundary>
          </>
        )}

        <EngineErrorBoundary route="workstation" component="EngineHealthPanel">
          <EngineHealthPanel />
        </EngineErrorBoundary>
      </WorkstationFrame>
      </fm.div>

      {/* ───── IRON GATE IG-LC2-017 — see docs/lc2/IRON_GATES_LC2.md ─────
          CockpitDock + ClipPreviewShell read the SAME `focusedClip`
          reference so the dock controls and the preview cannot drift
          onto different clips. After the BUG-032 P0 lift, they read the
          SAME `useCockpit()` value (provider wraps both children of this
          component) — the gate hardens because there is now no way for
          dock and preview to fall onto different clip contexts. The
          dock is gated on `focusedClip` truthy too — without a clip
          there is no provider above it, so mounting the dock would
          violate `useCockpit()`'s require-provider contract. See
          BUG-028 AFTER FIX and BUG-032 P0 AFTER FIX (harness caught the
          missing gate). */}
      {focusedClip && <CockpitDock />}
      {/* ───── END IRON GATE IG-LC2-017 (dock focusedClip prop) ───── */}

      {/* UI-3 · listens for `clip:open-submit` from ClipCards; portaled. */}
      <SubmitToWhopModal />
    </DesignOSAppShell>
    </CockpitProvider>
  );
}
// ───── END IRON GATE IG-LC2-018 (lifted provider, stable mount) ─────

export function WorkstationRoute() {
  return (
    <EngineSessionProvider resetOnRouteEnter>
      <WorkstationBody />
    </EngineSessionProvider>
  );
}

function formatElapsed(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}
