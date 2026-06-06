import { invoke } from "@tauri-apps/api/core";

// ──────────────────────────────────────────────────────────────────────
// ERROR-DISPLAY POLICY (user-journey-lens, lib pass)
// Every `catch (e) { setError(...) }` MUST run `e` through `humanError(e)`
// or `formatErrorForUI(e)` before reaching the UI. NEVER `setError(String(e))`
// — raw `String(e)` leaks Python tracebacks, "[object Object]", Tauri "Error:"
// prefixes, and "ModuleNotFoundError: ..." to users.
//
// New error surfaces (CaptionDrawer, ResultsGrid, PublishModal, etc.) must
// follow this convention. If you spot a `setError(String(e))` while editing,
// swap it to `setError(humanError(e))` in the same diff.
// ──────────────────────────────────────────────────────────────────────

// P0 #4 — when the Python sidecar attaches a structured error envelope it
// arrives here as a Rust anyhow message prefixed "ENV:{json...}". Caller
// catches SidecarError and reads .human (friendly) and .code (stable key).
export class SidecarError extends Error {
  code: string | null;
  human: string;
  technical: string;
  constructor(env: { error: string; human?: string | null; code?: string | null; technical?: string | null }) {
    super(env.human || env.error);
    this.name = "SidecarError";
    this.code = env.code ?? null;
    this.human = env.human || env.error;
    this.technical = env.technical || env.error;
  }
}

/**
 * Sprint #25 — convert any thrown value into a single human-readable line.
 * Replaces `setError(String(e))` everywhere. Prefers SidecarError.human
 * (sidecar pre-classified messages), then pattern-matches common Python /
 * Tauri / network failures, falls back to the raw string. Never returns
 * "ModuleNotFoundError: ..." or similar to a user.
 */
export function humanError(e: unknown): string {
  if (e instanceof SidecarError) return e.human;
  const raw = e instanceof Error ? e.message : String(e);
  // Catch the unhelpful String() coercions of non-Error throwables so the
  // user never sees "null" / "undefined" / "[object Object]" as a message.
  if (!raw || raw === "null" || raw === "undefined" || raw === "[object Object]") {
    return "Something went wrong.";
  }
  // Common pre-classified patterns we still want to humanise even when the
  // error didn't come through SidecarError (e.g. raw Tauri invoke failures,
  // fetch errors, parse errors).
  if (/ModuleNotFoundError|No module named/i.test(raw)) {
    return "The sidecar is missing a required Python package. Open Settings → Diagnose, or reinstall the app.";
  }
  if (/Private video|members-only|login required|sign in to confirm/i.test(raw)) {
    return "That source is private or login-walled. Public links work; private ones don't.";
  }
  if (/Video unavailable|removed by/i.test(raw)) {
    return "The source video is unavailable (removed, geo-blocked, or age-restricted).";
  }
  if (/HTTP Error 429|rate.?limit/i.test(raw)) {
    return "The source is rate-limiting us. Wait a minute and try again.";
  }
  if (/socket|timed out|TimeoutError|Connection refused|Connection reset|Network is unreachable|Failed to fetch/i.test(raw)) {
    return "Network timeout. Check your connection and try again.";
  }
  if (/HTTP 401|unauthori[sz]/i.test(raw)) {
    return "Sign in again — your session expired.";
  }
  if (/HTTP 403/i.test(raw)) {
    return "The server refused that request — check tier or permissions.";
  }
  if (/HTTP 404/i.test(raw)) {
    return "Not found.";
  }
  if (/HTTP 50[0-9]/i.test(raw)) {
    return "Server hiccup. Try again in a moment.";
  }
  // Strip the noisy "Error: " prefix that Tauri / browser sometimes prepends.
  return raw.replace(/^Error:\s*/i, "");
}

/**
 * One-line convenience over humanError() for the dozens of catch sites that
 * just want a string for setError(). Today this is humanError verbatim; the
 * indirection exists so a future change (telemetry, log-and-redact) can land
 * in one place without touching every caller.
 *
 * Use this in `setError(formatErrorForUI(e))`. NEVER `setError(String(e))`.
 */
export function formatErrorForUI(e: unknown): string {
  return humanError(e);
}

import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ──────────────────────────────────────────────────────────────────────
// SidecarLifecycle — surface the Rust-side `sidecar:died` crash event to
// React. Without this, an in-flight RPC promise sits forever and the UI
// shows a spinner with no recovery path. App.tsx is expected to:
//   1. call `subscribeSidecarDied(...)` once on mount,
//   2. on fire, render a global "Liquid Clips needs to restart" overlay
//      with a Restart button (relaunch via @tauri-apps/plugin-process),
//   3. every pending sidecarCall promise has ALREADY been rejected with
//      SidecarCrashedError by this module, so individual screens will
//      surface their own failure cards in parallel.
// ──────────────────────────────────────────────────────────────────────

/** Thrown into every pending sidecarCall promise when the Python sidecar
 *  process dies. Carries the exit code parsed out of the Rust message
 *  ("sidecar crashed (exit=Some(N)); restart the app"). exit_code is null
 *  when Rust couldn't read the status (process detached, signal, etc.). */
export class SidecarCrashedError extends Error {
  exit_code: number | null;
  constructor(exit_code: number | null) {
    super(
      exit_code == null
        ? "The video engine stopped unexpectedly. Please restart Liquid Clips."
        : `The video engine stopped unexpectedly (exit ${exit_code}). Please restart Liquid Clips.`,
    );
    this.name = "SidecarCrashedError";
    this.exit_code = exit_code;
  }
}

// Pending-call registry. Every in-flight sidecarCall registers a rejecter
// and unregisters in its finally block. On sidecar:died we drain the map
// and reject all of them so screens stop spinning.
let _pendingSeq = 0;
const _pendingRejecters = new Map<number, (e: SidecarCrashedError) => void>();

type SidecarDiedInfo = { exit_code: number | null };
const _sidecarDiedListeners = new Set<(info: SidecarDiedInfo) => void>();
let _sidecarDiedRustUnlistener: UnlistenFn | null = null;
let _sidecarDiedAttachInFlight: Promise<void> | null = null;

function _parseExitCodeFromMessage(raw: unknown): number | null {
  // The Rust side emits a string payload like:
  //   "sidecar crashed (exit=Some(137)); restart the app"
  // or "sidecar crashed (exit=None); restart the app"
  // or "sidecar crashed (exit=wait error: ...); restart the app"
  // Parse defensively — anything we can't parse becomes null.
  if (typeof raw !== "string") return null;
  const m = raw.match(/exit=Some\((-?\d+)\)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function _fireSidecarDied(info: SidecarDiedInfo): void {
  // 1. Reject every pending RPC so spinners collapse into recoverable error
  //    surfaces instead of hanging forever.
  const rejecters = Array.from(_pendingRejecters.values());
  _pendingRejecters.clear();
  for (const reject of rejecters) {
    try {
      reject(new SidecarCrashedError(info.exit_code));
    } catch {
      /* swallow — one bad subscriber can't take down the rest */
    }
  }
  // 2. Notify UI subscribers (App.tsx renders the restart overlay).
  for (const cb of _sidecarDiedListeners) {
    try {
      cb(info);
    } catch {
      /* swallow — same reason */
    }
  }
}

async function _ensureSidecarDiedListening(): Promise<void> {
  if (_sidecarDiedRustUnlistener || _sidecarDiedAttachInFlight) {
    return _sidecarDiedAttachInFlight ?? Promise.resolve();
  }
  _sidecarDiedAttachInFlight = (async () => {
    try {
      _sidecarDiedRustUnlistener = await listen<unknown>("sidecar:died", (ev) => {
        const exit_code = _parseExitCodeFromMessage(ev.payload);
        _fireSidecarDied({ exit_code });
      });
    } catch {
      // Listening can fail pre-boot (no Tauri runtime in web preview, etc.).
      // Silent — subscribers will simply never hear from us, which is fine in
      // the no-sidecar code path.
    } finally {
      _sidecarDiedAttachInFlight = null;
    }
  })();
  return _sidecarDiedAttachInFlight;
}

/** Subscribe to sidecar-crash events. Returns an unsubscribe fn. Safe to
 *  call before the Tauri runtime is ready — internally lazy-attaches the
 *  `sidecar:died` Rust listener on first subscribe. */
export function subscribeSidecarDied(cb: (info: SidecarDiedInfo) => void): () => void {
  _sidecarDiedListeners.add(cb);
  // Lazy-attach so unit tests / preview builds don't crash on missing Tauri.
  void _ensureSidecarDiedListening();
  return () => {
    _sidecarDiedListeners.delete(cb);
  };
}

export async function sidecarCall<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  // Make sure we've subscribed to sidecar:died BEFORE we make a call so an
  // immediate crash (rare but possible at boot) can still flush this promise.
  void _ensureSidecarDiedListening();

  const callId = ++_pendingSeq;
  // We can't actually cancel the underlying Tauri invoke promise. What we CAN
  // do is settle our outer promise early on crash by racing two settlements:
  //   - the real invoke result (success or normal rejection)
  //   - a SidecarCrashedError pushed in by _fireSidecarDied
  // Whichever resolves/rejects first wins.
  let crashReject: ((e: SidecarCrashedError) => void) | null = null;
  const crashSettled = new Promise<never>((_resolve, reject) => {
    crashReject = reject;
  });
  if (crashReject) _pendingRejecters.set(callId, crashReject);

  try {
    return await Promise.race<T>([
      (async () => {
        try {
          return await invoke<T>("sidecar_call", { method, params });
        } catch (e) {
          const raw = e instanceof Error ? e.message : String(e);
          // Structured envelope from the Python sidecar (see _classify_error +
          // sidecar.rs JSON-prefix). When present we throw SidecarError so the
          // FailureCard can render `human` instead of the raw exception string.
          const envIdx = raw.indexOf("ENV:");
          if (envIdx >= 0) {
            try {
              const env = JSON.parse(raw.slice(envIdx + 4));
              throw new SidecarError(env);
            } catch (parseErr) {
              if (parseErr instanceof SidecarError) throw parseErr;
              // fall through with raw
            }
          }
          // Also surface a sidecar-crash that the Rust shell propagated as a
          // normal call rejection (e.g. the pending-map drain in sidecar.rs).
          if (/sidecar crashed/i.test(raw)) {
            throw new SidecarCrashedError(_parseExitCodeFromMessage(raw));
          }
          throw e;
        }
      })(),
      crashSettled,
    ]);
  } finally {
    _pendingRejecters.delete(callId);
  }
}

export type IngestProgress = {
  status: "downloading" | "finished" | "error" | string;
  downloaded_bytes: number;
  total_bytes: number | null;
  percent: number | null;
  speed_bps: number | null;
  eta_seconds: number | null;
};

export function onIngestProgress(cb: (p: IngestProgress) => void): Promise<UnlistenFn> {
  return listen<IngestProgress>("sidecar:ingest_progress", (ev) => cb(ev.payload));
}

export type StageProgress = {
  stage: string;
  processed_seconds: number;
  total_seconds: number;
  last_text: string;
  segments_done: number;
  percent: number | null;
};

export function onStageProgress(cb: (p: StageProgress) => void): Promise<UnlistenFn> {
  return listen<StageProgress>("sidecar:stage_progress", (ev) => cb(ev.payload));
}

// --- types mirror python-sidecar/project.py + stages.py ---

export type StageStatus = "pending" | "running" | "done" | "failed";

export type StageState = {
  status: StageStatus;
  started_at: number | null;
  finished_at: number | null;
  error: string | null;
  output: Record<string, unknown>;
};

export type RatioKey = "vertical" | "square" | "portrait";

export const RATIOS: { key: RatioKey; label: string; aspectClass: string }[] = [
  { key: "vertical", label: "9:16", aspectClass: "aspect-[9/16]" },
  { key: "square", label: "1:1", aspectClass: "aspect-square" },
  { key: "portrait", label: "4:5", aspectClass: "aspect-[4/5]" },
];

export type OverlayType = "stack-bottom" | "stack-top" | "split-left" | "split-right" | "pip-br" | "pip-bl";

// Per-cell state — each layout has N cells, each can hold an independent
// source video + an audio role. Exactly one cell's audio plays (or the
// music_bed supersedes everything). See components/clips-feed/layout-cells.ts.
export type CellState = {
  source_path: string | null;
  audio: "this" | "muted";
};

export type Overlay = {
  type: OverlayType;
  // Legacy single-source fields — kept while the backend ships the per-cell
  // schema. UI prefers `cells` when present, falls back to source_path.
  source_path: string;
  start_offset_s: number;
  mute: boolean;
  audio_source?: "main" | "broll" | "muted";
  applied_paths?: Partial<Record<RatioKey, string>>;
  /** Cell-level overlay state. Keys are CellRole (see layout-cells.ts). */
  cells?: Record<string, CellState>;
  /** Optional music bed — when set, supersedes all per-cell audio choices. */
  music_bed?: { source_path: string; volume?: number } | null;
};

export type RemixState = {
  active_path?: Partial<Record<RatioKey, string>>;
  choice_id?: string;
  layout?: string;
  mode?: string;
} | null;

// v0.6.8 — per-axis breakdown of the LC Score. Each axis is 0-100. Surfaces
// under the LC Score badge on ClipCard, with the score_reason as the tooltip.
export type ScoreBreakdown = {
  hook: number;
  retention: number;
  clarity: number;
  shareability: number;
};

export type Clip = {
  start: number;
  end: number;
  title: string;
  description: string;
  theme: string;
  virality: number;
  slug: string;
  title_variants: string[];
  pinned_comment?: string;
  hook_text?: string | null;
  cut_path?: string;
  vertical_path?: string;
  square_path?: string;
  portrait_path?: string;
  srt_path?: string;
  vtt_path?: string;
  captions_burned?: boolean;
  overlay?: Overlay | null;
  remix?: RemixState;
  thumbnails?: { rank: number; path: string; score?: number; source?: string; style?: string; timestamp_s?: number }[];
  // v0.6.8 — branded LC Score sub-scores + one-line reason. Optional on old
  // projects; new LLM responses populate them. When undefined, the ClipCard
  // falls back to virality-only display.
  score_breakdown?: ScoreBreakdown;
  score_reason?: string;
  // v0.6.8 — Fast Draft top-3-first. True when the clip was deferred from the
  // initial reframe pass. ResultsGrid shows a "render pending" pill on these.
  pending_reframe?: boolean;
  // v0.6.9 — True when this clip was imported via the Import lane rather than
  // cut from a source. ClipCard hides "AI estimate" affordances on these
  // (LC Score is a placeholder 70, no sub-score breakdown — don't fake it).
  imported?: boolean;
  // v0.6.46 — Active caption style after the user's last bake. Sidecar's
  // method_edit_captions writes this onto the clip after a successful bake,
  // so the ClipCard captions chip + ClipPreview can render the right style
  // dot without re-reading the .json file. Undefined = caption baking has
  // never run for this clip (or pre-0.6.46 project).
  caption_style?: string;
  // v0.6.47 — Persisted custom palette for `caption_style === "custom"`.
  // Drawer rehydrates react-colorful swatches from this on reopen so the
  // clipper sees the colours they shipped with last time. Cleared by the
  // sidecar when the user switches off Custom.
  caption_palette?: {
    primary?: string;
    secondary?: string;
    outline?: string;
  };
};

export type Intent = "clips" | "youtube" | "both";

export type Project = {
  id: string;
  slug: string;
  root: string;
  source_path: string;
  source_filename: string;
  created_at: number;
  brief: string | null;
  intent: Intent;
  whop_bounty_id: string | null;
  whop_bounty_title: string | null;
  whop_bounty_reward_per_unit: number | null;
  whop_bounty_currency: string | null;
  // Richer bounty context — set when the project was started from a bounty.
  // Drives the BountyWorkspaceHeader + per-clip fit checklist.
  whop_bounty_description: string | null;
  whop_bounty_platforms: string[] | null;
  whop_bounty_source_url: string | null;
  whop_bounty_creator: string | null;
  whop_bounty_spots_remaining: number | null;
  whop_bounty_url: string | null;
  stages: Record<string, StageState>;
  clips: Clip[];
};

// What the desktop hands the sidecar when starting a bounty-linked run. Only
// the first four were persisted historically; the rest were added so the
// workspace feels bounty-specific (header, fit checklist, "open on Whop").
export type BountyContext = {
  id: string;
  title: string;
  rewardPerUnitAmount: number;
  currency: string;
  description?: string | null;
  allowedPlatforms?: string[];
  sourceUrl?: string | null;
  creator?: string | null;
  spotsRemaining?: number | null;
  whopUrl?: string | null;
};

// A locally-stored project linked to a Whop bounty — surfaced in Earn → In progress
// so a clipper can resume bounty work. Returned by sidecar.listBountyProjects().
export type BountyProjectSummary = {
  slug: string;
  source_filename: string;
  created_at: number;
  intent: Intent;
  clips_count: number;
  done: boolean;
  whop_bounty_id: string;
  whop_bounty_title: string | null;
  whop_bounty_reward_per_unit: number | null;
  whop_bounty_currency: string | null;
};

export type ProjectLibrarySummary = {
  slug: string;
  root: string;
  source_filename: string;
  created_at: number;
  updated_at: number;
  intent: Intent;
  clips_count: number;
  done: boolean;
  imported: boolean;
  reacted_count: number;
  whop_bounty_id: string | null;
  whop_bounty_title: string | null;
  archived: boolean;
  archived_at: number | null;
  cover_thumb_path: string | null;
};

export type StageName = "ingest" | "audio" | "transcribe" | "llm" | "cut" | "reframe" | "thumbs";

export const PIPELINE_STAGES: { key: StageName; label: string; runningLabel: string }[] = [
  { key: "ingest", label: "Read the file", runningLabel: "Reading the file" },
  { key: "audio", label: "Extracted audio", runningLabel: "Extracting audio" },
  { key: "transcribe", label: "Polished transcript", runningLabel: "Polishing transcript" },
  { key: "llm", label: "Picked moments", runningLabel: "Drafting clip windows" },
  { key: "cut", label: "Cut the clips", runningLabel: "Cutting the clips" },
  { key: "reframe", label: "Reframed vertical", runningLabel: "Reframing to vertical" },
  { key: "thumbs", label: "Picked thumbnails", runningLabel: "Picking thumbnails" },
];

/** Which stages run after ingest for a given intent. Cuts/reframe/thumbs are
 * purely per-clip work — the YouTube path skips them entirely (faster, cheaper).
 *
 * v0.6.8 — `thumbs` is no longer in the blocking sequence. ResultsGrid renders
 * fine without thumbnail paths (video element is the preview) and thumb
 * generation is a 5-20s tail we don't want fighting the Opus timer. The app
 * fires a background `runStage("thumbs")` after results land so the
 * thumbnails still appear, just out-of-band. */
export function pipelineStagesFor(intent: Intent): StageName[] {
  if (intent === "youtube") return ["audio", "transcribe", "llm"];
  // v0.6.19 — transcribe MUST run before llm; the LLM stage in
  // python-sidecar/stages.py reads transcript.json to pick clip moments and
  // hard-raises `FileNotFoundError: stage 3 (transcribe) must run before
  // stage 4 (llm)` if it's missing. Earlier "fast draft" attempt to defer
  // transcribe to the background path broke every clip run. Speed win
  // already lives inside transcribe itself (MLX on Apple Silicon).
  return ["audio", "transcribe", "llm", "cut", "reframe"];
}

/** Stages that run in the background AFTER results are visible. The desktop
 * fires these as fire-and-forget runStage calls. */
export function backgroundStagesFor(intent: Intent): StageName[] {
  if (intent === "youtube") return [];
  // Only thumbs runs in the background — transcribe is back in the blocking
  // path (see pipelineStagesFor note).
  return ["thumbs"];
}

export const BACKGROUND_STAGES: StageName[] = ["thumbs"];

/** Filter the pipeline-progress list shown in WorkingStage to match the intent.
 *  v0.6.8 — thumbs is excluded; it runs in the background after results land. */
export function visibleStagesFor(intent: Intent) {
  if (intent === "youtube") {
    return PIPELINE_STAGES.filter((s) => !["cut", "reframe", "thumbs"].includes(s.key));
  }
  return PIPELINE_STAGES.filter((s) => !["thumbs"].includes(s.key));
}

export type SecretName =
  | "OPENAI_API_KEY"
  | "ANTHROPIC_API_KEY"
  | "LICENSE_JWT"
  | "LIQUIDCLIPS_ONBOARDED"
  | "JUNIOR_WHOP_TOKEN"
  | "PEXELS_API_KEY"
  | "PIXABAY_API_KEY"
  | "GIPHY_API_KEY";

export type ReactionSearchResult = {
  id: string;
  provider: "giphy" | "pexels" | "pixabay";
  title: string;
  duration_s?: number;
  width?: number;
  height?: number;
  preview_url?: string | null;
  source_url?: string | null;
  author?: string | null;
  author_url?: string | null;
  download_url: string;
  download_width?: number;
  download_height?: number;
};

export type HardwareInfo = {
  ram_gb: number;
  free_disk_gb: number;
  cpu_count: number;
  platform: string;
  warnings: string[];
};

export const sidecar = {
  ping: () => sidecarCall<{ pong: true; version: string }>("ping"),
  checkDeps: () => sidecarCall<{
    ok: boolean;
    missing: string[];
    errors: Record<string, string>;
    python: string;
  }>("check_deps"),
  probe: (path: string) => sidecarCall<{ duration_seconds: number; width: number; height: number; format: string; size_bytes: number }>("probe", { path }),
  startRun: (sourcePath: string, brief?: string, intent: Intent = "both", bounty?: BountyContext) =>
    sidecarCall<{ project: Project }>("start_run", {
      source_path: sourcePath,
      intent,
      ...(brief ? { brief } : {}),
      ...(bounty ? { bounty } : {}),
    }),
  ingestUrl: (url: string, brief?: string, intent: Intent = "both", bounty?: BountyContext) =>
    sidecarCall<{ project: Project; downloaded_path: string }>("ingest_url", {
      url,
      intent,
      ...(brief ? { brief } : {}),
      ...(bounty ? { bounty } : {}),
    }),
  // v0.6.9 — Import finished MP4/MOV/WEBM clips into a normal Project so they
  // land in ResultsGrid with full stack/split/remix/schedule/publish. No
  // transcribe/llm/cut/reframe — every stage pre-marked done by the sidecar.
  importReadyClips: (paths: string[]) =>
    sidecarCall<{ project: Project }>("import_ready_clips", { paths }),
  // v0.6.35 — Cockpit avatar surface. The sidecar canonicalises the upload
  // to ~/LiquidClips/avatar.png so the frontend caches off one URL + bust
  // counter (see useAvatar in lib/avatar.ts).
  saveAvatar: (path: string) =>
    sidecarCall<{ path: string; size_bytes: number }>("save_avatar", { path }),
  clearAvatar: () => sidecarCall<{ removed: true }>("clear_avatar", {}),
  avatarStatus: () =>
    sidecarCall<{ present: boolean; path: string | null; mtime: number | null }>("avatar_status", {}),
  runStage: (slug: string, stage: StageName) =>
    sidecarCall<{ project: Project }>("run_stage", { slug, stage }),
  getProject: (slug: string) => sidecarCall<{ project: Project }>("get_project", { slug }),
  listProjects: (limit = 100, includeArchived = false) =>
    sidecarCall<{ projects: ProjectLibrarySummary[] }>("list_projects", { limit, include_archived: includeArchived }),
  setProjectArchived: (slug: string, archived: boolean) =>
    sidecarCall<{ slug: string; archived: boolean }>("set_project_archived", { slug, archived }),
  deleteProject: (slug: string) =>
    sidecarCall<{ slug: string; deleted: true }>("delete_project", { slug }),
  listBountyProjects: () =>
    sidecarCall<{ projects: BountyProjectSummary[] }>("list_bounty_projects"),
  getMetadata: (slug: string) => sidecarCall<{ metadata: Record<string, string> }>("get_metadata", { slug }),
  secretsStatus: () => sidecarCall<{ secrets: Record<SecretName, boolean> }>("secrets_status"),
  // Whether the LLM clip-picker can resolve an OpenAI key (env → keychain → dev
  // file) — used by the pre-run key guard. More accurate than secretsStatus,
  // which only reports the keychain.
  openaiKeyStatus: () => sidecarCall<{ available: boolean }>("openai_key_status"),
  // Restricted to LICENSE_JWT on the sidecar side — other secrets stay opaque.
  licenseJwtRead: () =>
    sidecarCall<{ name: "LICENSE_JWT"; value: string | null }>("secret_get", { name: "LICENSE_JWT" }),
  secretSet: (name: SecretName, value: string) => sidecarCall<{ ok: true; name: SecretName }>("secret_set", { name, value }),
  secretDelete: (name: SecretName) => sidecarCall<{ ok: true; name: SecretName }>("secret_delete", { name }),
  reactionSearch: (query: string, perPage = 12) =>
    sidecarCall<{
      provider: "giphy" | "pexels" | "pixabay";
      query: string;
      attribution_html: string;
      provider_errors?: Record<string, string>;
      results: ReactionSearchResult[];
    }>("reaction_search", { query, per_page: perPage, provider: "giphy" }),
  reactionSearchProvider: (query: string, provider: "giphy" | "pexels" | "pixabay", perPage = 12) =>
    sidecarCall<{
      provider: "giphy" | "pexels" | "pixabay";
      query: string;
      attribution_html: string;
      provider_errors?: Record<string, string>;
      results: ReactionSearchResult[];
    }>("reaction_search", { query, per_page: perPage, provider }),
  reactionDownload: (item: ReactionSearchResult, query?: string) =>
    sidecarCall<{ path: string; item: Record<string, unknown> }>("reaction_download", { item, query }),
  hardwareInfo: () => sidecarCall<HardwareInfo>("hardware_info"),
  preloadWhisper: () => sidecarCall<{ model: string; warmup_seconds: number }>("preload_whisper"),
  regenerateClip: (slug: string, idx: number, start: number, end: number) =>
    sidecarCall<{ project: Project }>("regenerate_clip", { slug, idx, start, end }),
  getCaptions: (slug: string, idx: number) =>
    sidecarCall<{
      idx: number;
      style: string;
      lines: Array<{
        start: number;
        end: number;
        text: string;
        words?: Array<{ start: number; end: number; text: string }>;
      }>;
      source: "edits" | "transcript";
      has_word_data: boolean;
      has_transcript: boolean;
      transcript_error?: string | null;
      updated_at: string | null;
      // Persisted custom palette — drawer rehydrates react-colorful
      // swatches from this on reopen. Null/undefined for preset-style edits.
      palette?: { primary?: string; secondary?: string; outline?: string } | null;
    }>("get_captions", { slug, idx }),
  editCaptions: (
    slug: string,
    idx: number,
    lines: unknown[],
    style: string,
    palette?: { primary?: string; secondary?: string; outline?: string } | null,
  ) =>
    sidecarCall<{
      project: Project;
      clip_idx: number;
      style: string;
      updated_at: string;
      video_path: string;
      palette?: { primary?: string; secondary?: string; outline?: string } | null;
      // ASS text used to bake. The desktop's libass-wasm overlay renders
      // this directly so the live preview matches the baked MP4 1:1.
      ass_text?: string;
    }>("edit_captions", { slug, idx, lines, style, palette }),
  addClip: (slug: string, start: number, end: number, title: string) =>
    sidecarCall<{ project: Project }>("add_clip", { slug, start, end, title }),
  removeClip: (slug: string, idx: number) =>
    sidecarCall<{ project: Project }>("remove_clip", { slug, idx }),
  updateClipMeta: (
    slug: string,
    idx: number,
    fields: { title?: string; description?: string; pinned_comment?: string },
  ) => sidecarCall<{ project: Project }>("update_clip_meta", { slug, idx, ...fields }),
  liftTranscript: (url: string) => sidecarCall<LiftTranscriptResult>("lift_transcript", { url }),
  // Write the lift-cancel marker so an in-flight lift_transcript raises at
  // its next 2s poll. Safe to call even when nothing is running — just
  // writes a marker that the next lift_transcript will clear on start.
  liftCancel: () => sidecarCall<{ ok: boolean }>("lift_cancel", {}),
  getYoutubeExtras: (slug: string) =>
    sidecarCall<{ youtube: YouTubeExtras }>("get_youtube_extras", { slug }),
  updateYoutubeExtras: (slug: string, fields: Partial<YouTubeExtras>) =>
    sidecarCall<{ youtube: YouTubeExtras }>("update_youtube_extras", { slug, fields }),
  predictTime: (durationSeconds: number, fileSizeMb: number) =>
    sidecarCall<TimePrediction>("predict_time", {
      duration_seconds: durationSeconds,
      file_size_mb: fileSizeMb,
    }),
  whopSessionStatus: () =>
    sidecarCall<{
      // New canonical names — `junior_activated` is what the Earn tab
      // checks to know if backend bounty proxy will work, and
      // `whop_desktop_oauth_source` reports the local Whop OAuth token
      // (reserved for future per-user actions, not browsing).
      junior_activated: boolean;
      whop_desktop_oauth_source: "iframe" | "env_user" | "keychain" | "seller_key" | "none";
      // Legacy fields — same data under old names, kept so a stale UI
      // doesn't crash mid-rollout.
      authenticated: boolean;
      source: "iframe" | "env_user" | "keychain" | "seller_key" | "none";
    }>("whop_session_status"),

  whopOAuthStart: () =>
    sidecarCall<{ authorize_url: string; redirect_uri: string }>("whop_oauth_start"),

  whopOAuthStatus: () =>
    sidecarCall<{ status: "idle" | "pending" | "success" | "error"; error?: string }>(
      "whop_oauth_status",
    ),

  whopOAuthCancel: () => sidecarCall<{ ok: boolean }>("whop_oauth_cancel"),
  whopSetSessionToken: (token: string) =>
    sidecarCall<{ ok: true; authenticated: boolean }>("whop_set_session_token", { token }),
  whopClearSessionToken: () =>
    sidecarCall<{ ok: true }>("whop_clear_session_token"),
  whopListBounties: (first = 30) =>
    sidecarCall<{ bounties: WhopBounty[]; authenticated: boolean; error?: string }>(
      "whop_list_bounties",
      { first },
    ),
  whopBounty: (id: string) =>
    sidecarCall<{ bounty: WhopBounty | null; authenticated: boolean; error?: string }>(
      "whop_bounty",
      { id },
    ),
  whopSubmission: (id: string) =>
    sidecarCall<{ submission: WhopSubmission | null; authenticated: boolean; error?: string }>(
      "whop_submission",
      { id },
    ),
  applyOverlay: (
    slug: string,
    idx: number,
    overlay: {
      type: OverlayType;
      source_path: string;
      start_offset_s?: number;
      audio_source?: "main" | "broll" | "muted";
    } | null,
  ) =>
    sidecarCall<{ project: Project }>("apply_overlay", { slug, idx, overlay }),
  dripPlan: (slug: string, weeks: 1 | 2 | 3 | 4, userTzOffsetHours: number) =>
    sidecarCall<{ slots: DripSlot[] }>("drip_plan", { slug, weeks, user_tz_offset_hours: userTzOffsetHours }),

  // ── Local schedule (Assisted Autopost, 0.4.28+) ──────────────────────
  // File-backed queue at $CLIPS_HOME/.schedule.json. Distinct from the
  // backend Postiz queue — local is always-available, no tier gate, and
  // the desktop reminds the user to post rather than auto-posting itself.
  localScheduleList: () =>
    sidecarCall<{ items: LocalScheduleItem[] }>("local_schedule_list", {}),
  localScheduleAdd: (items: LocalScheduleNew[]) =>
    sidecarCall<{ items: LocalScheduleItem[]; count: number }>(
      "local_schedule_add",
      { items },
    ),
  localScheduleMarkPosted: (id: string, postUrl?: string) =>
    sidecarCall<{ item: LocalScheduleItem }>("local_schedule_mark_posted", {
      id,
      post_url: postUrl ?? null,
    }),
  localScheduleCancel: (id: string) =>
    sidecarCall<{ ok: boolean }>("local_schedule_cancel", { id }),
  localScheduleRemove: (id: string) =>
    sidecarCall<{ ok: boolean }>("local_schedule_remove", { id }),

  // ── Direct-publish queue (Upload tab "drop a finished clip") ─────────
  // File-backed at $CLIPS_HOME/.direct-publish-queue.json. The frontend
  // owns the item shape — sidecar reads/writes the array verbatim. See
  // python-sidecar/direct_publish_queue.py.
  directPublishQueueRead: () =>
    sidecarCall<{ items: DirectPublishQueueItem[] }>(
      "direct_publish_queue_read",
      {},
    ),
  directPublishQueueWrite: (items: DirectPublishQueueItem[]) =>
    sidecarCall<{ ok: true; count: number }>(
      "direct_publish_queue_write",
      { items },
    ),
};

/** A clip that's already cut + ready to schedule/publish directly, without
 *  the long-form clip-pick pipeline. Persisted in
 *  $CLIPS_HOME/.direct-publish-queue.json so the queue survives restarts.
 *  Frontend owns the shape (sidecar is opaque persistence). */
export type DirectPublishQueueItem = {
  /** Local id — short random string. Stable across sessions. */
  id: string;
  /** Absolute path to the finished clip file on disk. */
  file_path: string;
  /** Display name — usually basename of file_path. */
  filename: string;
  /** Byte size at the time it was added, or null if unknown. Used as a
   *  cheap "this file looks right" cue in the card. */
  size_bytes: number | null;
  /** Optional duration in seconds. We skip ffprobe for v1 — the field is
   *  reserved so a later pass can populate it without a schema bump. */
  duration_seconds: number | null;
  /** When the user dropped it. ISO 8601 UTC. */
  added_at: string;
  /** User-editable display title shown above the thumbnail and used as the
   *  default post title when scheduling. Falls back to filename stem in the
   *  UI when unset. Sidecar persists the field opaquely — no schema bump. */
  title?: string;
};

export type TimePrediction = {
  path: "serial" | "chunked";
  total_s: number;
  stages: { name: string; seconds: number }[];
  confidence: "low" | "med" | "high";
  provider: "openai" | "groq";
};

// ── Whop bounty types (mirror python-sidecar/whop_client.py) ──────────

export type WhopBounty = {
  id: string;
  title: string;
  description: string;
  baseUnitAmount: number;
  rewardPerUnitAmount: number;
  currency: string;
  allowYoutube: boolean;
  allowTiktok: boolean;
  allowInstagram: boolean;
  allowX: boolean;
  acceptedSubmissionsLimit: number;
  acceptedSubmissionsCount: number;
  spotsRemaining: number;
  bountyType: string;
  status: string;
  viewCount: number;
  totalPaid: number;
  budgetAmount: number;
  createdAt: string;
  updatedAt: string;
  user: {
    username: string | null;
    name: string | null;
    image: string | null;
  };
  experience?: { id: string; name?: string | null } | null;
  // Campaign thumbnail — flattened from experience.logo.sourceUrl by the
  // backend proxy (Whop has no image on the bounty itself).
  thumbnail?: string | null;
};

export type WhopSubmission = {
  id: string;
  status: "pending" | "claimed" | "submitted" | "approved" | "denied" | "expired" | "unclaimed";
  submittedAt: string | null;
  claimedAt: string | null;
  expiresAt: string | null;
  formattedPayoutAmount: string | null;
  denialReason: string | null;
  verifiedVotesCount: number;
  rejectedVotesCount: number;
  bounty?: {
    id: string;
    title: string;
    rewardPerUnitAmount: number;
    currency: string;
  };
};

export type ScoredTitle = { text: string; score: number; reason: string };
export type EndScreenCTA = { cue: string; payoff: string };
export type YouTubeExtras = {
  scored_titles: ScoredTitle[];
  selected_title_idx: number;
  description: string;
  chapters: { start: number; title: string }[];
  tags: string[];
  hashtags: string[];
  pinned_video_comment: string;
  end_screen_ctas: EndScreenCTA[];
};

export type LiftTranscriptResult = {
  url: string;
  platform: "instagram" | "tiktok" | "youtube" | "x" | "link";
  language: string | null;
  duration: number;
  text: string;
  segments: { start: number; end: number; text: string }[];
  transcribe_engine?: "mlx" | "faster-whisper" | string;
  meta: {
    title: string | null;
    uploader: string | null;
    uploader_url: string | null;
    description: string | null;
    poster_path: string | null;
    duration_seconds: number;
    source_url: string;
    transcribe_engine?: "mlx" | "faster-whisper" | string;
  };
};

export type LiftProgress = {
  phase: "downloading" | "transcribing" | "done";
  status?: string;
  downloaded_bytes?: number;
  total_bytes?: number | null;
  percent?: number | null;
  // Seconds remaining (transcribe phase only). Derived from measured speed
  // once real segments flow; from a heartbeat estimate before that. UI
  // formats as "~N min left" — honest expectation beats a silent bar.
  eta_s?: number | null;
};

export function onLiftProgress(cb: (p: LiftProgress) => void): Promise<UnlistenFn> {
  return listen<LiftProgress>("sidecar:lift_progress", (ev) => cb(ev.payload));
}

export type DripSlot = {
  clip_idx: number;
  clip_title: string;
  vertical_path: string;
  platform: "youtube" | "tiktok" | "x";
  scheduled_for: string; // ISO UTC
  theme: string;
};

/** What the desktop sends to `localScheduleAdd`. The sidecar fills in id,
 *  created_at, status, and posted_at on persist. */
export type LocalScheduleNew = {
  project_slug: string;
  clip_idx: number;
  clip_title: string;
  vertical_path: string;
  platform: "youtube" | "tiktok" | "instagram" | "x";
  scheduled_for: string; // ISO UTC
  caption?: string;
};

/** What the sidecar returns. Mirrors local_schedule.py persisted shape. */
export type LocalScheduleItem = LocalScheduleNew & {
  id: string;
  status: "pending" | "posted" | "canceled";
  caption: string;
  created_at: string;
  posted_at: string | null;
  /** Only populated after `localScheduleMarkPosted(id, postUrl)`. */
  post_url?: string;
};
