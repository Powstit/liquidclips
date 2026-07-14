/**
 * GlobalDropConsumer · shell-level `source:drop` handler
 *
 * DropOverlay emits `bus.emit("source:drop", { paths })` whenever the user
 * drops a video file onto the Tauri window. Until now the only subscriber
 * was CreateClipsRoute (design-os/routes/CreateClips.tsx:87) — so if the
 * user dropped a file while on ANY other route (Home, Workstation, Engine,
 * Earn, Settings…) the bus event fired into the void and the file
 * disappeared silently. Track 2 (file upload) of Daniel's clipping journey
 * was completely non-functional off the Create route.
 *
 * This module mounts a single always-on subscriber inside App.tsx (post
 * splashAcked + WelcomeGate + AuthGate) so a drop from any surface:
 *   1. Fires a "Source bay · picking up <name>…" toast so the user gets
 *      instant feedback the drop registered.
 *   2. Routes the user to Workstation so the live ResultsGrid + StageRail
 *      render as ingest progresses.
 *   3. Persists an engine session (localStorage) so a cold-open lands
 *      back on the running project.
 *   4. Kicks off `sidecar.startRun(path, "", "clips", 30)` — the
 *      canonical local-file ingest RPC (Iron Gate IG-002) — then walks
 *      audio → transcribe → llm → cut → reframe → thumbs via runStage()
 *      so the user actually gets clips rather than an ingest that stops
 *      at the first stage.
 *
 * Contract-preserving mirror of CreateClipsRoute's local consumer. A
 * 750 ms in-memory dedup guards on the first path emitted so a future
 * per-route consumer (or an accidentally mounted second global one)
 * doesn't cause a double-ingest. NOTE: CreateClipsRoute is currently
 * dead code — not imported anywhere in the tree — so today Global is
 * the only listener. See dedup block for the full note.
 *
 * Wrapped in a Watchdog so a malformed drop payload (OS bug, unicode
 * path, sidecar crash mid-run) surfaces KadeRepairScreen instead of
 * white-screening the shell. Node id `pipeline/cp-18/drop-consumer`
 * (next available cp-NN after cp-16; cp-14/17 skipped per
 * docs/WATCHDOG_ROLLOUT_PROGRESS.md).
 */

import { useCallback } from "react";
import { bus, useEvent } from "../design-os/bridge";
import { sidecar } from "../design-os/engine/sidecar-stub";
import { startPersistedSession } from "../design-os/state/engineSessionPersistence";
import type { ProjectMeta, StageName } from "../design-os/engine/types";
import { Watchdog } from "./watchdog";
import { lcDiag, probeSidecarState } from "./diagnosticLogger";

const POST_INGEST_STAGES: ReadonlyArray<StageName> = [
  "audio",
  "transcribe",
  "llm",
  "cut",
  "reframe",
  "thumbs",
];

/* Module-level dedup — defensive against a second consumer being wired
 * on the same bus channel. Bus listener order is insertion-order (Set):
 * this global consumer mounts at App.tsx boot so it runs FIRST if a
 * per-route consumer (e.g. CreateClipsRoute.tsx:87) later subscribes.
 *
 * NOTE (2026-07-07): CreateClipsRoute is currently dead code — the
 * component is defined but never imported anywhere in the tree
 * (verified via `grep -rn 'from.*CreateClips'`). SimulatorRouter aliases
 * `#/create` to `home`, so the second listener never mounts today. The
 * dedup stays as a safety net for the moment a future route wires its
 * own listener again — first path seen wins, second within DEDUP_MS
 * short-circuits so we don't ingest twice. */
const DEDUP_MS = 750;
let lastDroppedPath: string | null = null;
let lastDroppedAt = 0;

function shouldSkip(path: string): boolean {
  const now = Date.now();
  if (lastDroppedPath === path && now - lastDroppedAt < DEDUP_MS) return true;
  lastDroppedPath = path;
  lastDroppedAt = now;
  return false;
}

/** Ship-lens Block-2 P1-04 · called from the preflight-fail branch so
 *  the user can re-drop the SAME file immediately after fixing it
 *  (e.g. right-clicking Make Available Offline in Finder). Without
 *  this, the 750ms dedup silently swallows the second drop. */
function forgetLastDroppedPath(): void {
  lastDroppedPath = null;
  lastDroppedAt = 0;
}

async function drivePostIngestStages(slug: string): Promise<void> {
  try {
    for (const stage of POST_INGEST_STAGES) {
      const started = Date.now();
      void lcDiag("stage_started", {
        source: "src/lib/globalDropConsumer.tsx:drivePostIngestStages",
        slug,
        stage,
      });
      const { project: updated } = await sidecar.runStage(slug, stage);
      void lcDiag("stage_success", {
        source: "src/lib/globalDropConsumer.tsx:drivePostIngestStages",
        slug,
        stage,
        duration_ms: Date.now() - started,
      });
      bus.emit("engine:complete", {
        kind: "bake",
        slug,
        project: updated as ProjectMeta,
      });
      // clips_written · fired when stage_cut lands a project with at
      // least one clip carrying a real cut_path. This is the earliest
      // proof that the pipeline produced a file on disk — the whole
      // definition of done hinges on it.
      if (stage === "cut") {
        const proj = updated as ProjectMeta;
        const clips = Array.isArray(proj?.clips) ? proj.clips : [];
        const withCut = clips.filter(
          (c) => typeof (c as { cut_path?: string }).cut_path === "string"
            && (c as { cut_path: string }).cut_path.length > 0,
        );
        void lcDiag("clips_written", {
          source: "src/lib/globalDropConsumer.tsx:drivePostIngestStages",
          slug,
          clip_count: clips.length,
          with_cut_path: withCut.length,
          first_cut_path_length:
            withCut.length > 0
              ? (withCut[0] as { cut_path: string }).cut_path.length
              : 0,
        });
        if (withCut.length > 0) {
          void lcDiag("fresh_clipping_engine_proven", {
            source: "src/lib/globalDropConsumer.tsx:drivePostIngestStages",
            slug,
            clip_count: clips.length,
            with_cut_path: withCut.length,
          });
        }
      }
    }
    bus.emit("engine:complete", { kind: "pick", slug });
  } catch (err) {
    void lcDiag("stage_failed", {
      source: "src/lib/globalDropConsumer.tsx:drivePostIngestStages",
      slug,
      error_message: String(err instanceof Error ? err.message : err).slice(0, 200),
    });
    bus.emit("engine:error", {
      kind: "bake",
      slug,
      error: String(err instanceof Error ? err.message : err),
    });
  }
}

function GlobalDropConsumerInner(): null {
  const handleDrop = useCallback((payload: { paths: string[] }) => {
    if (!payload?.paths || payload.paths.length === 0) return;
    /* Multi-file drop: first path wins. Mirrors CreateClipsRoute legacy
     * behavior — sidecar startRun ingests one source per project. Files
     * 2..N are dropped silently; a queue-multi UX belongs in a follow-up
     * sprint (matches InlineCreatePanel single-URL contract). */
    const path = payload.paths[0];
    if (typeof path !== "string" || path.length === 0) return;
    if (shouldSkip(path)) return;

    const name = path.split(/[\\/]/).pop() ?? "file";

    // Live-path diagnostic · the user just selected a real video, either
    // via drag/drop or via the plugin-dialog picker feeding source:drop.
    void lcDiag("video_input_selected", {
      source: "src/lib/globalDropConsumer.tsx:handleDrop",
      path_length: path.length,
      filename: name,
    });

    // Block 2 · 2026-07-11 · preflight gate. Runs BEFORE nav / toast /
    // session persistence / sidecar RPC so a Dropbox smart-sync stub,
    // an empty write, or an unreadable file never routes the user to
    // Workstation to watch a permanent-pending StageRail. handleDrop
    // stays a sync useCallback; the async check + rest of the pipeline
    // run inside a single IIFE so the useEvent wire doesn't change.
    void (async () => {
      const { preflightSourceFile } = await import(
        "../design-os/engine/uploadPreflight"
      );
      const pre = await preflightSourceFile(path);
      if (!pre.ok) {
        void lcDiag("upload_preflight_failed", {
          source: "src/lib/globalDropConsumer.tsx:handleDrop",
          reason: pre.reason,
          filename: pre.filename,
          detail: pre.detail?.slice(0, 200),
        });
        // P1-04 · forget this path so the user can re-drop the same
        // file (after Making Available Offline in Finder) without
        // getting dedup-swallowed.
        forgetLastDroppedPath();
        bus.emit("engine:error", {
          kind: "ingest",
          error: pre.humanMessage,
          human: pre.humanMessage,
          code: `PREFLIGHT_${pre.reason.toUpperCase()}`,
          source_path: pre.path,
        });
        return;
      }

      // Prove the sidecar is up BEFORE we try to talk to it, so a
      // "not managed" / "no bundled sidecar" surfaces as its own
      // diagnostic topic instead of a downstream mystery error.
      void lcDiag("sidecar_probe_before_ingest", {
        source: "src/lib/globalDropConsumer.tsx:handleDrop",
      });
      void probeSidecarState();

      /* Toast first so the user knows the drop registered even if the
       * sidecar takes a beat. */
      bus.emit("toast", {
        kind: "info",
        title: "Source bay",
        body: `Picked up ${name} · scanning…`,
      });

      /* Route the user to Workstation so the live ResultsGrid + StageRail
       * render as the pipeline drives the clips out. */
      bus.emit("nav:click", { route: "workstation" });

      /* Persist the session so a cold-open reopens the running project
       * rather than an empty Home. */
      startPersistedSession(name, { url: undefined });

      /* Synthetic ingest tick so useEngineSession advances phase to
       * "running" immediately — real sidecar events overwrite this on
       * the first true stage_progress. */
      bus.emit("engine:progress", { stage: "ingest", percent: null });

      /* Kick off the local-file ingest RPC (Iron Gate IG-002 · method
       * `start_run` · payload shape unchanged). */
      const ingestStarted = Date.now();
      void lcDiag("ingest_started", {
        source: "src/lib/globalDropConsumer.tsx:handleDrop",
        path_length: path.length,
        filename: name,
        intent: "clips",
        clip_count: 30,
      });
      try {
        const { project } = await sidecar.startRun(path, "", "clips", 30);
        if (project?.slug) {
          void lcDiag("ingest_success", {
            source: "src/lib/globalDropConsumer.tsx:handleDrop",
            slug: project.slug,
            duration_ms: Date.now() - ingestStarted,
          });
          void drivePostIngestStages(project.slug);
        } else {
          void lcDiag("ingest_failed_startrun", {
            source: "src/lib/globalDropConsumer.tsx:handleDrop",
            error_message: "Sidecar returned no project slug after start_run",
            duration_ms: Date.now() - ingestStarted,
          });
          // 2026-07-13 · Post-RC1 · canonical HQ envelope alongside
          // the legacy lcDiag beacon. `processing.failed` category so
          // Codex classifiers route into the pipeline lane. Data
          // carries the sanitised error string only — no source_path
          // (that IS PII for a user drop).
          void import("./hqEmit").then((h) => {
            h.emitHqEvent({
              category: "processing.failed",
              severity: "error",
              topic: "ingest.failed",
              data: {
                stage: "ingest",
                reason: "sidecar_no_slug",
                duration_ms: Date.now() - ingestStarted,
              },
            });
          }).catch(() => {
            /* HQ emit is best-effort */
          });
          bus.emit("engine:error", {
            kind: "ingest",
            error: "Sidecar returned no project slug after start_run",
            source_path: path,
          });
        }
      } catch (err) {
        const msg = String(err instanceof Error ? err.message : err);
        void lcDiag("ingest_failed_startrun", {
          source: "src/lib/globalDropConsumer.tsx:handleDrop",
          error_message: msg.slice(0, 200),
          duration_ms: Date.now() - ingestStarted,
        });
        // 2026-07-13 · Post-RC1 · canonical HQ envelope alongside the
        // legacy lcDiag beacon. Data carries the sanitised error
        // string only — no source_path (PII for a user drop).
        void import("./hqEmit").then((h) => {
          h.emitHqEvent({
            category: "processing.failed",
            severity: "error",
            topic: "ingest.failed",
            data: {
              stage: "ingest",
              reason: "sidecar_throw",
              error_message: msg.slice(0, 200),
              duration_ms: Date.now() - ingestStarted,
            },
          });
        }).catch(() => {
          /* HQ emit is best-effort */
        });
        bus.emit("engine:error", {
          kind: "ingest",
          error: msg,
          source_path: path,
        });
      }
    })();
  }, []);

  useEvent("source:drop", handleDrop);
  return null;
}

/**
 * Shell-level consumer for the `source:drop` bus channel emitted by
 * DropOverlay. Renders nothing. Wrap-and-forget — mount once inside the
 * post-splash / post-welcome / post-auth guarded shell in App.tsx.
 */
export function GlobalDropConsumer(): React.ReactElement {
  return (
    <Watchdog
      id="pipeline/cp-18/drop-consumer"
      label="Global source-drop consumer (Track 2 · file upload)"
      cluster="pipeline"
      source="src/lib/globalDropConsumer.tsx"
    >
      <GlobalDropConsumerInner />
    </Watchdog>
  );
}
