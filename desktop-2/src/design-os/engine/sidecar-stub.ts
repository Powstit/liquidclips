/**
 * sidecar-stub · Phase 6C IPC wrapper
 *
 * The legacy sidecar.ts (desktop/src/lib/sidecar.ts, 1761 LOC) requires the
 * Tauri Rust command `sidecar_call` + the bundled Python sidecar. desktop-2's
 * shell does ship that runtime — see src-tauri/src/lib.rs (Batch A bridge +
 * Batch C python tree at /python-sidecar/).
 *
 * This stub gives the ported Phase 6C bricks a typed IPC surface. Every
 * method is shape-compatible with the legacy wrapper so the swap to the real
 * sidecar in a later phase is a single import change.
 *
 * Behaviour:
 *   - In a Tauri runtime AND `sidecar_call` is exposed → invoke it (real
 *     Python sidecar); falls back to mock only when sidecar genuinely
 *     unavailable (browser preview / Playwright harness / state not
 *     managed). Real errors (envelope · restart · crash · timeout) surface
 *     as typed classes.
 *   - Otherwise → emits realistic `engine:progress` events on the Design OS
 *     bus over 6s, then `engine:complete`. Routes / Kade / MetricBoards
 *     react identically to a real run.
 *
 * Iron Gates IG-001 (ingest) and IG-002 (RPC registry) lock the legacy
 * contract. This stub honours the same method names + return shapes so
 * porting bricks need no logic changes.
 *
 * ─── Real-RPC wired methods (v2.2 Batch 1 · 2026-06-24) ──────────────
 * Methods below route through `sidecarCall` first, fall back to mock only
 * when `isSidecarUnavailable(e)`. The remaining methods (channels HTTP,
 * thumbnail*, OAuth stubs, exportApi.cancelExport/listHistory/etc.) still
 * use the legacy `tryInvoke` mock-fallback path until a later batch.
 *
 *   ingest pipeline:    ingestUrl · startRun · getProject · runStage
 *   editor (daily):     regenerateClip · getCaptions · editCaptions
 *   clip CRUD:          addClip · duplicateClip · removeClip · updateClipMeta
 *   generation:         pickMoreClips · startPickMoreClips · cancelPickMoreClips
 *   export:             exportApi.exportClip
 *   warmup:             preloadWhisper (top-level export, not on `sidecar`)
 *
 * 14+ wired today vs 4 before. Daily-use editor surfaces (Re-cut, Captions,
 * inline CRUD, Generate More) now hit the real sidecar instead of the
 * 6-second mock progress bar.
 */

import { bus } from "../bridge";
import { FIXTURE_PROJECT, type ProjectMeta, type StageName, STAGE_ORDER } from "./types";

declare global {
  interface Window {
    /** Playwright localhost-only project overrides keyed by slug. This keeps
     * edge-state tests at the real getProject boundary instead of
     * skipping when the default fixture cannot represent the state. */
    __lcDebugProjects?: Record<string, ProjectMeta>;
  }
}
// Batch B (2026-06-20) — real RPC entrypoint for the 4 ported methods.
// v2.2 Batch 1 (2026-06-24) — expanded to 14+ methods covering the daily
// editor + clip CRUD + generation surfaces. See header for the full list.
// `isSidecarUnavailable` discriminates "state not managed" (browser preview /
// Playwright / Batch A→C transitional state — fall back to mock) from real
// sidecar errors (envelope, restart, crash, timeout — surface to UI).
// `withCancelOnTimeout` drops a per-project cancel marker on timeout so a
// stuck ffmpeg child aborts at its next poll (regenerateClip 180s ceiling).
// Iron Gate IG-002.
import { sidecarCall, isSidecarUnavailable, withCancelOnTimeout } from "./sidecarCall";
// C1-T6 · 2026-07-05 · Wave 2 shared-rail codemod. See
// desktop-2/src/lib/bridgeToBackend.ts for the primitive. Used by the
// agency + channels + social + whop-rewards wrappers to replace the
// `tryInvoke("sidecar_call", ...) → shouldTryHttpBackend + fetch →
// mock` triple-branch dance with a single typed HTTP call. Wrapper
// dev-branch mocks stay behind `!shouldTryHttpBackend()` so preview /
// CI harness still get a deterministic response.
import { bridgeToBackend, BridgeError } from "../../lib/bridgeToBackend";
// Watchdog Rollout · mo-05 (2026-07-06) · schedule cancel/reschedule/retry.
// Each RPC below is wrapped so a failure inside the local-vs-backend
// branching + native-notification cancel/schedule dance surfaces to
// HQ Admin as a FailureRecord and never white-screens the caller.
// See docs/PROTOCOL_SELF_HEALING_NODES.md.
import { watchdogWrap } from "../../lib/watchdog";
import {
  type ExportFormat,
  type ExportPreset,
  type ExportJob,
  type TargetAccount,
  type AccountState,
  FIXTURE_EXPORT_HISTORY,
} from "../export/types";
import type { Platform } from "./types";
import {
  cancelAssistedNotification,
  isUploadableVideoPath,
  patchAssistedJob,
  readAssistedSchedule,
  scheduleAssistedNotification,
  upsertAssistedJobs,
  type AssistedScheduleRecord,
} from "../schedule/assistedSchedule";
import {
  type BrandPreset,
  type ThumbnailItem,
  type ThumbnailGenerateResult,
  type LedgerRow,
  type ThumbnailVariant,
  type IdentityImage,
  UNCLE_DANIEL_PRESET,
  FIXTURE_VARIANTS,
  FIXTURE_LEDGER_ROWS,
  COST_USD,
  EMO_ROTATION,
  PAT_ROTATION,
} from "../thumbnail/types";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

/* ============================================================
   Internal helpers
   ============================================================ */

/** Try the real Tauri sidecar_call command; return null if it isn't there. */
async function tryInvoke<T>(method: string, params: unknown): Promise<T | null> {
  if (typeof window === "undefined" || !window.__TAURI_INTERNALS__) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke("sidecar_call", { method, params })) as T;
  } catch (err) {
    // sidecar_call not registered in desktop-2 shell yet — fall back to stub.
    // Don't log every call, only on first miss.
    if (!warned.has(method)) {
      warned.add(method);
      // eslint-disable-next-line no-console
      console.info(`[sidecar-stub] real RPC unavailable for "${method}" — using mock`);
    }
    void err;
    return null;
  }
}

const warned = new Set<string>();
const HR = 3600_000;

/** 2026-08-27 · per-stage timeout ceiling for runStage() below — see the
 *  doc comment there for why this exists.
 *
 *  2026-08-28 · corrected after a real external tester on real Apple
 *  Silicon hardware hit "run_stage timed out after 180000ms" on reframe
 *  — a job that was very likely still legitimately working, not lost.
 *  cut/reframe/thumbs all scale with REQUESTED CLIP COUNT (the UI offers
 *  10/30/100), and transcribe scales with source duration — the Python
 *  side already has its own honest, duration-scaled ceiling up to 3600s
 *  for exactly this reason (see sidecar.rs's SIDECAR_CALL_TIMEOUT_SECS
 *  comment). My first pass set flat ceilings tuned from small (3-10 clip)
 *  local test batches, which meant a real 100-clip run — or long-form
 *  source audio — could get cut off well before the backend's own
 *  correctly-scaled timeout ever had a chance to fire. A false timeout
 *  here is strictly worse than the 1h-hang problem this was meant to
 *  fix: it kills a job that was going to finish.
 *
 *  Revised priority: never cut off legitimate large-batch/long-form work.
 *  Stages whose duration is genuinely workload-dependent now sit close
 *  to (but under) the backend's own 3600s ceiling, so the backend's
 *  honest error wins first. Lost-request detection for those stages is
 *  correspondingly slower than the original per-stage-timeout intent —
 *  that's the accepted tradeoff until this is done properly (a timeout
 *  computed from known clip_count / duration_s, the way predictor.py
 *  already estimates these stages, rather than a flat guess). */
const STAGE_TIMEOUT_MS: Partial<Record<StageName, number>> & { _default: number } = {
  audio: 300_000,
  cut: 600_000,
  thumbs: 600_000,
  transcribe: 3_300_000,
  reframe: 1_800_000,
  llm: 600_000,
  _default: 1_800_000,
};

/** Sleep helper for mock pacing. */
const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/**
 * Drive a fake 7-stage pipeline. Emits engine:progress per stage at realistic
 * pacing (~6s total) then engine:complete. Aborts when the returned token
 * is signalled.
 */
async function driveMockPipeline(opts: {
  slug: string;
  url?: string;
  abort: AbortSignal;
}): Promise<void> {
  const PER_STAGE_MS = 850;
  for (const stage of STAGE_ORDER) {
    for (let p = 0; p <= 1; p += 0.25) {
      if (opts.abort.aborted) return;
      bus.emit("engine:progress", {
        stage,
        percent: p,
        slug: opts.slug,
        url: opts.url,
      });
      await wait(PER_STAGE_MS / 4);
    }
  }
  if (!opts.abort.aborted) {
    // D1.patch · the mock pipeline drives ALL stages (audio → thumbs), so
    // it emits the canonical full-pipeline completion event, matching what
    // the real `start_run` chain produces. The InlineCreatePanel gates on
    // `kind === "pick"` to advance to the done state.
    bus.emit("engine:complete", { kind: "pick", slug: opts.slug, url: opts.url });
  }
}

/** Currently active mock controller — so a second call cancels the first. */
let activeAbort: AbortController | null = null;
function newRun(): AbortController {
  activeAbort?.abort();
  activeAbort = new AbortController();
  return activeAbort;
}

// 2026-08-28 — observed live: two different YouTube URLs both ingested
// concurrently (two real yt-dlp downloads running side by side), even
// though InlineCreatePanel already has a "one job at a time" phase guard.
// Root cause: that guard lives in InlineCreatePanel's own local React
// state, but `ingestUrl` is also called from CreateClips.tsx via the
// separate shared `useEngineSession` context — two independent surfaces,
// two independent trackers, neither aware of the other. `ingestUrl` here
// is the one place every caller funnels through regardless of which UI
// surface triggered it, so the guard belongs here, not duplicated per
// component. A plain module-level boolean (not React state) so it's
// synchronous and can't be missed by a race between renders.
let ingestInFlight = false;

/** Real implementation behind `sidecar.ingestUrl` — kept as a standalone
 *  function so the module-level `ingestInFlight` guard (in the object
 *  method below) wraps it cleanly with try/finally regardless of which
 *  internal branch (Tauri RPC vs mock fallback) actually resolves. */
async function ingestUrlImpl(
  url: string,
  brief: string | undefined,
  intent: "clips" | "script" | undefined,
  clipCount: number | undefined,
  runId: string | undefined,
): Promise<{ project: ProjectMeta; downloaded_path?: string }> {
  if (typeof window !== "undefined" && (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");

      // RPC JWT injection · 2026-07-09 — pass the frontend's already-
      // authenticated JWT so the sidecar's hosted Anthropic proxy call
      // and /telemetry/clip_run POST never touch macOS Keychain during
      // clipping. Sourced from authStorage.getJwt() → the same key
      // authHeaders() reads for every backend fetch below.
      const licenseJwt = readLicenseJwt();

      // BUG · two independent raw `listen("sidecar:ingest_complete")`
      // registrations for the same Tauri channel — this function's own,
      // plus the one `mountTauriAdapter()` keeps mounted for the whole
      // app's lifetime (proven reliable: it's what makes the Workstation
      // stage cards correctly show "Ingest complete" in production).
      // Live-reproduced repeatedly on signed/notarized builds: the
      // adapter's listener fires (Workstation reflects it) while this
      // function's own second listener on the identical channel never
      // does — the promise then hangs until the 5-minute timeout with no
      // visible error, regardless of listener-registration ordering.
      // Fix: don't compete for a second raw Tauri subscription at all.
      // `mountTauriAdapter` already re-emits `sidecar:ingest_complete` /
      // `ingest_error` as `engine:complete` / `engine:error` (kind:
      // "ingest") on the app's own in-process bus — including the full
      // `project` payload (see tauri-adapter.ts `project: obj.project`).
      // `bus.on` is synchronous (a plain Map<Set>), so subscribing here
      // has no async registration gap to race in the first place.
      return await new Promise<{ project: ProjectMeta; downloaded_path?: string }>((resolve, reject) => {
        let stopped = false;
        const cleanup = () => {
          if (stopped) return;
          stopped = true;
          offComplete();
          offError();
          window.clearTimeout(timeoutId);
        };

        const timeoutId = window.setTimeout(() => {
          cleanup();
          reject(new Error("Ingest timed out after 5 minutes"));
        }, 5 * 60 * 1000);

        const offComplete = bus.on("engine:complete", (p) => {
          if (p.kind !== "ingest") return;
          if (typeof p.url === "string" && p.url !== url.trim()) return; // not ours
          cleanup();
          resolve({
            project: (p.project as ProjectMeta | undefined) ?? { ...FIXTURE_PROJECT, source_url: url, stages: {} },
            downloaded_path: (p.project as { source_path?: string } | undefined)?.source_path,
          });
        });
        const offError = bus.on("engine:error", (p) => {
          if (p.kind !== "ingest") return;
          if (typeof p.url === "string" && p.url !== url.trim()) return;
          cleanup();
          reject(new Error(p.human ?? p.error ?? "Ingest failed"));
        });

        // Both bus listeners are live (synchronously, above) before this
        // fires. Returns almost immediately with `{ started: true }`;
        // the real work runs in a sidecar thread and reports back via
        // the events above.
        invoke("sidecar_call", {
          method: "start_ingest_url",
          params: { url, brief, intent, clip_count: clipCount, run_id: runId, license_jwt: licenseJwt },
        }).catch((e: unknown) => {
          cleanup();
          reject(e instanceof Error ? e : new Error(String(e)));
        });
      });
    } catch (err) {
      if (!isSidecarUnavailable(err)) throw err;
      // Sidecar genuinely unavailable — fall through to mock.
    }
  }

  // Mock fallback · browser preview + Batch A→C transition window.
  const project: ProjectMeta = {
    ...FIXTURE_PROJECT,
    source_url: url,
    intent,
    stages: {},
  };
  const ctl = newRun();
  void driveMockPipeline({ slug: project.slug, url, abort: ctl.signal });
  return { project, downloaded_path: project.source_path };
}

/* ============================================================
   Public API — mirrors legacy desktop/src/lib/sidecar.ts shape
   ============================================================ */

export const sidecar = {
  /** URL ingest. Batch D D1.patch · swaps from sync `ingest_url` (download-
   *  only) to async `start_ingest_url` (background download), then awaits the
   *  `sidecar:ingest_complete` Tauri event to surface the downloaded_path.
   *  The chained call to `start_run` happens at the caller (InlineCreatePanel)
   *  so the legacy IG-010 non-blocking pattern is preserved without auto-
   *  chaining inside Python. Iron Gate IG-002 — no RPC contract drift, the
   *  underlying Python method names + payload shapes are unchanged. */
  async ingestUrl(
    url: string,
    brief?: string,
    intent?: "clips" | "script",
    /**
     * BUG-017 P2 · user-selected target clip count (10 / 30 / 100). Sidecar
     * accepts 1..100; anything outside that or `undefined` falls back to the
     * legacy adaptive prompt. Wired into method_ingest_url so the URL flow
     * stamps it onto Project.clip_count before stage_llm runs.
     */
    clipCount?: number,
    /**
     * Control Tower #4 · 2026-07-09 — client-generated uuid4 that ties
     * this ingest to every downstream stage event + the /telemetry/clip_run
     * ledger row + the hosted Anthropic proxy call. Undefined = sidecar
     * generates its own (backwards-compat).
     */
    runId?: string,
  ): Promise<{ project: ProjectMeta; downloaded_path?: string }> {
    if (ingestInFlight) {
      throw new Error("Already working on that link — give it a moment, no need to submit it again.");
    }
    ingestInFlight = true;
    try {
      return await ingestUrlImpl(url, brief, intent, clipCount, runId);
    } finally {
      ingestInFlight = false;
    }
  },

  /** Local-file ingest. Mirrors legacy startRun shape.
   *  Batch B · real RPC at desktop/src/lib/sidecar.ts:750 — method
   *  name + payload shape preserved verbatim. Iron Gate IG-002. */
  async startRun(
    sourcePath: string,
    brief?: string,
    intent?: "clips" | "script",
    /** BUG-017 P2 · target clip count (10 / 30 / 100). See ingestUrl. */
    clipCount?: number,
    /** Control Tower #4 · client-generated uuid4 · see ingestUrl. */
    runId?: string,
  ): Promise<{ project: ProjectMeta }> {
    // RPC JWT injection · 2026-07-09 — see ingestUrl.
    const licenseJwt = readLicenseJwt();
    try {
      return await sidecarCall<{ project: ProjectMeta }>("start_run", {
        source_path: sourcePath, brief, intent, clip_count: clipCount, run_id: runId, license_jwt: licenseJwt,
      });
    } catch (e) {
      if (!isSidecarUnavailable(e)) throw e;
      // Sidecar state not managed yet (Batch A → C transition window).
    }

    const project: ProjectMeta = {
      ...FIXTURE_PROJECT,
      source_path: sourcePath,
      intent,
      stages: {},
    };
    const ctl = newRun();
    void driveMockPipeline({ slug: project.slug, abort: ctl.signal });
    return { project };
  },

  /** Multi-file import. Skips transcode in the legacy contract. */
  async importReadyClips(paths: string[]): Promise<{ project: ProjectMeta }> {
    const real = await tryInvoke<{ project: ProjectMeta }>("import_ready_clips", { paths });
    if (real) return real;

    // Imported projects skip ingest/audio/transcribe/llm and start at "cut".
    const project: ProjectMeta = {
      ...FIXTURE_PROJECT,
      source_path: paths[0],
      clips: FIXTURE_PROJECT.clips.map((c) => ({ ...c, imported: true })),
      stages: { ingest: { done: true }, audio: { done: true }, transcribe: { done: true }, llm: { done: true } },
    };
    bus.emit("engine:complete", { kind: "ingest", slug: project.slug });
    return { project };
  },

  /** Lift transcript only · URL → transcript text (no clipping).
   *  2026-07-10 · sidecar returns `{ url, text, segments, meta, ... }`
   *  at top level, not the `transcript_text` alias the legacy wrapper
   *  assumed. Remap so callers get a stable `transcript_text` field
   *  regardless of what shape method_lift_transcript settles on. */
  async liftTranscript(url: string): Promise<{ url: string; transcript_text?: string }> {
    const real = await tryInvoke<{
      url?: string;
      text?: string;
      transcript_text?: string;
      transcript?: { text?: string };
    }>("lift_transcript", { url });
    if (real) {
      const text =
        (typeof real.transcript_text === "string" && real.transcript_text) ||
        (typeof real.text === "string" && real.text) ||
        (typeof real.transcript?.text === "string" && real.transcript.text) ||
        "";
      return { url: real.url ?? url, transcript_text: text };
    }
    const ctl = newRun();
    void (async () => {
      for (const stage of ["ingest", "audio", "transcribe"] as StageName[]) {
        for (let p = 0; p <= 1; p += 0.33) {
          if (ctl.signal.aborted) return;
          bus.emit("engine:progress", { stage, percent: p, url });
          await wait(250);
        }
      }
      if (!ctl.signal.aborted) bus.emit("engine:complete", { kind: "lift", url });
    })();
    return { url };
  },

  /** Fetch a single project — reads the fixture when no runtime.
   *  Batch B · real RPC at desktop/src/lib/sidecar.ts:791 — method
   *  name + payload shape preserved verbatim. Iron Gate IG-002. */
  async getProject(slug: string): Promise<{ project: ProjectMeta }> {
    // Codex debug-project seam · Playwright can inject a debug project
    // via `window.__lcDebugProjects[slug]` for browser-harness runs, so
    // tests can drive the reducer without a real sidecar. Localhost only.
    const isLocalBrowserHarness =
      typeof window !== "undefined"
      && (window.location.protocol === "http:" || window.location.protocol === "https:")
      && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
    if (isLocalBrowserHarness) {
      const debugProject = window.__lcDebugProjects?.[slug];
      if (debugProject) return { project: structuredClone(debugProject) };
    }
    // Claude force-error seam · lets Playwright force the reject path so
    // the C3 mid-run-hydration dedup toast can be exercised (no Tauri IPC
    // available in Vite dev; getProject would otherwise silently return
    // the fixture). Production code never sets this flag. Ordered AFTER
    // the debug-project seam so a test that seeds both flags still hits
    // the injected project first — the two seams are independent.
    if (
      typeof window !== "undefined" &&
      (window as unknown as { __lcForceGetProjectError?: boolean }).__lcForceGetProjectError
    ) {
      throw new Error("harness · forced getProject failure");
    }
    try {
      return await sidecarCall<{ project: ProjectMeta }>("get_project", { slug });
    } catch (e) {
      if (!isSidecarUnavailable(e)) throw e;
    }
    return { project: { ...FIXTURE_PROJECT, slug } };
  },

  /** Run a single pipeline stage.
   *  2026-06-24 · swapped tryInvoke → sidecarCall to wire the real Python
   *  sidecar (post-ingest pipeline: audio · transcribe · llm · cut · reframe
   *  · thumbs). isSidecarUnavailable() fall-through preserves the mock
   *  behaviour for browser-preview (Vite dev / Playwright harness) where
   *  the Tauri sidecar isn't running. Iron Gate IG-002 · method name +
   *  payload shape unchanged.
   *
   *  2026-08-27 · per-stage timeout ceiling. Observed live: a stage request
   *  occasionally never reaches (or never returns from) the sidecar — no
   *  error, no progress event, nothing — and the Rust bridge's own safety
   *  net is 3600s, so the caller (drivePostIngestStages / InlineCreatePanel's
   *  stage loops) just hangs on that one `await` forever with no retry path
   *  reachable from the UI. Every stage here has a real, repeatedly-measured
   *  ceiling (audio <1s, cut <1s, thumbs ~5-15s, transcribe/reframe tens of
   *  seconds even on long content post-chunking-fix, llm up to ~2-3min with
   *  auto-extend retries) — these timeouts sit at generous multiples of
   *  that, so a legitimate slow run is never cut off, but a genuinely lost
   *  request now surfaces as a retryable engine:error within minutes
   *  instead of up to an hour of silent nothing. */
  async runStage(slug: string, stage: StageName): Promise<{ project: ProjectMeta }> {
    // RPC JWT injection · 2026-07-09 — hosted Anthropic proxy + telemetry
    // POST both fire from inside stages; sidecar caches for the duration
    // of the process but the run-stage entrypoint keeps it fresh across
    // sign-out/sign-in swaps.
    const licenseJwt = readLicenseJwt();
    const timeoutMs = STAGE_TIMEOUT_MS[stage] ?? STAGE_TIMEOUT_MS._default;
    try {
      return await withCancelOnTimeout(
        sidecarCall<{ project: ProjectMeta }>("run_stage", { slug, stage, license_jwt: licenseJwt }),
        timeoutMs,
        "run_stage",
        slug,
      );
    } catch (e) {
      if (!isSidecarUnavailable(e)) throw e;
    }
    bus.emit("engine:progress", { stage, percent: 1, slug });
    return { project: FIXTURE_PROJECT };
  },

  /** Generate more clips on an existing project. v2.2 Batch 1 — swapped
   *  from `start_pick_more_clips` (background fire-and-forget) to the
   *  blocking `pick_more_clips` method, matching the legacy desktop
   *  contract at desktop/src/lib/sidecar.ts:939. The blocking shape is
   *  what `ResultsGrid` expects — `await sidecar.pickMoreClips()` then
   *  re-read project. No JS-side timeout: LLM + ffmpeg for many clips
   *  can be several minutes; the Rust 1h safety net is the only ceiling
   *  and the UI shows in-flight state. Iron Gate IG-002. */
  async pickMoreClips(slug: string): Promise<{ project: ProjectMeta; added?: number; skipped?: number }> {
    try {
      return await sidecarCall<{ project: ProjectMeta; added: number; skipped: number }>(
        "pick_more_clips",
        { slug },
      );
    } catch (e) {
      if (!isSidecarUnavailable(e)) throw e;
    }
    bus.emit("engine:progress", { stage: "llm", percent: 0.5, slug });
    window.setTimeout(() => bus.emit("engine:complete", { kind: "pick", slug }), 1200);
    return { project: FIXTURE_PROJECT };
  },

  /** Re-cut a single clip. v2.2 Batch 1 — swapped from `start_regenerate_clip`
   *  (background) to the blocking `regenerate_clip` method, matching legacy
   *  desktop/src/lib/sidecar.ts:927. Wrapped in `withCancelOnTimeout` (180s
   *  ceiling, drops `.cancel` marker on timeout so a stuck ffmpeg child
   *  aborts at next poll). Iron Gate IG-002. */
  async regenerateClip(slug: string, idx: number, start: number, end: number): Promise<{ project: ProjectMeta }> {
    try {
      return await withCancelOnTimeout(
        sidecarCall<{ project: ProjectMeta }>("regenerate_clip", { slug, idx, start, end }),
        180_000,
        "regenerate_clip",
        slug,
      );
    } catch (e) {
      if (!isSidecarUnavailable(e)) throw e;
    }
    bus.emit("engine:progress", { stage: "cut", percent: 0.5, slug, idx });
    window.setTimeout(() => bus.emit("engine:complete", { kind: "regenerate", slug, idx }), 1200);
    return { project: FIXTURE_PROJECT };
  },

  /** Start an overlay bake job (returns immediately; events drive UI). */
  async startOverlayBake(slug: string, idx: number, overlay: unknown): Promise<{ started: boolean; completed?: boolean }> {
    const real = await tryInvoke<{ started: boolean }>("start_overlay_bake", { slug, idx, overlay });
    if (real) return real;
    bus.emit("engine:progress", { stage: "bake", percent: 0.0, slug, idx });
    window.setTimeout(() => bus.emit("engine:complete", { kind: "bake", slug, idx }), 1400);
    return { started: true, completed: true };
  },

  /** Cancel an overlay bake job. */
  async cancelOverlayBake(slug: string, idx: number): Promise<{ canceled: boolean }> {
    const real = await tryInvoke<{ canceled: boolean }>("cancel_overlay_bake", { slug, idx });
    return real ?? { canceled: true };
  },

  /** Update a single clip's platforms. */
  async setClipPlatforms(slug: string, idx: number, platforms: string[]): Promise<{ project: ProjectMeta }> {
    const real = await tryInvoke<{ project: ProjectMeta }>("set_clip_platforms", { slug, idx, platforms });
    return real ?? { project: FIXTURE_PROJECT };
  },

  /** Fetch captions for a clip. v2.2 Batch 1 — real RPC port from legacy
   *  desktop/src/lib/sidecar.ts:944. Returns the full legacy shape
   *  (lines/source/has_word_data/etc.) when the real sidecar answers; mock
   *  fallback keeps the narrow `{idx, style, lines}` shape for browser
   *  preview. Iron Gate IG-002. */
  async getCaptions(slug: string, idx: number): Promise<{
    idx: number;
    style: string;
    lines: unknown[];
    source?: "edits" | "transcript";
    has_word_data?: boolean;
    has_transcript?: boolean;
    transcript_error?: string | null;
    updated_at?: string | null;
    palette?: { primary?: string; secondary?: string; outline?: string } | null;
    position?: { align: 2 | 5 | 8; marginV: number } | null;
  }> {
    try {
      return await sidecarCall<{
        idx: number;
        style: string;
        lines: unknown[];
        source: "edits" | "transcript";
        has_word_data: boolean;
        has_transcript: boolean;
        transcript_error?: string | null;
        updated_at: string | null;
        palette?: { primary?: string; secondary?: string; outline?: string } | null;
        position?: { align: 2 | 5 | 8; marginV: number } | null;
      }>("get_captions", { slug, idx });
    } catch (e) {
      if (!isSidecarUnavailable(e)) throw e;
    }
    return { idx, style: "fuchsia-pop", lines: [] };
  },

  /**
   * BUG-035 · Edit captions for a clip. v2.2 Batch 1 — wired to real RPC.
   *
   * desktop-2's CaptionModule uses a simplified payload `{ text, style,
   * position }` (text is the single caption string). The legacy Python
   * `edit_captions` (sidecar.py:1657) requires `lines: list` of subtitle
   * line objects. We adapt by wrapping the single `text` into one
   * full-duration line; advanced per-word color + multi-line editing
   * lives behind the legacy 6-arg signature and is out of Batch 1 scope.
   *
   * Position arrives as a string in the simplified payload (e.g.
   * "bottom"); Python expects `{align: 2|5|8, marginV: 0..400}`. We
   * translate the three documented positions; unrecognised strings map
   * to the bottom default so the bake still ships a usable artifact.
   *
   * Mock fallback emits engine:progress + engine:complete so the UI's
   * state machine has a deterministic "done" signal in test/dev mode.
   * Iron Gate IG-002 — Python method name + outer payload shape preserved.
   */
  async editCaptions(
    slug: string,
    idx: number,
    payload: { text: string; style: string; position: string },
  ): Promise<{ ok: boolean }> {
    const adaptedPosition = ((): { align: 2 | 5 | 8; marginV: number } => {
      switch (payload.position) {
        case "top":    return { align: 8 as const, marginV: 60 };
        case "mid":
        case "middle": return { align: 5 as const, marginV: 0 };
        case "bottom":
        default:       return { align: 2 as const, marginV: 80 };
      }
    })();
    const adaptedLines = [{
      start: 0,
      end: 0,
      text: payload.text,
    }];
    try {
      await sidecarCall<{
        project: ProjectMeta;
        clip_idx: number;
        style: string;
        updated_at: string;
      }>("edit_captions", {
        slug,
        idx,
        lines: adaptedLines,
        style: payload.style,
        position: adaptedPosition,
      });
      return { ok: true };
    } catch (e) {
      if (!isSidecarUnavailable(e)) throw e;
    }
    bus.emit("engine:progress", { stage: "captions", percent: 0.5, slug, idx });
    await new Promise<void>((resolve) => {
      window.setTimeout(() => {
        bus.emit("engine:complete", { kind: "captions", slug, idx });
        resolve();
      }, 900);
    });
    return { ok: true };
  },

  /** Add a new clip slot at start/end seconds with title. v2.2 Batch 1
   *  port of legacy desktop/src/lib/sidecar.ts:995. Iron Gate IG-002. */
  async addClip(slug: string, start: number, end: number, title: string): Promise<{ project: ProjectMeta }> {
    try {
      return await sidecarCall<{ project: ProjectMeta }>("add_clip", { slug, start, end, title });
    } catch (e) {
      if (!isSidecarUnavailable(e)) throw e;
    }
    return { project: FIXTURE_PROJECT };
  },

  /** Duplicate an existing rendered clip without re-cutting (reuses MP4
   *  paths). New slug -v2/-v3, title "(copy)". v2.2 Batch 1 port of
   *  legacy desktop/src/lib/sidecar.ts:999. Note Python param name is
   *  `source_idx` (snake_case), not `sourceIdx`. Iron Gate IG-002. */
  async duplicateClip(slug: string, sourceIdx: number): Promise<{ project: ProjectMeta }> {
    try {
      return await sidecarCall<{ project: ProjectMeta }>("duplicate_clip", { slug, source_idx: sourceIdx });
    } catch (e) {
      if (!isSidecarUnavailable(e)) throw e;
    }
    return { project: FIXTURE_PROJECT };
  },

  /** Remove a clip from the project. v2.2 Batch 1 — real RPC port from
   *  legacy desktop/src/lib/sidecar.ts:1001. Iron Gate IG-002. */
  async removeClip(slug: string, idx: number): Promise<{ project: ProjectMeta }> {
    try {
      return await sidecarCall<{ project: ProjectMeta }>("remove_clip", { slug, idx });
    } catch (e) {
      if (!isSidecarUnavailable(e)) throw e;
    }
    return { project: FIXTURE_PROJECT };
  },

  /** Update clip metadata (title / description / pin). v2.2 Batch 1 port
   *  of legacy desktop/src/lib/sidecar.ts:1003. NOTE the Python contract
   *  spreads the `fields` object INTO params (`{slug, idx, ...fields}`)
   *  rather than nesting under `fields`. The previous stub nested under
   *  `fields` which Python would ignore — this Batch 1 port aligns the
   *  payload shape with the legacy contract. Iron Gate IG-002. */
  async updateClipMeta(
    slug: string, idx: number,
    fields: { title?: string; description?: string; pinned_comment?: string },
  ): Promise<{ project: ProjectMeta }> {
    try {
      return await sidecarCall<{ project: ProjectMeta }>("update_clip_meta", { slug, idx, ...fields });
    } catch (e) {
      if (!isSidecarUnavailable(e)) throw e;
    }
    return { project: FIXTURE_PROJECT };
  },
};

/** Abort the active mock pipeline (e.g. when leaving the route). */
export function abortActiveSidecarRun(): void {
  activeAbort?.abort();
  activeAbort = null;
}

/* ============================================================
   v2.2 Batch 1 (2026-06-24) · Top-level async control + warmup
   Mirrors legacy desktop/src/lib/sidecar.ts top-level helpers
   (1306–1311 + 919). Top-level (not on `sidecar` object) so they
   compose cleanly into the cockpit/results lifecycle hooks the
   way the legacy callers do. Iron Gate IG-002.
   ============================================================ */

/** Background-start "generate more clips". Returns immediately with
 *  `{ started: true }`; the work runs in a sidecar thread and emits
 *  pick_progress / pick_complete / pick_error events the React shell
 *  attaches to via on*Pick listeners. Use when the surface wants
 *  fine-grained progress + cancel, instead of `sidecar.pickMoreClips`'s
 *  blocking call. v2.2 Batch 1 port of legacy sidecar.ts:1306. */
export async function startPickMoreClips(slug: string): Promise<{ started: boolean }> {
  try {
    return await sidecarCall<{ started: boolean }>("start_pick_more_clips", { slug });
  } catch (e) {
    if (!isSidecarUnavailable(e)) throw e;
  }
  // Mock fallback — emit fake start so callers' wait-for-event hooks
  // settle without throwing. Real pipeline-complete signal still flows
  // through `sidecar.pickMoreClips` mock path.
  return { started: true };
}

/** Cancel a previously-started pick-more-clips run. Writes the per-
 *  project cancel marker; the sidecar's `_check_canceled` poll raises
 *  CancelledError at its next checkpoint. v2.2 Batch 1 port of
 *  legacy sidecar.ts:1308. */
export async function cancelPickMoreClips(slug: string): Promise<{ canceled: boolean; reason?: string }> {
  try {
    return await sidecarCall<{ canceled: boolean; reason?: string }>("cancel_pick_more_clips", { slug });
  } catch (e) {
    if (!isSidecarUnavailable(e)) throw e;
  }
  return { canceled: true, reason: "mock" };
}

/** Warm the faster-whisper model so first transcription doesn't pay the
 *  cold-load cost. Best fired once at app boot, after the sidecar is up.
 *  v2.2 Batch 1 port of legacy sidecar.ts:919. Returns the model name
 *  Python loaded + how long the warmup took. Safe to ignore the result.
 *  Iron Gate IG-002. */
export async function preloadWhisper(): Promise<{ model: string; warmup_seconds: number }> {
  try {
    return await sidecarCall<{ model: string; warmup_seconds: number }>("preload_whisper", {});
  } catch (e) {
    if (!isSidecarUnavailable(e)) throw e;
  }
  // Mock fallback — pretend the model is warm so callers don't retry.
  return { model: "mock-tiny", warmup_seconds: 0 };
}

/* ============================================================
   Thumbnail engine · Phase 6F stubs
   Mirrors the 13 sidecar.thumbnail* methods from legacy
   desktop/src/lib/sidecar.ts. Real-Tauri-first / mock-fallback,
   same pattern as the ingest methods above.
   ============================================================ */

/** In-memory storage for the stub side — survives nav between routes
 *  during a single page session. Real persistence comes via the legacy
 *  sidecar runtime (out of Phase 6F scope). */
const mockState = {
  brand: UNCLE_DANIEL_PRESET as BrandPreset,
  identity: [
    { path: "/brand/kade/kade-base.png",          name: "face_1.png", size: 248_000 },
    { path: "/brand/kade/kade-success.webp",      name: "face_2.png", size: 312_000 },
    { path: "/brand/kade/kade-reading-brief.webp", name: "face_3.png", size: 298_000 },
  ] as IdentityImage[],
  /** Episode-mode variants — per project slug (one episode = one project). */
  variantsBySlug: { } as Record<string, ThumbnailVariant[]>,
  /** Active YouTube thumbnail per slug. */
  coverBySlug: { } as Record<string, string | null>,
  /** Clip-mode variants — keyed `${slug}:${clipIdx}` */
  variantsByClip: { } as Record<string, ThumbnailVariant[]>,
  /** Active per-clip cover — keyed `${slug}:${clipIdx}` */
  clipCoverByClip: { } as Record<string, string | null>,
  ledger: [...FIXTURE_LEDGER_ROWS] as LedgerRow[],
};
mockState.variantsBySlug[FIXTURE_PROJECT.slug] = [...FIXTURE_VARIANTS];
mockState.coverBySlug[FIXTURE_PROJECT.slug] = FIXTURE_VARIANTS[0].path;

let activeBatchAbort: AbortController | null = null;

export const thumbnail = {
  // ---- Getters ----
  async getBrand(): Promise<{ preset: BrandPreset }> {
    const real = await tryInvoke<{ preset: BrandPreset }>("thumbnail_get_brand", {});
    return real ?? { preset: mockState.brand };
  },
  async getIdentity(): Promise<{ files: string[]; count: number; dir: string }> {
    const real = await tryInvoke<{ files: string[]; count: number; dir: string }>("thumbnail_get_identity", {});
    if (real) return real;
    return {
      files: mockState.identity.map((i) => i.path),
      count: mockState.identity.length,
      dir: "~/LiquidClips/identity/",
    };
  },
  async list(slug: string): Promise<{ thumbnails: ThumbnailVariant[]; dir: string }> {
    const real = await tryInvoke<{ thumbnails: ThumbnailVariant[]; dir: string }>("thumbnail_list", { slug });
    if (real) return real;
    return {
      thumbnails: mockState.variantsBySlug[slug] ?? [],
      dir: `~/LiquidClips/projects/${slug}/thumbnails/`,
    };
  },
  async getCover(slug: string): Promise<{ slug: string; cover_path: string | null; set_at: string | null }> {
    const real = await tryInvoke<{ slug: string; cover_path: string | null; set_at: string | null }>(
      "thumbnail_get_cover", { slug },
    );
    return real ?? {
      slug,
      cover_path: mockState.coverBySlug[slug] ?? null,
      set_at: mockState.coverBySlug[slug] ? new Date().toISOString() : null,
    };
  },
  async ledger(): Promise<{ rows: LedgerRow[]; total_usd: number; count: number }> {
    const real = await tryInvoke<{ rows: LedgerRow[]; total_usd: number; count: number }>("thumbnail_ledger", {});
    if (real) return real;
    const rows = mockState.ledger;
    return {
      rows,
      total_usd: rows.reduce((s, r) => s + r.cost_usd, 0),
      count: rows.length,
    };
  },

  // ---- Setters ----
  async saveBrand(preset: BrandPreset): Promise<{ preset: BrandPreset; path: string }> {
    const real = await tryInvoke<{ preset: BrandPreset; path: string }>("thumbnail_save_brand", { preset });
    mockState.brand = { ...preset };
    return real ?? { preset: mockState.brand, path: "~/LiquidClips/brand_preset.json" };
  },
  async saveIdentity(sources: string[]): Promise<{ files: string[]; count: number; dir: string }> {
    const real = await tryInvoke<{ files: string[]; count: number; dir: string }>(
      "thumbnail_save_identity", { sources },
    );
    if (real) return real;
    if (sources.length < 3) {
      throw new Error("Need at least 3 face crops to lock identity.");
    }
    mockState.identity = sources.map((s, i) => ({
      path: s, name: `face_${i + 1}.png`,
    }));
    return {
      files: mockState.identity.map((i) => i.path),
      count: mockState.identity.length,
      dir: "~/LiquidClips/identity/",
    };
  },
  async useAsCover(slug: string, path: string): Promise<{ slug: string; cover_path: string; choice_path: string }> {
    const real = await tryInvoke<{ slug: string; cover_path: string; choice_path: string }>(
      "thumbnail_use_as_cover", { slug, path },
    );
    mockState.coverBySlug[slug] = path;
    bus.emit("toast", {
      kind: "success",
      title: "Cover set",
      body: "Library will refresh with the new cover.",
    });
    return real ?? {
      slug, cover_path: path,
      choice_path: `~/LiquidClips/projects/${slug}/cover_choice.json`,
    };
  },

  // ---- Prompt preview (free, fast template) ----
  async previewPrompt(item: ThumbnailItem): Promise<{ prompt: string }> {
    const real = await tryInvoke<{ prompt: string }>("thumbnail_preview_prompt", { item });
    if (real) return real;
    const idx = Math.max(0, item.order - 1);
    const expression = EMO_ROTATION[idx % EMO_ROTATION.length];
    const pattern    = PAT_ROTATION[idx % PAT_ROTATION.length];
    const accentName = mockState.brand.accents?.[item.accent] ?? item.accent;
    const lines = [
      `Identity: ${mockState.brand.identity}.`,
      `Wardrobe: ${mockState.brand.wardrobe}.`,
      `Expression: ${expression}.`,
      `Layout: ${pattern}.`,
      `Accent palette: ${accentName}.`,
      `Headline: "${item.text}".`,
      item.metaphor ? `Metaphor: ${item.metaphor}.` : "",
      item.prop ? `Prop: ${item.prop}.` : "",
      "Use the attached image(s) as the EXACT fixed identity. Never describe the face — let the reference define it.",
    ].filter(Boolean);
    return { prompt: lines.join("\n") };
  },

  // ---- Generate (single, blocking) ----
  async generate(slug: string, item: ThumbnailItem): Promise<ThumbnailGenerateResult> {
    const real = await tryInvoke<ThumbnailGenerateResult>("thumbnail_generate", { slug, item });
    if (real) return real;
    // Mock pacing: emit progress over 3s
    const ctl = new AbortController();
    bus.emit("engine:progress", { stage: "thumbnail", percent: 0, slug });
    await wait(900);
    bus.emit("engine:progress", { stage: "thumbnail", percent: 0.4, slug });
    await wait(900);
    bus.emit("engine:progress", { stage: "thumbnail", percent: 0.85, slug });
    await wait(900);
    if (ctl.signal.aborted) throw new Error("Cancelled");
    const cost = COST_USD[item.quality];
    const path = `/brand/kade/kade-generating-captions.webp`;
    const variant: ThumbnailVariant = {
      id: `v-${Date.now()}`,
      path,
      name: `Variant · ${(Math.random() * 30 + 70).toFixed(0)}`,
      cost_usd: cost,
      model: mockState.brand.model,
      modified_at: new Date().toISOString(),
      score: Math.round(60 + Math.random() * 35),
    };
    mockState.variantsBySlug[slug] = [...(mockState.variantsBySlug[slug] ?? []), variant];
    mockState.ledger = [
      { ts: variant.modified_at, slug, model: variant.model, cost_usd: cost, output_path: path, title: item.text },
      ...mockState.ledger,
    ];
    bus.emit("engine:complete", { kind: "thumbnail-batch", slug });
    return {
      output_path: path,
      cost_usd: cost,
      model: mockState.brand.model,
      completed_at: variant.modified_at,
      prompt_used: "(mock prompt — runtime stub)",
      slug,
    };
  },

  async cancel(slug: string): Promise<{ slug: string; marker_path: string; requested: boolean }> {
    const real = await tryInvoke<{ slug: string; marker_path: string; requested: boolean }>(
      "thumbnail_cancel", { slug },
    );
    return real ?? {
      slug, marker_path: `~/LiquidClips/.thumbgen_cancel.${slug}`, requested: true,
    };
  },

  // ---- Batch (IG-010 non-blocking pair) ----
  async batchStart(slug: string, items: ThumbnailItem[]): Promise<{ started: boolean; total: number; slug: string }> {
    const real = await tryInvoke<{ started: boolean; total: number; slug: string }>(
      "thumbnail_batch_start", { slug, items },
    );
    if (real) return real;
    activeBatchAbort?.abort();
    const ctl = new AbortController();
    activeBatchAbort = ctl;
    const total = items.length;
    void (async () => {
      for (let i = 0; i < total; i++) {
        if (ctl.signal.aborted) {
          bus.emit("engine:error", {
            kind: "thumbnail-batch",
            slug,
            error: "batch_cancelled",
            human: `Cancelled at ${i} of ${total}.`,
            code: "canceled",
          });
          return;
        }
        bus.emit("engine:progress", { stage: "thumbnail", percent: i / total, slug, note: `Variant ${i + 1} of ${total}` });
        await wait(1100);
      }
      if (!ctl.signal.aborted) {
        bus.emit("engine:complete", { kind: "thumbnail-batch", slug });
      }
    })();
    return { started: true, total, slug };
  },
  async batchCancel(slug: string): Promise<{ canceled: boolean; reason?: string }> {
    const real = await tryInvoke<{ canceled: boolean; reason?: string }>("thumbnail_batch_cancel", { slug });
    activeBatchAbort?.abort();
    return real ?? { canceled: true, reason: "user-requested" };
  },

  /* ---- Phase 6F pivot · clip-mode helpers ---- */
  /** Per-clip variants (keyed `${slug}:${clipIdx}`). */
  async listForClip(slug: string, clipIdx: number): Promise<{ thumbnails: ThumbnailVariant[]; dir: string }> {
    const real = await tryInvoke<{ thumbnails: ThumbnailVariant[]; dir: string }>(
      "thumbnail_list_clip", { slug, idx: clipIdx },
    );
    if (real) return real;
    const key = `${slug}:${clipIdx}`;
    return {
      thumbnails: mockState.variantsByClip[key] ?? [],
      dir: `~/LiquidClips/projects/${slug}/clips/${clipIdx}/thumbnails/`,
    };
  },
  async getClipCover(slug: string, clipIdx: number): Promise<{ slug: string; idx: number; cover_path: string | null }> {
    const real = await tryInvoke<{ slug: string; idx: number; cover_path: string | null }>(
      "thumbnail_get_clip_cover", { slug, idx: clipIdx },
    );
    if (real) return real;
    const key = `${slug}:${clipIdx}`;
    return { slug, idx: clipIdx, cover_path: mockState.clipCoverByClip[key] ?? null };
  },
  async useAsClipCover(slug: string, clipIdx: number, path: string): Promise<{ slug: string; idx: number; cover_path: string }> {
    const real = await tryInvoke<{ slug: string; idx: number; cover_path: string }>(
      "thumbnail_use_as_clip_cover", { slug, idx: clipIdx, path },
    );
    const key = `${slug}:${clipIdx}`;
    mockState.clipCoverByClip[key] = path;
    bus.emit("toast", {
      kind: "success",
      title: "Clip cover set",
      body: "Clip will use this thumbnail in Library.",
    });
    return real ?? { slug, idx: clipIdx, cover_path: path };
  },
};

/** Expose for test reads — Phase 6F simulator. */
export function _readMockThumbnailState() {
  return mockState;
}

/* ============================================================
   Phase 6H · Export contracts
   Mirrors legacy desktop/src/lib/sidecar.ts shapes:
   - exportClip / startExportClip / cancelExportClip (IG-010 style pair)
   - listExportHistory
   Real-Tauri-first / mock-fallback with engine:progress + complete bus emits.
   ============================================================ */

const exportState = {
  history: [...FIXTURE_EXPORT_HISTORY] as ExportJob[],
};
let activeExportAbort: AbortController | null = null;

export interface ExportClipParams {
  slug: string;
  idx: number;
  format: ExportFormat;
  preset: ExportPreset;
  watermark: boolean;
  targetAccountIds?: string[];
}

// 2026-08-11 — recordClipExported() (POST /usage/clip-exported on a
// successful Export click) removed from here. Business decision
// (confirmed live by the app owner): the free-tier 100-clip counter now
// decrements the moment a clip finishes being cut/reframed/thumbnailed
// (python-sidecar/sidecar.py::_bill_newly_completed_clips), not when the
// user later chooses to Export it — the expensive compute already
// happened by then, and metering only on Export meant someone could run
// the pipeline unlimited times for free forever without ever exporting.
// Keeping this call here too would double-bill every real export (once
// at clip-completion, once again here). remaining_exports still flows
// back through the existing /sync -> trial.ts -> clipsRemaining path;
// the TrialStatusPill picks up the new count on its next refresh.
//
// Known gap, not addressed here: the "that was your last free clip"
// toast this used to fire is gone — the billing call now fires from a
// Python background thread with no direct path to the frontend's toast
// bus. The persistent "N clips left" pill still reflects the real count,
// it just won't pop a one-time notification at the exact moment. Flagged
// as a deliberate scope cut, not an oversight — real-time notification
// would need the sidecar to write a marker into project.json for the
// frontend's existing hydrate_project poll to pick up.

export const exportApi = {
  /** Single export job · blocking shape (matches legacy `regenerateClip`).
   *  Batch B · real RPC. Method name `export_clip` preserved. Iron Gate
   *  IG-002. Mock fallback unchanged.
   *
   *  Watchdog Rollout · cp-10 (2026-07-06) · async RPC boundary. Failures
   *  register a FailureRecord for the pipeline/cp-10/export-clip node so
   *  HQ Admin sees the money-moment surface health. Same watchdogWrap
   *  pattern C2 used for money/mo-05 schedule ops. */
  exportClip: watchdogWrap(
    {
      id: "pipeline/cp-10/export-clip",
      label: "Real MP4 export",
      cluster: "pipeline",
      source: "src/design-os/engine/sidecar-stub.ts:exportClip",
    },
    async (p: ExportClipParams): Promise<{ jobId: string; outputPath: string }> => {
    try {
      const result = await sidecarCall<{ jobId: string; outputPath: string }>("export_clip", p as unknown as Record<string, unknown>);
      // 2026-08-11 — the free-tier counter no longer bills here. See the
      // comment above exportApi for why (moved to clip-completion time,
      // sidecar-side).
      return result;
    } catch (e) {
      if (!isSidecarUnavailable(e)) throw e;
      // P0.3 · 2026-07-09 (Daniel's contract) — the sidecar-unavailable
      // path is a FIXTURE FALLBACK. In production (Tauri) it lies: a
      // synthetic `/projects/<slug>/clips/<idx>-export-<fmt>.mp4` path
      // makes the money moment look successful when no MP4 exists.
      //
      // Only browser preview / Vite dev / Playwright harness may use it.
      // In the installed app, sidecar-unavailable is a real error and
      // the Export button lands in error state.
      const isTauri =
        typeof window !== "undefined" &&
        "__TAURI_INTERNALS__" in window;
      if (isTauri) {
        throw new Error(
          "Sidecar unavailable · export cannot complete. Quit Liquid Clips and reopen — takes 5 seconds.",
        );
      }
    }

    activeExportAbort?.abort();
    const ctl = new AbortController();
    activeExportAbort = ctl;

    bus.emit("engine:progress", { stage: "export", percent: 0, slug: p.slug, idx: p.idx });
    for (let v = 0.15; v <= 0.95; v += 0.2) {
      if (ctl.signal.aborted) throw new Error("Cancelled");
      await wait(650);
      bus.emit("engine:progress", { stage: "export", percent: v, slug: p.slug, idx: p.idx, note: `Rendering ${p.format} · ${p.preset}` });
    }
    if (ctl.signal.aborted) throw new Error("Cancelled");

    const jobId = `ex-${Date.now()}`;
    // Browser-preview-only synthetic path · production Tauri path
    // returns/throws above so this only runs in Vite dev / Playwright.
    const outputPath = `/projects/${p.slug}/clips/${p.idx}-export-${p.format.replace(":", "-")}.mp4`;
    const job: ExportJob = {
      id: jobId,
      clipIdx: p.idx,
      clipTitle: FIXTURE_PROJECT.clips.find((c) => c.idx === p.idx)?.title ?? `Clip #${p.idx}`,
      format: p.format,
      preset: p.preset,
      watermark: p.watermark,
      targetAccountId: p.targetAccountIds?.[0],
      createdAt: new Date().toISOString(),
      status: "complete",
      durationS: 30,
      outputPath,
    };
    exportState.history = [job, ...exportState.history];
    bus.emit("engine:complete", { kind: "export", slug: p.slug, idx: p.idx });
    return { jobId, outputPath };
  }),

  /** Cancel the active export run. */
  async cancelExport(): Promise<{ canceled: boolean }> {
    const real = await tryInvoke<{ canceled: boolean }>("cancel_export", {});
    activeExportAbort?.abort();
    return real ?? { canceled: true };
  },

  /** Return the recent export queue history.
   *  Watchdog Rollout · cp-13 (2026-07-06) · async RPC boundary. */
  listHistory: watchdogWrap(
    {
      id: "pipeline/cp-13/export-history",
      label: "Export history persistence",
      cluster: "pipeline",
      source: "src/design-os/engine/sidecar-stub.ts:listHistory",
    },
    async (): Promise<{ jobs: ExportJob[] }> => {
      const real = await tryInvoke<{ jobs: ExportJob[] }>("list_export_history", {});
      return real ?? { jobs: exportState.history };
    },
  ),

  /** Save copy of the exported clip to a user-chosen path.
   *
   * Ship-lens P1-002 fix (2026-07-06) · tri-state return so callers
   * can distinguish "user cancelled" (dest null · reason "cancelled")
   * from "sidecar not wired" (dest null · reason "not_wired"). Prior
   * behaviour returned `{dest: null}` in both cases and callers had to
   * lie to users about which one happened. */
  /** Watchdog Rollout · cp-11 (2026-07-06) · async RPC boundary
   *  around the save-copy-as sidecar call. */
  saveCopyAs: watchdogWrap(
    {
      id: "pipeline/cp-11/save-copy-as",
      label: "Save copy as",
      cluster: "pipeline",
      source: "src/design-os/engine/sidecar-stub.ts:saveCopyAs",
    },
    async (outputPath: string): Promise<{
      dest: string | null;
      reason?: "cancelled" | "not_wired" | "not_found" | "error";
      error?: string;
    }> => {
    const real = await tryInvoke<{ dest: string | null; error?: string }>(
      "save_copy_as",
      { source: outputPath },
    );
    if (real) {
      if (real.dest) return { dest: real.dest };
      // Ship-lens RPC-contract fix (2026-07-06) · sidecar.py
      // (method_save_copy_as at desktop/python-sidecar/sidecar.py:4991)
      // returns typed error codes on `dest: null`. Prior wrapper collapsed
      // every null-dest into "cancelled" · a source-missing / copy-failed
      // failure surfaced as "Save cancelled · No destination selected" · a
      // user-visible lie. Translate error codes to typed reasons instead.
      if (real.error === "source_not_found") {
        return { dest: null, reason: "not_found", error: real.error };
      }
      if (real.error) {
        return { dest: null, reason: "error", error: real.error };
      }
      // null dest + no error is reserved for a future Tauri file-picker
      // cancel path · Python method today never returns this shape.
      return { dest: null, reason: "cancelled" };
    }
    // No sidecar available (dev / preview / test) · surface via reason
    // instead of a silent "cancelled" lie.
    return { dest: null, reason: "not_wired" };
  }),

  /** Reveal the exported clip in Finder / Explorer.
   *
   * Ship-lens P0-001 fix (2026-07-06) · tri-state so callers can
   * distinguish real "file missing" from "sidecar not wired". Prior
   * behaviour returned `{revealed: false}` in both cases and callers
   * would tell users the file was gone when the reveal handler was
   * simply unwired. */
  /** Watchdog Rollout · cp-12 (2026-07-06) · async RPC boundary. */
  revealInFinder: watchdogWrap(
    {
      id: "pipeline/cp-12/reveal-in-finder",
      label: "Reveal in Finder",
      cluster: "pipeline",
      source: "src/design-os/engine/sidecar-stub.ts:revealInFinder",
    },
    async (outputPath: string): Promise<{ revealed: boolean; reason?: "not_found" | "not_wired" | "error"; error?: string }> => {
      // 2026-07-09 · Route through @tauri-apps/plugin-opener JS API
      // (native permission opener:allow-reveal-item-in-dir already in
      // capabilities/default.json). The old custom `reveal_in_finder`
      // Rust command was never registered in the invoke_handler list;
      // this replaces the never-wired path.
      try {
        const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
        await revealItemInDir(outputPath);
        return { revealed: true };
      } catch (err) {
        // File missing / path invalid → the plugin throws. Distinguish
        // "not on disk" from "plugin unavailable in dev".
        const msg = String((err as Error)?.message || err || "");
        if (/no such file|not found|does not exist/i.test(msg)) {
          return { revealed: false, reason: "not_found", error: msg };
        }
        // Fallback to the legacy Rust command in case a future build
        // registers it; if that's also missing we surface not_wired.
        const legacy = await tryInvoke<{ revealed: boolean; error?: string }>("reveal_in_finder", { path: outputPath });
        if (legacy) {
          if (legacy.revealed) return { revealed: true };
          return {
            revealed: false,
            reason: legacy.error === "path_not_found" ? "not_found" : "error",
            error: legacy.error,
          };
        }
        return { revealed: false, reason: "not_wired", error: msg };
      }
    },
  ),
};

/** Expose mock state for tests. */
export function _readMockExportState() {
  return exportState;
}

/* ============================================================
   2026-07-05 · Agency campaign watermark overlay API
   Frontend wrappers around the sidecar's Remotion + ffmpeg
   composite pipeline. All 3 calls fall through to no-op mocks
   in dev / preview builds so components stay renderable when
   the sidecar isn't running.
   ============================================================ */

/** Config shape sent to the sidecar. Mirrors the backend Pydantic
 *  WatermarkOverlayConfig · snake_case JSON on the wire. */
export interface CampaignWatermarkConfig {
  logo_url: string;
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center-top" | "center-bottom";
  motion: "static" | "corner-pulse" | "fade-in-out" | "slide-in-left" | "lower-third";
  text: string | null;
  duration_frames: number;
  version: number;
}

/** Ship-lens P1-001 fix · when Tauri is present, real sidecar failures
 *  must bubble up as thrown errors instead of returning a silent
 *  mock-success shape (empty overlay_path). Callers can then show a
 *  proper error state to the user + telemetry can catch it. Only in
 *  browser preview / Vite dev / test do we return the mock. */
function tauriPresent(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Ship-lens P1-CW-003 fix · call the real Tauri sidecar_call directly
 *  (bypasses tryInvoke's silent-swallow branch) so structured errors
 *  from the Python sidecar (like "Remotion project not found") surface
 *  verbatim to the caller instead of a generic fabricated string. */
async function invokeOrThrow<T>(method: string, args: Record<string, unknown>): Promise<T> {
  if (!tauriPresent()) {
    throw new Error(`sidecar.${method} not available in preview build`);
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke("sidecar_call", { method, params: args })) as T;
  } catch (err) {
    // Preserve the real error message · include the method name so
    // callers + telemetry can triage without chasing the stack.
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`sidecar.${method} failed: ${detail}`);
  }
}

export const campaignOverlayApi = {
  /** Render the alpha overlay MOV for one campaign · one-time per
   *  (campaign_id, version). Idempotent · cached at
   *  ~/LiquidClips/campaign-overlays/<id>_v<n>.mov.
   *  Ship-lens P1-001 · throws in Tauri when the sidecar returns null. */
  async render(campaignId: string, config: CampaignWatermarkConfig, force = false): Promise<{ overlay_path: string; cached: boolean }> {
    if (!tauriPresent()) {
      // Dev / preview / test · no sidecar to call.
      return { overlay_path: "", cached: false };
    }
    return invokeOrThrow<{ overlay_path: string; cached: boolean }>("render_campaign_overlay", {
      campaign_id: campaignId,
      config,
      force,
    });
  },

  /** Cache check · returns overlay_path=null if the render hasn't happened yet.
   *  Ship-lens P1-001 · throws in Tauri when the sidecar rejects. */
  async getCached(campaignId: string, version = 1): Promise<{ overlay_path: string | null; cached: boolean }> {
    if (!tauriPresent()) {
      return { overlay_path: null, cached: false };
    }
    return invokeOrThrow<{ overlay_path: string | null; cached: boolean }>("get_campaign_overlay", {
      campaign_id: campaignId,
      version,
    });
  },

  /** Composite a cached overlay MOV onto an already-exported clip MP4.
   *  Ship-lens P1-001 · throws in Tauri when the sidecar rejects. */
  async composite(sourceMp4: string, overlayMov: string, outputMp4: string): Promise<{ output_path: string }> {
    if (!tauriPresent()) {
      return { output_path: sourceMp4 };
    }
    return invokeOrThrow<{ output_path: string }>("composite_campaign_overlay", {
      source_mp4: sourceMp4,
      overlay_mov: overlayMov,
      output_mp4: outputMp4,
    });
  },
};

/* ============================================================
   Phase 6I-A · Channels API
   Mirrors legacy desktop/src/lib/sidecar.ts + backend `/channels`
   endpoints. Real-Tauri-first / mock-fallback. Multi-account per
   platform supported. Single swap point: when the real sidecar lands,
   only this file changes.
   ============================================================ */

/** Channel-lifecycle status (distinct from job state). Maps cleanly into
 *  AccountState for UI rendering. */
export type ChannelStatus = "connected" | "expired" | "failed" | "locked" | "pending-link";

/** One published / queued / failed post for the recent-history list in
 *  ChannelDetailDrawer. Real Ayrshare history shape mirrors this. */
export interface ChannelPost {
  id: string;
  /** ISO UTC timestamp the post was made or scheduled for. */
  ts: string;
  /** Clip / source title (display only). */
  title: string;
  /** Post status. */
  status: "posted" | "scheduled" | "failed" | "uploading";
  /** Public post URL when status === "posted". */
  postUrl?: string;
  /** Human error message when status === "failed". */
  error?: string;
}

export interface SidecarChannel {
  id: string;
  platform: Platform;
  /** User-facing label (e.g. "TikTok · @preview-clipper-01"). */
  label: string;
  /** @handle without prefix. */
  handle: string;
  avatar?: string;
  /** Channel-lifecycle status. */
  status: ChannelStatus;
  /** Brand ownership · Phase 6I-A shim = user_id (per audit §11.4). */
  brandId: string;
  brandLabel?: string;
  /** Minimum tier the user needed to connect this account. */
  tierRequirement: "clipper" | "pro" | "agency";
  /** Ayrshare profileKey (unique per channel). */
  ayrshareProfileKey?: string;
  /** Last successful publish timestamp · ISO UTC. */
  lastPublishAt?: string;
  /** Posts this month for connection-health surface. */
  monthlyPostCount?: number;
  /** Token expiry · ISO UTC. */
  tokenExpiresAt?: string;
  /** Optional recent-post history (newest first). */
  recentPosts?: ChannelPost[];
  createdAt: string;
}

/** Map channel-lifecycle status to AccountState for UI rendering. */
export function channelStatusToAccountState(status: ChannelStatus): AccountState {
  switch (status) {
    case "connected":    return "connected";
    case "expired":      return "account-expired";
    case "failed":       return "failed";
    case "locked":       return "plan-limit-reached";
    case "pending-link": return "pending-link";
  }
}

/** Adapt a SidecarChannel to a TargetAccount (for AccountChipState + targets row). */
export function channelToTargetAccount(c: SidecarChannel): TargetAccount {
  return {
    id: c.id,
    platform: c.platform,
    label: c.label,
    handle: c.handle,
    avatar: c.avatar,
    state: channelStatusToAccountState(c.status),
    brandLabel: c.brandLabel,
  };
}

/* BUG-043 · channel cache. Initialized empty so mock-mode customers
 * never see "connected" channels they don't own. The previous initial
 * seed of 10 realistic-looking channels (@preview-clipper-01 / @preview-clipper-03 /
 * etc.) was a FAKE — it presented those accounts as if they were the
 * customer's connections. Real backend path (real-http / real-rpc) still
 * works: `channels.list()` overwrites this cache with adapted backend
 * rows. Disconnect/refresh mutate this cache, so they still work against
 * real-http data. */
const channelState: { channels: SidecarChannel[]; forcedSource?: "real-http" | "real-rpc" | "mock" } = {
  channels: [],
};

/* 2026-06-23 · puppeteer-only test seam · mirrors useTierCaps's
 * __lcDebugSetTier pattern. Lets a Playwright test seed
 * `channelState.channels` (and the resolved source) before the page
 * reads them, without spoofing __TAURI_INTERNALS__ or wiring
 * VITE_BACKEND_URL. Used by tests/e2e/platform-icons-and-accountpack-proof.spec.ts
 * to verify the +$6/mo accountpack CTA when free-tier user is at the
 * 1-channel cap. Safe in production — never invoked outside tests. */
declare global {
  interface Window {
    __lcDebugSeedChannels?: (
      channels: SidecarChannel[],
      source?: "real-http" | "real-rpc" | "mock",
    ) => void;
  }
}
declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Window { __lcDebugChannelState?: any }
}
if (typeof window !== "undefined") {
  window.__lcDebugSeedChannels = (chs, source = "real-http") => {
    channelState.channels = chs;
    channelState.forcedSource = source;
    window.dispatchEvent(new CustomEvent("lc:debug-channels-seeded", {
      detail: { channels: chs, source },
    }));
  };
  // Expose channelState reference for debugging — confirms test seed took.
  window.__lcDebugChannelState = channelState;
}

// BUG-043 · was a Set of setTimeouts driving the fake-OAuth-after-3s.
// The fake-OAuth mock path is gone (honest throw); this var is dead.
// Kept-but-disabled to preserve module-level identity for any callers
// who imported it by mistake. Safe to delete in a later refactor.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const oauthPendingTimeouts = new Set<ReturnType<typeof setTimeout>>();
void oauthPendingTimeouts;

/* ============================================================
   Phase 6N-C · Channels reality pass · backend HTTP adapter
   ============================================================ */

/** License JWT for `/channels` + `/social/*` etc.
 *  P1-1B · the canonical storage adapter lives at `../../lib/authStorage`.
 *  Browser preview pastes a real JWT into `localStorage.lc.license.jwt.v1`
 *  to test the HTTP path without spinning up a Tauri install; that key
 *  is `LICENSE_JWT_STORAGE_KEY` and stays compatible. The Tauri Keychain
 *  path is a forward-ready hook in authStorage · not wired yet. */
import { getJwt as readLicenseJwt } from "../../lib/authStorage";

/** Build an `Authorization: Bearer <jwt>` header when a JWT is available. */
function authHeaders(): Record<string, string> {
  const jwt = readLicenseJwt();
  if (!jwt) return {};
  return { Authorization: `Bearer ${jwt}` };
}

/** Shape of the backend `/channels` response row. Mirrors
 *  `junior-backend/app/routes/channels.py:ChannelResponse`. */
interface BackendChannelResponse {
  id: string;
  label: string;
  platform: string;
  handle: string | null;
  status: string;                 // active | paused | expired | failed
  total_posts: number;
  last_refreshed_at: string | null;
  created_at: string;
}

/** Adapt backend SocialChannel.status → SidecarChannel.status. The
 *  backend uses publishing-lifecycle wording; the DOS uses
 *  ChannelStatus enum from community/types-like vocabulary. */
function adaptBackendChannelStatus(s: string): ChannelStatus {
  switch (s) {
    case "active":   return "connected";
    case "paused":   return "expired";    // paused = needs reactivation
    case "expired":  return "expired";
    case "failed":   return "failed";
    case "pending":  return "pending-link";
    default:         return "expired";
  }
}

/** Adapt one backend row → SidecarChannel. Fields not on the backend
 *  yet (brand, tier requirement, recent posts) get conservative
 *  defaults so the UI keeps rendering. */
function adaptBackendChannel(b: BackendChannelResponse): SidecarChannel {
  return {
    id: b.id,
    platform: b.platform as Platform,
    label: b.label,
    handle: b.handle ?? "",
    status: adaptBackendChannelStatus(b.status),
    /* `brandId` is a Phase 6I-A shim · backend doesn't carry one. Default
     *  to the caller-anchored brand bucket so the chip renders without
     *  breaking tier-cap math. */
    brandId: "brand-1",
    brandLabel: undefined,
    /* Tier requirement isn't on /channels yet. Default to "pro" so the
     *  AddAccount cap rendering stays conservative; real value will land
     *  when the backend adds tier metadata to the row. */
    tierRequirement: "pro",
    ayrshareProfileKey: undefined,
    lastPublishAt: b.last_refreshed_at ?? undefined,
    monthlyPostCount: b.total_posts,
    tokenExpiresAt: undefined,
    recentPosts: undefined,
    createdAt: b.created_at,
  };
}

export const channels = {
  async list(): Promise<{ channels: SidecarChannel[]; source: "real-rpc" | "real-http" | "mock" }> {
    /* 0 · Puppeteer-only seeded state · see __lcDebugSeedChannels above. */
    if (channelState.forcedSource) {
      return { channels: [...channelState.channels], source: channelState.forcedSource };
    }
    /* 1 · Real HTTP backend via bridgeToBackend · GET /channels returns
     *      a bare array (no wrapper). C1-T6 codemod (2026-07-05) · was
     *      tryInvoke("list_channels") + shouldTryHttpBackend fetch. */
    if (shouldTryHttpBackend()) {
      try {
        const j = await bridgeToBackend<
          BackendChannelResponse[] | { channels?: BackendChannelResponse[] }
        >("GET", "/channels");
        const rows = Array.isArray(j) ? j : (j.channels ?? []);
        const adapted = rows.map(adaptBackendChannel);
        channelState.channels = adapted;
        return { channels: adapted, source: "real-http" };
      } catch (err) {
        void err;
        /* fall through to mock · dev preview + CI harness path */
      }
    }
    /* 2 · Mock fallback */
    return { channels: [...channelState.channels], source: "mock" };
  },

  /** Start a connect flow. Phase 6I-A: NO real OAuth. Mock seeds a
   *  pending-link row and flips it to connected after a short delay so
   *  the UI can demo the lifecycle. */
  async connect(platform: Platform, label?: string): Promise<{ channel: SidecarChannel; linkUrl?: string }> {
    /* Real HTTP backend via bridgeToBackend · POST /channels returns
     *  ChannelCreateResponse { channel: ChannelResponse; link_url:
     *  string }. link_url is surfaced so the caller can open the OAuth
     *  handshake in the user's browser. C1-T6 codemod (2026-07-05) ·
     *  was tryInvoke("connect_channel") + shouldTryHttpBackend fetch. */
    if (shouldTryHttpBackend()) {
      try {
        const j = await bridgeToBackend<{ channel: BackendChannelResponse; link_url: string }>(
          "POST",
          "/channels",
          { platform, label: label ?? `${platform}` },
        );
        const adapted = adaptBackendChannel(j.channel);
        channelState.channels = [adapted, ...channelState.channels];
        bus.emit("toast", {
          kind: "info",
          title: "Connect link",
          body: "Opening OAuth in your browser.",
        });
        bus.emit("browse:open", {
          url: j.link_url,
          source: "settings",
          mirror: "whop",
          title: `Connect ${platform}`,
        });
        return { channel: adapted, linkUrl: j.link_url };
      } catch (err) {
        void err;
        /* fall through to honest-error mock branch below */
      }
    }
    /* BUG-043 · Honest mock fallback. The previous implementation seeded
     * a pending-link row with a fake `@new.<platform>.<rand>` handle,
     * fired a "Linking…" toast, then after 3s flipped to "connected"
     * with a fake `pk_mock_*` profile key. That was a FAKE OAuth — the
     * customer thought they'd connected an account when no backend ever
     * said so. Now: throw an honest error. The UI surfaces it via
     * useChannels.error so the customer sees what actually happened.
     *
     * Suppress the unused `label` param warning while keeping the
     * signature compatible with real-tauri / real-http branches. */
    void label;
    throw new Error(
      `Channels backend not reachable · OAuth for ${platform} requires a live /channels endpoint. Install the desktop app or connect a backend to manage channels.`,
    );
  },

  async disconnect(id: string): Promise<{ ok: boolean }> {
    /* Real HTTP backend via bridgeToBackend · DELETE /channels/{id}
     *  returns 204 No Content · bridge returns undefined and any non-
     *  2xx throws. C1-T6 codemod (2026-07-05). */
    if (shouldTryHttpBackend()) {
      try {
        await bridgeToBackend<void>("DELETE", `/channels/${encodeURIComponent(id)}`);
        const removed = channelState.channels.find((c) => c.id === id);
        channelState.channels = channelState.channels.filter((c) => c.id !== id);
        if (removed) {
          bus.emit("toast", { kind: "info", title: "Disconnected", body: `${removed.label} removed.` });
        }
        return { ok: true };
      } catch (err) {
        void err;
        /* fall through to mock */
      }
    }
    const removed = channelState.channels.find((c) => c.id === id);
    channelState.channels = channelState.channels.filter((c) => c.id !== id);
    if (removed) {
      bus.emit("toast", {
        kind: "info",
        title: "Disconnected",
        body: `${removed.label} removed.`,
      });
    }
    return { ok: true };
  },

  /** Re-fetch handle + status for a single channel. Used after OAuth
   *  redirect lands and for "Reconnect" affordance on expired chips. */
  async refresh(id: string): Promise<{ channel: SidecarChannel | null }> {
    /* Real HTTP backend via bridgeToBackend · POST /channels/{id}/refresh
     *  → ChannelResponse. C1-T6 codemod (2026-07-05). */
    if (shouldTryHttpBackend()) {
      try {
        const j = await bridgeToBackend<BackendChannelResponse>(
          "POST",
          `/channels/${encodeURIComponent(id)}/refresh`,
        );
        const adapted = adaptBackendChannel(j);
        channelState.channels = channelState.channels.map((c) => c.id === id ? adapted : c);
        return { channel: adapted };
      } catch (err) {
        void err;
        /* fall through to mock */
      }
    }
    const found = channelState.channels.find((c) => c.id === id);
    if (!found) return { channel: null };
    // Mock-side: if expired/failed, flip to pending-link → connected
    if (found.status === "expired" || found.status === "failed") {
      const next = { ...found, status: "pending-link" as ChannelStatus };
      channelState.channels = channelState.channels.map((c) => c.id === id ? next : c);
      bus.emit("toast", {
        kind: "info",
        title: "Re-linking…",
        body: `${found.label} · OAuth simulation in flight (3s).`,
      });
      setTimeout(() => {
        channelState.channels = channelState.channels.map((c) =>
          c.id === id ? { ...c, status: "connected", tokenExpiresAt: undefined } : c
        );
        bus.emit("toast", { kind: "success", title: "Re-linked", body: `${found.label} re-connected.` });
      }, 3000);
      return { channel: next };
    }
    return { channel: found };
  },
};

/** Expose mock state for tests. */
export function _readMockChannelState() {
  return channelState;
}

/* ============================================================
   Phase 6N-C · Ayrshare social connection state
   Mirrors `junior-backend/app/routes/social.py:ConnectionState`. The
   Channels surface uses this to decide whether to surface the global
   "connect Ayrshare profile" empty state vs the per-platform grid.
   ============================================================ */

export interface SocialConnectionState {
  connected: boolean;
  profileKeySet: boolean;
  platforms: string[];
  active: boolean;
  source: "real-rpc" | "real-http" | "mock";
}

const socialMockState: Omit<SocialConnectionState, "source"> = {
  connected: true,
  profileKeySet: true,
  platforms: ["tiktok", "instagram", "youtube", "x", "linkedin", "facebook"],
  active: true,
};

export const social = {
  async connections(): Promise<SocialConnectionState> {
    /* Real HTTP backend via bridgeToBackend · GET /social/connections
     *  → { connected, profile_key_set, platforms, active }. C1-T6
     *  codemod (2026-07-05). */
    if (shouldTryHttpBackend()) {
      try {
        const j = await bridgeToBackend<{
          connected: boolean;
          profile_key_set: boolean;
          platforms: string[];
          active: boolean;
        }>("GET", "/social/connections");
        return {
          connected: j.connected,
          profileKeySet: j.profile_key_set,
          platforms: j.platforms,
          active: j.active,
          source: "real-http",
        };
      } catch (err) {
        void err;
        /* fall through to mock */
      }
    }
    return { ...socialMockState, source: "mock" };
  },
};

/* Dev-only window hook · lets screenshots / tests mutate the channel fixture
 * without reaching for dynamic-import (which Vite may evaluate as a fresh
 * module instance). Only exposed in non-production builds. */
declare global {
  interface Window {
    __lcDebugSetChannelPlatform?: (id: string, platform: Platform, label?: string, handle?: string) => void;
  }
}
if (typeof window !== "undefined" && import.meta.env.DEV) {
  window.__lcDebugSetChannelPlatform = (id, platform, label, handle) => {
    const idx = channelState.channels.findIndex((c) => c.id === id);
    if (idx < 0) return;
    channelState.channels[idx] = {
      ...channelState.channels[idx],
      platform,
      label: label ?? channelState.channels[idx].label,
      handle: handle ?? channelState.channels[idx].handle,
    };
  };
}

/* ============================================================
   Phase 6J-A · Schedule API
   Foundation for the Schedule route. Real Ayrshare wiring lands
   later — same real-Tauri-first / mock-fallback pattern as the
   channels + export surfaces.
   ============================================================ */

export type ScheduledJobStatus =
  | "draft"
  | "scheduled"
  | "uploading"
  | "posted"
  | "failed"
  | "retrying"
  | "cancelled";

export interface ScheduledJob {
  id: string;
  clipId: string;
  clipTitle: string;
  projectSlug: string;
  campaignId?: string;
  campaignName?: string;
  /** All targets this job is bound to. Drives campaign fan-out later. */
  targetAccountIds: string[];
  /** Platform + account label/handle for the row-level chip without a join. */
  platform: Platform;
  accountLabel: string;
  accountHandle: string;
  /** ISO UTC. */
  scheduledFor: string;
  status: ScheduledJobStatus;
  retryCount: number;
  error?: string;
  captionOverride?: string;
  postUrl?: string;
  /** Local rendered video used by the assisted browser handoff. */
  outputPath?: string;
  /** Assisted = reminder + browser handoff; automatic = provider-owned. */
  deliveryMode?: "assisted" | "automatic";
  remindedAt?: string;
  handoffOpenedAt?: string;
  createdAt: string;
}

export interface ScheduleClipAccountSnapshot {
  id: string;
  platform: Platform;
  label: string;
  handle: string;
}

export interface ScheduleClipParams {
  clipId: string;
  clipTitle: string;
  projectSlug: string;
  targetAccountIds: string[];
  /** Optional snapshots — used when the caller's account ids don't map to
   *  the connected-channel registry (e.g. legacy FIXTURE_TARGET_ACCOUNTS). */
  accounts?: ScheduleClipAccountSnapshot[];
  /** A real rendered MP4/MOV path. Assisted scheduling is blocked without it. */
  outputPath: string;
  scheduledFor: string;
  /** Single shared caption — used when every target gets the same copy. */
  captionOverride?: string;
  /** Per-account caption override · keyed by accountId. Phase 6J-D.
   *  When present for an accountId, the resulting ScheduledJob uses this
   *  caption; otherwise falls back to captionOverride; otherwise undefined. */
  captionByAccountId?: Record<string, string>;
  campaignId?: string;
  campaignName?: string;
}

/* Customer builds start empty. Assisted jobs hydrate from localStorage and
 * real provider jobs merge in when the backend is reachable. */
const scheduleState: { jobs: ScheduledJob[] } = { jobs: [] };

const scheduleRetryTimeouts = new Set<ReturnType<typeof setTimeout>>();

/* ============================================================
   Phase 6N-C · Schedule reality pass · backend HTTP adapter
   Mirrors `junior-backend/app/routes/schedules.py:ScheduleResponse`.
   ============================================================ */

interface BackendScheduleResponse {
  id: string;
  project_slug: string;
  clip_idx: number;
  clip_title: string;
  platform: string;
  scheduled_for: string;
  status: string;
  post_url: string | null;
  live_url: string | null;
  error: string | null;
  created_at: string;
}

function adaptBackendScheduleStatus(s: string): ScheduledJobStatus {
  switch (s) {
    case "pending":
    case "scheduled":  return "scheduled";
    case "uploading":  return "uploading";
    case "published":  return "posted";
    case "failed":     return "failed";
    case "cancelled":  return "cancelled";
    case "retrying":   return "retrying";
    default:           return "scheduled";
  }
}

function adaptBackendSchedule(b: BackendScheduleResponse, accountId?: string): ScheduledJob {
  const platform = b.platform as Platform;
  return {
    id: b.id,
    clipId: `${b.project_slug}#${b.clip_idx}`,
    clipTitle: b.clip_title,
    projectSlug: b.project_slug,
    /* Backend rows are per-platform · no account binding yet, so we
     *  carry the row id as the target placeholder. When channels lookup
     *  resolves, the row gets a real ch- id. */
    targetAccountIds: [accountId ?? b.id],
    platform,
    accountLabel: platform,
    accountHandle: "",
    scheduledFor: b.scheduled_for,
    status: adaptBackendScheduleStatus(b.status),
    retryCount: 0,
    error: b.error ?? undefined,
    captionOverride: undefined,
    postUrl: b.live_url ?? b.post_url ?? undefined,
    createdAt: b.created_at,
  };
}

export const schedule = {
  async scheduleClip(p: ScheduleClipParams): Promise<{ jobs: ScheduledJob[] }> {
    if (!isUploadableVideoPath(p.outputPath)) {
      throw new Error("Export the clip before setting an assisted schedule.");
    }
    const ch = channelState.channels;
    const created: AssistedScheduleRecord[] = [];
    for (const accountId of p.targetAccountIds) {
      const channel = ch.find((c) => c.id === accountId);
      const snap = p.accounts?.find((a) => a.id === accountId);
      /* Fall back to a synthetic snapshot when neither side has the id —
       * caller still gets a job back rather than a silent drop. */
      const account = channel
        ? { platform: channel.platform, label: channel.label, handle: channel.handle }
        : snap
          ? { platform: snap.platform, label: snap.label, handle: snap.handle }
          : null;
      if (!account) continue;
      const perAccount = p.captionByAccountId?.[accountId];
      const job: AssistedScheduleRecord = {
        id: `asj-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
        clipId: p.clipId,
        clipTitle: p.clipTitle,
        projectSlug: p.projectSlug,
        campaignId: p.campaignId,
        campaignName: p.campaignName,
        targetAccountIds: [accountId],
        platform: account.platform,
        accountLabel: account.label,
        accountHandle: account.handle,
        scheduledFor: p.scheduledFor,
        status: "scheduled",
        retryCount: 0,
        /* Phase 6J-D · per-account caption wins, then single shared, then none. */
        captionOverride: perAccount ?? p.captionOverride,
        outputPath: p.outputPath,
        deliveryMode: "assisted",
        createdAt: new Date().toISOString(),
      };
      created.push(job);
    }
    await Promise.all(created.map(async (job) => {
      job.nativeNotificationScheduled = await scheduleAssistedNotification(job);
    }));
    upsertAssistedJobs(created);
    scheduleState.jobs = [...created, ...scheduleState.jobs.filter((job) => job.deliveryMode !== "assisted")];
    if (created.length > 0) {
      bus.emit("toast", {
        kind: "success",
        title: "Reminder set",
        body: created.length === 1
          ? `Liquid Clips will prepare the ${created[0].accountLabel} handoff at posting time.`
          : `${created.length} assisted posting reminders created.`,
      });
    }
    return { jobs: created };
  },

  async listScheduledClips(range?: { from?: string; to?: string }): Promise<{ jobs: ScheduledJob[]; source: "real-rpc" | "real-http" | "assisted-local" }> {
    const local = readAssistedSchedule();
    // 2026-07-05 · CM-T6 · discovery-wrapper swap. `/schedules` on the
    // backend returns a bare array, hence the `as BackendScheduleResponse[]`
    // cast at the receive site.
    if (shouldTryHttpBackend()) {
      try {
        const j = await bridgeToBackend<BackendScheduleResponse[]>("GET", "/schedules");
        const jobs = j.map((row) => adaptBackendSchedule(row));
        scheduleState.jobs = [...local, ...jobs];
        return { jobs: scheduleState.jobs, source: "real-http" };
      } catch (e) {
        if (!(e instanceof BridgeError)) throw e;
      }
    }
    scheduleState.jobs = local;
    if (!range || (!range.from && !range.to)) {
      return { jobs: [...scheduleState.jobs], source: "assisted-local" };
    }
    const fromT = range.from ? Date.parse(range.from) : -Infinity;
    const toT = range.to ? Date.parse(range.to) : Infinity;
    const jobs = scheduleState.jobs.filter((j) => {
      const t = Date.parse(j.scheduledFor);
      return t >= fromT && t <= toT;
    });
    return { jobs, source: "assisted-local" };
  },

  // mo-05 · Watchdog wrap · async RPC boundary. Failures surface as
  // FailureRecord to HQ Admin; the caller still sees the thrown error.
  cancelScheduledJob: watchdogWrap(
    {
      id: "money/mo-05/schedule-cancel",
      label: "Cancel scheduled job",
      cluster: "money",
      source: "src/design-os/engine/sidecar-stub.ts:cancelScheduledJob",
    },
    async (id: string): Promise<{ ok: boolean }> => {
    const local = readAssistedSchedule().find((job) => job.id === id);
    if (local) {
      await cancelAssistedNotification(id);
      patchAssistedJob(id, { status: "cancelled" });
      scheduleState.jobs = scheduleState.jobs.map((job) => (
        job.id === id ? { ...job, status: "cancelled" } : job
      ));
      bus.emit("toast", { kind: "info", title: "Reminder cancelled", body: local.clipTitle });
      return { ok: true };
    }
    // 2026-07-05 · CM-T6 · discovery-wrapper swap. Backend
    // DELETE /schedules/{id} returns 204 No Content. bridgeToBackend
    // parses 204 as void via its typed return contract.
    if (shouldTryHttpBackend()) {
      try {
        await bridgeToBackend<void>(
          "DELETE",
          `/schedules/${encodeURIComponent(id)}`,
        );
        const found = scheduleState.jobs.find((j) => j.id === id);
        scheduleState.jobs = scheduleState.jobs.map((j) => j.id === id ? { ...j, status: "cancelled" } : j);
        if (found) {
          bus.emit("toast", { kind: "info", title: "Cancelled", body: `${found.accountLabel} · ${found.clipTitle}` });
        }
        return { ok: true };
      } catch (e) {
        if (!(e instanceof BridgeError)) throw e;
      }
    }
    const found = scheduleState.jobs.find((j) => j.id === id);
    if (!found) return { ok: false };
    scheduleState.jobs = scheduleState.jobs.map((j) => j.id === id ? { ...j, status: "cancelled" } : j);
    bus.emit("toast", { kind: "info", title: "Cancelled", body: `${found.accountLabel} · ${found.clipTitle}` });
    return { ok: true };
  }),

  // mo-05 · Watchdog wrap · reschedule RPC (rescheduleJob).
  rescheduleJob: watchdogWrap(
    {
      id: "money/mo-05/schedule-reschedule",
      label: "Reschedule scheduled job",
      cluster: "money",
      source: "src/design-os/engine/sidecar-stub.ts:rescheduleJob",
    },
    async (id: string, scheduledFor: string): Promise<{ job: ScheduledJob | null }> => {
    const local = readAssistedSchedule().find((job) => job.id === id);
    if (local) {
      await cancelAssistedNotification(id);
      const next = patchAssistedJob(id, {
        scheduledFor,
        status: "scheduled",
        remindedAt: undefined,
        handoffOpenedAt: undefined,
        nativeNotificationScheduled: false,
      });
      if (next) {
        const nativeNotificationScheduled = await scheduleAssistedNotification(next);
        const persisted = patchAssistedJob(id, { nativeNotificationScheduled }) ?? next;
        scheduleState.jobs = scheduleState.jobs.map((job) => job.id === id ? persisted : job);
        bus.emit("toast", { kind: "info", title: "Reminder moved", body: local.clipTitle });
      }
      return { job: readAssistedSchedule().find((job) => job.id === id) ?? next };
    }
    // 2026-07-05 · CM-T6 · discovery-wrapper swap. No PATCH endpoint
    // for reschedule · chain DELETE-old + POST-new via bridgeToBackend
    // so the cron picks up the new time. The re-created row gets a
    // fresh server id.
    if (shouldTryHttpBackend()) {
      try {
        const existing = scheduleState.jobs.find((j) => j.id === id);
        if (existing) {
          await bridgeToBackend<void>(
            "DELETE",
            `/schedules/${encodeURIComponent(id)}`,
          );
          const j = await bridgeToBackend<BackendScheduleResponse>(
            "POST",
            "/schedules",
            {
              project_slug: existing.projectSlug,
              clip_idx: parseInt(existing.clipId.split("#").pop() ?? "0", 10) || 0,
              clip_title: existing.clipTitle,
              vertical_path: "",
              platform: existing.platform,
              scheduled_for: scheduledFor,
            },
          );
          const adapted = adaptBackendSchedule(j);
          scheduleState.jobs = scheduleState.jobs
            .filter((x) => x.id !== id)
            .concat([adapted]);
          bus.emit("toast", { kind: "info", title: "Rescheduled", body: `${existing.accountLabel} · new time set.` });
          return { job: adapted };
        }
      } catch (e) {
        if (!(e instanceof BridgeError)) throw e;
      }
    }
    const found = scheduleState.jobs.find((j) => j.id === id);
    if (!found) return { job: null };
    const next: ScheduledJob = { ...found, scheduledFor, status: "scheduled", error: undefined };
    scheduleState.jobs = scheduleState.jobs.map((j) => j.id === id ? next : j);
    bus.emit("toast", { kind: "info", title: "Rescheduled", body: `${found.accountLabel} · new time set.` });
    return { job: next };
  }),

  // mo-05 · Watchdog wrap · retry RPC (retryScheduledJob).
  retryScheduledJob: watchdogWrap(
    {
      id: "money/mo-05/schedule-retry",
      label: "Retry scheduled job",
      cluster: "money",
      source: "src/design-os/engine/sidecar-stub.ts:retryScheduledJob",
    },
    async (id: string): Promise<{ job: ScheduledJob | null }> => {
    // 2026-07-05 · CM-T8 · assisted-local retry path. For a local record
    // whose reminder-window passed without a completed handoff (e.g.
    // notification was dismissed, or app was closed at scheduledFor),
    // "retry" = re-arm the notification for +2 minutes from now and
    // clear the handoff/reminder stamps so the monitor treats it as
    // fresh. No backend call needed.
    const local = readAssistedSchedule().find((job) => job.id === id);
    if (local) {
      await cancelAssistedNotification(id);
      const nextTime = new Date(Date.now() + 2 * 60_000).toISOString();
      const next = patchAssistedJob(id, {
        scheduledFor: nextTime,
        status: "scheduled",
        remindedAt: undefined,
        handoffOpenedAt: undefined,
        nativeNotificationScheduled: false,
        retryCount: local.retryCount + 1,
        error: undefined,
      });
      if (next) {
        const nativeNotificationScheduled = await scheduleAssistedNotification(next);
        const persisted = patchAssistedJob(id, { nativeNotificationScheduled }) ?? next;
        scheduleState.jobs = scheduleState.jobs.map((job) => job.id === id ? persisted : job);
        bus.emit("toast", {
          kind: "info",
          title: "Retry armed",
          body: `${local.clipTitle} · reminder in 2 minutes.`,
        });
        return { job: persisted };
      }
    }
    // 2026-07-05 · CM-T6 · discovery-wrapper swap. Backend
    // POST /schedules/{id}/retry returns the updated ScheduleResponse.
    if (shouldTryHttpBackend()) {
      try {
        const j = await bridgeToBackend<BackendScheduleResponse>(
          "POST",
          `/schedules/${encodeURIComponent(id)}/retry`,
        );
        const adapted = adaptBackendSchedule(j);
        scheduleState.jobs = scheduleState.jobs.map((x) => x.id === id ? adapted : x);
        bus.emit("toast", { kind: "info", title: "Retrying", body: `${adapted.accountLabel}` });
        return { job: adapted };
      } catch (e) {
        if (!(e instanceof BridgeError)) throw e;
      }
    }
    const found = scheduleState.jobs.find((j) => j.id === id);
    if (!found) return { job: null };
    const retrying: ScheduledJob = {
      ...found,
      status: "retrying",
      retryCount: found.retryCount + 1,
      error: found.error,
    };
    scheduleState.jobs = scheduleState.jobs.map((j) => j.id === id ? retrying : j);
    bus.emit("toast", { kind: "info", title: "Retrying", body: `${found.accountLabel} · attempt ${retrying.retryCount + 1}` });
    /* Resolve the retry after a short beat — most retries succeed in the mock.
     * Channels still in expired/failed lifecycle bubble back to "failed". */
    const t = setTimeout(() => {
      const channel = channelState.channels.find((c) => c.id === retrying.targetAccountIds[0]);
      const willFail = channel && (channel.status === "expired" || channel.status === "failed");
      scheduleState.jobs = scheduleState.jobs.map((j) =>
        j.id === id
          ? willFail
            ? { ...j, status: "failed", error: "Channel still needs reconnect" }
            : { ...j, status: "posted", error: undefined, postUrl: `https://example.com/mock/${id}` }
          : j
      );
      bus.emit("toast", {
        kind: willFail ? "error" : "success",
        title: willFail ? "Retry failed" : "Posted",
        body: `${found.accountLabel}`,
      });
      scheduleRetryTimeouts.delete(t);
    }, 2200);
    scheduleRetryTimeouts.add(t);
    return { job: retrying };
  }),
};

/** Expose mock state for tests. */
export function _readMockScheduleState() {
  return scheduleState;
}

/* ============================================================
   Phase 6L-A · Community API
   Mirrors legacy desktop CommunityTab.fetchChannels (real backend),
   plus a leaderboard preview slice. Real-Tauri-first / fetch-backend /
   mock-fallback. Single swap point: when the real sidecar lands, only
   this file changes.
   ============================================================ */

import type {
  CommunityChannel,
  LeaderboardPreviewRow,
  AnnouncementItem,
  BannerItem,
  BannerPlacement,
} from "../community/types";

/** Backend URL — mirrors legacy `lib/backend.ts`. Falls back to prod
 *  liquidclips.app when VITE_BACKEND_URL isn't set. */
function backendUrl(): string {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  try {
    const v = (import.meta as any).env?.VITE_BACKEND_URL as string | undefined;
    if (typeof v === "string" && v.length > 0) return v;
  } catch { /* noop */ }
  return "https://api.liquidclips.app";
}

/** Should we try the HTTP backend? In a Tauri runtime we always do (no
 *  CORS — Tauri handles allowlist). In plain browser preview we only
 *  attempt when the caller has explicitly opted-in via VITE_BACKEND_URL,
 *  otherwise we skip straight to mock to avoid noisy CORS console spam
 *  hitting prod from localhost. */
function shouldTryHttpBackend(): boolean {
  if (typeof window === "undefined") return false;
  if (window.__TAURI_INTERNALS__) return true;
  /* Browser-journey seam: localhost may opt into the real HTTP adapter so
   * Playwright can intercept and prove live response mapping. The guard is
   * deliberately impossible on the packaged app or production website. */
  try {
    const host = window.location.hostname;
    if (
      (host === "localhost" || host === "127.0.0.1")
      && window.localStorage.getItem("lc.dev.force-http.v1") === "1"
    ) {
      return true;
    }
  } catch { /* storage/location unavailable · continue to env gate */ }
  /* eslint-disable @typescript-eslint/no-explicit-any */
  try {
    const v = (import.meta as any).env?.VITE_BACKEND_URL as string | undefined;
    return typeof v === "string" && v.length > 0;
  } catch { /* noop */ }
  return false;
}

/* Seed mock matching the REAL CommunityChannel shape (NOT the simulator
 * fakeCommunity shape). Mirrors `seed_community_channels.py` minus
 * Whop chat ids — those land via Admin HQ in prod.
 *
 * Phase 6L-B transitional notes — when Campaigns ships in Phase 6M:
 *   - `free-clipper-lobby`     → collapse into a single Help/Support slot.
 *   - `affiliate-growth-room`  → collapse into Affiliate Growth campaign
 *                                discussion (no standalone room).
 *   - All `mission` rows       → become campaign discussions, one per
 *                                campaign · Community surface stops
 *                                listing them directly.
 *   - `announcements`          → stays as the single announcement slot.
 *   - `premium-rewards-hq`     → collapses into the Rewards landing
 *                                inside the Campaigns route.
 */
const communityState: {
  channels: CommunityChannel[];
  viewerTier: string;
  leaderboardPreview: LeaderboardPreviewRow[];
  announcements: AnnouncementItem[];
  banners: BannerItem[];
  /** When true → the route surfaces "Studio preview · mock" tag. */
  isMockFallback: boolean;
} = {
  channels: [],
  viewerTier: "pro",
  /* BUG-045 · leaderboard cache. Initialized empty so mock-mode customers
   * never see fake top-earner handles (@maya.clips · $12,420 · 88 refs,
   * @preview-clipper-01 · $9,870 · 64 refs · isCaller=true, etc.) presented as
   * real social proof. Real backend path (real-http via /leaderboard/earnings)
   * still works: `community.leaderboardPreview()` overwrites this cache.
   * The historical 5-row fixture is preserved as LEGACY_LEADERBOARD_FIXTURE
   * below for future dev-fixture use, but is not read by production code. */
  leaderboardPreview: [],
  /* Phase 6L-A · audit could not confirm a public /announcements endpoint.
   * Seed empty so the rail renders a safe empty state, not faked posts. */
  announcements: [],
  /* Phase 6L-C · `community_top` banner seed · single item for screenshot
   * fidelity. Real backend already exposes admin POST/PATCH for banners
   * (junior-backend/app/routes/admin.py:1819). A future public GET swaps
   * this seed without UI changes. */
  banners: [] as BannerItem[],
  isMockFallback: true,
};

export const community = {
  async listChannels(p?: { clerkUserId?: string }): Promise<{
    channels: CommunityChannel[];
    viewerTier: string;
    source: "real-rpc" | "real-http" | "mock";
  }> {
    /* 1 · Real Tauri RPC */
    const real = await tryInvoke<{ channels: CommunityChannel[]; viewer_tier: string }>(
      "list_community_channels",
      p ?? {},
    );
    if (real) {
      communityState.channels = real.channels;
      communityState.viewerTier = real.viewer_tier;
      communityState.isMockFallback = false;
      return { channels: real.channels, viewerTier: real.viewer_tier, source: "real-rpc" };
    }
    /* 2 · Real HTTP backend (legacy desktop path) · skipped in plain
     *  browser preview unless VITE_BACKEND_URL was set, so localhost
     *  tests don't fire CORS-blocked requests against prod. */
    if (shouldTryHttpBackend()) {
      try {
        const q = p?.clerkUserId ? `?clerk_user_id=${encodeURIComponent(p.clerkUserId)}` : "";
        const r = await fetch(`${backendUrl()}/community/channels${q}`, { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as { channels?: CommunityChannel[]; viewer_tier?: string };
          if (Array.isArray(j.channels)) {
            communityState.channels = j.channels;
            communityState.viewerTier = j.viewer_tier ?? communityState.viewerTier;
            communityState.isMockFallback = false;
            return { channels: j.channels, viewerTier: communityState.viewerTier, source: "real-http" };
          }
        }
      } catch {
        /* Network unreachable in dev/CI runs — fall through to seeded mock. */
      }
    }
    /* 3 · Mock fallback */
    communityState.isMockFallback = true;
    return {
      channels: [...communityState.channels],
      viewerTier: communityState.viewerTier,
      source: "mock",
    };
  },

  async leaderboardPreview(): Promise<{ rows: LeaderboardPreviewRow[]; source: "real-rpc" | "real-http" | "mock" }> {
    // 2026-07-05 · CM-T6 · discovery-wrapper swap.
    if (shouldTryHttpBackend()) {
      try {
        const j = await bridgeToBackend<{ entries?: Array<{ rank: number; display_handle: string; lifetime_earnings_usd: number; paid_referrals: number; is_caller: boolean }> }>(
          "GET",
          "/leaderboard/earnings",
        );
        if (Array.isArray(j.entries)) {
          const rows = j.entries.slice(0, 5).map((e) => ({
            rank: e.rank,
            displayHandle: e.display_handle,
            lifetimeEarningsUsd: e.lifetime_earnings_usd,
            paidReferrals: e.paid_referrals,
            isCaller: e.is_caller,
          }));
          return { rows, source: "real-http" };
        }
      } catch (e) {
        if (!(e instanceof BridgeError)) throw e;
      }
    }
    return { rows: [...communityState.leaderboardPreview], source: "mock" };
  },

  async listBanners(p: { placement: BannerPlacement }): Promise<{ items: BannerItem[]; source: "real-rpc" | "real-http" | "mock" }> {
    // 2026-07-05 · CM-T6 · discovery-wrapper swap.
    if (shouldTryHttpBackend()) {
      try {
        const j = await bridgeToBackend<{ banners?: Array<{
          id: string; title: string; subtitle: string | null; image_url: string | null;
          cta_text: string | null; cta_url: string | null; placement: string;
          target_tier: string | null; priority: number; starts_at: string | null;
          ends_at: string | null; is_active: boolean;
        }> }>("GET", `/banners?placement=${encodeURIComponent(p.placement)}`);
        if (Array.isArray(j.banners)) {
          const items: BannerItem[] = j.banners
            .filter((b) => b.placement === p.placement && b.is_active)
            .map((b) => ({
              id: b.id,
              title: b.title,
              subtitle: b.subtitle,
              imageUrl: b.image_url,
              ctaText: b.cta_text,
              ctaUrl: b.cta_url,
              placement: b.placement as BannerPlacement,
              targetTier: (b.target_tier === "free" || b.target_tier === "paid") ? b.target_tier : null,
              priority: b.priority,
              startsAt: b.starts_at,
              endsAt: b.ends_at,
              isActive: b.is_active,
            }));
          return { items, source: "real-http" };
        }
      } catch (e) {
        if (!(e instanceof BridgeError)) throw e;
      }
    }
    const items = communityState.banners
      .filter((b) => b.placement === p.placement && b.isActive)
      .sort((a, b) => b.priority - a.priority);
    return { items, source: "mock" };
  },

  async listAnnouncements(): Promise<{ items: AnnouncementItem[]; source: "real-rpc" | "real-http" | "mock" }> {
    // 2026-07-05 · CM-T6 · discovery-wrapper swap. No public
    // /announcements GET confirmed in the Phase 6K audit · attempt
    // via bridgeToBackend, degrade to mock on 404 silently.
    if (shouldTryHttpBackend()) {
      try {
        const j = await bridgeToBackend<{ items?: AnnouncementItem[] }>(
          "GET",
          "/announcements",
        );
        if (Array.isArray(j.items)) return { items: j.items, source: "real-http" };
      } catch (e) {
        if (!(e instanceof BridgeError)) throw e;
      }
    }
    return { items: [...communityState.announcements], source: "mock" };
  },
};

export function _readMockCommunityState() {
  return communityState;
}

/* ============================================================
   Phase 6L-D · Earn API
   Mirrors backend /me/reward-clips + leaderboard cache. Real-Tauri-first
   → fetch backend → mock fallback. Mock seeds line up with the leaderboard
   preview so the Earn route's totals match the LeaderboardSection caller
   row.
   ============================================================ */

import type {
  RewardClip,
  RewardClipStatus,
  EarnSummary,
  TrackingLinkBlock,
  RpmTier,
} from "../earn/types";
import { RPM_TIERS } from "../earn/types";

/* Backend wire row (snake_case) for the JSON parse step. */
interface BackendRewardClipBlock {
  id: string;
  whop_reward_id: string;
  whop_reward_title: string | null;
  clip_idx: number;
  platform: string | null;
  account_label: string | null;
  campaign_id: string | null;
  whop_submission_id: string | null;
  status: string | null;
  tracking_link: {
    id: string;
    short_url: string;
    destination_url: string;
    affiliate_id: string | null;
    platform: string | null;
    account_label: string | null;
    campaign_id: string | null;
    label: string | null;
    disabled: boolean;
    click_count: number;
  } | null;
  created_at: string;
  updated_at: string;
}

function adaptRewardClip(b: BackendRewardClipBlock): RewardClip {
  const tl: TrackingLinkBlock | null = b.tracking_link
    ? {
        id: b.tracking_link.id,
        shortUrl: b.tracking_link.short_url,
        destinationUrl: b.tracking_link.destination_url,
        affiliateId: b.tracking_link.affiliate_id,
        platform: b.tracking_link.platform,
        accountLabel: b.tracking_link.account_label,
        campaignId: b.tracking_link.campaign_id,
        label: b.tracking_link.label,
        disabled: b.tracking_link.disabled,
        clickCount: b.tracking_link.click_count,
      }
    : null;
  return {
    id: b.id,
    whopRewardId: b.whop_reward_id,
    whopRewardTitle: b.whop_reward_title,
    clipIdx: b.clip_idx,
    platform: b.platform,
    accountLabel: b.account_label,
    campaignId: b.campaign_id,
    whopSubmissionId: b.whop_submission_id,
    status: (b.status as RewardClipStatus | null) ?? null,
    trackingLink: tl,
    createdAt: b.created_at,
    updatedAt: b.updated_at,
  };
}

const D = 24 * HR;
/* BUG-045 · earn cache. Initialized with NO clips so mock-mode customers
 * never see fake lifetime earnings, fake pending payouts, fake approved
 * count, or fake "paid" rows for clips they never made. The previous
 * seed of 8 RewardClips (Uncle Daniel · cold-open hooks 1,420 clicks,
 * DDB Beauty · viral hook 980 clicks, etc.) derived $9.34 lifetime /
 * $2.10 pending visible on BOTH the Earn route AND the Home earn strip
 * (BUG-040 single-source). Real backend path (real-http via
 * /me/reward-clips) still works: `earn.listRewardClips()` overwrites
 * this cache with adapted rows. The historical fixture array is
 * preserved as `LEGACY_REWARD_CLIPS_FIXTURE` for future dev-fixture use. */
const earnState: { clips: RewardClip[]; rpm: RpmTier } = {
  rpm: RPM_TIERS.pro,
  clips: [],
};

/* eslint-disable @typescript-eslint/no-unused-vars */
const LEGACY_REWARD_CLIPS_FIXTURE: RewardClip[] = [
    /* PAID · cleared + tracking link with clicks */
    { id: "rclip_p1", whopRewardId: "wr-001", whopRewardTitle: "Uncle Daniel · cold-open hooks",
      clipIdx: 0, platform: "tiktok", accountLabel: "@preview-clipper-01", campaignId: "cmp-1",
      whopSubmissionId: "wsub_001", status: "paid",
      trackingLink: { id: "tl-001", shortUrl: "https://jnremployee.com/r/tl-001",
        destinationUrl: "https://liquidclips.app/?a=aff_ud", affiliateId: "aff_ud",
        platform: "tiktok", accountLabel: "@preview-clipper-01", campaignId: "cmp-1",
        label: "Cold-open · tiktok", disabled: false, clickCount: 1420 },
      createdAt: new Date(Date.now() - 12 * D).toISOString(),
      updatedAt: new Date(Date.now() - 8 * D).toISOString() },
    { id: "rclip_p2", whopRewardId: "wr-002", whopRewardTitle: "DDB Beauty · viral hook",
      clipIdx: 3, platform: "instagram", accountLabel: "@preview-clipper-03", campaignId: "cmp-2",
      whopSubmissionId: "wsub_002", status: "paid",
      trackingLink: { id: "tl-002", shortUrl: "https://jnremployee.com/r/tl-002",
        destinationUrl: "https://liquidclips.app/?a=aff_ud", affiliateId: "aff_ud",
        platform: "instagram", accountLabel: "@preview-clipper-03", campaignId: "cmp-2",
        label: "Beauty · ig", disabled: false, clickCount: 980 },
      createdAt: new Date(Date.now() - 9 * D).toISOString(),
      updatedAt: new Date(Date.now() - 5 * D).toISOString() },
    /* APPROVED · payout queued */
    { id: "rclip_a1", whopRewardId: "wr-003", whopRewardTitle: "Sponsor Campaigns · tech vertical",
      clipIdx: 5, platform: "youtube", accountLabel: "Preview Channel", campaignId: "cmp-3",
      whopSubmissionId: "wsub_003", status: "approved",
      trackingLink: { id: "tl-003", shortUrl: "https://jnremployee.com/r/tl-003",
        destinationUrl: "https://liquidclips.app/?a=aff_ud", affiliateId: "aff_ud",
        platform: "youtube", accountLabel: "Preview Channel", campaignId: "cmp-3",
        label: "Sponsor · yt", disabled: false, clickCount: 420 },
      createdAt: new Date(Date.now() - 3 * D).toISOString(),
      updatedAt: new Date(Date.now() - 1 * D).toISOString() },
    { id: "rclip_a2", whopRewardId: "wr-004", whopRewardTitle: "Affiliate Growth · how to onboard",
      clipIdx: 7, platform: "tiktok", accountLabel: "@preview-clipper-02", campaignId: "cmp-4",
      whopSubmissionId: "wsub_004", status: "approved",
      trackingLink: { id: "tl-004", shortUrl: "https://jnremployee.com/r/tl-004",
        destinationUrl: "https://liquidclips.app/?a=aff_ud", affiliateId: "aff_ud",
        platform: "tiktok", accountLabel: "@preview-clipper-02", campaignId: "cmp-4",
        label: "Affiliate · tt", disabled: false, clickCount: 280 },
      createdAt: new Date(Date.now() - 2 * D).toISOString(),
      updatedAt: new Date(Date.now() - 4 * HR).toISOString() },
    /* SUBMITTED (pending review) */
    { id: "rclip_s1", whopRewardId: "wr-005", whopRewardTitle: "Uncle Daniel · the boring tip",
      clipIdx: 9, platform: "x", accountLabel: "@preview-clipper-04", campaignId: "cmp-1",
      whopSubmissionId: "wsub_005", status: "submitted",
      trackingLink: null,
      createdAt: new Date(Date.now() - 6 * HR).toISOString(),
      updatedAt: new Date(Date.now() - 30 * 60_000).toISOString() },
    { id: "rclip_s2", whopRewardId: "wr-006", whopRewardTitle: "Viral Reaction · trending tag",
      clipIdx: 11, platform: "tiktok", accountLabel: "@preview-clipper-01", campaignId: "cmp-5",
      whopSubmissionId: null, status: "submitted",
      trackingLink: null,
      createdAt: new Date(Date.now() - 2 * HR).toISOString(),
      updatedAt: new Date(Date.now() - 90 * 60_000).toISOString() },
    /* DENIED (rejected) · reason carried through `whop_submission_id` */
    { id: "rclip_d1", whopRewardId: "wr-007", whopRewardTitle: "DDB Fashion · runway pull",
      clipIdx: 13, platform: "instagram", accountLabel: "@preview-clipper-03.cuts", campaignId: "cmp-6",
      whopSubmissionId: "wsub_007", status: "denied",
      trackingLink: null,
      createdAt: new Date(Date.now() - 5 * D).toISOString(),
      updatedAt: new Date(Date.now() - 3 * D).toISOString() },
    /* GENERATED (draft · tracking link minted, no submission yet) */
    { id: "rclip_g1", whopRewardId: "wr-008", whopRewardTitle: "Uncle Daniel · three edits",
      clipIdx: 15, platform: null, accountLabel: null, campaignId: "cmp-1",
      whopSubmissionId: null, status: "generated",
      trackingLink: { id: "tl-008", shortUrl: "https://jnremployee.com/r/tl-008",
        destinationUrl: "https://liquidclips.app/?a=aff_ud", affiliateId: "aff_ud",
        platform: null, accountLabel: null, campaignId: "cmp-1",
        label: null, disabled: false, clickCount: 12 },
      createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      updatedAt: new Date(Date.now() - 60 * 60_000).toISOString() },
];
/* eslint-enable @typescript-eslint/no-unused-vars */
void LEGACY_REWARD_CLIPS_FIXTURE;

function deriveSummary(clips: ReadonlyArray<RewardClip>, rpm: RpmTier): EarnSummary {
  /* RPM × (total clicks ÷ 1k) ≈ lifetime earned for clips that landed views.
   * Real backend uses cached_lifetime_earnings_usd; this matches the spirit
   * for the mock fallback. */
  const totalClicks = clips.reduce((acc, c) => acc + (c.trackingLink?.clickCount ?? 0), 0);
  const totalEarnedUsd = (totalClicks / 1000) * rpm.rpmUsd;
  const paidClips = clips.filter((c) => c.status === "paid");
  const approvedClips = clips.filter((c) => c.status === "approved");
  const rejectedClips = clips.filter((c) => c.status === "denied");
  const pendingClips = clips.filter((c) => c.status === "submitted");
  const pendingPayoutsUsd = approvedClips.reduce(
    (acc, c) => acc + ((c.trackingLink?.clickCount ?? 0) / 1000) * rpm.rpmUsd,
    0,
  );
  return {
    totalEarnedUsd: Math.round(totalEarnedUsd * 100) / 100,
    pendingPayoutsUsd: Math.round(pendingPayoutsUsd * 100) / 100,
    approvedCount: approvedClips.length,
    rejectedCount: rejectedClips.length,
    pendingCount: pendingClips.length,
    paidCount: paidClips.length,
    rpm,
    totalClicks,
    updatedAt: new Date().toISOString(),
  };
}

export const earn = {
  async listRewardClips(): Promise<{ clips: RewardClip[]; source: "real-rpc" | "real-http" | "mock" }> {
    // 2026-07-05 · CM-T6 · Wave 2 discovery-wrapper swap.
    // Real backend HTTP first via bridgeToBackend (existing
    // `/me/reward-clips` in reward_clips.py). Sidecar RPC path kept
    // as a secondary route for future sidecar wiring, but never
    // reached today because no Python handler exists.
    if (shouldTryHttpBackend()) {
      try {
        const j = await bridgeToBackend<{ reward_clips?: BackendRewardClipBlock[] }>(
          "GET",
          "/me/reward-clips",
        );
        if (Array.isArray(j.reward_clips)) {
          const clips = j.reward_clips.map(adaptRewardClip);
          earnState.clips = clips;
          return { clips, source: "real-http" };
        }
      } catch (e) {
        if (!(e instanceof BridgeError)) throw e;
        /* fall through to mock · silent BridgeError → mock is the
         * documented degrade path per the audit endpoint contract */
      }
    }
    return { clips: [...earnState.clips], source: "mock" };
  },

  async summary(rpmTier?: "free" | "pro" | "agency"): Promise<{ summary: EarnSummary; source: "real-rpc" | "real-http" | "mock" }> {
    // 2026-07-05 · CM-T6 · no dedicated /me/earn/summary endpoint
    // exists on the backend today. Summary is DERIVED from the
    // listRewardClips response above · when the backend adds a real
    // aggregation endpoint, swap this to bridgeToBackend("GET",
    // "/me/earn/summary") and delete the derivation.
    const rpm = rpmTier ? RPM_TIERS[rpmTier] : earnState.rpm;
    return { summary: deriveSummary(earnState.clips, rpm), source: "mock" };
  },
};

export function _readMockEarnState() {
  return earnState;
}

/* ============================================================
   Phase 6N-B · Campaigns API
   Mirrors the canonical Campaign model defined in 6N-A
   (`docs/campaign-foundation-architecture.md`). Real-Tauri-first →
   HTTP backend (`/campaigns` already lives at
   `junior-backend/app/routes/campaigns.py`) → mock fallback.
   ============================================================ */

import type { Campaign } from "../campaigns/types";

const HRR = 3600_000;
const DAYY = 24 * HRR;

/* BUG-044 · campaigns cache. Initialized empty so mock-mode customers
 * never see fake reward bounties / fake funded% / fake capacities. The
 * previous seed of 10 realistic-looking campaigns (Uncle Daniel cold-
 * open hooks, DDB Beauty launch week, etc.) presented a fully-built
 * bounty marketplace as if real — visible $X pool + Y% funded + M/N
 * capacity numbers driven by hardcoded fixture data. Real backend path
 * (real-http / real-rpc) still works: `campaigns.list()` overwrites this
 * cache with adapted backend rows.
 *
 * The historical fixture array is preserved in `LEGACY_CAMPAIGN_FIXTURE`
 * (declared below the empty cache) for any future dev-fixture flag or
 * Storybook use — it is no longer read by production code.
 */
const campaignsState: { campaigns: Campaign[] } = { campaigns: [] };

/* eslint-disable @typescript-eslint/no-unused-vars */
const LEGACY_CAMPAIGN_FIXTURE: Campaign[] = [
    /* 1 · FEATURED clip campaign · Uncle Daniel · tiered RPM */
    {
      id: "cmp-1", slug: "uncle-daniel-cold-open-hooks",
      title: "Cold-open hooks", subtitle: "Help Uncle Daniel scale the playbook",
      description: "We're paying for the cleanest cold-open clips this month. Hook lands in the first three seconds · we'll pay you per thousand verified views. Pick footage from the asset folder, ship it, watch your tracking link earn.",
      brand: "Uncle Daniel", businessUnit: "uncle_daniel",
      createdBy: "user_admin_uncle", createdAt: new Date(Date.now() - 12 * DAYY).toISOString(),
      updatedAt: new Date(Date.now() - 2 * HRR).toISOString(),
      campaignType: "clip", status: "live", visibility: "public",
      placementQuality: "featured",
      placementMetadata: {
        featuredStartsAt: new Date(Date.now() - 5 * DAYY).toISOString(),
        featuredEndsAt:   new Date(Date.now() + 10 * DAYY).toISOString(),
      },
      rewardKind: "usd", rewardPoolCents: 250_000,
      payoutRules: { kind: "tiered", byTier: {
        free:   { kind: "rpm", rpmCents: 100, minVerifiedViews: 1000 },
        pro:    { kind: "rpm", rpmCents: 300, minVerifiedViews: 1000 },
        agency: { kind: "rpm", rpmCents: 500, minVerifiedViews: 1000 },
      }},
      fundedPct: 72, minLcScore: 75,
      capacityTotal: null, capacityUsed: 42, capacityWindowStart: null, capacityWindowEnd: null,
      deadline: new Date(Date.now() + 10 * DAYY).toISOString(),
      durationLabel: "10 days left",
      targetPlatforms: ["tiktok", "instagram", "youtube"],
      targetGeos: null, targetHashtags: ["#clip", "#hook", "#shorts"],
      visibilityTiers: ["free", "solo", "pro", "agency"],
      requiredTier: null, requiresMembership: false,
      tierRules: {
        submissionCaps: { free: 1, pro: 5, agency: 50 },
        discussionAccess: { minTier: "free" },
      },
      discussionProvider: "whop", communityChannelId: "cc-5", nativeDiscussionId: null,
      assetSources: [
        { id: "as-1", kind: "drive_folder", label: "Uncle Daniel · Q3 raw footage",
          url: "https://drive.google.com/drive/folders/uncle-q3-raw", externalId: "ud_q3_raw",
          manifest: { fileCount: 38, totalBytes: 14_200_000_000, sampleNames: ["20260601-podcast-cold-open.mp4", "20260603-listener-question.mp4"], cachedAt: new Date(Date.now() - 6 * HRR).toISOString() },
          status: "ready", addedAt: new Date(Date.now() - 11 * DAYY).toISOString() },
        { id: "as-2", kind: "whop_assets", label: "Uncle Daniel · brand kit",
          url: "https://whop.com/c/chat_feed_udc_5/assets", externalId: "whop_brand_kit",
          status: "ready", addedAt: new Date(Date.now() - 11 * DAYY).toISOString() },
      ],
      bannerUrl: "/brand/decks/workspace.png",
      featuredThumbUrl: "/brand/sponsored/thumb-creator.png",
      whopUrl: "https://whop.com/liquidclips/rewards/cold-open-hooks",
      whopCampaignId: "wc-cold-open-1", whopCampaignUrl: "https://whop.com/liquidclips/rewards/cold-open-hooks",
      affiliateEnabled: false,
      watermarkAllowed: true,
    },
    /* 2 · SPONSORED submission campaign · DDB Beauty · flat */
    {
      id: "cmp-2", slug: "ddb-beauty-launch-week",
      title: "DDB Beauty launch week",
      subtitle: "First-look behind-the-scenes submissions",
      description: "Submit a 30s vertical clip from the launch week footage. Reviewed within 48h. $40 per approved clip · multiple approvals allowed per clipper.",
      brand: "DDB Beauty", businessUnit: "ddb_beauty",
      createdBy: "user_admin_ddb", createdAt: new Date(Date.now() - 6 * DAYY).toISOString(),
      updatedAt: new Date(Date.now() - 8 * HRR).toISOString(),
      campaignType: "submission", status: "live", visibility: "public",
      placementQuality: "sponsored",
      placementMetadata: {
        sponsorBrand: "DDB Beauty", sponsorshipPackage: "gold",
      },
      rewardKind: "usd", rewardPoolCents: 100_000,
      payoutRules: { kind: "flat", amountCents: 4_000, currency: "USD" },
      fundedPct: 100, minLcScore: 70,
      capacityTotal: 25, capacityUsed: 11,
      capacityWindowStart: null, capacityWindowEnd: null,
      deadline: new Date(Date.now() + 5 * DAYY).toISOString(),
      durationLabel: "5 days left",
      targetPlatforms: ["instagram", "tiktok"],
      targetGeos: null, targetHashtags: ["#ddbbeauty", "#launchweek"],
      visibilityTiers: ["free", "solo", "pro", "agency"],
      requiredTier: null, requiresMembership: false,
      tierRules: { submissionCaps: { free: 1, pro: 3, agency: 10 } },
      discussionProvider: "whop", communityChannelId: "cc-7", nativeDiscussionId: null,
      assetSources: [
        { id: "as-3", kind: "dropbox_folder", label: "DDB Beauty · launch raw",
          url: "https://www.dropbox.com/sh/ddb-launch", externalId: "ddb_launch",
          manifest: { fileCount: 14, totalBytes: 6_800_000_000, sampleNames: ["bts-arrivals.mp4", "bts-runway-rehearsal.mp4"], cachedAt: new Date(Date.now() - 12 * HRR).toISOString() },
          status: "ready", addedAt: new Date(Date.now() - 6 * DAYY).toISOString() },
      ],
      bannerUrl: "/brand/decks/upload.png",
      featuredThumbUrl: "/brand/sponsored/thumb-business.png",
      whopUrl: "https://whop.com/liquidclips/rewards/ddb-launch",
      whopCampaignId: "wc-ddb-launch", whopCampaignUrl: "https://whop.com/liquidclips/rewards/ddb-launch",
      affiliateEnabled: false,
      watermarkAllowed: true,
    },
    /* 3 · STANDARD coordination campaign · Product Hunt push · capacity */
    {
      id: "cmp-3", slug: "ph-coordination-push",
      title: "Product Hunt launch · coordinated upvote",
      subtitle: "2,000 verified upvotes inside a 90-minute window",
      description: "We're launching on Product Hunt Monday 09:00 PT. Get there in the first 90 minutes, upvote, screenshot, drop it in the campaign chat. $0.50 each · capped at 2,000 actions.",
      brand: "Liquid Clips", businessUnit: "liquid_clips",
      createdBy: "user_admin_lc", createdAt: new Date(Date.now() - 3 * DAYY).toISOString(),
      updatedAt: new Date(Date.now() - 6 * HRR).toISOString(),
      campaignType: "coordination", status: "coming_soon", visibility: "public",
      placementQuality: "standard",
      rewardKind: "usd", rewardPoolCents: 100_000,
      payoutRules: {
        kind: "capacity_limited",
        perActionCents: 50,
        capacityTotal: 2000,
        windowStartIso: new Date(Date.now() + 3 * DAYY).toISOString(),
        windowEndIso:   new Date(Date.now() + 3 * DAYY + 90 * 60_000).toISOString(),
      },
      fundedPct: 100, minLcScore: 0,
      capacityTotal: 2000, capacityUsed: 0,
      capacityWindowStart: new Date(Date.now() + 3 * DAYY).toISOString(),
      capacityWindowEnd:   new Date(Date.now() + 3 * DAYY + 90 * 60_000).toISOString(),
      deadline: new Date(Date.now() + 3 * DAYY + 90 * 60_000).toISOString(),
      durationLabel: "Monday · 90-min window",
      targetPlatforms: [],
      targetGeos: ["US", "UK", "EU"], targetHashtags: null,
      visibilityTiers: ["free", "solo", "pro", "agency"],
      requiredTier: null, requiresMembership: false,
      tierRules: { submissionCaps: { free: 1, pro: 1, agency: 1 } },
      discussionProvider: "whop", communityChannelId: "cc-2", nativeDiscussionId: null,
      assetSources: [],
      bannerUrl: "/brand/decks/payouts.png",
      featuredThumbUrl: null,
      whopUrl: "https://whop.com/liquidclips/rewards/ph-coord",
      whopCampaignId: null, whopCampaignUrl: null,
      affiliateEnabled: false,
      watermarkAllowed: true,
    },
    /* 4 · STANDARD affiliate campaign · Liquid Clips growth · RPM-on-signup */
    {
      id: "cmp-4", slug: "liquid-clips-affiliate-growth",
      title: "Affiliate growth · ship signups",
      subtitle: "Earn on every signup that converts through your link",
      description: "Promote Liquid Clips on your channels. Every verified signup through your tracking link pays out. Bonus structure: 10 referrals → +$50, 50 referrals → +$500.",
      brand: "Liquid Clips", businessUnit: "liquid_clips",
      createdBy: "user_admin_lc", createdAt: new Date(Date.now() - 14 * DAYY).toISOString(),
      updatedAt: new Date(Date.now() - 1 * DAYY).toISOString(),
      campaignType: "affiliate", status: "live", visibility: "public",
      placementQuality: "standard",
      rewardKind: "usd", rewardPoolCents: 500_000,
      payoutRules: {
        kind: "bonus",
        base: { kind: "flat", amountCents: 1_000, currency: "USD" },
        bonuses: [
          { label: "10 referrals", triggerCondition: { kind: "first_n_submissions", n: 10 }, extra: { kind: "flat", amountCents: 5_000, currency: "USD" } },
          { label: "50 referrals", triggerCondition: { kind: "first_n_submissions", n: 50 }, extra: { kind: "flat", amountCents: 50_000, currency: "USD" } },
        ],
      },
      fundedPct: 88, minLcScore: 0,
      capacityTotal: null, capacityUsed: 134,
      capacityWindowStart: null, capacityWindowEnd: null,
      deadline: null, durationLabel: "Ongoing",
      targetPlatforms: ["tiktok", "instagram", "youtube", "x", "linkedin"],
      targetGeos: null, targetHashtags: ["#liquidclips"],
      visibilityTiers: ["free", "solo", "pro", "agency"],
      requiredTier: null, requiresMembership: false,
      tierRules: { discussionAccess: { minTier: "free" } },
      discussionProvider: "whop", communityChannelId: "cc-4", nativeDiscussionId: null,
      assetSources: [
        { id: "as-4", kind: "direct_upload", label: "LC · brand assets pack",
          url: "/uploads/liquidclips/brand-pack.zip",
          manifest: { fileCount: 24, totalBytes: 220_000_000, sampleNames: ["logo-fuchsia.svg", "wordmark.png", "social-cover.psd"], cachedAt: new Date(Date.now() - 1 * DAYY).toISOString() },
          status: "ready", addedAt: new Date(Date.now() - 14 * DAYY).toISOString() },
      ],
      bannerUrl: "/brand/decks/earn.png",
      featuredThumbUrl: null,
      whopUrl: "https://whop.com/liquidclips/affiliate",
      whopCampaignId: null, whopCampaignUrl: null,
      affiliateEnabled: true,
      watermarkAllowed: true,
    },
    /* 5 · STANDARD clip campaign · Sponsor tech vertical · tiered */
    {
      id: "cmp-5", slug: "sponsor-tech-vertical",
      title: "Sponsor: tech vertical clips",
      subtitle: "Curate AI / SaaS / dev footage into shorts",
      description: "We're amplifying a tech-vertical sponsor for the next 4 weeks. Footage is whitelisted in the asset folder. RPM tiered free / pro / agency. Clean watermark required.",
      brand: "Tech sponsor", businessUnit: "sponsors",
      createdBy: "user_admin_sponsors", createdAt: new Date(Date.now() - 4 * DAYY).toISOString(),
      updatedAt: new Date(Date.now() - 4 * HRR).toISOString(),
      campaignType: "clip", status: "funded", visibility: "public",
      placementQuality: "category_spotlight",
      placementMetadata: { categoryKey: "clip" },
      rewardKind: "usd", rewardPoolCents: 400_000,
      payoutRules: { kind: "tiered", byTier: {
        free:   { kind: "rpm", rpmCents: 100, minVerifiedViews: 2000 },
        pro:    { kind: "rpm", rpmCents: 350, minVerifiedViews: 2000 },
        agency: { kind: "rpm", rpmCents: 600, minVerifiedViews: 2000 },
      }},
      fundedPct: 96, minLcScore: 80,
      capacityTotal: null, capacityUsed: 27,
      capacityWindowStart: null, capacityWindowEnd: null,
      deadline: new Date(Date.now() + 24 * DAYY).toISOString(),
      durationLabel: "24 days left",
      targetPlatforms: ["youtube", "tiktok", "instagram"],
      targetGeos: null, targetHashtags: ["#ai", "#saas", "#dev"],
      visibilityTiers: ["solo", "pro", "agency"],
      requiredTier: "pro", requiresMembership: true,
      tierRules: { submissionCaps: { pro: 5, agency: 50 } },
      discussionProvider: "whop", communityChannelId: "cc-9", nativeDiscussionId: null,
      assetSources: [
        { id: "as-5", kind: "drive_folder", label: "Tech sponsor · whitelist clips",
          url: "https://drive.google.com/drive/folders/tech-whitelist",
          manifest: { fileCount: 52, totalBytes: 28_000_000_000, sampleNames: ["ai-demo-cut1.mp4", "saas-launch-clip.mp4"], cachedAt: new Date(Date.now() - 4 * HRR).toISOString() },
          status: "ready", addedAt: new Date(Date.now() - 4 * DAYY).toISOString() },
      ],
      bannerUrl: "/brand/decks/learn.png",
      featuredThumbUrl: "/brand/sponsored/thumb-tech.png",
      whopUrl: "https://whop.com/liquidclips/sponsor-tech",
      whopCampaignId: "wc-sponsor-tech", whopCampaignUrl: "https://whop.com/liquidclips/sponsor-tech",
      affiliateEnabled: false,
      watermarkAllowed: true,
    },
    /* 6 · COMING SOON · Uncle Daniel viral reactions (echo of community channel cc-6) */
    {
      id: "cmp-6", slug: "viral-reaction-missions",
      title: "Viral reaction missions",
      subtitle: "Fast reactions to trending posts",
      description: "Watch the inbox, react fast. We drop a trending tweet / post · you have 4 hours to ship a clip. Flat reward per approved reaction.",
      brand: "Uncle Daniel", businessUnit: "uncle_daniel",
      createdBy: "user_admin_uncle", createdAt: new Date(Date.now() - 1 * DAYY).toISOString(),
      updatedAt: new Date(Date.now() - 6 * HRR).toISOString(),
      campaignType: "submission", status: "coming_soon", visibility: "public",
      placementQuality: "standard",
      rewardKind: "usd", rewardPoolCents: 60_000,
      payoutRules: { kind: "flat", amountCents: 1_500, currency: "USD" },
      fundedPct: 60, minLcScore: 70,
      capacityTotal: 40, capacityUsed: 0,
      capacityWindowStart: null, capacityWindowEnd: null,
      deadline: null, durationLabel: "Drops weekly",
      targetPlatforms: ["tiktok", "x"],
      targetGeos: null, targetHashtags: ["#viral", "#reaction"],
      visibilityTiers: ["solo", "pro", "agency"],
      requiredTier: "pro", requiresMembership: true,
      tierRules: { submissionCaps: { pro: 2, agency: 20 } },
      discussionProvider: "whop", communityChannelId: "cc-6", nativeDiscussionId: null,
      assetSources: [],
      bannerUrl: "/brand/decks/schedule.png",
      featuredThumbUrl: null,
      whopUrl: "https://whop.com/liquidclips/rewards/viral-reaction",
      whopCampaignId: null, whopCampaignUrl: null,
      affiliateEnabled: false,
      watermarkAllowed: true,
    },
];
/* eslint-enable @typescript-eslint/no-unused-vars */
void LEGACY_CAMPAIGN_FIXTURE;

/* 6N-G · Backend `/campaigns` returns the snake_case `_serialize()` wire
 * shape · the frontend Campaign type is camelCase. The previous cast was
 * a type lie that worked only because the real-http path wasn't hit in
 * preview. This adapter is the explicit translation point.
 *
 * Only fields the UI surfaces today are mapped. Legacy mock rows skip
 * the adapter entirely; they're already in Campaign shape. */
interface BackendCampaignRow {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  subtitle: string | null;
  type: string;
  status: string;
  rpm_cents: number;
  budget_cents: number;
  funded_pct: number;
  duration_label: string | null;
  whop_url: string | null;
  banner_url: string | null;
  eligibility: string[];
  visibility_tiers: string[];
  min_lc_score: number;
  cta_text: string;
  sort_order: number;
  base_rpm_cents: number;
  premium_rpm_cents: number;
  premium_bonus_cents: number;
  free_banner_text: string | null;
  premium_banner_text: string | null;
  mission_type: string | null;
  mission_lane: string | null;
  requires_membership: boolean;
  watermark_allowed: boolean;
  whop_campaign_id: string | null;
  whop_campaign_url: string | null;
  your_rpm_cents: number | null;
  is_premium_caller: boolean | null;
  /* §8 fields · always shipped, null for legacy rows */
  description?: string;
  campaign_type?: string;
  whop_reward_id?: string | null;
  whop_reward_url?: string | null;
  whop_reward_snapshot?: WhopRewardSnapshot | null;
  whop_reward_snapshot_status?: WhopRewardSnapshotStatus;
  whop_reward_state?: WhopRewardState | null;
  whop_reward_snapshot_business_goal?: string | null;
  whop_reward_snapshot_bounty_type?: string | null;
  whop_reward_synced_at?: string | null;
  whop_reward_last_error?: string | null;
  /* Ship-lens P0-CW-005 fix (2026-07-06) · per-campaign agency
   * watermark overlay config. NULL when campaign uses default Liquid
   * Clips watermark. Consumed by PublishModule to invoke the
   * campaignOverlayApi.render + composite pipeline. */
  watermark_overlay_config?: {
    logo_url: string;
    position: string;
    motion: string;
    text: string | null;
    duration_frames: number;
    version: number;
  } | null;
}

function adaptBackendCampaign(b: BackendCampaignRow): Campaign {
  const ct = ((b.campaign_type as Campaign["campaignType"]) || "clip");
  const status = (b.status as Campaign["status"]) || "live";
  const rpm = b.your_rpm_cents ?? b.base_rpm_cents ?? b.rpm_cents ?? 0;
  return {
    id: b.id,
    slug: b.slug,
    title: b.name,
    subtitle: b.subtitle,
    description: b.description ?? "",
    brand: b.brand,
    businessUnit: b.mission_lane,
    createdBy: "user_admin",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    campaignType: ct,
    status,
    visibility: b.requires_membership ? "members_only" : "public",
    placementQuality: "standard",
    rewardKind: "usd",
    rewardPoolCents: b.budget_cents ?? 0,
    payoutRules: { kind: "rpm", rpmCents: rpm, minVerifiedViews: 1000 },
    fundedPct: b.funded_pct ?? 0,
    minLcScore: b.min_lc_score ?? 75,
    capacityTotal: null,
    capacityUsed: 0,
    capacityWindowStart: null,
    capacityWindowEnd: null,
    deadline: null,
    durationLabel: b.duration_label,
    targetPlatforms: [],
    targetGeos: null,
    targetHashtags: null,
    visibilityTiers: (b.visibility_tiers as Campaign["visibilityTiers"]) || ["free", "solo", "pro", "agency"],
    requiredTier: null,
    requiresMembership: !!b.requires_membership,
    tierRules: {},
    discussionProvider: "whop",
    communityChannelId: null,
    nativeDiscussionId: null,
    assetSources: [],
    bannerUrl: b.banner_url,
    featuredThumbUrl: null,
    whopUrl: b.whop_url,
    whopCampaignId: b.whop_campaign_id,
    whopCampaignUrl: b.whop_campaign_url,
    affiliateEnabled: false,
    /* §8 reward reads · optional · pass through as-is */
    whopRewardId: b.whop_reward_id ?? null,
    whopRewardUrl: b.whop_reward_url ?? null,
    whopRewardState: (b.whop_reward_state as Campaign["whopRewardState"]) ?? null,
    whopRewardSnapshotStatus: b.whop_reward_snapshot_status ?? "not_attempted",
    whopRewardSnapshot: (b.whop_reward_snapshot as Campaign["whopRewardSnapshot"]) ?? null,
    whopRewardSnapshotBusinessGoal: b.whop_reward_snapshot_business_goal ?? null,
    whopRewardSnapshotBountyType: b.whop_reward_snapshot_bounty_type ?? null,
    whopRewardSyncedAt: b.whop_reward_synced_at ?? null,
    whopRewardLastError: b.whop_reward_last_error ?? null,
    /* Ship-lens P0-CW-006 fix · surface sponsor watermark_allowed flag
     * on the Campaign shape so PublishModule can enforce it directly
     * without unsafe wire-shape casts. Default true for legacy rows. */
    watermarkAllowed: b.watermark_allowed ?? true,
    /* Ship-lens P0-CW-005 fix + P1-CW-010 runtime validation · adapter
     * maps snake_case wire → camelCase Campaign type. Position + motion
     * strings are validated against the known enums; invalid values from
     * a stale backend get clamped to safe defaults instead of getting
     * passed through and crashing Remotion's positionStyle switch. */
    watermarkOverlayConfig: b.watermark_overlay_config
      ? (() => {
          const validPos = new Set<NonNullable<Campaign["watermarkOverlayConfig"]>["position"]>([
            "top-left", "top-right", "bottom-left", "bottom-right", "center-top", "center-bottom",
          ]);
          const validMotion = new Set<NonNullable<Campaign["watermarkOverlayConfig"]>["motion"]>([
            "static", "corner-pulse", "fade-in-out", "slide-in-left", "lower-third",
          ]);
          const rawPos = b.watermark_overlay_config!.position as NonNullable<Campaign["watermarkOverlayConfig"]>["position"];
          const rawMotion = b.watermark_overlay_config!.motion as NonNullable<Campaign["watermarkOverlayConfig"]>["motion"];
          // Ship-lens P1-CW-014 fix · when clamping to a safe default,
          // log a warning so telemetry catches schema drift. Silent
          // clamps hide broken agency configs from developers.
          if (!validPos.has(rawPos)) {
            // eslint-disable-next-line no-console
            console.warn(`[adaptBackendCampaign] campaign ${b.slug} watermark position "${rawPos}" invalid · clamped to "bottom-right"`);
          }
          if (!validMotion.has(rawMotion)) {
            // eslint-disable-next-line no-console
            console.warn(`[adaptBackendCampaign] campaign ${b.slug} watermark motion "${rawMotion}" invalid · clamped to "corner-pulse"`);
          }
          return {
            logo_url: b.watermark_overlay_config!.logo_url,
            position: validPos.has(rawPos) ? rawPos : "bottom-right",
            motion: validMotion.has(rawMotion) ? rawMotion : "corner-pulse",
            text: b.watermark_overlay_config!.text,
            duration_frames: b.watermark_overlay_config!.duration_frames,
            version: b.watermark_overlay_config!.version,
          };
        })()
      : null,
  };
}

export const campaigns = {
  async list(): Promise<{ campaigns: Campaign[]; source: "real-rpc" | "real-http" | "mock" }> {
    // 2026-07-05 · CM-T6 · discovery-wrapper swap. Backend `/campaigns`
    // route already exists in campaigns.py. Sidecar RPC layer dropped
    // (no Python handler) · fall through to mock preserves the demo
    // path for storybook / offline dev.
    if (shouldTryHttpBackend()) {
      try {
        const j = await bridgeToBackend<{ campaigns?: BackendCampaignRow[] }>(
          "GET",
          "/campaigns",
        );
        if (Array.isArray(j.campaigns)) {
          const adapted = j.campaigns.map(adaptBackendCampaign);
          campaignsState.campaigns = adapted;
          return { campaigns: adapted, source: "real-http" };
        }
      } catch (e) {
        if (!(e instanceof BridgeError)) throw e;
      }
    }
    return { campaigns: [...campaignsState.campaigns], source: "mock" };
  },

  async getBySlug(slug: string): Promise<{ campaign: Campaign | null; source: "real-rpc" | "real-http" | "mock" }> {
    // 2026-07-05 · CM-T6 · discovery-wrapper swap.
    if (shouldTryHttpBackend()) {
      try {
        const j = await bridgeToBackend<{ campaign?: BackendCampaignRow | null }>(
          "GET",
          `/campaigns/${encodeURIComponent(slug)}`,
        );
        if (j.campaign !== undefined && j.campaign !== null) {
          return { campaign: adaptBackendCampaign(j.campaign), source: "real-http" };
        }
        if (j.campaign === null) {
          return { campaign: null, source: "real-http" };
        }
      } catch (e) {
        if (!(e instanceof BridgeError)) throw e;
      }
    }
    const c = campaignsState.campaigns.find((x) => x.slug === slug || x.id === slug) ?? null;
    return { campaign: c, source: "mock" };
  },
};

export function _readMockCampaignsState() {
  return campaignsState;
}

/* ============================================================
   Phase 6N-D v1 · Campaign Asset Links
   Backed by `junior-backend/app/routes/campaign_asset_links.py` +
   `CampaignAssetLink` model. Brief-link CRUD only · NO OAuth, NO
   ingestion. Real-RPC → HTTP → mock fallback.
   ============================================================ */

export type CampaignAssetLinkType =
  | "google_drive"
  | "dropbox"
  | "whop"
  | "direct_url"
  | "upload_note";

export type CampaignAssetLinkVisibility = "all" | "joined" | "approved";

export interface CampaignAssetLink {
  id: string;
  campaignId: string;
  type: CampaignAssetLinkType;
  title: string;
  url: string;
  notes: string | null;
  required: boolean;
  visibility: CampaignAssetLinkVisibility;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignAssetLinkCreate {
  type: CampaignAssetLinkType;
  title: string;
  url?: string;
  notes?: string | null;
  required?: boolean;
  visibility?: CampaignAssetLinkVisibility;
  sortOrder?: number;
}

export interface CampaignAssetLinkPatch {
  type?: CampaignAssetLinkType;
  title?: string;
  url?: string;
  notes?: string | null;
  required?: boolean;
  visibility?: CampaignAssetLinkVisibility;
  sortOrder?: number;
}

interface BackendAssetLinkBlock {
  id: string;
  campaign_id: string;
  type: CampaignAssetLinkType;
  title: string;
  url: string;
  notes: string | null;
  required: boolean;
  visibility: CampaignAssetLinkVisibility;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function adaptBackendAssetLink(b: BackendAssetLinkBlock): CampaignAssetLink {
  return {
    id: b.id,
    campaignId: b.campaign_id,
    type: b.type,
    title: b.title,
    url: b.url,
    notes: b.notes,
    required: b.required,
    visibility: b.visibility,
    sortOrder: b.sort_order,
    createdAt: b.created_at,
    updatedAt: b.updated_at,
  };
}

/* Seed mock links for the existing 6 mock campaigns. Mirrors the kinds
 * of links agencies actually paste in the legacy Whop chat. */
const assetLinksMock: Record<string, CampaignAssetLink[]> = {
  "cmp-1": [
    { id: "lnk_1a", campaignId: "cmp-1", type: "google_drive",
      title: "Uncle Daniel · Q3 raw footage",
      url: "https://drive.google.com/drive/folders/uncle-q3-raw",
      notes: "Filter by `cold-open-*` files first · best hooks live in the morning sessions.",
      required: true, visibility: "all", sortOrder: 0,
      createdAt: new Date(Date.now() - 11 * 86400_000).toISOString(),
      updatedAt: new Date(Date.now() - 6 * 3600_000).toISOString() },
    { id: "lnk_1b", campaignId: "cmp-1", type: "whop",
      title: "Brand kit + caption presets",
      url: "https://whop.com/c/chat_feed_udc_5/assets",
      notes: null, required: false, visibility: "joined", sortOrder: 1,
      createdAt: new Date(Date.now() - 11 * 86400_000).toISOString(),
      updatedAt: new Date(Date.now() - 11 * 86400_000).toISOString() },
    { id: "lnk_1c", campaignId: "cmp-1", type: "upload_note",
      title: "Submit your own clip",
      url: "",
      notes: "Export from Liquid Clips with clean watermark · submit via Earn route. Tracking link mints automatically when you do.",
      required: false, visibility: "all", sortOrder: 2,
      createdAt: new Date(Date.now() - 11 * 86400_000).toISOString(),
      updatedAt: new Date(Date.now() - 11 * 86400_000).toISOString() },
  ],
  "cmp-2": [
    { id: "lnk_2a", campaignId: "cmp-2", type: "dropbox",
      title: "DDB Beauty · launch raw",
      url: "https://www.dropbox.com/sh/ddb-launch",
      notes: "BTS arrivals + runway rehearsal cuts only. Outfit shots are off-limits this drop.",
      required: true, visibility: "all", sortOrder: 0,
      createdAt: new Date(Date.now() - 6 * 86400_000).toISOString(),
      updatedAt: new Date(Date.now() - 12 * 3600_000).toISOString() },
  ],
  "cmp-3": [
    { id: "lnk_3a", campaignId: "cmp-3", type: "direct_url",
      title: "Product Hunt landing page",
      url: "https://www.producthunt.com/posts/liquid-clips",
      notes: "Submit at 09:00 PT sharp · screenshot your upvote + drop it in the campaign chat.",
      required: true, visibility: "all", sortOrder: 0,
      createdAt: new Date(Date.now() - 3 * 86400_000).toISOString(),
      updatedAt: new Date(Date.now() - 6 * 3600_000).toISOString() },
  ],
  "cmp-4": [
    { id: "lnk_4a", campaignId: "cmp-4", type: "direct_url",
      title: "Affiliate dashboard",
      url: "https://whop.com/liquidclips/affiliate",
      notes: "Grab your tracking link · paste in bio, captions, or scripts.",
      required: false, visibility: "all", sortOrder: 0,
      createdAt: new Date(Date.now() - 14 * 86400_000).toISOString(),
      updatedAt: new Date(Date.now() - 1 * 86400_000).toISOString() },
    { id: "lnk_4b", campaignId: "cmp-4", type: "google_drive",
      title: "Brand assets pack",
      url: "https://drive.google.com/drive/folders/lc-brand",
      notes: null, required: false, visibility: "all", sortOrder: 1,
      createdAt: new Date(Date.now() - 14 * 86400_000).toISOString(),
      updatedAt: new Date(Date.now() - 14 * 86400_000).toISOString() },
  ],
  "cmp-5": [
    { id: "lnk_5a", campaignId: "cmp-5", type: "google_drive",
      title: "Tech sponsor · whitelist clips",
      url: "https://drive.google.com/drive/folders/tech-whitelist",
      notes: "Only material in this folder is approved for derivative clips. Anything else gets rejected.",
      required: true, visibility: "approved", sortOrder: 0,
      createdAt: new Date(Date.now() - 4 * 86400_000).toISOString(),
      updatedAt: new Date(Date.now() - 4 * 3600_000).toISOString() },
  ],
  "cmp-6": [],
};

/* Mutable mock state so create/patch/remove/reorder work in browser
 * preview without a backend. */
const assetLinksState: { byCampaignId: Record<string, CampaignAssetLink[]> } = {
  byCampaignId: Object.fromEntries(
    Object.entries(assetLinksMock).map(([k, v]) => [k, [...v]]),
  ),
};

export const campaignAssetLinks = {
  async list(p: { slug: string }): Promise<{ links: CampaignAssetLink[]; source: "real-rpc" | "real-http" | "mock" }> {
    // 2026-07-05 · CM-T6 · discovery-wrapper swap.
    if (shouldTryHttpBackend()) {
      try {
        const j = await bridgeToBackend<{ links?: BackendAssetLinkBlock[] }>(
          "GET",
          `/campaigns/${encodeURIComponent(p.slug)}/asset-links`,
        );
        const links = (j.links ?? []).map(adaptBackendAssetLink);
        return { links, source: "real-http" };
      } catch (e) {
        if (!(e instanceof BridgeError)) throw e;
      }
    }
    /* Mock fallback · resolve slug → campaign id via campaignsState. */
    const camp = campaignsState.campaigns.find((c) => c.slug === p.slug);
    if (!camp) return { links: [], source: "mock" };
    const links = assetLinksState.byCampaignId[camp.id] ?? [];
    return { links: [...links].sort((a, b) => a.sortOrder - b.sortOrder), source: "mock" };
  },

  async create(p: { slug: string; payload: CampaignAssetLinkCreate }): Promise<{ link: CampaignAssetLink | null }> {
    const real = await tryInvoke<{ link: CampaignAssetLink | null }>("create_campaign_asset_link", p);
    if (real) return real;
    if (shouldTryHttpBackend()) try {
      const r = await fetch(`${backendUrl()}/agency/campaigns/${encodeURIComponent(p.slug)}/asset-links`, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          type: p.payload.type,
          title: p.payload.title,
          url: p.payload.url ?? "",
          notes: p.payload.notes ?? null,
          required: p.payload.required ?? false,
          visibility: p.payload.visibility ?? "all",
          sort_order: p.payload.sortOrder ?? 0,
        }),
      });
      if (r.ok) {
        const j = (await r.json()) as BackendAssetLinkBlock;
        return { link: adaptBackendAssetLink(j) };
      }
    } catch { /* fall through */ }
    const camp = campaignsState.campaigns.find((c) => c.slug === p.slug);
    if (!camp) return { link: null };
    const next: CampaignAssetLink = {
      id: `lnk_mock_${Date.now()}`,
      campaignId: camp.id,
      type: p.payload.type,
      title: p.payload.title,
      url: p.payload.url ?? "",
      notes: p.payload.notes ?? null,
      required: p.payload.required ?? false,
      visibility: p.payload.visibility ?? "all",
      sortOrder: p.payload.sortOrder ?? (assetLinksState.byCampaignId[camp.id]?.length ?? 0),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const arr = assetLinksState.byCampaignId[camp.id] ?? [];
    assetLinksState.byCampaignId[camp.id] = [...arr, next];
    return { link: next };
  },

  async patch(p: { slug: string; id: string; payload: CampaignAssetLinkPatch }): Promise<{ link: CampaignAssetLink | null }> {
    const real = await tryInvoke<{ link: CampaignAssetLink | null }>("patch_campaign_asset_link", p);
    if (real) return real;
    if (shouldTryHttpBackend()) try {
      const r = await fetch(`${backendUrl()}/agency/campaigns/${encodeURIComponent(p.slug)}/asset-links/${encodeURIComponent(p.id)}`, {
        method: "PATCH",
        cache: "no-store",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          ...(p.payload.type !== undefined && { type: p.payload.type }),
          ...(p.payload.title !== undefined && { title: p.payload.title }),
          ...(p.payload.url !== undefined && { url: p.payload.url }),
          ...(p.payload.notes !== undefined && { notes: p.payload.notes }),
          ...(p.payload.required !== undefined && { required: p.payload.required }),
          ...(p.payload.visibility !== undefined && { visibility: p.payload.visibility }),
          ...(p.payload.sortOrder !== undefined && { sort_order: p.payload.sortOrder }),
        }),
      });
      if (r.ok) {
        const j = (await r.json()) as BackendAssetLinkBlock;
        return { link: adaptBackendAssetLink(j) };
      }
    } catch { /* fall through */ }
    const camp = campaignsState.campaigns.find((c) => c.slug === p.slug);
    if (!camp) return { link: null };
    const arr = assetLinksState.byCampaignId[camp.id] ?? [];
    const idx = arr.findIndex((x) => x.id === p.id);
    if (idx < 0) return { link: null };
    const updated: CampaignAssetLink = {
      ...arr[idx],
      ...(p.payload.type !== undefined && { type: p.payload.type }),
      ...(p.payload.title !== undefined && { title: p.payload.title }),
      ...(p.payload.url !== undefined && { url: p.payload.url }),
      ...(p.payload.notes !== undefined && { notes: p.payload.notes }),
      ...(p.payload.required !== undefined && { required: p.payload.required }),
      ...(p.payload.visibility !== undefined && { visibility: p.payload.visibility }),
      ...(p.payload.sortOrder !== undefined && { sortOrder: p.payload.sortOrder }),
      updatedAt: new Date().toISOString(),
    };
    arr[idx] = updated;
    assetLinksState.byCampaignId[camp.id] = arr;
    return { link: updated };
  },

  async remove(p: { slug: string; id: string }): Promise<{ ok: boolean }> {
    const real = await tryInvoke<{ ok: boolean }>("remove_campaign_asset_link", p);
    if (real) return real;
    if (shouldTryHttpBackend()) try {
      const r = await fetch(`${backendUrl()}/agency/campaigns/${encodeURIComponent(p.slug)}/asset-links/${encodeURIComponent(p.id)}`, {
        method: "DELETE",
        cache: "no-store",
        headers: authHeaders(),
      });
      if (r.ok || r.status === 204) return { ok: true };
    } catch { /* fall through */ }
    const camp = campaignsState.campaigns.find((c) => c.slug === p.slug);
    if (!camp) return { ok: false };
    const before = assetLinksState.byCampaignId[camp.id] ?? [];
    assetLinksState.byCampaignId[camp.id] = before.filter((x) => x.id !== p.id);
    return { ok: assetLinksState.byCampaignId[camp.id].length < before.length };
  },

  async reorder(p: { slug: string; items: Array<{ id: string; sortOrder: number }> }): Promise<{ links: CampaignAssetLink[] }> {
    const real = await tryInvoke<{ links: CampaignAssetLink[] }>("reorder_campaign_asset_links", p);
    if (real) return real;
    if (shouldTryHttpBackend()) try {
      const r = await fetch(`${backendUrl()}/agency/campaigns/${encodeURIComponent(p.slug)}/asset-links/reorder`, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ items: p.items.map((it) => ({ id: it.id, sort_order: it.sortOrder })) }),
      });
      if (r.ok) {
        const j = (await r.json()) as { links: BackendAssetLinkBlock[] };
        return { links: j.links.map(adaptBackendAssetLink) };
      }
    } catch { /* fall through */ }
    const camp = campaignsState.campaigns.find((c) => c.slug === p.slug);
    if (!camp) return { links: [] };
    const order = new Map(p.items.map((it) => [it.id, it.sortOrder]));
    const arr = (assetLinksState.byCampaignId[camp.id] ?? []).map((row) =>
      order.has(row.id) ? { ...row, sortOrder: order.get(row.id)! } : row,
    );
    arr.sort((a, b) => a.sortOrder - b.sortOrder);
    assetLinksState.byCampaignId[camp.id] = arr;
    return { links: [...arr] };
  },
};

export function _readMockAssetLinksState() {
  return assetLinksState;
}

/* ============================================================
   Phase 6N-E v1 · Agency Campaign Creation
   Backed by `junior-backend/app/routes/agency_campaigns.py`.
   v1 rule: Whop is the source of truth for the reward · Liquid Clips
   is the execution layer. No new OAuth, no bounty:create, no in-app
   reward creation. External Whop creation is the intended v1 path.
   ============================================================ */

export type WhopRewardState =
  | "unlinked"
  | "pending_reward"
  | "connected"
  | "live"
  | "funded"
  | "partially_funded"
  | "capacity_reached"
  | "closed"
  | "unreachable"
  | "not_visible"
  | "stale";

export type AgencyValidateSource =
  | "real"
  | "cache"
  | "unreachable"
  | "not_visible"
  | "invalid_input";

// URL-first patch · separate enrichment outcome from reward state. The
// agency flow NEVER blocks on `not_attempted` / `not_enriched` / `unreachable`.
export type WhopRewardSnapshotStatus =
  | "not_attempted"
  | "enriched"
  | "not_enriched"
  | "unreachable";

export interface WhopRewardSnapshot {
  id?: string;
  title?: string;
  description?: string;
  baseUnitAmount?: number;
  rewardPerUnitAmount?: number;
  budgetAmount?: number;
  totalPaid?: number;
  currency?: string;
  status?: string;
  bountyType?: string;
  businessGoalType?: string;
  acceptedSubmissionsLimit?: number;
  acceptedSubmissionsCount?: number;
  spotsRemaining?: number;
  viewCount?: number;
  thumbnail?: string | null;
  allowYoutube?: boolean;
  allowTiktok?: boolean;
  allowInstagram?: boolean;
  allowX?: boolean;
  user?: { username?: string; name?: string; image?: string | null };
  experience?: { id?: string; name?: string };
  attachments?: Array<{ filename?: string; sourceUrl?: string; contentType?: string }>;
  [key: string]: unknown;
}

export interface ValidateRewardRequest { input: string; }

export interface ValidateRewardResponse {
  rewardId: string | null;
  snapshot: WhopRewardSnapshot | null;
  rewardState: WhopRewardState;
  businessGoal: string | null;
  bountyType: string | null;
  source: AgencyValidateSource;
  /** URL-first · separates "we tried to enrich" from "we never tried". */
  snapshotStatus: WhopRewardSnapshotStatus;
  error: string | null;
}

export type AgencyCampaignType = "clip" | "coordination" | "affiliate" | "submission";
export type AgencyCampaignStatus =
  | "draft"
  | "pending_reward"
  | "coming_soon"
  | "partially_funded"
  | "funded"
  | "live"
  | "closed";

export interface AgencyCampaignCreate {
  title: string;
  slug: string;
  campaignType?: AgencyCampaignType;
  description?: string;
  /** URL-first patch · URL is the source of truth; id is optional bonus. */
  whopRewardUrl?: string;
  whopRewardId?: string;
  businessUnit?: string;
  requiredTier?: string;
  visibilityTiers?: string[];
}

export interface AgencyCampaignPatch {
  title?: string;
  description?: string;
  campaignType?: AgencyCampaignType;
  businessUnit?: string;
  requiredTier?: string;
  visibilityTiers?: string[];
  bannerUrl?: string;
  missionLane?: string;
}

export interface AgencyCampaignBlock {
  id: string;
  slug: string;
  title: string;
  description: string;
  campaignType: AgencyCampaignType;
  status: AgencyCampaignStatus;
  whopRewardId: string | null;
  whopRewardUrl: string | null;
  whopRewardState: WhopRewardState | null;
  /** URL-first · explicit enrichment outcome. */
  whopRewardSnapshotStatus: WhopRewardSnapshotStatus;
  whopRewardSnapshot: WhopRewardSnapshot | null;
  whopRewardSnapshotBusinessGoal: string | null;
  whopRewardSnapshotBountyType: string | null;
  whopRewardSyncedAt: string | null;
  whopRewardLastError: string | null;
  bannerUrl: string | null;
  businessUnit: string | null;
  requiredTier: string | null;
  visibilityTiers: string[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BackendValidateResponse {
  reward_id: string | null;
  snapshot: WhopRewardSnapshot | null;
  reward_state: WhopRewardState;
  business_goal: string | null;
  bounty_type: string | null;
  source: AgencyValidateSource;
  snapshot_status: WhopRewardSnapshotStatus;
  error: string | null;
}

interface BackendCampaignBlock {
  id: string;
  slug: string;
  title: string;
  description: string;
  campaign_type: AgencyCampaignType;
  status: AgencyCampaignStatus;
  whop_reward_id: string | null;
  whop_reward_url: string | null;
  whop_reward_state: WhopRewardState | null;
  whop_reward_snapshot_status: WhopRewardSnapshotStatus;
  whop_reward_snapshot: WhopRewardSnapshot | null;
  whop_reward_snapshot_business_goal: string | null;
  whop_reward_snapshot_bounty_type: string | null;
  whop_reward_synced_at: string | null;
  whop_reward_last_error: string | null;
  banner_url: string | null;
  business_unit: string | null;
  required_tier: string | null;
  visibility_tiers: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function adaptValidate(b: BackendValidateResponse): ValidateRewardResponse {
  return {
    rewardId: b.reward_id,
    snapshot: b.snapshot,
    rewardState: b.reward_state,
    businessGoal: b.business_goal,
    bountyType: b.bounty_type,
    source: b.source,
    // Backends pre-§8 may not emit snapshot_status · derive from source.
    snapshotStatus: b.snapshot_status ?? deriveSnapshotStatusFromSource(b.source),
    error: b.error,
  };
}

function deriveSnapshotStatusFromSource(source: AgencyValidateSource): WhopRewardSnapshotStatus {
  if (source === "real") return "enriched";
  if (source === "not_visible") return "not_enriched";
  if (source === "unreachable") return "unreachable";
  return "not_attempted";
}

function adaptAgencyCampaign(b: BackendCampaignBlock): AgencyCampaignBlock {
  return {
    id: b.id,
    slug: b.slug,
    title: b.title,
    description: b.description,
    campaignType: b.campaign_type,
    status: b.status,
    whopRewardId: b.whop_reward_id,
    whopRewardUrl: b.whop_reward_url,
    whopRewardState: b.whop_reward_state,
    whopRewardSnapshotStatus: b.whop_reward_snapshot_status ?? "not_attempted",
    whopRewardSnapshot: b.whop_reward_snapshot,
    whopRewardSnapshotBusinessGoal: b.whop_reward_snapshot_business_goal,
    whopRewardSnapshotBountyType: b.whop_reward_snapshot_bounty_type,
    whopRewardSyncedAt: b.whop_reward_synced_at,
    whopRewardLastError: b.whop_reward_last_error,
    bannerUrl: b.banner_url,
    businessUnit: b.business_unit,
    requiredTier: b.required_tier,
    visibilityTiers: b.visibility_tiers,
    createdBy: b.created_by,
    createdAt: b.created_at,
    updatedAt: b.updated_at,
  };
}

const WHOP_REWARD_ID_RE = /\b((?:b|bnty)_[a-zA-Z0-9_-]+)\b/;

function mockSnapshotFor(rewardId: string): WhopRewardSnapshot {
  return {
    id: rewardId,
    title: "Mock reward · preview only",
    description: "Real reward fields land when the backend is reachable.",
    baseUnitAmount: 3.0,
    rewardPerUnitAmount: 0,
    budgetAmount: 2500,
    totalPaid: 1820,
    currency: "usd",
    status: "published",
    bountyType: "workforce",
    businessGoalType: "clipping",
    acceptedSubmissionsLimit: 50,
    acceptedSubmissionsCount: 36,
    spotsRemaining: 14,
    viewCount: 0,
    thumbnail: "/brand/sponsored/thumb-creator.png",
    allowYoutube: true,
    allowTiktok: true,
    allowInstagram: true,
    allowX: false,
    user: { username: "preview-host", name: "Preview Host", image: null },
    experience: { id: "exp_mock", name: "Preview Community" },
    attachments: [],
  };
}

function mockDeriveState(snapshot: WhopRewardSnapshot | null): WhopRewardState {
  if (!snapshot) return "unlinked";
  const accepted = snapshot.acceptedSubmissionsCount ?? 0;
  const limit = snapshot.acceptedSubmissionsLimit ?? 0;
  const spots = snapshot.spotsRemaining;
  const total = snapshot.totalPaid ?? 0;
  const budget = snapshot.budgetAmount ?? 0;
  const status = (snapshot.status ?? "").toLowerCase();
  if (status === "archived" || status === "closed") return "closed";
  if (spots === 0 && limit > 0) return "capacity_reached";
  if (status === "published" || status === "live" || status === "active") {
    if (limit && accepted > 0 && accepted < limit) return "partially_funded";
    if (budget && total < budget) return "funded";
    return "live";
  }
  return "connected";
}

const agencyCampaignsState: { campaigns: AgencyCampaignBlock[] } = { campaigns: [] };

export const agencyWhop = {
  async validateReward(p: ValidateRewardRequest): Promise<ValidateRewardResponse> {
    /* Real HTTP backend via bridgeToBackend · POST /agency/whop/
     *  validate-reward → BackendValidateResponse. C1-T6 codemod
     *  (2026-07-05). */
    if (shouldTryHttpBackend()) {
      try {
        const j = await bridgeToBackend<BackendValidateResponse>(
          "POST",
          "/agency/whop/validate-reward",
          { input: p.input },
        );
        return adaptValidate(j);
      } catch (err) {
        void err;
        /* fall through to mock */
      }
    }
    const m = p.input.match(WHOP_REWARD_ID_RE);
    if (!m) {
      // URL-first patch · no id is NOT an error · the URL is still
      // the source of truth. UI shows "Use this URL anyway" CTA.
      return {
        rewardId: null,
        snapshot: null,
        rewardState: "unlinked",
        businessGoal: null,
        bountyType: null,
        source: "invalid_input",
        snapshotStatus: "not_attempted",
        error: null,
      };
    }
    const rewardId = m[1];
    const snap = mockSnapshotFor(rewardId);
    return {
      rewardId,
      snapshot: snap,
      rewardState: mockDeriveState(snap),
      businessGoal: snap.businessGoalType ?? null,
      bountyType: snap.bountyType ?? null,
      source: "real",
      snapshotStatus: "enriched",
      error: null,
    };
  },
};

export const agencyCampaigns = {
  async create(p: AgencyCampaignCreate): Promise<AgencyCampaignBlock | null> {
    /* Real HTTP backend via bridgeToBackend · POST /agency/campaigns
     *  → BackendCampaignBlock. C1-T6 codemod (2026-07-05). */
    if (shouldTryHttpBackend()) {
      try {
        const j = await bridgeToBackend<BackendCampaignBlock>(
          "POST",
          "/agency/campaigns",
          {
            title: p.title,
            slug: p.slug,
            campaign_type: p.campaignType ?? "clip",
            description: p.description ?? "",
            // URL-first patch · URL is canonical · id is bonus.
            whop_reward_url: p.whopRewardUrl,
            whop_reward_id: p.whopRewardId,
            business_unit: p.businessUnit,
            required_tier: p.requiredTier,
            visibility_tiers: p.visibilityTiers,
          },
        );
        return adaptAgencyCampaign(j);
      } catch (err) {
        void err;
        /* fall through to mock */
      }
    }
    // URL-first patch mock parity · extract id from URL when not given;
    // campaign STAYS in `draft` whether or not enrichment succeeds.
    const extractedId = p.whopRewardId ?? (p.whopRewardUrl?.match(WHOP_REWARD_ID_RE)?.[1] ?? null);
    let snapshot: WhopRewardSnapshot | null = null;
    let rewardState: WhopRewardState = "unlinked";
    let snapshotStatus: WhopRewardSnapshotStatus = "not_attempted";
    let lastError: string | null = null;
    if (extractedId) {
      const v = await agencyWhop.validateReward({ input: extractedId });
      snapshot = v.snapshot;
      rewardState = v.rewardState;
      snapshotStatus = v.snapshotStatus;
      lastError = v.error;
    }
    const row: AgencyCampaignBlock = {
      id: `cmpmock_${Date.now()}`,
      slug: p.slug,
      title: p.title,
      description: p.description ?? "",
      campaignType: p.campaignType ?? "clip",
      // URL-first · always start as draft. Status only flips on publish.
      status: "draft",
      whopRewardId: extractedId,
      whopRewardUrl: p.whopRewardUrl ?? null,
      whopRewardState: rewardState,
      whopRewardSnapshotStatus: snapshotStatus,
      whopRewardSnapshot: snapshot,
      whopRewardSnapshotBusinessGoal: snapshot?.businessGoalType ?? null,
      whopRewardSnapshotBountyType: snapshot?.bountyType ?? null,
      whopRewardSyncedAt: snapshot ? new Date().toISOString() : null,
      whopRewardLastError: lastError,
      bannerUrl: null,
      businessUnit: p.businessUnit ?? null,
      requiredTier: p.requiredTier ?? null,
      visibilityTiers: p.visibilityTiers ?? ["free", "solo", "pro", "agency"],
      createdBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    agencyCampaignsState.campaigns = [row, ...agencyCampaignsState.campaigns];
    return row;
  },

  async patch(p: { slug: string; payload: AgencyCampaignPatch }): Promise<AgencyCampaignBlock | null> {
    /* Real HTTP backend via bridgeToBackend · PATCH
     *  /agency/campaigns/{slug} → BackendCampaignBlock. C1-T6 codemod
     *  (2026-07-05). */
    if (shouldTryHttpBackend()) {
      try {
        const j = await bridgeToBackend<BackendCampaignBlock>(
          "PATCH",
          `/agency/campaigns/${encodeURIComponent(p.slug)}`,
          {
            ...(p.payload.title !== undefined && { title: p.payload.title }),
            ...(p.payload.description !== undefined && { description: p.payload.description }),
            ...(p.payload.campaignType !== undefined && { campaign_type: p.payload.campaignType }),
            ...(p.payload.businessUnit !== undefined && { business_unit: p.payload.businessUnit }),
            ...(p.payload.requiredTier !== undefined && { required_tier: p.payload.requiredTier }),
            ...(p.payload.visibilityTiers !== undefined && { visibility_tiers: p.payload.visibilityTiers }),
            ...(p.payload.bannerUrl !== undefined && { banner_url: p.payload.bannerUrl }),
            ...(p.payload.missionLane !== undefined && { mission_lane: p.payload.missionLane }),
          },
        );
        return adaptAgencyCampaign(j);
      } catch (err) {
        void err;
        /* fall through to mock */
      }
    }
    const idx = agencyCampaignsState.campaigns.findIndex((c) => c.slug === p.slug);
    if (idx < 0) return null;
    const updated: AgencyCampaignBlock = {
      ...agencyCampaignsState.campaigns[idx],
      ...(p.payload.title !== undefined && { title: p.payload.title }),
      ...(p.payload.description !== undefined && { description: p.payload.description }),
      ...(p.payload.campaignType !== undefined && { campaignType: p.payload.campaignType }),
      ...(p.payload.businessUnit !== undefined && { businessUnit: p.payload.businessUnit }),
      ...(p.payload.requiredTier !== undefined && { requiredTier: p.payload.requiredTier }),
      ...(p.payload.visibilityTiers !== undefined && { visibilityTiers: p.payload.visibilityTiers }),
      ...(p.payload.bannerUrl !== undefined && { bannerUrl: p.payload.bannerUrl }),
      updatedAt: new Date().toISOString(),
    };
    agencyCampaignsState.campaigns[idx] = updated;
    return updated;
  },

  async connectReward(p: { slug: string; whopRewardUrl?: string; whopRewardId?: string }): Promise<AgencyCampaignBlock | null> {
    /* Real HTTP backend via bridgeToBackend · POST
     *  /agency/campaigns/{slug}/connect-reward → BackendCampaignBlock.
     *  URL-first: URL is canonical · id is bonus. C1-T6 codemod
     *  (2026-07-05). */
    if (shouldTryHttpBackend()) {
      try {
        const j = await bridgeToBackend<BackendCampaignBlock>(
          "POST",
          `/agency/campaigns/${encodeURIComponent(p.slug)}/connect-reward`,
          {
            whop_reward_url: p.whopRewardUrl,
            whop_reward_id: p.whopRewardId,
          },
        );
        return adaptAgencyCampaign(j);
      } catch (err) {
        void err;
        /* fall through to mock */
      }
    }
    const idx = agencyCampaignsState.campaigns.findIndex((c) => c.slug === p.slug);
    if (idx < 0) return null;
    const extractedId = p.whopRewardId ?? (p.whopRewardUrl?.match(WHOP_REWARD_ID_RE)?.[1] ?? null);
    let snapshot: WhopRewardSnapshot | null = null;
    let rewardState: WhopRewardState = "unlinked";
    let snapshotStatus: WhopRewardSnapshotStatus = "not_attempted";
    let lastError: string | null = null;
    if (extractedId) {
      const v = await agencyWhop.validateReward({ input: extractedId });
      snapshot = v.snapshot;
      rewardState = v.rewardState;
      snapshotStatus = v.snapshotStatus;
      lastError = v.error;
    }
    const prev = agencyCampaignsState.campaigns[idx];
    const updated: AgencyCampaignBlock = {
      ...prev,
      whopRewardId: extractedId ?? prev.whopRewardId,
      whopRewardUrl: p.whopRewardUrl ?? prev.whopRewardUrl,
      whopRewardSnapshot: snapshot ?? prev.whopRewardSnapshot,
      whopRewardState: rewardState,
      whopRewardSnapshotStatus: snapshotStatus,
      whopRewardSnapshotBusinessGoal: snapshot?.businessGoalType ?? prev.whopRewardSnapshotBusinessGoal,
      whopRewardSnapshotBountyType: snapshot?.bountyType ?? prev.whopRewardSnapshotBountyType,
      whopRewardSyncedAt: snapshot ? new Date().toISOString() : prev.whopRewardSyncedAt,
      whopRewardLastError: lastError,
      // URL-first · campaign stays in draft. Publish is the only status mutator.
      updatedAt: new Date().toISOString(),
    };
    agencyCampaignsState.campaigns[idx] = updated;
    return updated;
  },

  async publish(p: { slug: string }): Promise<{ ok: boolean; campaign?: AgencyCampaignBlock; errors?: string[] }> {
    /* Real HTTP backend via bridgeToBackend · POST
     *  /agency/campaigns/{slug}/publish → BackendCampaignBlock. 422
     *  is a business-rule violation (campaign not ready · missing
     *  fields), surfaced as {ok:false, errors}. Other non-2xx fall
     *  through to mock. C1-T6 codemod (2026-07-05). */
    if (shouldTryHttpBackend()) {
      try {
        const j = await bridgeToBackend<BackendCampaignBlock>(
          "POST",
          `/agency/campaigns/${encodeURIComponent(p.slug)}/publish`,
        );
        return { ok: true, campaign: adaptAgencyCampaign(j) };
      } catch (err) {
        if (err instanceof BridgeError && err.status === 422) {
          const detail = (err.body as { detail?: { errors?: string[] } | string } | null)?.detail;
          const errors = typeof detail === "object" && detail?.errors
            ? detail.errors
            : ["Campaign isn't ready to publish · check the review step."];
          return { ok: false, errors };
        }
        /* fall through to mock for other statuses / network */
      }
    }
    const idx = agencyCampaignsState.campaigns.findIndex((c) => c.slug === p.slug);
    if (idx < 0) return { ok: false, errors: ["Campaign not found"] };
    const row = agencyCampaignsState.campaigns[idx];
    const errors: string[] = [];
    // URL-first patch · gate on URL OR id (URL is canonical) · title +
    // brief · NEVER on enrichment status.
    const hasUrl = !!(row.whopRewardUrl?.trim());
    const hasId = !!(row.whopRewardId?.trim());
    if (!(hasUrl || hasId)) errors.push("Connect a Whop reward (paste the URL) before publishing.");
    if (!row.title.trim()) errors.push("Title is required.");
    if (!row.description.trim()) errors.push("Brief is required · mirror the Whop reward rules in the description.");
    if (errors.length > 0) return { ok: false, errors };
    const rs = row.whopRewardState ?? "unlinked";
    const nextStatus: AgencyCampaignStatus =
      rs === "closed" || rs === "capacity_reached" ? "closed"
      : rs === "live" || rs === "funded" || rs === "partially_funded" ? "live"
      : "coming_soon";
    const updated: AgencyCampaignBlock = { ...row, status: nextStatus, updatedAt: new Date().toISOString() };
    agencyCampaignsState.campaigns[idx] = updated;
    return { ok: true, campaign: updated };
  },

  async refreshReward(p: { slug: string }): Promise<AgencyCampaignBlock | null> {
    /* Real HTTP backend via bridgeToBackend · POST
     *  /agency/campaigns/{slug}/refresh-reward → BackendCampaignBlock.
     *  C1-T6 codemod (2026-07-05). */
    if (shouldTryHttpBackend()) {
      try {
        const j = await bridgeToBackend<BackendCampaignBlock>(
          "POST",
          `/agency/campaigns/${encodeURIComponent(p.slug)}/refresh-reward`,
        );
        return adaptAgencyCampaign(j);
      } catch (err) {
        void err;
        /* fall through to mock */
      }
    }
    const idx = agencyCampaignsState.campaigns.findIndex((c) => c.slug === p.slug);
    if (idx < 0) return null;
    const row = agencyCampaignsState.campaigns[idx];
    // URL-first · try one more id-extract from the URL before giving up.
    const rewardId = row.whopRewardId ?? (row.whopRewardUrl?.match(WHOP_REWARD_ID_RE)?.[1] ?? null);
    if (!rewardId) return row;
    const v = await agencyWhop.validateReward({ input: rewardId });
    const updated: AgencyCampaignBlock = {
      ...row,
      whopRewardId: rewardId,
      whopRewardSnapshot: v.snapshot,
      whopRewardState: v.rewardState,
      whopRewardSnapshotStatus: v.snapshotStatus,
      whopRewardSyncedAt: new Date().toISOString(),
      whopRewardLastError: v.error,
      updatedAt: new Date().toISOString(),
    };
    agencyCampaignsState.campaigns[idx] = updated;
    return updated;
  },

  /** GET /agency/campaigns · every campaign this agency owns (admin
   *  callers get every campaign, per the backend's own admin bypass).
   *  Phase 3 (2026-08-26) · SubmissionsReview needs this list to know
   *  which campaign slugs to fan out submission reads across. */
  async list(): Promise<AgencyCampaignBlock[]> {
    if (shouldTryHttpBackend()) {
      try {
        const j = await bridgeToBackend<BackendCampaignBlock[]>("GET", "/agency/campaigns");
        return j.map(adaptAgencyCampaign);
      } catch (err) {
        void err;
        /* fall through to mock */
      }
    }
    return agencyCampaignsState.campaigns;
  },

  /** GET /agency/campaigns/{slug}/submissions · real CampaignSubmission
   *  rows for one owned campaign. No mock fallback — SubmissionsReview
   *  already renders an honest empty state when the source isn't real
   *  HTTP, matching the rest of this file's mock-fallback convention of
   *  never inventing submission rows. */
  async submissions(slug: string): Promise<AgencySubmission[]> {
    if (shouldTryHttpBackend()) {
      try {
        return await bridgeToBackend<AgencySubmission[]>(
          "GET",
          `/agency/campaigns/${encodeURIComponent(slug)}/submissions`,
        );
      } catch (err) {
        void err;
      }
    }
    return [];
  },

  /** POST /agency/campaigns/{slug}/submissions/{id}/status · agency-
   *  owner-scoped approve/reject (separate from the admin-only
   *  PATCH /submissions/{id}/status). Backend 404s if the caller
   *  doesn't own the campaign the submission belongs to. */
  async setSubmissionStatus(p: {
    slug: string;
    submissionId: string;
    status: "accepted" | "rejected";
    rejectionReason?: string | null;
  }): Promise<AgencySubmission | null> {
    if (shouldTryHttpBackend()) {
      try {
        return await bridgeToBackend<AgencySubmission>(
          "POST",
          `/agency/campaigns/${encodeURIComponent(p.slug)}/submissions/${encodeURIComponent(p.submissionId)}/status`,
          { status: p.status, rejection_reason: p.rejectionReason ?? null },
        );
      } catch (err) {
        void err;
      }
    }
    return null;
  },
};

/** Wire shape of `AgencySubmissionRow` from junior-backend's
 *  agency_campaigns.py — used by both `submissions()` and
 *  `setSubmissionStatus()` above. */
export interface AgencySubmission {
  id: string;
  user_id: string;
  campaign_id: string;
  clip_url: string;
  moment_type: string;
  status: string;
  rejection_reason: string | null;
  verified_views: number;
  payout_usd_cents: number;
  whop_submission_id: string | null;
  created_at: string;
}

export function _readMockAgencyCampaignsState() {
  return agencyCampaignsState;
}
