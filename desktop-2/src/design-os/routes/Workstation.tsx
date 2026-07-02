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
  const { resume } = useEngineSessionPersistence();
  useKadeFromSession("workstation");

  const hero = ROUTE_HERO["workstation"];
  const spec = ROUTE_REGISTRY["workstation"];

  const isEmpty = session.phase === "idle" && !resume;
  // Phase C2 · project hydrated but the bake produced zero usable clips.
  // Treated as an explicit "empty results" surface with a recovery action;
  // never renders leftover focus / editor / inspector chrome from a prior
  // project. Distinct from `isEmpty` (fresh idle) so the recovery copy can
  // acknowledge the failed run.
  const isZeroCandidates =
    !!session.project && (session.project.clips?.length ?? 0) === 0;

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
  // v2.2.18 · scoped-fix step 3 · split "focused" from "opened for
  //   preview / editing." Selecting a clip in the grid must NOT auto-
  //   cover the workspace with the cockpit editor.
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  useEffect(() => {
    if (!session.project) return;
    const n = session.project.clips.length;
    // Phase C2 · zero-candidate recovery. A hydrated project that carries
    // zero clips (bake produced nothing usable, or every clip failed to
    // render) must NOT leave stale focus + inspector + editor state from
    // a previous project. Clear all of them so the empty-results panel
    // owns the surface with a retry action.
    if (n === 0) {
      if (focusedClipIdx !== null) setFocusedClipIdx(null);
      if (inspectorOpen) setInspectorOpen(false);
      if (editorOpen) setEditorOpen(false);
      return;
    }
    // Clamp out-of-range (e.g. a stale persisted idx after a fresh shorter run).
    if (focusedClipIdx == null || focusedClipIdx >= n) {
      setFocusedClipIdx(0);
      selectClipForStudio(0);
    }
  }, [session.project, focusedClipIdx, inspectorOpen, editorOpen]);
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
      // BUG-010 · once clips are ready, the persistent helper-right Kade
      // overlaps the inspector panel and competes with the user's actual
      // content. Hide the sticky Kade on complete so the clip grid +
      // inspector own the viewport. Kade is still present DURING the run
      // (via KadeIgnition) and on the empty / running states.
      hideStickyKade={session.phase === "complete"}
    >
      <fm.div
        className="sim-stage lc-ws-stage"
        variants={presets.routeEnter}
        initial="initial"
        animate="animate"
      >
      {/* Checkpoint item 2 · semantic route-title. The visible duplicate
          header stays removed (the WorkstationFrame titlebar carries the
          visible project name), but brand-consistency.spec.ts still
          requires ONE h1 inside .lc-main OR a [data-route-title] node
          per route. Visually-hidden h1 satisfies both without
          reintroducing the crushed duplicate UI. */}
      <h1
        className="lc-visually-hidden"
        data-route-title="Workstation"
      >
        Workstation
      </h1>
      <WorkstationFrame
        projectName={chromeProjectName}
        sourceLabel={chromeSourceLabel}
        clipCount={chromeClipCount}
        selectedCount={selectedCount}
        readyCount={chromeReadyCount}
        sessionStatus={chromeSessionStatus}
        sessionStage={chromeSessionStage}
      >
        {/* v2.2.18 sprint · action strip retired. The WorkstationFrame
            status strip already carries the phase (via sessionStatus +
            sessionStage props). Phase pill kept as a hidden marker for
            visual/e2e locator stability; EngineActions render into the
            titlebar-right slot via portal (see WorkstationFrame). */}
        <span
          className="lc-runtime-tag lc-visually-hidden"
          data-testid="ws-phase-pill"
        >
          {session.phase === "running"
            ? `Scanning · ${session.stage ?? ""}`
            : session.phase === "complete"
              ? "Clips ready"
              : session.phase === "error"
                ? "Run hit a snag"
                : hero.h1}
        </span>
        <EngineErrorBoundary route="workstation" component="EngineActions">
          <EngineActions onGoCreate={openCreatePanel} />
        </EngineErrorBoundary>

        {isEmpty ? (
          <EngineEmptyState onGoCreate={openCreatePanel} />
        ) : isZeroCandidates ? (
          <div
            className="lc-ws-zero"
            role="status"
            data-testid="ws-zero-candidates"
          >
            <div className="lc-ws-zero-eb">Run finished · zero clips</div>
            <div className="lc-ws-zero-title">
              The engine finished but produced no usable clips.
            </div>
            <p className="lc-ws-zero-note">
              This can happen when the source is too short, silent, or when
              every candidate failed to render. Try another source.
            </p>
            <div className="lc-ws-zero-cta">
              {/* Checkpoint item 4 · honest label. The desktop-2 shell
                  does not yet have a "re-run the same saved source"
                  RPC path — the recovery here opens the create panel
                  so the user drops a fresh source. Label reflects that.
                  When the sidecar exposes a `sidecar.retryLastRun`
                  contract, this button can flip to a genuine retry
                  event; until then the copy tells the truth. */}
              <button
                type="button"
                className="lc-ws-zero-btn is-primary"
                data-testid="ws-zero-retry"
                onClick={openCreatePanel}
              >
                Try another source
              </button>
            </div>
          </div>
        ) : (
          <div
            className="lc-ws-body"
            data-testid="ws-split-workbench"
            data-inspector={inspectorOpen && focusedClip ? "1" : "0"}
          >
            <div className="lc-ws-body-main">
              {/* Kade brought back per Daniel's ask — transient pre-scan
                  float. Self-clears once clipsReady > 0. */}
              <EngineErrorBoundary route="workstation" component="KadeIgnition">
                <KadeIgnition />
              </EngineErrorBoundary>

              {/* BUG-007 · StageRail is a running-phase progress surface.
                  When phase === "complete", the rail's seven "Complete"
                  pills consume the full main-column height above
                  ResultsGrid, hiding the user's actual clips below the
                  fold. Dismiss the rail on complete; KadeIgnition already
                  follows the same dismiss-on-clipsReady pattern. The
                  heartbeat-done strip below carries the "Clips ready"
                  message so no signal is lost. */}
              {session.phase !== "complete" && (
                <EngineErrorBoundary route="workstation" component="StageRail">
                  <StageRail />
                </EngineErrorBoundary>
              )}

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
            {/* v2.2.18 sprint · post-complete heartbeat retired — the
                WorkstationFrame status strip already reads "N/M clips
                ready" so the horizontal strip below was pure duplication
                (see problem #2). Kept only the RUNNING and ERROR strips. */}
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

              <EngineErrorBoundary route="workstation" component="ResultsGrid">
                <ResultsGrid
                  project={session.project}
                  pendingCount={Math.max(session.clipsReady, session.clipsTotal ?? 0)}
                  onSelectionChange={setSelectedCount}
                  onOpenClip={(c) => {
                    // v2.2.18 scoped-fix step 3 · picking a clip opens
                    //   the PREVIEW drawer, not the editor. Only the
                    //   "Edit clip" button inside the drawer promotes
                    //   focus to the cockpit editor.
                    setFocusedClipIdx(c.idx);
                    selectClipForStudio(c.idx);
                    setInspectorOpen(true);
                    setEditorOpen(false);
                    bus.emit("toast", {
                      kind: "info",
                      title: "Preview",
                      body: `Selected · ${c.title}`,
                    });
                  }}
                />
              </EngineErrorBoundary>
            </div>
            {inspectorOpen && focusedClip && (
              <aside
                className="lc-ws-body-inspector"
                data-testid="ws-inspector"
                data-has-clip="1"
              >
                <header className="lc-ws-inspector-head">
                  <span className="lc-ws-inspector-eb">Inspector</span>
                  <button
                    type="button"
                    className="lc-ws-inspector-close"
                    aria-label="Close preview"
                    onClick={() => {
                      setInspectorOpen(false);
                      setEditorOpen(false);
                    }}
                  >
                    ×
                  </button>
                </header>
                {/* IRON GATE IG-LC2-016 preserved · ClipPreviewShell
                    mounts iff focusedClip truthy. */}
                <EngineErrorBoundary route="workstation" component="ClipPreviewShell">
                  <ClipPreviewShell clip={focusedClip} />
                </EngineErrorBoundary>
                {/* v2.2.18 · Edit / Schedule / Export promote the
                    selection to full editor. Selecting a clip alone
                    NEVER opens the dock. */}
                <div className="lc-ws-inspector-cta">
                  <button
                    type="button"
                    className="lc-ws-inspector-btn is-primary"
                    onClick={() => setEditorOpen(true)}
                  >
                    Edit clip
                  </button>
                  <button
                    type="button"
                    className="lc-ws-inspector-btn"
                    onClick={() => setEditorOpen(true)}
                    title="Open editor · Schedule tab"
                  >
                    Schedule
                  </button>
                  <button
                    type="button"
                    className="lc-ws-inspector-btn"
                    onClick={() => setEditorOpen(true)}
                    title="Open editor · Export tab"
                  >
                    Export
                  </button>
                </div>
                <details className="lc-ws-diagnostics">
                  <summary className="lc-ws-diagnostics-summary">Diagnostics</summary>
                  <EngineErrorBoundary route="workstation" component="EngineHealthPanel">
                    <EngineHealthPanel />
                  </EngineErrorBoundary>
                </details>
              </aside>
            )}
          </div>
        )}
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
      {/* v2.2.18 scoped-fix step 3 · dock mount requires BOTH a focused
          clip AND an explicit editor-open intent from the user. Merely
          selecting a clip no longer covers the workspace with the
          cockpit. IG-LC2-017 unchanged (focusedClip still required). */}
      {focusedClip && editorOpen && <CockpitDock />}
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
