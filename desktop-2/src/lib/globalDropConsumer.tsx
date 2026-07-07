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

async function drivePostIngestStages(slug: string): Promise<void> {
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
  } catch (err) {
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

    /* Toast first so the user knows the drop registered even if the
     * sidecar takes a beat. Mirrors the CreateClipsRoute copy so
     * "Source bay · Picked up <name> · scanning…" reads identically
     * regardless of which surface the user dropped onto. */
    bus.emit("toast", {
      kind: "info",
      title: "Source bay",
      body: `Picked up ${name} · scanning…`,
    });

    /* Route the user to Workstation so the live ResultsGrid + StageRail
     * render as the pipeline drives the clips out. Without this the
     * user drops a file on Home and stares at cockpit tiles while the
     * pipeline silently runs in the background. */
    bus.emit("nav:click", { route: "workstation" });

    /* Persist the session so a cold-open reopens the running project
     * rather than an empty Home. Mirrors CreateClipsRoute + InlineCreatePanel. */
    startPersistedSession(name, { url: undefined });

    /* Synthetic ingest tick so useEngineSession advances phase to
     * "running" immediately — real sidecar events overwrite this on
     * the first true stage_progress. Mirrors InlineCreatePanel:281. */
    bus.emit("engine:progress", { stage: "ingest", percent: null });

    /* Kick off the local-file ingest RPC (Iron Gate IG-002 · method
     * `start_run` · payload shape unchanged). Default clip count 30
     * matches the panel's default chip. */
    sidecar
      .startRun(path, "", "clips", 30)
      .then(({ project }) => {
        if (project?.slug) {
          void drivePostIngestStages(project.slug);
        } else {
          bus.emit("engine:error", {
            kind: "ingest",
            error: "Sidecar returned no project slug after start_run",
          });
        }
      })
      .catch((err) => {
        bus.emit("engine:error", {
          kind: "ingest",
          error: String(err instanceof Error ? err.message : err),
        });
      });
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
