/**
 * Engine types · ported from legacy desktop/src/lib/project.ts (shape-equivalent)
 *
 * Phase 6C ports the legacy clipping engine data shapes into the Design OS so
 * routes can render real-looking content without depending on the legacy
 * runtime. Kept narrow: only the fields the ported bricks actually read.
 *
 * Iron Gates IG-001/IG-002 lock the contract on the sidecar side — these
 * types mirror the JSON the sidecar returns.
 */

export type StageName =
  | "ingest" | "audio" | "transcribe" | "llm" | "cut" | "reframe" | "thumbs";

export const STAGE_ORDER: ReadonlyArray<StageName> = [
  "ingest", "audio", "transcribe", "llm", "cut", "reframe", "thumbs",
];

// BUG-029.8 · friendly progress copy. The pill labels describe what the
// pipeline is actually doing to the user, not what the engineering stage
// is named internally. Order matches STAGE_ORDER. The terminal "Clips
// ready" state lives on the heartbeat strip in Workstation.tsx, not here.
export const STAGE_LABEL: Record<StageName, string> = {
  ingest:     "Preparing video",
  audio:      "Preparing audio",
  transcribe: "Transcribing",
  llm:        "Picking clips",
  cut:        "Cutting",
  reframe:    "Rendering",
  thumbs:     "Making thumbnails",
};

export interface StageState {
  done: boolean;
  failed?: boolean;
  failed_at?: string;
  failed_error?: string;
}

export type Platform = "youtube" | "tiktok" | "instagram" | "x" | "linkedin" | "facebook";

export interface ScoreBreakdown {
  hook?: number;
  retention?: number;
  clarity?: number;
  shareability?: number;
}

export interface ClipOverlay {
  type?: string;
  source_path?: string | null;
  music_bed?: string | null;
  start_offset_s?: number;
  bake_status?: "idle" | "baking" | "complete" | "error";
  bake_error?: string | null;
}

export interface Clip {
  idx: number;
  title: string;
  description?: string;
  pinned_comment?: string;
  start: number;
  end: number;
  duration_s?: number;
  /** 0..100 virality score from the LLM. */
  score?: number;
  score_reason?: string;
  score_breakdown?: ScoreBreakdown;
  vertical_path?: string | null;
  /** Cut-stage output — lands before reframe finishes. Used as the preview
   *  fallback when vertical_path isn't ready yet so cards show real video as
   *  soon as Cut completes (sidecar shape — runtime field, see project.json). */
  cut_path?: string | null;
  portrait_path?: string | null;
  square_path?: string | null;
  poster_path?: string | null;
  /** Sidecar thumbnail stage output — 3 PNG variants per clip, sorted by
   *  rank (1 = best). Grid tiles render thumbnails[0] as the poster.
   *  Putting a <video> in every tile and asking WebKit to paint a frame
   *  doesn't work (preload="metadata" never decodes pixels). */
  thumbnails?: Array<{
    rank: number;
    path: string;
    timestamp_s?: number;
    score?: number;
    source?: string;
  }>;
  platforms?: Platform[];
  caption_style?: string;
  imported?: boolean;
  overlay?: ClipOverlay | null;
  /** UI-3 · client-derived lifecycle status. Sidecar will add this field in
   *  Batch D; until then, defaults to "draft" if missing. */
  status?: "draft" | "ready" | "scheduled" | "posted" | "submitted";
}

export interface ProjectMeta {
  slug: string;
  name: string;
  source_path?: string;
  source_url?: string;
  duration_s?: number;
  created_at?: string;
  /** Project-level stages — see STAGE_ORDER for canonical ordering. */
  stages: Partial<Record<StageName, StageState>>;
  clips: Clip[];
  intent?: "clips" | "script";
}

/* Fixture data — for the simulator + defensive-guard sentinel. Kept
 * imported by EditorSection so it can be compared against and REFUSED
 * (see EditorSection.tsx:176 `if (project.name === FIXTURE_PROJECT.name)
 * return;`). Ships to the bundle as inert data · never rendered to a
 * customer in the installed Tauri app.
 *
 * Phase 2 finalization · Option B production-fixture-audit (2026-07-10):
 * `source_url` neutralized from RickRoll (dQw4w9WgXcQ) → sentinel URL
 * so the surviving fixture string in the bundle cannot RickRoll a
 * customer if the browser-preview stub path ever runs in production. */
export const FIXTURE_PROJECT: ProjectMeta = {
  slug: "uncle-daniel-clip-squad-2026",
  name: "Uncle Daniel — Wednesday drop",
  source_url: "https://example.com/preview",
  duration_s: 1844,
  created_at: "2026-06-18T09:14:00Z",
  stages: {
    ingest:     { done: true },
    audio:      { done: true },
    transcribe: { done: true },
    llm:        { done: true },
    cut:        { done: true },
    reframe:    { done: true },
    thumbs:     { done: true },
  },
  clips: [
    {
      idx: 0, title: "The cold-open that actually works",
      start: 0, end: 28, duration_s: 28, score: 92,
      score_reason: "Hook lands in the first 3s · clear face · concrete claim.",
      score_breakdown: { hook: 96, retention: 88, clarity: 92, shareability: 92 },
      platforms: ["tiktok", "instagram", "youtube"],
      caption_style: "fuchsia-pop",
      vertical_path: "/brand/kade/kade-cutting-clips.webp",
      status: "posted",
    },
    {
      idx: 1, title: "Why most clippers fail by minute 4",
      start: 240, end: 295, duration_s: 55, score: 87,
      score_reason: "Strong contrarian angle · pacing dips after 30s.",
      score_breakdown: { hook: 86, retention: 80, clarity: 90, shareability: 92 },
      platforms: ["tiktok", "instagram"],
      caption_style: "cyan-bold",
      vertical_path: "/brand/kade/kade-create-clips.webp",
      status: "ready",
    },
    {
      idx: 2, title: "The one rule nobody tells you about hooks",
      start: 612, end: 670, duration_s: 58, score: 84,
      score_reason: "Memorable line · slightly long for shorts; trim to 45s.",
      score_breakdown: { hook: 88, retention: 78, clarity: 86, shareability: 84 },
      platforms: ["youtube", "x"],
      caption_style: "amber-soft",
      vertical_path: "/brand/kade/kade-reading-brief.webp",
      status: "scheduled",
    },
    {
      idx: 3, title: "How to stop sounding like every other clipper",
      start: 905, end: 962, duration_s: 57, score: 78,
      score_reason: "Solid education clip · expect lower CTR than #0.",
      score_breakdown: { hook: 70, retention: 82, clarity: 84, shareability: 76 },
      platforms: ["youtube", "linkedin"],
      caption_style: "fuchsia-pop",
      vertical_path: "/brand/kade/kade-generating-captions.webp",
      status: "draft",
    },
    {
      idx: 4, title: "The boring tip that beats every viral trick",
      start: 1320, end: 1374, duration_s: 54, score: 72,
      score_reason: "Honest insight · less click-bait energy.",
      score_breakdown: { hook: 62, retention: 84, clarity: 88, shareability: 64 },
      platforms: ["youtube"],
      caption_style: "cyan-bold",
      vertical_path: "/brand/kade/kade-publishing.webp",
      status: "submitted",
    },
    {
      idx: 5, title: "Why you should always end with a CTA",
      start: 1660, end: 1720, duration_s: 60, score: 68,
      score_reason: "Useful but generic — keep as supporting clip.",
      score_breakdown: { hook: 58, retention: 78, clarity: 86, shareability: 60 },
      platforms: ["youtube", "linkedin"],
      caption_style: "amber-soft",
      vertical_path: "/brand/kade/kade-earn-mode.webp",
      status: "draft",
    },
  ],
};
