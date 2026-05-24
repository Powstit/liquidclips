import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export async function sidecarCall<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  return invoke<T>("sidecar_call", { method, params });
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

export type OverlayType = "stack-bottom" | "stack-top" | "pip-br" | "pip-bl";

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
  applied_paths?: Partial<Record<RatioKey, string>>;
  /** Cell-level overlay state. Keys are CellRole (see layout-cells.ts). */
  cells?: Record<string, CellState>;
  /** Optional music bed — when set, supersedes all per-cell audio choices. */
  music_bed?: { source_path: string; volume?: number } | null;
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
  thumbnails?: { rank: number; path: string; score?: number; source?: string; style?: string; timestamp_s?: number }[];
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
  stages: Record<string, StageState>;
  clips: Clip[];
};

export type BountyContext = {
  id: string;
  title: string;
  rewardPerUnitAmount: number;
  currency: string;
};

export type StageName = "ingest" | "audio" | "transcribe" | "llm" | "cut" | "reframe" | "thumbs";

export const PIPELINE_STAGES: { key: StageName; label: string; runningLabel: string }[] = [
  { key: "ingest", label: "Read the file", runningLabel: "Reading the file" },
  { key: "audio", label: "Extracted audio", runningLabel: "Extracting audio" },
  { key: "transcribe", label: "Transcribed", runningLabel: "Transcribing" },
  { key: "llm", label: "Picked the best moments", runningLabel: "Picking the best moments" },
  { key: "cut", label: "Cut the clips", runningLabel: "Cutting the clips" },
  { key: "reframe", label: "Reframed vertical", runningLabel: "Reframing to vertical" },
  { key: "thumbs", label: "Picked thumbnails", runningLabel: "Picking thumbnails" },
];

/** Which stages run after ingest for a given intent. Cuts/reframe/thumbs are
 * purely per-clip work — the YouTube path skips them entirely (faster, cheaper). */
export function pipelineStagesFor(intent: Intent): StageName[] {
  if (intent === "youtube") return ["audio", "transcribe", "llm"];
  return ["audio", "transcribe", "llm", "cut", "reframe", "thumbs"];
}

/** Filter the pipeline-progress list shown in WorkingStage to match the intent. */
export function visibleStagesFor(intent: Intent) {
  if (intent === "youtube") {
    return PIPELINE_STAGES.filter((s) => !["cut", "reframe", "thumbs"].includes(s.key));
  }
  return PIPELINE_STAGES;
}

export type SecretName =
  | "OPENAI_API_KEY"
  | "ANTHROPIC_API_KEY"
  | "JUNIOR_LICENSE_JWT"
  | "JUNIOR_WHOP_TOKEN";

export type HardwareInfo = {
  ram_gb: number;
  free_disk_gb: number;
  cpu_count: number;
  platform: string;
  warnings: string[];
};

export const sidecar = {
  ping: () => sidecarCall<{ pong: true; version: string }>("ping"),
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
  runStage: (slug: string, stage: StageName) =>
    sidecarCall<{ project: Project }>("run_stage", { slug, stage }),
  getProject: (slug: string) => sidecarCall<{ project: Project }>("get_project", { slug }),
  getMetadata: (slug: string) => sidecarCall<{ metadata: Record<string, string> }>("get_metadata", { slug }),
  secretsStatus: () => sidecarCall<{ secrets: Record<SecretName, boolean> }>("secrets_status"),
  // Restricted to JUNIOR_LICENSE_JWT on the sidecar side — other secrets stay opaque.
  licenseJwtRead: () =>
    sidecarCall<{ name: "JUNIOR_LICENSE_JWT"; value: string | null }>("secret_get", { name: "JUNIOR_LICENSE_JWT" }),
  secretSet: (name: SecretName, value: string) => sidecarCall<{ ok: true; name: SecretName }>("secret_set", { name, value }),
  secretDelete: (name: SecretName) => sidecarCall<{ ok: true; name: SecretName }>("secret_delete", { name }),
  hardwareInfo: () => sidecarCall<HardwareInfo>("hardware_info"),
  preloadWhisper: () => sidecarCall<{ model: string; warmup_seconds: number }>("preload_whisper"),
  regenerateClip: (slug: string, idx: number, start: number, end: number) =>
    sidecarCall<{ project: Project }>("regenerate_clip", { slug, idx, start, end }),
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
    } | null,
  ) =>
    sidecarCall<{ project: Project }>("apply_overlay", { slug, idx, overlay }),
  dripPlan: (slug: string, weeks: 1 | 2 | 3 | 4, userTzOffsetHours: number) =>
    sidecarCall<{ slots: DripSlot[] }>("drip_plan", { slug, weeks, user_tz_offset_hours: userTzOffsetHours }),
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
  experience?: { id: string } | null;
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
  meta: {
    title: string | null;
    uploader: string | null;
    uploader_url: string | null;
    description: string | null;
    poster_path: string | null;
    duration_seconds: number;
    source_url: string;
  };
};

export type LiftProgress = {
  phase: "downloading" | "transcribing" | "done";
  status?: string;
  downloaded_bytes?: number;
  total_bytes?: number | null;
  percent?: number | null;
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
