/* eslint-disable @typescript-eslint/no-explicit-any */
// Browser preview's mock for sidecarCall. Returns realistic sample-project
// data + simulates progress events. Used only when Vite builds for web
// (VITE_TARGET=web). The desktop build never imports this file.

import type { Project, StageName } from "./sidecar";

const NOW = () => Math.floor(Date.now() / 1000);

function makeClip(idx: number): any {
  const titles = [
    "The one moment that changed everything",
    "Why everybody gets this wrong",
    "Three seconds of pure confidence",
    "Wait — did he just say that?",
    "The number nobody talks about",
    "How he closed in 30 seconds flat",
    "This is the part they edit out",
    "Twelve years to figure this out",
  ];
  const themes = ["hot-take", "origin-story", "tactical", "punchline", "data-point"];
  const t = titles[idx % titles.length];
  const start = 60 + idx * 95;
  const end = start + 48;
  const slug = `clip-${(idx + 1).toString().padStart(2, "0")}`;
  return {
    start,
    end,
    title: t,
    description:
      "A standout moment from the recording — hook lands in the first two seconds, payoff at the end, clean cut on a complete sentence.",
    theme: themes[idx % themes.length],
    virality: 65 + ((idx * 7) % 30),
    slug,
    title_variants: [
      t,
      t.replace(/[?.]$/, "") + " (you won't believe it)",
      "Wait until you hear this →",
    ],
    pinned_comment: "Pin this comment: which moment hit you hardest?",
    hook_text: t.split(" ").slice(0, 4).join(" "),
    // Real sample mp4s bundled at /sample/clips/*. All ratios point at the
    // same vertical clip in preview — that's fine for UX validation. Overlay
    // selection swaps `overlay.applied_paths` to the matching pre-rendered
    // variant (stack-bottom.mp4, pip-br.mp4, etc.), see apply_overlay below.
    cut_path: "/sample/clips/base.mp4",
    vertical_path: "/sample/clips/base.mp4",
    square_path: "/sample/clips/base.mp4",
    portrait_path: "/sample/clips/base.mp4",
    srt_path: `/sample/${slug}.srt`,
    vtt_path: `/sample/${slug}.vtt`,
    captions_burned: false,
    overlay: null,
    thumbnails: [
      { rank: 1, path: `/sample/thumb-${(idx % 3) + 1}.svg`, source: "frame", timestamp_s: 12.4, score: 0.91 },
      { rank: 2, path: `/sample/thumb-${((idx + 1) % 3) + 1}.svg`, source: "frame", timestamp_s: 22.0, score: 0.86 },
      { rank: 3, path: `/sample/thumb-${((idx + 2) % 3) + 1}.svg`, source: "frame", timestamp_s: 31.7, score: 0.81 },
    ],
  };
}

function freshProject(slug = "sample-podcast-clip", brief?: string, intent: "clips" | "youtube" | "both" = "both"): Project {
  const t = NOW();
  const stages = {
    ingest: {
      status: "done", started_at: t - 60, finished_at: t - 58, error: null,
      output: { duration_seconds: 1820, poster_path: "/sample/poster.svg" },
    },
    audio:  { status: "done", started_at: t - 58, finished_at: t - 56, error: null, output: {} },
    transcribe: { status: "done", started_at: t - 56, finished_at: t - 30, error: null, output: { duration: 1820, language: "en", model: "tiny", word_count: 4218 } },
    llm: { status: "done", started_at: t - 30, finished_at: t - 28, error: null, output: { clip_count: 8 } },
    cut: { status: "done", started_at: t - 28, finished_at: t - 18, error: null, output: { cut_count: 8 } },
    reframe: { status: "done", started_at: t - 18, finished_at: t - 8, error: null, output: { reframed_count: 8, formats: ["vertical", "square", "portrait"] } },
    thumbs: { status: "done", started_at: t - 8, finished_at: t - 2, error: null, output: { thumb_count: 24 } },
  };
  return {
    id: "preview",
    slug,
    root: "/sample/preview-project",
    source_path: "/sample/source.mp4",
    source_filename: "Sample podcast — episode 42.mp4",
    created_at: t - 65,
    brief: brief ?? null,
    intent,
    stages: stages as any,
    clips: intent === "youtube" ? [] : Array.from({ length: 8 }, (_, i) => makeClip(i)),
  } as Project;
}

// --- in-memory project store (one per slug) ---
const projects = new Map<string, Project>();
const youtubeStore = new Map<string, ReturnType<typeof defaultYoutubeFixture>>();

// ── Mock Whop bounties for the web preview ─────────────────────────────
// Realistic-shaped data so the Earn tab clicks through end-to-end without
// hitting the real Whop API. Mirrors the WhopBounty / WhopSubmission types
// in sidecar.ts. Status auto-advances on a timer so the polling notification
// fires naturally during demo.

const mockSubmissionStore = new Map<string, {
  id: string;
  status: "pending" | "claimed" | "submitted" | "approved" | "denied" | "expired";
  submittedAt: string | null;
  claimedAt: string | null;
  expiresAt: string | null;
  formattedPayoutAmount: string | null;
  denialReason: string | null;
  verifiedVotesCount: number;
  rejectedVotesCount: number;
  bounty: { id: string; title: string; rewardPerUnitAmount: number; currency: string };
}>();

function mockBounties() {
  const now = new Date().toISOString();
  return [
    {
      id: "bty_mock_001",
      title: "THE 2 HOUR CREATOR PODCAST — EPISODE 47",
      description: "Clip 60-90 second hooks from the founder's best stories. Subtitle every clip. End on a punchline. No watermarks. Required CTA: 'Subscribe at magnet00000.com'.",
      baseUnitAmount: 1000,
      rewardPerUnitAmount: 8.5,
      currency: "GBP",
      allowYoutube: true, allowTiktok: true, allowInstagram: false, allowX: false,
      acceptedSubmissionsLimit: 30, acceptedSubmissionsCount: 18, spotsRemaining: 12,
      bountyType: "clipping", status: "active",
      viewCount: 412_000, totalPaid: 1_240.5, budgetAmount: 2_400.0,
      createdAt: now, updatedAt: now,
      user: { username: "magnet00000", name: "Magneto", image: null },
      experience: { id: "exp_mock_001" },
    },
    {
      id: "bty_mock_002",
      title: "SARAH BUILDS A WEBSITE LIVE — 4-HOUR STREAM",
      description: "Find the 'wow' moments — when something visibly clicks for Sarah. Aim for ~60 seconds each. Hook with the problem, payoff with the fix. Vertical only.",
      baseUnitAmount: 1000,
      rewardPerUnitAmount: 6.0,
      currency: "GBP",
      allowYoutube: true, allowTiktok: true, allowInstagram: true, allowX: false,
      acceptedSubmissionsLimit: 50, acceptedSubmissionsCount: 23, spotsRemaining: 27,
      bountyType: "clipping", status: "active",
      viewCount: 89_400, totalPaid: 138.0, budgetAmount: 3_000.0,
      createdAt: now, updatedAt: now,
      user: { username: "sarahcodes", name: "Sarah Codes", image: null },
      experience: { id: "exp_mock_002" },
    },
    {
      id: "bty_mock_003",
      title: "THE FOUNDER POST-MORTEM — 90 MIN INTERVIEW",
      description: "Hook with the most painful admission. 45-60s clips only. Required: brand mention 'failmoney.app' in first 3 seconds. Banned: anything political.",
      baseUnitAmount: 1000,
      rewardPerUnitAmount: 12.0,
      currency: "GBP",
      allowYoutube: false, allowTiktok: true, allowInstagram: true, allowX: true,
      acceptedSubmissionsLimit: 20, acceptedSubmissionsCount: 17, spotsRemaining: 3,
      bountyType: "clipping", status: "active",
      viewCount: 51_200, totalPaid: 612.0, budgetAmount: 800.0,
      createdAt: now, updatedAt: now,
      user: { username: "failmoney", name: "Fail Money", image: null },
      experience: { id: "exp_mock_003" },
    },
    {
      id: "bty_mock_004",
      title: "BUYING A BAR FROM A STRANGER — 28 MIN VLOG",
      description: "The 'gotcha' moments — when the seller drops a hint about why they're really selling. 30-60s clips. Caption every cut. YouTube Shorts + Reels only.",
      baseUnitAmount: 1000,
      rewardPerUnitAmount: 4.5,
      currency: "GBP",
      allowYoutube: true, allowTiktok: false, allowInstagram: true, allowX: false,
      acceptedSubmissionsLimit: 40, acceptedSubmissionsCount: 8, spotsRemaining: 32,
      bountyType: "clipping", status: "active",
      viewCount: 22_800, totalPaid: 102.6, budgetAmount: 1_800.0,
      createdAt: now, updatedAt: now,
      user: { username: "bartender_b", name: "Bartender B", image: null },
      experience: { id: "exp_mock_004" },
    },
  ];
}

// Seed a few sample submissions in various statuses
function seedMockSubmissions() {
  if (mockSubmissionStore.size > 0) return;
  const now = Date.now();
  const minutes = (n: number) => new Date(now - n * 60_000).toISOString();
  const hours = (n: number) => new Date(now - n * 3600_000).toISOString();

  mockSubmissionStore.set("sub_mock_001", {
    id: "sub_mock_001",
    status: "submitted",
    submittedAt: minutes(8),
    claimedAt: hours(2),
    expiresAt: new Date(now + 40 * 3600_000).toISOString(),
    formattedPayoutAmount: null,
    denialReason: null,
    verifiedVotesCount: 0,
    rejectedVotesCount: 0,
    bounty: { id: "bty_mock_001", title: "THE 2 HOUR CREATOR PODCAST — EPISODE 47", rewardPerUnitAmount: 8.5, currency: "GBP" },
  });
  mockSubmissionStore.set("sub_mock_002", {
    id: "sub_mock_002",
    status: "approved",
    submittedAt: hours(28),
    claimedAt: hours(36),
    expiresAt: null,
    formattedPayoutAmount: "£42.50",
    denialReason: null,
    verifiedVotesCount: 3,
    rejectedVotesCount: 0,
    bounty: { id: "bty_mock_001", title: "THE 2 HOUR CREATOR PODCAST — EPISODE 47", rewardPerUnitAmount: 8.5, currency: "GBP" },
  });
  mockSubmissionStore.set("sub_mock_003", {
    id: "sub_mock_003",
    status: "approved",
    submittedAt: hours(50),
    claimedAt: hours(58),
    expiresAt: null,
    formattedPayoutAmount: "£18.00",
    denialReason: null,
    verifiedVotesCount: 2,
    rejectedVotesCount: 0,
    bounty: { id: "bty_mock_002", title: "SARAH BUILDS A WEBSITE LIVE", rewardPerUnitAmount: 6.0, currency: "GBP" },
  });
  mockSubmissionStore.set("sub_mock_004", {
    id: "sub_mock_004",
    status: "denied",
    submittedAt: hours(70),
    claimedAt: hours(78),
    expiresAt: null,
    formattedPayoutAmount: null,
    denialReason: "Missing required brand mention in first 3 seconds.",
    verifiedVotesCount: 0,
    rejectedVotesCount: 2,
    bounty: { id: "bty_mock_003", title: "THE FOUNDER POST-MORTEM", rewardPerUnitAmount: 12.0, currency: "GBP" },
  });
}
seedMockSubmissions();

function defaultYoutubeFixture() {
  return {
    scored_titles: [
      { text: "I hit $4k/day letting AI tell me what to build", score: 92, reason: "curiosity gap on a named number — high CTR." },
      { text: "The AI prompt that found me a $4k/day product", score: 87, reason: "specific outcome + tool — strong for search." },
      { text: "How I let AI pick my next product (and made $4k/day)", score: 81, reason: "credible but longer; tests well as variant B." },
      { text: "My AI product research workflow, end to end", score: 64, reason: "generic — burns CTR but ranks for the long tail." },
      { text: "The review-mining prompt nobody told you about", score: 58, reason: "hooky but vague — risk of bounce." },
    ],
    selected_title_idx: 0,
    description:
      "Mining customer reviews with a single AI prompt found me the angle for a product that now does $4k/day. In this video I break down the exact research workflow — where I source the reviews, the structured prompt I send to the model, and how I turn the output into a product page that converts.\n\nThis isn't a 'use AI to write copy' video. It's a research pipeline you can run in 10 minutes per niche, and the angles it surfaces wouldn't have occurred to me from scratch.",
    chapters: [
      { start: 0,   title: "The $4k/day result" },
      { start: 72,  title: "Why review-mining beats keyword research" },
      { start: 285, title: "The exact prompt structure" },
      { start: 540, title: "Walking through a real niche" },
      { start: 1020, title: "What I'd skip if I started over" },
      { start: 1380, title: "Getting the full prompt set" },
    ],
    tags: ["digital products", "ai product research", "review mining", "product hooks", "indie founder", "no code product", "ai marketing", "passive income online", "ai prompts", "solopreneur"],
    hashtags: ["productivity", "AItools", "digitalproducts", "indiehackers"],
    pinned_video_comment: "Which niche should I run this prompt on next? Drop one below and I'll pick the most-liked comment.",
    end_screen_ctas: [
      { cue: "Point at the upgrade prompt", payoff: "Subscribe — I post one of these workflows every Tuesday." },
      { cue: "Tease the next video", payoff: "Watch this next — the 12-niche test I ran with the same prompt." },
    ],
  };
}
function getOrCreate(slug?: string, brief?: string, intent: "clips" | "youtube" | "both" = "both"): Project {
  const key = slug ?? "sample-podcast-clip";
  if (!projects.has(key)) projects.set(key, freshProject(key, brief, intent));
  return projects.get(key)!;
}

// --- mock event emitter (Tauri's listen() routes here) ---
type Handler = (payload: unknown) => void;
const listeners = new Map<string, Set<Handler>>();
export function onMockEvent<T = unknown>(event: string, cb: (p: T) => void): () => void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  const handlers = listeners.get(event)!;
  const wrapped = cb as Handler;
  handlers.add(wrapped);
  return () => handlers.delete(wrapped);
}
function emit(event: string, payload: unknown) {
  listeners.get(event)?.forEach((cb) => cb(payload));
}

// --- main dispatch ---
export async function mockSidecarCall<T>(method: string, params: Record<string, any>): Promise<T> {
  switch (method) {
    case "ping":
      return { pong: true, version: "preview-0.3.0" } as T;

    case "secrets_status":
      return { secrets: { OPENAI_API_KEY: true, ANTHROPIC_API_KEY: false, JUNIOR_LICENSE_JWT: true } } as T;

    case "openai_key_status":
      return { available: true } as T;

    case "secret_get":
      return { name: params.name, value: params.name === "JUNIOR_LICENSE_JWT" ? "preview-jwt" : null } as T;

    case "hardware_info":
      return { ram_gb: 16, free_disk_gb: 240, cpu_count: 10, platform: "preview", warnings: [] } as T;

    case "preload_whisper":
      return { model: "tiny", warmup_seconds: 0.2 } as T;

    case "probe":
      return { duration_seconds: 1820, width: 1920, height: 1080, format: "mp4", size_bytes: 240_000_000 } as T;

    case "ingest_url":
      return simulateIngest(params) as Promise<T>;

    case "start_run":
      {
        const intent = (params.intent as "clips" | "youtube" | "both") || "both";
        const slug = "preview-" + Math.random().toString(36).slice(2, 7);
        const proj = freshProject(slug, (params.brief as string) || undefined, intent);
        projects.set(slug, proj);
        return { project: proj } as T;
      }

    case "run_stage":
      // Pipeline already "complete" in the fixture — just emit a couple of progress
      // events for realism and return the same project.
      await simulateStage(params.slug as string, params.stage as StageName);
      return { project: getOrCreate(params.slug as string) } as T;

    case "get_project":
      return { project: getOrCreate(params.slug as string) } as T;

    case "get_metadata":
      return {
        metadata: {
          chapters: "00:00 Cold open\n01:12 The setup\n04:45 The pivot moment\n08:30 The reveal\n12:18 What it means for you\n15:02 The honest counter\n18:24 Where this goes next",
          description: "Sample SEO description with chapters prepended.\n\n00:00 Cold open\n01:12 The setup\n08:30 The reveal",
          titles: "Sample title variant 1\nSample title variant 2\nSample title variant 3",
          tags: "podcast, clip, junior, sample",
        },
      } as T;

    case "regenerate_clip":
      // Bounds change is reflected back; no real re-render in preview.
      {
        const p = getOrCreate(params.slug as string);
        const c = p.clips[params.idx as number];
        if (c) { c.start = params.start as number; c.end = params.end as number; }
        return { project: p } as T;
      }

    case "remove_clip":
      {
        const p = getOrCreate(params.slug as string);
        p.clips.splice(params.idx as number, 1);
        return { project: p } as T;
      }

    case "whop_session_status":
      // In the web preview we always claim "authenticated via iframe" — that
      // way the Earn tab demonstrates the production happy-path instead of
      // the paste-fallback dev path.
      return { authenticated: true, source: "iframe" } as T;

    case "whop_set_session_token":
      return { ok: true, authenticated: true } as T;

    case "whop_clear_session_token":
      return { ok: true } as T;

    case "whop_list_bounties":
      return { bounties: mockBounties(), authenticated: true } as T;

    case "whop_bounty":
      {
        const id = params.id as string;
        const found = mockBounties().find((b) => b.id === id);
        return { bounty: found ?? null, authenticated: true } as T;
      }

    case "whop_submission":
      {
        const id = params.id as string;
        const sub = mockSubmissionStore.get(id);
        return { submission: sub ?? null, authenticated: true } as T;
      }

    case "predict_time":
      {
        const duration = Number(params.duration_seconds) || 0;
        // Mirror the Python predictor's math at low fidelity — enough for the
        // simulator to show a sensible ETA.
        const audio = Math.max(10, duration / 40);
        const clips = Math.max(3, Math.min(25, Math.floor(duration / 180)));
        const cut = clips * 2;
        const reframe = Math.ceil(clips / 7) * 12;
        const thumbs = Math.ceil(clips / 8) * 2;
        // Pretend a 25 Mbps upload + OpenAI Whisper-1.
        const audioSizeMb = duration * 0.032;
        const upload = (audioSizeMb / 25) * 1.4;
        const transcribeSerial = upload + duration / 10 + 5;
        const nChunks = Math.max(1, Math.ceil(duration / 75));
        const batches = Math.ceil(nChunks / 10);
        const perChunk = (audioSizeMb / nChunks / 25) * 1.4 + 75 / 10 + 3;
        const transcribeChunked = 5 + batches * perChunk;
        const llmSerial = 30;
        const llmChunked = 30 + nChunks * 0.5;
        const baseShared = 2 + audio + cut + reframe + thumbs;
        const serialTotal = baseShared + transcribeSerial + llmSerial;
        const chunkedTotal = baseShared + transcribeChunked + llmChunked;
        const path = chunkedTotal < serialTotal ? "chunked" : "serial";
        return {
          path,
          total_s: Math.round((path === "chunked" ? chunkedTotal : serialTotal) * 10) / 10,
          stages: [
            { name: "ingest", seconds: 2 },
            { name: "audio", seconds: Math.round(audio * 10) / 10 },
            { name: `transcribe (${path})`, seconds: Math.round((path === "chunked" ? transcribeChunked : transcribeSerial) * 10) / 10 },
            { name: "llm", seconds: Math.round((path === "chunked" ? llmChunked : llmSerial) * 10) / 10 },
            { name: "cut", seconds: cut },
            { name: "reframe", seconds: reframe },
            { name: "thumbs", seconds: thumbs },
          ],
          confidence: "med",
          provider: "openai",
        } as T;
      }

    case "get_youtube_extras":
      return {
        youtube: youtubeStore.get(params.slug as string) ?? defaultYoutubeFixture(),
      } as T;

    case "update_youtube_extras":
      {
        const slug = params.slug as string;
        const cur = youtubeStore.get(slug) ?? defaultYoutubeFixture();
        const next = { ...cur, ...((params.fields as Partial<typeof cur>) || {}) };
        youtubeStore.set(slug, next);
        return { youtube: next } as T;
      }

    case "update_clip_meta":
      {
        const p = getOrCreate(params.slug as string);
        const c = p.clips[params.idx as number];
        if (c) {
          if (typeof params.title === "string") c.title = params.title;
          if (typeof params.description === "string") c.description = params.description;
          if (typeof params.pinned_comment === "string") c.pinned_comment = params.pinned_comment;
        }
        return { project: p } as T;
      }

    case "lift_transcript":
      {
        const url = (params.url as string) || "";
        const isIg = /instagram\.com/i.test(url);
        const isTt = /tiktok\.com/i.test(url);
        const isYt = /youtube\.com|youtu\.be/i.test(url);
        const isX = /twitter\.com|x\.com/i.test(url);
        const platform = isIg ? "instagram" : isTt ? "tiktok" : isYt ? "youtube" : isX ? "x" : "link";
        // Stream a couple of progress events to simulate the real path.
        void (async () => {
          await new Promise((r) => setTimeout(r, 250));
          emit("sidecar:lift_progress", { phase: "downloading", percent: 60 });
          await new Promise((r) => setTimeout(r, 400));
          emit("sidecar:lift_progress", { phase: "transcribing", percent: 30 });
          await new Promise((r) => setTimeout(r, 400));
          emit("sidecar:lift_progress", { phase: "transcribing", percent: 80 });
        })();
        // Return a realistic-looking dummy transcript after a short delay.
        return new Promise<T>((resolve) => {
          setTimeout(() => {
            resolve({
              url,
              platform,
              language: "en",
              duration: 75.5,
              text: "I hit four thousand dollars a day letting AI tell me what digital products to build. By mining the reviews of other products, AI can find the top desires and pain points in your niche that becomes your product hook. Comment prompt and I'll send you all the prompts I use in my seven figure digital product business.",
              segments: [
                { start: 0, end: 6, text: "I hit four thousand dollars a day letting AI tell me what digital products to build." },
                { start: 6, end: 18, text: "By mining the reviews of other products, AI can find the top desires and pain points in your niche." },
                { start: 18, end: 28, text: "Those pain points become your product hook — the angle that actually converts." },
                { start: 28, end: 42, text: "I'll show you the exact prompt structure I use to extract the desire patterns from any review pile." },
                { start: 42, end: 58, text: "It takes about ten minutes per product, and you get back something you couldn't have written from scratch." },
                { start: 58, end: 75.5, text: "Comment prompt and I'll send you the full prompt set I use in my seven-figure digital product business." },
              ],
              meta: {
                title: "Video by thejimmyreilly",
                uploader: "thejimmyreilly",
                uploader_url: "https://instagram.com/thejimmyreilly",
                description:
                  "I hit $4k/day letting AI tell me what digital products to build. By mining the reviews of other products, AI can find the top desires and pain points in your niche that becomes your product hook.\n\nComment 'prompt' and I'll send you all the prompts I use in my 7-figure digital product business.",
                poster_path: null,
                duration_seconds: 75.5,
                source_url: url,
              },
            } as T);
          }, 1200);
        });
      }

    case "add_clip":
      {
        const p = getOrCreate(params.slug as string);
        const title = (params.title as string) || "Manual clip";
        const slug = title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 40) || "manual-clip";
        const base = p.clips[0];
        p.clips.push({
          ...(base ?? {}),
          start: params.start as number,
          end: params.end as number,
          title,
          description: "",
          theme: "manual",
          virality: 50,
          slug,
          title_variants: [],
          pinned_comment: "",
          thumbnails: base?.thumbnails ?? [],
        });
        return { project: p } as T;
      }

    case "apply_overlay":
      {
        const old = getOrCreate(params.slug as string);
        const idx = params.idx as number;
        const c = old.clips[idx];
        if (!c) return { project: old } as T;

        let nextClip = c;
        if (params.overlay) {
          const overlayType = (params.overlay as any).type as string;
          const sampleByType: Record<string, string> = {
            "stack-bottom": "/sample/clips/stack-bottom.mp4",
            "stack-top": "/sample/clips/stack-top.mp4",
            "pip-br": "/sample/clips/pip-br.mp4",
            "pip-bl": "/sample/clips/pip-br.mp4",
            "split-h": "/sample/clips/split-h.mp4",
          };
          const path = sampleByType[overlayType] ?? "/sample/clips/stack-bottom.mp4";
          nextClip = {
            ...c,
            overlay: {
              ...(params.overlay as any),
              applied_paths: { vertical: path, square: path, portrait: path },
            },
          };
        } else {
          nextClip = { ...c, overlay: null };
        }

        // CRITICAL: return new project + clips + clip references so React's
        // memo/ref equality triggers re-renders. Previous in-place mutation
        // meant the same reference came back and the UI froze.
        const nextClips = [...old.clips];
        nextClips[idx] = nextClip;
        const next = { ...old, clips: nextClips };
        projects.set(params.slug as string, next);
        return { project: next } as T;
      }

    case "drip_plan":
      return { slots: [] } as T;

    default:
      // eslint-disable-next-line no-console
      console.warn("[mock-sidecar] unimplemented:", method);
      return null as unknown as T;
  }
}

async function simulateIngest(params: Record<string, any>) {
  // Fire ingest_progress events at 25/50/75/100% so the URL fetch screen has
  // motion before the rest of the pipeline renders.
  const steps = [10, 35, 62, 88, 100];
  let downloaded = 0;
  const total = 320_000_000;
  for (const pct of steps) {
    downloaded = Math.floor((total * pct) / 100);
    emit("sidecar:ingest_progress", {
      status: pct < 100 ? "downloading" : "finished",
      downloaded_bytes: downloaded,
      total_bytes: total,
      percent: pct,
      speed_bps: 8_400_000,
      eta_seconds: pct < 100 ? Math.round((100 - pct) / 4) : 0,
    });
    await sleep(450);
  }
  const intent = (params.intent as "clips" | "youtube" | "both") || "both";
  const briefStr = typeof params.brief === "string" ? params.brief : undefined;
  const project = freshProject("preview-" + Math.random().toString(36).slice(2, 7), briefStr, intent);
  projects.set(project.slug, project);
  return { project, downloaded_path: project.source_path };
}

async function simulateStage(_slug: string, stage: StageName) {
  // 4-tick fake progress for any stage with no real work to do.
  for (const pct of [25, 55, 85, 100]) {
    emit("sidecar:stage_progress", {
      stage,
      processed_seconds: pct,
      total_seconds: 100,
      last_text: stage === "transcribe" ? "transcribing in preview mode" : "",
      segments_done: pct,
      percent: pct,
    });
    await sleep(280);
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
