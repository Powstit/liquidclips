/**
 * useEngineSession · per-route engine session state
 *
 * Phase 6B infrastructure. A small React context + hook owning the engine
 * session for the active route. Backed by the Design OS bus channels that
 * the tauri-adapter populates:
 *
 *   engine:progress  → updates { stage, percent, note, slug?, idx?, url? }
 *   engine:complete  → marks `phase: "complete"` (route owns next step)
 *   engine:error     → marks `phase: "error"` + carries human/code
 *   route:enter      → resets session (clean slate between routes)
 *
 * Routes wrap their content in <EngineSessionProvider> (Phase 6C+). Until
 * then, `useEngineSession()` returns the IDLE session — no state escapes.
 *
 * NOTE: this hook does NOT call the sidecar. Routes still call
 * `sidecar.ingestUrl(...)` etc. directly via the legacy IPC wrapper; the
 * session merely *observes* progress.
 */

import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import { useEvent, type EngineStage, type KadeState } from "../bridge";
import { sidecar } from "../engine/sidecar-stub";
import type { ProjectMeta } from "../engine/types";

export type EnginePhase = "idle" | "running" | "complete" | "error";

export interface EngineSession {
  /** High-level lifecycle. */
  phase: EnginePhase;
  /** Active sidecar stage when phase === "running". */
  stage: EngineStage | null;
  /** 0..1 normalized. null when sidecar emits indeterminate progress. */
  percent: number | null;
  /** Optional last-text line (transcribe / llm). */
  note: string | null;
  /** Active project slug if scoped. */
  slug: string | null;
  /** Active clip idx if scoped. */
  idx: number | null;
  /** Active URL if scoped. */
  url: string | null;
  /** Last error payload — populated when phase === "error". */
  error: { message: string; human?: string; code?: string } | null;
  /** Suggested Kade pose derived from stage. Routes can override. */
  kade: KadeState;
  /** Live project — null until bake_complete hydrates it via get_project. */
  project: ProjectMeta | null;
  /** Live "N of M ready" counter — advanced from stage_progress segments_done. */
  clipsReady: number;
  /** Live "out of M" target — first stage_progress with `total` wins. */
  clipsTotal: number | null;
  /** Run-start timestamp (ms epoch) — set on the first progress event after idle. */
  startedAt: number | null;
  /** Last event timestamp (ms epoch) — used for "Still working…" copy. */
  lastEventAt: number | null;
}

const IDLE: EngineSession = {
  phase: "idle",
  stage: null,
  percent: null,
  note: null,
  slug: null,
  idx: null,
  url: null,
  error: null,
  kade: "idle",
  project: null,
  clipsReady: 0,
  clipsTotal: null,
  startedAt: null,
  lastEventAt: null,
};

const EngineSessionContext = createContext<EngineSession>(IDLE);

/* ============================================================
   Stage → Kade pose mapping (single source of truth)
   ============================================================ */

const STAGE_TO_KADE: Record<EngineStage, KadeState> = {
  ingest:     "import-footage",
  audio:      "cutting-clips",
  transcribe: "generating-captions",
  llm:        "reading-brief",
  cut:        "cutting-clips",
  reframe:    "cutting-clips",
  thumbs:     "reading-brief",
  bake:       "cutting-clips",
  regenerate: "cutting-clips",
  lift:       "reading-brief",
  pick:       "reading-brief",
  thumbnail:  "reading-brief",
  export:     "exporting",
  captions:   "generating-captions",
};

function kadeFor(stage: EngineStage | null, phase: EnginePhase): KadeState {
  if (phase === "error") return "error";
  if (phase === "complete") return "success";
  if (!stage) return "idle";
  return STAGE_TO_KADE[stage] ?? "idle";
}

/* ============================================================
   Reducer
   ============================================================ */

type Action =
  | { type: "progress"; stage: EngineStage; percent: number | null; slug?: string; idx?: number; url?: string; note?: string; segmentsDone?: number; segmentsTotal?: number }
  | { type: "complete"; slug?: string; idx?: number; url?: string }
  | { type: "error"; error: string; human?: string; code?: string; slug?: string; idx?: number; url?: string }
  | { type: "hydrate_project"; project: ProjectMeta }
  | { type: "reset" };

function reducer(state: EngineSession, action: Action): EngineSession {
  switch (action.type) {
    case "progress": {
      const stage = action.stage;
      const now = Date.now();
      const startedAt = state.startedAt ?? now;
      // segments_done is monotonic per worker completion in cut/reframe/thumbs.
      // total is the clip-count target; first non-zero wins so a single dropped
      // event near the end doesn't reset the M.
      const clipsReady = action.segmentsDone ?? state.clipsReady;
      const clipsTotal = action.segmentsTotal ?? state.clipsTotal;
      return {
        ...state,
        phase: "running",
        stage,
        percent: action.percent,
        note: action.note ?? null,
        slug: action.slug ?? state.slug,
        idx: action.idx ?? state.idx,
        url: action.url ?? state.url,
        error: null,
        kade: kadeFor(stage, "running"),
        clipsReady,
        clipsTotal,
        startedAt,
        lastEventAt: now,
      };
    }
    case "complete": {
      const now = Date.now();
      return {
        ...state,
        phase: "complete",
        percent: 1,
        slug: action.slug ?? state.slug,
        idx: action.idx ?? state.idx,
        url: action.url ?? state.url,
        error: null,
        kade: kadeFor(state.stage, "complete"),
        lastEventAt: now,
      };
    }
    case "error": {
      const now = Date.now();
      return {
        ...state,
        phase: "error",
        slug: action.slug ?? state.slug,
        idx: action.idx ?? state.idx,
        url: action.url ?? state.url,
        error: {
          message: action.error,
          human: action.human,
          code: action.code,
        },
        kade: kadeFor(state.stage, "error"),
        lastEventAt: now,
      };
    }
    case "hydrate_project": {
      // Sidecar emits clip dicts WITHOUT `idx` (positional in the array) and
      // with `virality` instead of `score`. The UI Clip type declares both as
      // required/expected. Normalise at the single hydration funnel so every
      // consumer (ResultsGrid, ClipCard, CockpitDock) sees idx-bearing,
      // score-bearing clips. UI-only mapping — no engine change.
      const normalisedClips = action.project.clips.map((c, i) => {
        const raw = c as typeof c & { virality?: number };
        return {
          ...c,
          idx: typeof c.idx === "number" ? c.idx : i,
          score: c.score ?? raw.virality,
          duration_s: c.duration_s ?? Math.max(0, c.end - c.start),
        };
      });
      const normalisedProject = { ...action.project, clips: normalisedClips };
      return {
        ...state,
        project: normalisedProject,
        clipsTotal: normalisedClips.length,
        clipsReady: Math.max(state.clipsReady, normalisedClips.length),
      };
    }
    case "reset":
      return IDLE;
    default:
      return state;
  }
}

/* ============================================================
   Provider
   ============================================================ */

export interface EngineSessionProviderProps {
  /** If supplied, only progress/complete/error events matching this slug
   *  update the session. Routes that own a project pass it here. */
  slug?: string;
  /** Same as `slug` but for URL-keyed flows (ingestUrl, liftTranscript). */
  url?: string;
  /** Reset the session whenever the route or scope changes. Default: true. */
  resetOnRouteEnter?: boolean;
  children: ReactNode;
}

export function EngineSessionProvider({
  slug, url, resetOnRouteEnter = true, children,
}: EngineSessionProviderProps) {
  const [state, dispatch] = useReducer(reducer, IDLE);

  // Filter helpers — when the provider is scoped, ignore mismatched events.
  const matches = (payloadSlug?: string, payloadUrl?: string): boolean => {
    if (slug && payloadSlug && payloadSlug !== slug) return false;
    if (url && payloadUrl && payloadUrl !== url) return false;
    return true;
  };

  useEvent("engine:progress", (p) => {
    if (!matches(p.slug, p.url)) return;
    dispatch({
      type: "progress",
      stage: p.stage,
      percent: p.percent,
      slug: p.slug,
      idx: p.idx,
      url: p.url,
      note: p.note,
      segmentsDone: p.segmentsDone,
      segmentsTotal: p.segmentsTotal,
    });
    // BUG-023 · live per-clip hydration. Sidecar emits stage_progress with
    // segments_done++ after each cut/reframe/thumbs worker returns. Re-read
    // project.json on each advance so finished clips surface as real cards
    // immediately, not only at bake_complete. get_project is a cheap disk
    // read (no engine work, no sidecar mutation) — at most one per worker.
    if (
      p.slug &&
      typeof p.segmentsDone === "number" &&
      p.segmentsDone > 0 &&
      (p.stage === "cut" || p.stage === "reframe" || p.stage === "thumbs")
    ) {
      void sidecar.getProject(p.slug)
        .then(({ project }) => dispatch({ type: "hydrate_project", project }))
        .catch((err) => console.warn("[useEngineSession] mid-run hydrate failed:", err));
    }
  });

  useEvent("engine:complete", (p) => {
    if (!matches(p.slug, p.url)) return;
    dispatch({ type: "complete", slug: p.slug, idx: p.idx, url: p.url });
    // bake = full pipeline done. Hydrate the real project so ResultsGrid
    // can render actual clips instead of fixture. Other kinds (ingest,
    // pick, regenerate, export) don't need full re-hydration.
    if (p.kind === "bake" || p.kind === "regenerate") {
      // BUG-034 · regenerate now refetches like bake. The Trim journey's
      // observable "preview reloads after re-cut" depends on this — a
      // regenerate event without re-hydration leaves the project stale.
      // Mirrors the bake path: embedded payload fast path, RPC fallback.
      const embedded = p.project as ProjectMeta | undefined;
      if (embedded && Array.isArray((embedded as { clips?: unknown[] }).clips)) {
        dispatch({ type: "hydrate_project", project: embedded });
        return;
      }
      if (p.slug) {
        void sidecar.getProject(p.slug)
          .then(({ project }) => dispatch({ type: "hydrate_project", project }))
          .catch((err) => console.warn("[useEngineSession] hydrate_project failed:", err));
      }
    }
  });

  useEvent("engine:error", (p) => {
    if (!matches(p.slug, p.url)) return;
    dispatch({
      type: "error",
      error: p.error,
      human: p.human,
      code: p.code,
      slug: p.slug,
      idx: p.idx,
      url: p.url,
    });
  });

  useEvent("route:enter", () => {
    if (resetOnRouteEnter) dispatch({ type: "reset" });
  });

  // Stable identity per state — useMemo is overkill since reducer already
  // returns new refs, but keeps lint quiet.
  const value = useMemo(() => state, [state]);

  return createElement(EngineSessionContext.Provider, { value }, children);
}

/** Read-only consumer hook — safe outside a provider (returns IDLE). */
export function useEngineSession(): EngineSession {
  return useContext(EngineSessionContext);
}
