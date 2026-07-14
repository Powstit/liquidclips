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

import { useEffect, useState } from "react";
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

  // Recovery brief P0 · 2026-07-08 · Golden-path step 2 (clipping) diagnostics.
  // Emit `create_screen_mounted` so Railway logs capture the moment the user
  // navigates to Create + the runtime state at that moment.
  useEffect(() => {
    void (async () => {
      try {
        const mod = await import("../../lib/diagnosticLogger");
        mod.lcDiag("create_screen_mounted", {
          runtime_mode: runtime.mode,
          session_phase: session.phase,
          has_slug: !!session.project?.slug,
          project_slug: session.project?.slug ?? null,
          tauri_present: typeof window !== "undefined" && "__TAURI_INTERNALS__" in window,
        });
      } catch { /* non-fatal */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recovery brief P0 · subscribe to engine bus events so stage lifecycle
  // lands in /telemetry/diagnostic. Fires `stage_started` on progress ticks
  // that name a new stage; `stage_success` on engine:complete with a bake
  // kind; `clips_written` when a bake payload carries a real `clips` array.
  useEvent("engine:progress", (p) => {
    void (async () => {
      try {
        const mod = await import("../../lib/diagnosticLogger");
        mod.lcDiag("stage_started", {
          stage: p.stage,
          percent: p.percent,
          slug: p.slug ?? null,
        });
      } catch { /* non-fatal */ }
    })();
  });

  useEvent("engine:complete", (p) => {
    void (async () => {
      try {
        const mod = await import("../../lib/diagnosticLogger");
        const proj = (p as { project?: { slug?: string; clips?: unknown[] } }).project;
        const kind = (p as { kind?: string }).kind ?? "unknown";
        mod.lcDiag("stage_success", {
          kind,
          slug: proj?.slug ?? (p as { slug?: string }).slug ?? null,
          clip_count: Array.isArray(proj?.clips) ? proj.clips.length : null,
        });
        // clips_written · fires ONCE per bake when a project payload with
        // >0 clips lands. That's the truth marker that transcribe/reframe/cut
        // actually produced files.
        if (Array.isArray(proj?.clips) && proj.clips.length > 0) {
          const firstClip = proj.clips[0] as { cut_path?: string; vertical_path?: string; slug?: string };
          mod.lcDiag("clips_written", {
            slug: proj.slug ?? null,
            clip_count: proj.clips.length,
            first_clip_cut_path: firstClip?.cut_path ?? null,
            first_clip_vertical_path: firstClip?.vertical_path ?? null,
            first_clip_slug: firstClip?.slug ?? null,
          });
          // Recovery brief 2026-07-09 · Daniel's Test B acceptance marker.
          // Fires only when a bake yields a real file path (looks like an
          // absolute macOS path OR contains .mp4). Tauri fs.exists probe
          // confirms the file is on disk. Absence of this event = fresh
          // clipping engine NOT proven this session.
          void (async () => {
            try {
              const cut = firstClip?.cut_path ?? "";
              const vert = firstClip?.vertical_path ?? "";
              const anyPath = cut || vert || "";
              const looksReal = anyPath.startsWith("/") && anyPath.includes(".mp4");
              let cutExists: boolean | null = null;
              let vertExists: boolean | null = null;
              try {
                const fsMod = await import("@tauri-apps/plugin-fs");
                if (cut) cutExists = await fsMod.exists(cut);
                if (vert) vertExists = await fsMod.exists(vert);
              } catch { /* fs probe optional */ }
              if (looksReal && (cutExists || vertExists)) {
                mod.lcDiag("fresh_clipping_engine_proven", {
                  slug: proj?.slug ?? null,
                  clip_count: proj?.clips?.length ?? 0,
                  first_clip_cut_path: cut || null,
                  first_clip_vertical_path: vert || null,
                  cut_exists: cutExists,
                  vertical_exists: vertExists,
                  via: "clips_written_with_disk_check",
                });
              }
            } catch { /* non-fatal */ }
          })();
        }
      } catch { /* non-fatal */ }
    })();
  });

  // Recovery brief P0 · surface every engine:error via lcDiag so a silent
  // catch (or a real sidecar throw) shows up in Railway logs alongside the
  // ingest/stage timeline.
  useEvent("engine:error", (p) => {
    void (async () => {
      try {
        const mod = await import("../../lib/diagnosticLogger");
        mod.lcDiag("ingest_failed", {
          kind: (p as { kind?: string }).kind ?? "unknown",
          error: String((p as { error?: string }).error ?? "").slice(0, 300),
        });
      } catch { /* non-fatal */ }
    })();
  });

  // Shell-level drop emits "source:drop" — route picks it up here. First
  // path wins (legacy behaviour: ingest one source at a time).
  useEvent("source:drop", (p) => {
    if (!p.paths || p.paths.length === 0) return;
    const path = p.paths[0];
    const name = path.split("/").pop() ?? "file";
    // Control Tower #4 · 2026-07-09 — generate the run_id here so every
    // downstream log line and the ledger row share one correlator.
    const runId = (typeof crypto !== "undefined" && "randomUUID" in crypto)
      ? crypto.randomUUID()
      : `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    startPersistedSession(name, { url: undefined });

    // Recovery brief P0 · diagnose the moment the user picks a video AND
    // the sidecar state right before we try to ingest. If sidecar isn't
    // managed at ingest time, the isSidecarUnavailable guard now throws
    // in prod (no fixture fallback) — this log tells us why.
    void (async () => {
      try {
        const mod = await import("../../lib/diagnosticLogger");
        mod.lcDiag("video_input_selected", {
          source: "drop",
          file_name: name.slice(0, 120),
          path_len: path.length,
          path_starts_with: path.slice(0, 40),
          run_id: runId,
        });
        await mod.probeSidecarState();
        mod.lcDiag("sidecar_probe_before_ingest", {
          source: "drop",
          about_to_call: "sidecar.startRun",
          run_id: runId,
        });
        mod.lcDiag("ingest_started", { source: "drop", file_name: name.slice(0, 120), run_id: runId });
      } catch { /* non-fatal */ }
    })();

    // Product fix 2026-07-04 · chain post-ingest stages so drop actually
    // produces clips. Was fire-and-forget → user got no clips.
    sidecar.startRun(path, undefined, undefined, undefined, runId)
      .then(({ project }) => {
        void (async () => {
          try {
            const mod = await import("../../lib/diagnosticLogger");
            mod.lcDiag("ingest_success", {
              slug: project?.slug ?? null,
              project_is_fixture_slug: project?.slug === "fixture-project" || project?.slug === "preview",
              stages_present: project?.stages ? Object.keys(project.stages) : [],
            });
          } catch { /* non-fatal */ }
        })();
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
        void (async () => {
          try {
            const mod = await import("../../lib/diagnosticLogger");
            const errName = e instanceof Error ? e.name : typeof e;
            const errMsg = e instanceof Error ? e.message : String(e);
            mod.lcDiag("ingest_failed_startrun", {
              error_name: errName,
              error_msg: errMsg.slice(0, 300),
              is_sidecar_error: errMsg.toLowerCase().includes("sidecar"),
              is_prod_fixture_block: errMsg.toLowerCase().includes("prod") || errMsg.toLowerCase().includes("engine unavailable"),
            });
          } catch { /* non-fatal */ }
        })();
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
            // Control Tower #4 · 2026-07-09 — one run_id per attempt.
            const runId = (typeof crypto !== "undefined" && "randomUUID" in crypto)
              ? crypto.randomUUID()
              : `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
            // Product fix 2026-07-04 · chain post-ingest stages so URL paste
            // actually produces clips. Was firing ingest and stopping.
            sidecar.ingestUrl(url, undefined, undefined, undefined, runId)
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
