/**
 * engineSessionPersistence · localStorage-backed session summary
 *
 * Phase 6C-Lockdown. Keeps the latest engine session summary across
 * refreshes so Clipping Engine can offer a "Resume last session" banner.
 *
 * What we persist (intentionally narrow):
 *   - source name / URL (whichever was ingested)
 *   - slug if assigned
 *   - last stage
 *   - last percent
 *   - last status (running / complete / error)
 *   - timestamps
 *   - runtimeMode at the time (so we can disclaim mock runs)
 *
 * What we do NOT persist:
 *   - clip data (too large; comes back from sidecar on resume)
 *   - errors beyond a one-line human message
 *   - PII / secrets
 *
 * Write throttle: 250ms (matches legacy workbench-store cadence).
 */

import { useEffect, useRef, useState } from "react";
import { useEvent, bus } from "../bridge";
import { runtimeMode, type RuntimeMode } from "../engine/runtimeInfo";

const KEY = "lc:engine:session:v1";

export interface PersistedEngineSession {
  /** Display source — URL or filename (last component). */
  source: string;
  /** Optional project slug once the sidecar assigns one. */
  slug?: string;
  url?: string;
  /** Last stage observed on the bus. */
  stage?: string;
  /** Last percent 0..1, null if indeterminate. */
  percent: number | null;
  status: "running" | "complete" | "error";
  /** Human-rendered error if status === "error". */
  message?: string;
  /** Runtime mode when this was last written — so the banner can disclaim. */
  runtimeMode: RuntimeMode;
  /** Engine → Studio handoff: which clip the user opened for editing. */
  selectedClipIdx?: number;
  /** Thumbnail Studio → Studio/Library handoff: the chosen variant path
   *  (writes from either episode mode or clip mode). */
  selectedVariantPath?: string;

  /* ---- Thumbnail Studio Phase 6F · dual-mode pivot ---- */
  /** Active thumbnail mode. Defaults to "episode" if absent. */
  thumbMode?: "episode" | "clip";
  /** Editable episode title — defaults to project.name; persists across nav. */
  episodeTitle?: string;
  /** Episode-mode winner — the YouTube thumbnail set as cover for this slug. */
  selectedEpisodeThumbnailPath?: string;
  /** Clip-mode winners — keyed by clipIdx so each clip remembers its cover. */
  selectedClipCoverByClipIdx?: Record<number, string>;

  startedAt: string;
  updatedAt: string;
}

/* ============================================================
   Read / write helpers
   ============================================================ */

export function readPersistedSession(): PersistedEngineSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedEngineSession>;
    if (!parsed.source || !parsed.status) return null;
    return {
      source: parsed.source,
      slug: parsed.slug,
      url: parsed.url,
      stage: parsed.stage,
      percent: parsed.percent ?? null,
      status: parsed.status,
      message: parsed.message,
      runtimeMode: parsed.runtimeMode === "real" ? "real" : "mock",
      selectedClipIdx: typeof parsed.selectedClipIdx === "number" ? parsed.selectedClipIdx : undefined,
      selectedVariantPath: typeof parsed.selectedVariantPath === "string" ? parsed.selectedVariantPath : undefined,
      thumbMode: parsed.thumbMode === "clip" ? "clip" : (parsed.thumbMode === "episode" ? "episode" : undefined),
      episodeTitle: typeof parsed.episodeTitle === "string" ? parsed.episodeTitle : undefined,
      selectedEpisodeThumbnailPath: typeof parsed.selectedEpisodeThumbnailPath === "string" ? parsed.selectedEpisodeThumbnailPath : undefined,
      selectedClipCoverByClipIdx: typeof parsed.selectedClipCoverByClipIdx === "object" && parsed.selectedClipCoverByClipIdx
        ? (parsed.selectedClipCoverByClipIdx as Record<number, string>)
        : undefined,
      startedAt: parsed.startedAt ?? new Date().toISOString(),
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function writePersistedSession(s: PersistedEngineSession): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* quota or private mode — degrade gracefully */
  }
}

export function clearPersistedSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
  bus.emit("toast", {
    kind: "info",
    title: "Session",
    body: "Cleared. The engine is ready for a fresh source.",
  });
}

/* ============================================================
   Imperative session starter — call when a source begins ingesting
   ============================================================ */

export function startPersistedSession(source: string, opts?: { url?: string; slug?: string }): void {
  const now = new Date().toISOString();
  const next: PersistedEngineSession = {
    source,
    url: opts?.url,
    slug: opts?.slug,
    stage: undefined,
    percent: null,
    status: "running",
    runtimeMode: runtimeMode(),
    startedAt: now,
    updatedAt: now,
  };
  writePersistedSession(next);
}

/** Phase 6F pivot · set the active thumbnail mode. */
export function setThumbMode(mode: "episode" | "clip"): void {
  const cur = readPersistedSession();
  const now = new Date().toISOString();
  const base: PersistedEngineSession = cur ?? {
    source: "Thumbnail session",
    runtimeMode: runtimeMode(),
    startedAt: now,
    updatedAt: now,
    status: "complete",
    percent: 1,
  };
  writePersistedSession({ ...base, thumbMode: mode, updatedAt: now });
}

/** Phase 6F pivot · persist the editable episode title. */
export function setEpisodeTitle(title: string): void {
  const cur = readPersistedSession();
  const now = new Date().toISOString();
  const base: PersistedEngineSession = cur ?? {
    source: "Thumbnail session",
    runtimeMode: runtimeMode(),
    startedAt: now,
    updatedAt: now,
    status: "complete",
    percent: 1,
  };
  writePersistedSession({ ...base, episodeTitle: title, updatedAt: now });
}

/** Phase 6F pivot · set the YouTube thumbnail for this episode. */
export function selectEpisodeThumbnail(path: string | null): void {
  const cur = readPersistedSession();
  const now = new Date().toISOString();
  const base: PersistedEngineSession = cur ?? {
    source: "Thumbnail session",
    runtimeMode: runtimeMode(),
    startedAt: now,
    updatedAt: now,
    status: "complete",
    percent: 1,
  };
  writePersistedSession({
    ...base,
    selectedEpisodeThumbnailPath: path ?? undefined,
    selectedVariantPath: path ?? base.selectedVariantPath,
    updatedAt: now,
  });
}

/** Phase 6F pivot · set the clip cover for a specific clip idx. */
export function selectClipCover(clipIdx: number, path: string | null): void {
  const cur = readPersistedSession();
  const now = new Date().toISOString();
  const base: PersistedEngineSession = cur ?? {
    source: "Thumbnail session",
    runtimeMode: runtimeMode(),
    startedAt: now,
    updatedAt: now,
    status: "complete",
    percent: 1,
  };
  const nextMap = { ...(base.selectedClipCoverByClipIdx ?? {}) };
  if (path) {
    nextMap[clipIdx] = path;
  } else {
    delete nextMap[clipIdx];
  }
  writePersistedSession({
    ...base,
    selectedClipCoverByClipIdx: nextMap,
    selectedVariantPath: path ?? base.selectedVariantPath,
    updatedAt: now,
  });
}

/** Thumbnail Studio handoff: persist the chosen cover path so Studio /
 *  Library can read it on route swap. Pair with `selectClipForStudio`. */
export function selectVariantForExport(path: string | null): void {
  const cur = readPersistedSession();
  const now = new Date().toISOString();
  const next: PersistedEngineSession = cur ?? {
    source: "Thumbnail session",
    runtimeMode: runtimeMode(),
    startedAt: now,
    updatedAt: now,
    status: "complete",
    percent: 1,
  };
  writePersistedSession({
    ...next,
    selectedVariantPath: path ?? undefined,
    updatedAt: now,
  });
}

/** Engine → Studio handoff. Sets / clears the selected clip on the
 *  persisted session so Studio can pick it up on route swap. */
export function selectClipForStudio(idx: number | null): void {
  const cur = readPersistedSession();
  const now = new Date().toISOString();
  const next: PersistedEngineSession = cur ?? {
    source: "Studio session",
    runtimeMode: runtimeMode(),
    startedAt: now,
    updatedAt: now,
    status: "complete",
    percent: 1,
  };
  writePersistedSession({
    ...next,
    selectedClipIdx: idx ?? undefined,
    updatedAt: now,
  });
}

/* ============================================================
   Hook · keeps persistence + state alive while mounted
   ============================================================ */

export function useEngineSessionPersistence(): {
  resume: PersistedEngineSession | null;
  clear: () => void;
} {
  const [resume, setResume] = useState<PersistedEngineSession | null>(() => readPersistedSession());
  const lastWriteRef = useRef<number>(0);

  // Track progress and write at most every 250ms.
  useEvent("engine:progress", (p) => {
    const cur = readPersistedSession();
    const base: PersistedEngineSession = cur ?? {
      source: p.url ?? "Source",
      runtimeMode: runtimeMode(),
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "running",
      percent: null,
    };
    const next: PersistedEngineSession = {
      ...base,
      stage: p.stage,
      percent: p.percent,
      slug: p.slug ?? base.slug,
      url: p.url ?? base.url,
      status: "running",
      updatedAt: new Date().toISOString(),
      runtimeMode: runtimeMode(),
    };
    const now = Date.now();
    if (now - lastWriteRef.current > 250) {
      lastWriteRef.current = now;
      writePersistedSession(next);
    }
  });

  useEvent("engine:complete", (p) => {
    const cur = readPersistedSession();
    if (!cur) return;
    writePersistedSession({
      ...cur,
      slug: p.slug ?? cur.slug,
      url: p.url ?? cur.url,
      percent: 1,
      status: "complete",
      updatedAt: new Date().toISOString(),
    });
  });

  useEvent("engine:error", (p) => {
    const cur = readPersistedSession();
    if (!cur) return;
    writePersistedSession({
      ...cur,
      slug: p.slug ?? cur.slug,
      url: p.url ?? cur.url,
      status: "error",
      message: p.human ?? p.error,
      updatedAt: new Date().toISOString(),
    });
  });

  // Pre-unload flush — write whatever's in the bus buffer
  useEffect(() => {
    const onUnload = () => {
      // Nothing to flush; writes are eager. Kept for symmetry with legacy.
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  const clear = (): void => {
    clearPersistedSession();
    setResume(null);
  };

  return { resume, clear };
}
