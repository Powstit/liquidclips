/**
 * CreateClipsRoute · Phase 6C-Lockdown
 *
 * Adds:
 *   - EngineActions strip (Cancel / Clear when a run is mid-flight, Resume
 *     when persisted)
 *   - Session persistence — drops + URL pastes call startPersistedSession
 *   - Runtime-honesty tag in the hero eyebrow when mock
 *   - EngineErrorBoundary around UploadPortal so a portal crash leaves the
 *     route otherwise functional
 *
 * Still NOT touched: backend / auth / payment / release / Studio.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { SimPage } from "./SimPage";
import { UploadPortal } from "../engine/UploadPortal";
import { sidecar } from "../engine/sidecar-stub";
import { EngineActions } from "../engine/EngineActions";
import { useRuntimeInfo } from "../engine/runtimeInfo";
import { startPersistedSession, useEngineSessionPersistence } from "../state/engineSessionPersistence";
import { useModalPortal } from "../components/ModalPortal";
import { EngineErrorBoundary } from "../components/EngineErrorBoundary";
import { EngineSessionProvider, useEngineSession } from "../state/useEngineSession";
import { useKadeFromSession } from "../state/useKadeFromSession";
import { useEvent } from "../bridge";
import { bus } from "../bridge";
import type { StageName, ProjectMeta } from "../engine/types";
// Port #8b · Section B · shared contextual demo overlay.
import { DemoOverlay } from "../../components/demo-overlay";
import "./CreateClips.css";

/**
 * Post-ingest pipeline chain · mirrors `InlineCreatePanel.tsx:299-343`.
 *
 * Product-functional fix 2026-07-04 · CreateClips route was firing
 * `sidecar.ingestUrl` / `startRun` and stopping. No downstream stages ran,
 * so the user pasted a URL and never got clips. This helper walks the same
 * post-ingest stages InlineCreatePanel walks: audio → transcribe → llm →
 * cut → reframe → thumbs. Each `runStage` emits `stage_progress` events
 * so `useEngineSession` advances in real time. Every stage completion
 * emits an `engine:complete { kind: "bake" }` so ResultsGrid hydrates
 * live · not only at the final stage.
 *
 * Iron Gate IG-002 · no RPC contract drift · uses existing runStage.
 */
const POST_INGEST_STAGES: ReadonlyArray<StageName> = [
  "audio",
  "transcribe",
  "llm",
  "cut",
  "reframe",
  "thumbs",
];

async function drivePostIngestStages(
  slug: string,
  onError: (err: unknown, kind: string) => void,
): Promise<void> {
  try {
    for (const stage of POST_INGEST_STAGES) {
      const { project: updated } = await sidecar.runStage(slug, stage);
      bus.emit("engine:complete", {
        kind: "bake",
        slug,
        project: updated as ProjectMeta,
      });
    }
    bus.emit("engine:complete", { kind: "pick", slug });
  } catch (e) {
    onError(e, "pipeline");
  }
}

function CreateClipsBody() {
  const [portalOpen, setPortalOpen] = useState(false);
  const session = useEngineSession();
  const runtime = useRuntimeInfo();
  const modalHost = useModalPortal();
  // Mount persistence so progress writes happen even on this route
  useEngineSessionPersistence();
  useKadeFromSession("create");

  // Shell-level drop emits "source:drop" — route picks it up here. First
  // path wins (legacy behaviour: ingest one source at a time).
  useEvent("source:drop", (p) => {
    if (!p.paths || p.paths.length === 0) return;
    const path = p.paths[0];
    const name = path.split("/").pop() ?? "file";
    startPersistedSession(name, { url: undefined });
    // Product fix 2026-07-04 · chain post-ingest stages so drop actually
    // produces clips. Was fire-and-forget → user got no clips.
    sidecar.startRun(path)
      .then(({ project }) => {
        if (project?.slug) {
          void drivePostIngestStages(project.slug, (err) => {
            bus.emit("engine:error", {
              kind: "bake",
              error: String(err instanceof Error ? err.message : err),
            });
          });
        }
      })
      .catch((e) => {
        bus.emit("engine:error", {
          kind: "ingest",
          error: String(e instanceof Error ? e.message : e),
        });
      });
    bus.emit("toast", {
      kind: "info",
      title: "Source bay",
      body: `Picked up ${name} · scanning…`,
    });
  });

  return (
    <>
      <SimPage
        route="create"
        world="cockpit-home"
        defaultKade={session.kade}
        keyPanel={{
          eyebrow:
            runtime.mode === "mock"
              ? "Source bay"
              : "Source bay",
          headline: "Drop a link or file",
          sub:
            session.phase === "running"
              ? `Scanning · ${session.stage ?? "ingest"}…`
              : session.phase === "complete"
                ? "Source ready · go to Engine to review candidates."
                : session.phase === "error"
                  ? "Run hit a snag · check the engine controls."
                  : "I'll scan it and find the moments worth clipping.",
          chips: ["URL", "MP4", "MOV", "Live"],
          progress: session.percent ?? undefined,
        }}
        microInteractions={[
          { label: "Paste a link", kade: "import-footage" },
          { label: "Drop a file", kade: "import-footage" },
          { label: "Source not supported", kade: "warning" },
        ]}
      />

      {/* Run controls — visible only when something is in flight or persisted */}
      <EngineErrorBoundary route="create" component="EngineActions">
        <div className="lc-create-actions-wrap">
          <EngineActions onGoCreate={() => setPortalOpen(true)} />
        </div>
      </EngineErrorBoundary>

      {/* Floating CTA → opens UploadPortal via modal host */}
      {modalHost && createPortal(
        <button
          type="button"
          className="lc-create-cta"
          onClick={() => setPortalOpen(true)}
        >
          <span className="lc-create-cta-eb">
            {runtime.mode === "mock" ? "Engine preview" : "Open"}
          </span>
          <span className="lc-create-cta-body">Upload portal</span>
        </button>,
        modalHost,
      )}

      <EngineErrorBoundary route="create" component="UploadPortal">
        <UploadPortal
          open={portalOpen}
          onClose={() => setPortalOpen(false)}
          intent="clips"
          onPasteUrl={(url) => {
            startPersistedSession(url, { url });
            // Product fix 2026-07-04 · chain post-ingest stages so URL paste
            // actually produces clips. Was firing ingest and stopping.
            sidecar.ingestUrl(url)
              .then(({ project }) => {
                if (project?.slug) {
                  void drivePostIngestStages(project.slug, (err) => {
                    bus.emit("engine:error", {
                      kind: "bake",
                      error: String(err instanceof Error ? err.message : err),
                      url,
                    });
                  });
                }
              })
              .catch((e) => {
                bus.emit("engine:error", {
                  kind: "ingest",
                  error: String(e instanceof Error ? e.message : e),
                  url,
                });
              });
          }}
          onPickFile={() => {
            // Stub run (no native picker until dialog plugin lands)
            startPersistedSession("(picked-file.mp4)");
            // Product fix 2026-07-04 · same chain as onPasteUrl above.
            sidecar.startRun("(picked-file.mp4)")
              .then(({ project }) => {
                if (project?.slug) {
                  void drivePostIngestStages(project.slug, (err) => {
                    bus.emit("engine:error", {
                      kind: "bake",
                      error: String(err instanceof Error ? err.message : err),
                    });
                  });
                }
              })
              .catch((e) => {
                bus.emit("engine:error", {
                  kind: "ingest",
                  error: String(e instanceof Error ? e.message : e),
                });
              });
          }}
        />
      </EngineErrorBoundary>

      {/* Port #8b · #1 · contextual demo overlay for the Build tab
          (canonical route per Daniel 2026-07-04). Shows only when
          session is idle — no active run, no persisted session, no
          previous dismissal (localStorage: demo-shown-build).
          useEngineSessionPersistence has already reconciled state
          above so session.phase === 'idle' means genuinely no
          resumable session. Overlay sits fixed bottom-right, does
          not obstruct UploadPortal or the source-drop CTA. */}
      {session.phase === "idle" && (
        <DemoOverlay
          mp4Src="/demos/01-clipping.mp4"
          kadePosterSrc="/brand/kade/kade-cutting-clips.webp"
          title="How clipping works"
          storageKey="demo-shown-build"
          hint={<><strong>60 sec</strong> · tap to unmute · ✕ to dismiss</>}
        />
      )}
    </>
  );
}

export function CreateClipsRoute() {
  return (
    <EngineSessionProvider resetOnRouteEnter>
      <CreateClipsBody />
    </EngineSessionProvider>
  );
}
