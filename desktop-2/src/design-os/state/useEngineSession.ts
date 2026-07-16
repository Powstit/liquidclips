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
  useRef,
  type ReactNode,
} from "react";
import { useEvent, bus, type EngineStage, type KadeState } from "../bridge";
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
      // Checkpoint item 5 · complete normalization at the hydration
      // boundary so no `undefined | null | NaN | Infinity | [object
      // Object]` reaches customer-visible surfaces. Legacy or partial
      // payloads (older schema, half-baked runs, sidecar bugs) remain
      // selectable — they just render explicit absent-value placeholders
      // instead of blanks / `NaN` / raw objects.
      //
      // safeNumber:        finite fallback (used for numeric fields
      //                    that must render as a number, e.g. start/
      //                    end/duration).
      // safeFiniteOrNull:  finite value OR null (used for OPTIONAL
      //                    numeric fields where the caller can render
      //                    `—`; guarantees the value the UI receives
      //                    is either a real finite number or null).
      // safeString:        non-empty string fallback (used for
      //                    required strings like clip title / project
      //                    name).
      // safeStringOrNull:  non-empty string OR null (used for OPTIONAL
      //                    strings like description / score_reason;
      //                    guarantees no empty / whitespace-only /
      //                    non-string value reaches interpolation).
      const safeNumber = (v: unknown, fallback = 0): number => {
        const n = typeof v === "number" ? v : Number(v);
        return Number.isFinite(n) ? n : fallback;
      };
      const safeFiniteOrNull = (v: unknown): number | null => {
        if (v == null) return null;
        const n = typeof v === "number" ? v : Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const safeString = (v: unknown, fallback: string): string => {
        if (typeof v !== "string") return fallback;
        const t = v.trim();
        return t.length > 0 ? t : fallback;
      };
      const safeStringOrNull = (v: unknown): string | null => {
        if (typeof v !== "string") return null;
        const t = v.trim();
        return t.length > 0 ? t : null;
      };
      const safeBreakdown = (raw: unknown): {
        hook?: number;
        retention?: number;
        clarity?: number;
        shareability?: number;
      } => {
        // Include a key ONLY if the source value normalizes to a finite
        // number. Absent keys let the renderer's `if (v == null) return
        // null;` guard skip them without surfacing NaN / Infinity / null
        // /`[object Object]` in customer copy.
        const src = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {};
        const out: {
          hook?: number;
          retention?: number;
          clarity?: number;
          shareability?: number;
        } = {};
        for (const k of ["hook", "retention", "clarity", "shareability"] as const) {
          const n = safeFiniteOrNull(src[k]);
          if (n !== null) out[k] = n;
        }
        return out;
      };
      const projectSlug = safeString(action.project.slug, "project");
      const normalisedSoFar: Array<{ id: string }> = [];
      const normalisedClips = (action.project.clips ?? []).map((c, i) => {
        const raw = c as typeof c & { virality?: number };
        const start = safeNumber(c.start, 0);
        const end = safeNumber(c.end, start);
        const duration_s = safeNumber(c.duration_s, Math.max(0, end - start));
        // 2026-07-14 · Stable clip identity. Prefer sidecar-supplied
        // `id`; otherwise synthesise a DETERMINISTIC migration id
        // from immutable clip attributes ONLY (slug + start + end).
        // Position (i) is deliberately excluded from the fallback —
        // otherwise a reorder / re-hydrate that shifts `i` would
        // change the id for the same underlying clip, breaking the
        // reorder-preserves-focus invariant.
        //
        // Collision safety · in the pathological case of two clips
        // with identical (start, end) — which real sidecar payloads
        // don't produce, but the normalizer must be safe under —
        // the second occurrence's suffix `-dupN` distinguishes them
        // while keeping the FIRST occurrence's id stable across
        // reorders (once assigned, it survives).
        const sidecarId = (c as typeof c & { id?: string }).id;
        let stableId: string;
        if (typeof sidecarId === "string" && sidecarId) {
          stableId = sidecarId;
        } else {
          const basis = `${projectSlug}-c${start}-${end}`;
          // Deterministic disambiguation among earlier clips in this
          // same normalize pass that already produced `basis`. Uses
          // the pre-existing normalised ids to count collisions.
          const seenBefore = normalisedSoFar.filter(
            (prev) => prev.id === basis || prev.id.startsWith(`${basis}-dup`),
          ).length;
          stableId = seenBefore === 0 ? basis : `${basis}-dup${seenBefore}`;
        }
        normalisedSoFar.push({ id: stableId });
        return {
          ...c,
          id: stableId,
          idx: typeof c.idx === "number" && Number.isFinite(c.idx) ? c.idx : i,
          title: safeString(c.title, `Untitled clip · #${i + 1}`),
          description: safeStringOrNull(c.description) ?? undefined,
          start,
          end,
          duration_s,
          score: safeFiniteOrNull(c.score ?? raw.virality) ?? undefined,
          score_reason: safeStringOrNull(c.score_reason) ?? undefined,
          score_breakdown: safeBreakdown(c.score_breakdown),
          vertical_path: c.vertical_path ?? null,
          cut_path: c.cut_path ?? null,
          thumbnails: Array.isArray(c.thumbnails) ? c.thumbnails : [],
          platforms: Array.isArray(c.platforms) ? c.platforms : [],
          overlay: c.overlay ?? null,
        };
      });
      const normalisedProject = {
        ...action.project,
        name: safeString(action.project.name, "Untitled project"),
        clips: normalisedClips,
      };
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

  // Phase C3 · mid-run hydration failure surfacing without notification
  //   spam. A transient project.json read miss between segments MUST NOT
  //   turn the run terminal, but SHOULD become visible so the user knows
  //   why the grid stopped advancing. Debounce to at most one toast per
  //   30 seconds per (slug, stage) pair — noisy sidecar errors won't
  //   flood the notification host.
  // Phase C7 · sequence guard so late `getProject` responses cannot
  //   overwrite a newer project. Every dispatched hydrate captures the
  //   sequence at call time; on resolve, if the ref has advanced, the
  //   response is discarded. Route:enter invalidates all in-flight
  //   promises by bumping the sequence.
  const hydrateSeqRef = useRef(0);
  const midRunWarnAtRef = useRef<Record<string, number>>({});
  const emitMidRunHydrateWarning = (slug: string, stage: string, err: unknown) => {
    const key = `${slug}::${stage}`;
    const now = Date.now();
    const last = midRunWarnAtRef.current[key] ?? 0;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[useEngineSession] mid-run hydrate failed:", msg);
    if (now - last < 30_000) return; // dedupe · silent for 30s per key
    midRunWarnAtRef.current[key] = now;
    bus.emit("toast", {
      kind: "warning",
      title: "Grid paused",
      body: `Couldn't refresh clips mid-run · engine's still working. We'll retry automatically.`,
    });
  };

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
      const slug = p.slug;
      const stage = p.stage;
      const seq = ++hydrateSeqRef.current;
      void sidecar.getProject(slug)
        .then(({ project }) => {
          if (seq !== hydrateSeqRef.current) return; // stale response
          dispatch({ type: "hydrate_project", project });
        })
        .catch((err) => {
          if (seq !== hydrateSeqRef.current) return;
          emitMidRunHydrateWarning(slug, stage, err);
        });
    }
  });

  useEvent("engine:complete", (p) => {
    if (!matches(p.slug, p.url)) return;
    //   must never surface as "complete" — that used to render a session
    //   with 0/0 clips, which reads to the user as success. Instead we
    //   dispatch error + a customer-safe toast in clipper voice.
    //   Defence-in-depth for engine:complete emitted from any bridge path.
    if (p.kind === "bake") {
      const embedded = p.project as (ProjectMeta & { clips?: unknown[] }) | undefined;
      if (embedded && Array.isArray(embedded.clips) && embedded.clips.length === 0) {
        dispatch({
          type: "error",
          error: "clip_plan_empty",
          human: "No clips came out. Try a longer source with more talking.",
        });
        bus.emit("toast", {
          kind: "error",
          title: "No clips came out",
          body: "The transcript was too short or off-topic. Try a longer source with more talking · nothing landed on disk.",
        });
        return;
      }
    }
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
        // Phase C7 · sequence guard so a stale late response can't
        //   overwrite a newer project. Route:enter also bumps the seq
        //   so all in-flight promises get discarded on route change.
        const seq = ++hydrateSeqRef.current;
        void sidecar.getProject(p.slug)
          .then(({ project }) => {
            if (seq !== hydrateSeqRef.current) return;
            // 2026-07-09 · same no-fake-finish gate on the hydrated
            //   path — if a freshly fetched project has 0 clips, we
            //   still route through the customer-safe error.
            const hydratedClips = (project as { clips?: unknown[] } | undefined)?.clips;
            if (Array.isArray(hydratedClips) && hydratedClips.length === 0) {
              dispatch({
                type: "error",
                error: "clip_plan_empty",
                human: "No clips came out. Try a longer source with more talking.",
              });
              bus.emit("toast", {
                kind: "error",
                title: "No clips came out",
                body: "The transcript was too short or off-topic. Try a longer source with more talking · nothing landed on disk.",
              });
              return;
            }
            dispatch({ type: "hydrate_project", project });
          })
          .catch((err) => {
            if (seq !== hydrateSeqRef.current) return;
            // Ship-lens P0-001 · surface hydration failures instead of
            //   swallowing them. 2026-07-09 customer-safe copy pass —
            //   raw sidecar error stays on `error`, user sees a
            //   clipper-voice sentence.
            const msg = err instanceof Error ? err.message : String(err);
            console.warn("[useEngineSession] hydrate_project failed:", err);
            dispatch({
              type: "error",
              error: msg,
              human: "We couldn't load clips from the last run. Hit Retry to try again.",
            });
            bus.emit("toast", {
              kind: "error",
              title: "Couldn't load clips",
              body: "The last run finished but we couldn't read it back. Hit Retry.",
            });
          });
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
    // Phase C7 · bump the hydrate sequence so any in-flight getProject
    //   resolves into a stale-response noop instead of dispatching into
    //   a route the user has already left.
    hydrateSeqRef.current += 1;
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
