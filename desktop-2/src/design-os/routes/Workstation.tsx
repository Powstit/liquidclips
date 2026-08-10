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

import { useEffect, useMemo, useRef, useState } from "react";
import { DesignOSAppShell } from "../components/AppShell";
import { EngineErrorBoundary } from "../components/EngineErrorBoundary";
import { CockpitDock, type ModuleKey } from "../engine/cockpit/CockpitDock";
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
import { useEngineSessionPersistence, selectClipForStudioById, clearPersistedSession } from "../state/engineSessionPersistence";
import { humanErrorToast, describeError } from "../errors/customerSafeErrors";
import { EngineSessionProvider, useEngineSession } from "../state/useEngineSession";
import { useKadeFromSession } from "../state/useKadeFromSession";
import { ROUTE_REGISTRY } from "../routing/routeRegistry";
import { ROUTE_HERO } from "../copy/copyMap";
import { bus, useEvent } from "../bridge";
// Watchdog Rollout · cp-01 (2026-07-06) · wraps the Workstation route so
// a crash inside the clip grid / stage rail / cockpit renders
// KadeRepairScreen instead of the black-canvas silent-empty bug that
// Claude 2 flagged. See docs/PROTOCOL_SELF_HEALING_NODES.md.
import { Watchdog } from "../../lib/watchdog";
import "./SimPage.css";
import "./Workstation.css";

function WorkstationBody() {
  const session = useEngineSession();
  const { resume } = useEngineSessionPersistence();
  useKadeFromSession("workstation");

  const hero = ROUTE_HERO["workstation"];
  const spec = ROUTE_REGISTRY["workstation"];

  const isEmpty = session.phase === "idle" && !resume;
  // 2026-08-08 · `resume` is read synchronously from localStorage at mount
  // (readPersistedSession), so it's truthy on the very first render —
  // before the actual project re-hydrates from the sidecar (async RPC,
  // "clip data... comes back from sidecar on resume"). In that gap,
  // `isEmpty` is already false (resume is truthy) but `session.project`
  // is still null, so the "real content" branch below renders with
  // nothing to show yet — StageRail/ResultsGrid effectively empty.
  // Reported live as the whole route going blank for a moment on
  // navigation, self-resolving once hydration lands. This makes that gap
  // an explicit, visible state instead of an implicit empty render.
  const isRestoring = !isEmpty && !session.project && session.phase === "idle";

  // 2026-08-09 · isRestoring was documented above as a "self-resolving"
  // gap, but there was no actual guarantee of that — if the persisted
  // slug's project never hydrates (stale localStorage pointing at a
  // project that moved/vanished, a dropped RPC, whatever), the user was
  // stuck on bare "Restoring your session…" text forever with no way
  // out. Reported live: user landed here with nothing queued and no
  // path back to Create Clips. Give the restore a few seconds, then
  // offer an explicit escape hatch instead of trusting it to resolve.
  const [restoreStalled, setRestoreStalled] = useState(false);
  useEffect(() => {
    if (!isRestoring) {
      setRestoreStalled(false);
      return;
    }
    const t = window.setTimeout(() => setRestoreStalled(true), 4000);
    return () => window.clearTimeout(t);
  }, [isRestoring]);

  // 2026-08-07 · removed the full-page "Run finished · zero clips" /
  // stage-crash takeovers that used to render here instead of the grid.
  // The zero-clips one fired constantly mid-run (any hydrated project
  // with clips still empty — true for every run before the llm stage
  // lands — tripped it), and the crash one swapped out the whole
  // card grid/StageRail for a blocking panel — both read as the view
  // randomly switching away from the cards (reported live: "between
  // ingest and audio, or before transcribe, it always brings a new
  // page with an error message"). ResultsGrid's own inline
  // `zeroClipsAfterRun` note (gated on the run actually being
  // finished via the new `isRunning` prop, not just "no clips yet")
  // now carries the honest-empty case without leaving the grid/
  // StageRail chrome. A genuine stage crash (non-"clip_plan_empty"
  // error — e.g. the hosted LLM provider rejecting the request) fires
  // a toast instead, below.
  const isRealStageCrash =
    session.phase === "error"
    && !!session.error?.message
    && session.error.message !== "clip_plan_empty"
    && session.error?.code !== "clip_plan_empty";
  const crashToastFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isRealStageCrash) {
      crashToastFiredRef.current = null;
      return;
    }
    const key = session.error?.message ?? "";
    if (crashToastFiredRef.current === key) return;
    crashToastFiredRef.current = key;
    // 2026-08-07 · route through the existing customer-safe classifier
    // instead of showing the raw thrown string (which for a provider
    // error is a technical HTTP-status-plus-JSON blob) — humanErrorToast
    // also stashes the real technical detail on the diagnostic ring for
    // "Copy diagnostics" / support, so nothing is actually lost.
    const safe = humanErrorToast(session.error?.message, { scenario: "clip" });
    bus.emit("toast", { kind: safe.kind, title: safe.title, body: safe.body });
  }, [isRealStageCrash, session.error]);

  // Item 3 — lifted selection count for the WorkstationFrame title bar.
  // ResultsGrid owns the multi-select Set locally and pushes the size up
  // via onSelectionChange. Zero on the empty stage (no grid mounted).
  const [selectedCount, setSelectedCount] = useState(0);

  // BUG-026 · CockpitDock focused-clip wiring.
  // Historically the focus was stored as `focusedClipIdx` (a position),
  // and CockpitDock's provider resolved it via `session.project.clips[idx]`.
  // That assumed array position === clip identity, which is only true on
  // the very first render. Under any subsequent reorder / rehydrate /
  // filter, the same idx would silently point at a DIFFERENT clip.
  //
  // 2026-07-14 · stable-ID focus refactor (Daniel · full-clipping-journey
  // sweep root-cause fix). Focus is now stored as `focusedClipId` — the
  // stable, position-independent clip.id assigned in the hydrate_project
  // normalizer (`state/useEngineSession.ts`). ClipCard clicks + bus events
  // both write id. `idx` remains display order only. Legacy engine calls
  // that require a numeric position (e.g. `selectClipForStudio(idx)`) are
  // bridged with `findIndex` at the call site — never stored as identity.
  //
  // Backward-compat: `resume.selectedClipId` is read first; if a legacy
  // snapshot only carries `selectedClipIdx`, the useEffect below resolves
  // it to an id after `session.project` hydrates.
  const [focusedClipId, setFocusedClipId] = useState<string | null>(
    typeof resume?.selectedClipId === "string" && resume.selectedClipId
      ? resume.selectedClipId
      : null,
  );
  // v2.2.18 · scoped-fix step 3 · split "focused" from "opened for
  //   preview / editing." Selecting a clip in the grid must NOT auto-
  //   cover the workspace with the cockpit editor.
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorModule, setEditorModule] = useState<ModuleKey>("reaction");
  // Bridge helper · resolve the CURRENT array position of a clip by id
  // from the LIVE project collection. This is the only correct source
  // for the legacy `selectedClipIdx` hint written to persistence —
  // NEVER trust a hint carried by the bus event, and NEVER use
  // `clip.idx` (that's display order, not array position). Returns
  // null when the id isn't in the collection (unknown / stale focus).
  const resolveArrayPositionById = (id: string): number | null => {
    if (!session.project) return null;
    const pos = session.project.clips.findIndex((c) => c.id === id);
    return pos >= 0 ? pos : null;
  };
  useEvent("clip:open-edit", (payload) => {
    setFocusedClipId(payload.clipId);
    selectClipForStudioById(payload.clipId, resolveArrayPositionById(payload.clipId));
    setInspectorOpen(true);
    setEditorModule("reaction");
    setEditorOpen(true);
  });
  useEvent("clip:open-export", (payload) => {
    setFocusedClipId(payload.clipId);
    selectClipForStudioById(payload.clipId, resolveArrayPositionById(payload.clipId));
    setInspectorOpen(true);
    setEditorModule("publish");
    setEditorOpen(true);
  });
  useEffect(() => {
    // D1-cluster-N (2026-07-12) · same clearing behaviour when the
    // engine session lands in the `clip_plan_empty` error state
    // (bake returned zero clips → useEngineSession dispatches error
    // rather than hydrating a project with `clips: []`). Without
    // this branch, a stale focused clip / inspector / editor from a
    // PRIOR hydrate would remain visible next to the zero-candidate
    // panel — workstation.spec.ts:1126 exercises exactly that flow.
    if (
      session.phase === "error"
      && (session.error?.message === "clip_plan_empty"
          || session.error?.code === "clip_plan_empty")
    ) {
      if (focusedClipId !== null) setFocusedClipId(null);
      if (inspectorOpen) setInspectorOpen(false);
      if (editorOpen) setEditorOpen(false);
      return;
    }
    if (!session.project) return;
    const clips = session.project.clips;
    const n = clips.length;
    // Phase C2 · zero-candidate recovery. A hydrated project that carries
    // zero clips (bake produced nothing usable, or every clip failed to
    // render) must NOT leave stale focus + inspector + editor state from
    // a previous project. Clear all of them so the empty-results panel
    // owns the surface with a retry action.
    if (n === 0) {
      if (focusedClipId !== null) setFocusedClipId(null);
      if (inspectorOpen) setInspectorOpen(false);
      if (editorOpen) setEditorOpen(false);
      return;
    }
    // Legacy resume migration · if we booted with only `selectedClipIdx`
    // (no id) AND no focus yet, translate the persisted array position
    // into an id via the live collection so subsequent renders anchor
    // on identity. clampedIdx is a genuine array position (bounded to
    // the live collection), so it is a correct `arrayPosition` hint.
    if (focusedClipId == null && typeof resume?.selectedClipIdx === "number") {
      const clampedPos = Math.max(0, Math.min(n - 1, resume.selectedClipIdx));
      const migratedId = clips[clampedPos]?.id;
      if (migratedId) {
        setFocusedClipId(migratedId);
        selectClipForStudioById(migratedId, clampedPos);
        return;
      }
    }
    // Default focus · if nothing is focused yet, pick the first clip.
    // arrayPosition is 0 by definition (first slot in the live array).
    if (focusedClipId == null) {
      const firstId = clips[0]?.id;
      if (firstId) {
        setFocusedClipId(firstId);
        selectClipForStudioById(firstId, 0);
      }
      return;
    }
    // Recover safely if the focused id disappeared (rehydrated project
    // dropped that clip, or a stale persisted id). Pick the first clip
    // instead of leaving a dangling ref that would land on fixture
    // content in the provider fallback.
    if (!clips.some((c) => c.id === focusedClipId)) {
      const firstId = clips[0]?.id;
      if (firstId) {
        setFocusedClipId(firstId);
        selectClipForStudioById(firstId, 0);
      }
    }
  }, [session.project, session.phase, session.error, focusedClipId, inspectorOpen, editorOpen, resume?.selectedClipIdx]);
  // ───── IRON GATE IG-LC2-016 — see docs/lc2/IRON_GATES_LC2.md ─────
  // focusedClip is resolved from LIVE session.project.clips by STABLE ID
  // (never by array position — see the 2026-07-14 refactor comment
  // above). CockpitDock + ClipPreviewShell read this same value so the
  // editor is one source of truth. See BUG-028.
  const focusedClip = session.project && focusedClipId != null
    ? session.project.clips.find((c) => c.id === focusedClipId)
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
  // 2026-08-08 · was `project?.clips.length ?? clipsTotal ?? 0` — once
  // session.project hydrates AT ALL, its (possibly still-incomplete)
  // clips.length silently WINS over the actual target count, even if
  // fewer clips have landed than the run is targeting. Reported live:
  // badge read "9/9" (looked finished) while a 10th clip was still being
  // picked/added — project had hydrated with 9 clips before the 10th
  // arrived, and clipsTotal (the real target, tracked from stage_progress
  // well before project ever hydrates) got discarded the moment it did.
  // Math.max keeps the denominator honest to whichever is currently
  // larger — the true target once known, never fewer than what's landed.
  const chromeClipCount = isEmpty
    ? 0
    : Math.max(session.project?.clips.length ?? 0, session.clipsTotal ?? 0);
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
  // focused clip when one exists; otherwise a stable structural
  // placeholder is used so the provider's identity (and therefore
  // React's reconciliation of every child below it) does not change
  // when `focusedClip` toggles. The harness caught the alternative
  // (conditional wrap) causing a route:enter → reset loop.
  //
  // 2026-07-14 · Stable-id refactor. The placeholder priority is:
  //   1. `focusedClip` (the real, id-resolved clip)
  //   2. `session.project.clips[0]` when a real project has hydrated —
  //      this keeps CockpitDock reading REAL clip data during the
  //      window between session hydration and focus resolution, so a
  //      user never sees fixture titles / metadata leak into the
  //      cockpit even for one paint tick.
  //   3. `FIXTURE_PROJECT.clips[0]` ONLY when no project has hydrated
  //      yet — the pre-first-run empty shell.
  const providerClip =
    focusedClip
    ?? session.project?.clips[0]
    ?? FIXTURE_PROJECT.clips[0];

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
        data-kade-anchor
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
        ) : isRestoring ? (
          <div className="lc-ws-restoring" role="status" aria-live="polite">
            <span className="lc-ws-restoring-eb">Restoring your session…</span>
            {restoreStalled && (
              <>
                <span className="lc-ws-restoring-sub">
                  Taking longer than usual — this project may not have come back.
                </span>
                <button
                  type="button"
                  className="lc-eng-empty-cta"
                  data-testid="workstation-restoring-start-new"
                  onClick={() => {
                    clearPersistedSession();
                    openCreatePanel();
                  }}
                >
                  Start a new clip
                </button>
              </>
            )}
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
                  message so no signal is lost.

                  2026-08-09 · same stale-phase gap as ResultsGrid's
                  hasCompletedRun fix below: dropping a NEW source hydrates
                  a fresh project before the first engine:progress event
                  flips phase back to "running" — in that gap, phase is
                  still "complete" from the PRIOR run, so this condition
                  hid the stage cards entirely right as the new run went
                  live (reported live: cards missing until "transcribe"
                  ticked in). Only treat "complete" as real when it
                  belongs to the currently-hydrated project. */}
              {(session.phase !== "complete"
                || !session.project?.slug
                || session.project.slug !== session.slug) && (
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
                  {/* 2026-08-07 · was sanitizeError(session.error.message) —
                    * that only redacts PII (emails/tokens), it doesn't turn
                    * a raw "RuntimeError: ... HTTP 502 · {json}" blob into
                    * clean copy. Routed through the same customer-safe
                    * classifier as the crash toast + StageRail's failed-tile
                    * text (describeError, customerSafeErrors.ts). */}
                  {session.error.human ?? describeError(session.error.message, { scenario: "clip" }).title}
                </span>
              </div>
            )}

              <EngineErrorBoundary route="workstation" component="ResultsGrid">
                <ResultsGrid
                  project={session.project}
                  isRunning={session.phase === "running"}
                  hasCompletedRun={
                    // 2026-08-08 · dropping a NEW source can hydrate a
                    // fresh (empty-clips) project before the first
                    // engine:progress event flips phase back to "running"
                    // — in that gap, phase is still "complete"/"error"
                    // from the PRIOR run. Reported live: "No clips this
                    // time" flashing on a brand-new source right before
                    // transcribing starts. Require the completion status
                    // to actually belong to the currently-hydrated
                    // project (matching slug) — a stale completed/errored
                    // phase for a DIFFERENT project no longer counts.
                    (session.phase === "complete" || session.phase === "error")
                    && !!session.project?.slug
                    && session.project.slug === session.slug
                  }
                  pendingCount={Math.max(session.clipsReady, session.clipsTotal ?? 0)}
                  onSelectionChange={setSelectedCount}
                  onOpenClip={(c) => {
                    // v2.2.18 scoped-fix step 3 · picking a clip opens
                    //   the PREVIEW drawer, not the editor. Only the
                    //   "Edit clip" button inside the drawer promotes
                    //   focus to the cockpit editor.
                    // 2026-07-14 · Stable-id focus · store id (identity).
                    //   The persistence-layer legacy idx hint is derived
                    //   from findIndex on the live collection — never
                    //   from `c.idx` (that's display order, not array
                    //   position, and drifts after any reorder).
                    if (!c.id) {
                      // Never crash a customer click. The invariant belongs
                      // at the data layer (hydrate_project) — if we reach a
                      // click without an id, log it and no-op.
                      void import("../../lib/diagnosticLogger").then(({ lcDiag }) => {
                        lcDiag("clip_id_missing_at_click", {
                          surface: "Workstation.onOpenClip",
                          clip_idx: c.idx,
                          clip_title: c.title,
                        });
                      });
                      return;
                    }
                    setFocusedClipId(c.id);
                    selectClipForStudioById(c.id, resolveArrayPositionById(c.id));
                    setInspectorOpen(true);
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
                  <ClipPreviewShell clip={focusedClip} sourcePath={session.project?.source_path} />
                </EngineErrorBoundary>
                {/* v2.2.18 · Edit / Schedule / Export promote the
                    selection to full editor. Selecting a clip alone
                    NEVER opens the dock. */}
                <div className="lc-ws-inspector-cta">
                  <button
                    type="button"
                    className="lc-ws-inspector-btn is-primary"
                    onClick={() => {
                      setEditorModule("reaction");
                      setEditorOpen(true);
                    }}
                  >
                    Edit clip
                  </button>
                  <button
                    type="button"
                    className="lc-ws-inspector-btn"
                    onClick={() => {
                      setEditorModule("schedule");
                      setEditorOpen(true);
                    }}
                    title="Open editor · Schedule tab"
                  >
                    Schedule
                  </button>
                  <button
                    type="button"
                    className="lc-ws-inspector-btn"
                    onClick={() => {
                      setEditorModule("publish");
                      setEditorOpen(true);
                    }}
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
      {focusedClip && editorOpen && <CockpitDock initialModule={editorModule} />}
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
    <Watchdog
      id="pipeline/cp-01/workstation-route"
      label="Workstation · clip grid + stage rail + cockpit"
      cluster="pipeline"
      source="src/design-os/routes/Workstation.tsx:511"
    >
      <EngineSessionProvider resetOnRouteEnter>
        <WorkstationBody />
      </EngineSessionProvider>
    </Watchdog>
  );
}

function formatElapsed(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}
