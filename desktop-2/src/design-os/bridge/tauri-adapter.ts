/**
 * Tauri ↔ Design OS bus adapter
 *
 * Phase 6B infrastructure. Single source of translation between the legacy
 * `sidecar:*` Tauri events and the Design OS bus. Mounted exactly once
 * inside DesignOSBoundary so legacy + new routes share one wire.
 *
 * Mapping:
 *
 *   sidecar:ingest_progress       → engine:progress { stage: "ingest", ... }
 *   sidecar:stage_progress        → engine:progress { stage: <payload.stage>, ... }
 *   sidecar:bake_progress         → engine:progress { stage: "bake",     ... }
 *   sidecar:thumbnail_batch_progress → engine:progress { stage: "thumbnail" }
 *   sidecar:regenerate_progress   → engine:progress { stage: "regenerate" }
 *   sidecar:pick_progress         → engine:progress { stage: "pick" }
 *   sidecar:lift_progress         → engine:progress { stage: "lift" }
 *
 *   sidecar:ingest_complete       → engine:complete { kind: "ingest" }
 *   sidecar:lift_complete         → engine:complete { kind: "lift" }
 *   sidecar:pick_complete         → engine:complete { kind: "pick" }
 *   sidecar:regenerate_complete   → engine:complete { kind: "regenerate" }
 *   sidecar:bake_complete         → engine:complete { kind: "bake" }
 *   sidecar:thumbnail_batch_complete → engine:complete { kind: "thumbnail-batch" }
 *
 *   sidecar:*_error               → engine:error    { kind, error, human?, code? }
 *   sidecar:died                  → engine:error    { kind: "sidecar-died", error, code: "SIDECAR_DIED" }
 *
 * The adapter does NOT transform values beyond normalising names + extracting
 * `slug / idx / url / percent / note / error / human / code`. Anything richer
 * stays inside the sidecar contract; routes that need the full payload can
 * still listen to the raw Tauri channel.
 *
 * The mount returns an unsubscribe function — DesignOSBoundary cleans it up
 * on unmount (StrictMode-safe).
 */

import { bus, type EngineStage, type EngineCompletionKind } from "./events";

/** Inner shape we extract from the variously-typed Tauri payloads. */
interface NormalizedProgress {
  percent: number | null;
  slug?: string;
  idx?: number;
  url?: string;
  note?: string;
  segmentsDone?: number;
  segmentsTotal?: number;
}

interface NormalizedError {
  error: string;
  human?: string;
  code?: string;
  slug?: string;
  idx?: number;
  url?: string;
}

function pct(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  // Sidecar emits some progress as 0..100 and some as 0..1. Heuristic:
  // > 1.5 means "percent units", anything else is treated as ratio.
  return raw > 1.5 ? raw / 100 : raw;
}

function normalizeProgress(p: unknown): NormalizedProgress {
  const obj = (p ?? {}) as Record<string, unknown>;
  const percentSource =
    obj.percent ??
    obj.pct ??
    (typeof obj.processed_seconds === "number" && typeof obj.total_seconds === "number" && obj.total_seconds > 0
      ? (obj.processed_seconds as number) / (obj.total_seconds as number)
      : undefined);
  return {
    percent: pct(percentSource),
    slug: typeof obj.slug === "string" ? obj.slug : undefined,
    idx: typeof obj.idx === "number" ? obj.idx : undefined,
    url: typeof obj.url === "string" ? obj.url : undefined,
    note: typeof obj.last_text === "string" ? obj.last_text : undefined,
    segmentsDone: typeof obj.segments_done === "number" ? obj.segments_done : undefined,
    segmentsTotal: typeof obj.total === "number" ? obj.total : undefined,
  };
}

function normalizeError(p: unknown): NormalizedError {
  const obj = (p ?? {}) as Record<string, unknown>;
  return {
    error: typeof obj.error === "string" ? obj.error : String(obj.message ?? "Unknown error"),
    // YouTubeBlockedError (sidecar.py) sends customer_message/error_code
    // instead of human/code — fall back so its reviewed copy isn't
    // discarded and re-derived by the generic regex classifier.
    human: typeof obj.human === "string" ? obj.human
      : typeof obj.customer_message === "string" ? obj.customer_message : undefined,
    code: typeof obj.code === "string" ? obj.code
      : typeof obj.error_code === "string" ? obj.error_code : undefined,
    slug: typeof obj.slug === "string" ? obj.slug : undefined,
    idx: typeof obj.idx === "number" ? obj.idx : undefined,
    url: typeof obj.url === "string" ? obj.url : undefined,
  };
}

function readStage(p: unknown, fallback: EngineStage): EngineStage {
  const raw = (p as { stage?: string } | undefined)?.stage;
  const allowed: ReadonlyArray<EngineStage> = [
    "ingest", "audio", "transcribe", "llm", "cut", "reframe", "thumbs",
    "bake", "regenerate", "lift", "pick", "thumbnail",
  ];
  return (raw && (allowed as ReadonlyArray<string>).includes(raw))
    ? (raw as EngineStage)
    : fallback;
}

/** Listener-mount entry. */
interface ProgressBinding {
  channel: string;
  stage: EngineStage;
}

const PROGRESS_BINDINGS: ReadonlyArray<ProgressBinding> = [
  { channel: "sidecar:ingest_progress",          stage: "ingest"     },
  { channel: "sidecar:stage_progress",           stage: "transcribe" }, // payload.stage overrides
  { channel: "sidecar:bake_progress",            stage: "bake"       },
  { channel: "sidecar:thumbnail_batch_progress", stage: "thumbnail"  },
  { channel: "sidecar:export_progress",          stage: "export"     },
  { channel: "sidecar:regenerate_progress",      stage: "regenerate" },
  { channel: "sidecar:pick_progress",            stage: "pick"       },
  { channel: "sidecar:lift_progress",            stage: "lift"       },
  { channel: "sidecar:overlay_progress",         stage: "bake"       },
];

interface CompletionBinding {
  channel: string;
  kind: EngineCompletionKind;
}

const COMPLETION_BINDINGS: ReadonlyArray<CompletionBinding> = [
  { channel: "sidecar:ingest_complete",            kind: "ingest"           },
  { channel: "sidecar:lift_complete",              kind: "lift"             },
  { channel: "sidecar:pick_complete",              kind: "pick"             },
  { channel: "sidecar:regenerate_complete",        kind: "regenerate"       },
  { channel: "sidecar:bake_complete",              kind: "bake"             },
  { channel: "sidecar:thumbnail_batch_complete",   kind: "thumbnail-batch"  },
  { channel: "sidecar:export_complete",            kind: "export"           },
];

const ERROR_BINDINGS: ReadonlyArray<CompletionBinding> = [
  { channel: "sidecar:ingest_error",            kind: "ingest"           },
  { channel: "sidecar:lift_error",              kind: "lift"             },
  { channel: "sidecar:pick_error",              kind: "pick"             },
  { channel: "sidecar:regenerate_error",        kind: "regenerate"       },
  { channel: "sidecar:bake_error",              kind: "bake"             },
  { channel: "sidecar:thumbnail_batch_error",   kind: "thumbnail-batch"  },
  { channel: "sidecar:export_error",            kind: "export"           },
];

/**
 * Subscribe to all sidecar:* events and re-emit them onto the Design OS bus.
 * Returns an unsubscribe function. Safe to call in non-Tauri runtimes —
 * silently no-ops if the Tauri API is unreachable.
 */
export function mountTauriAdapter(): () => void {
  if (typeof window === "undefined") return () => {};

  // Marker so accidental double-mount doesn't double-emit.
  const w = window as Window & { __lcTauriAdapterMounted?: boolean };
  if (w.__lcTauriAdapterMounted) return () => {};
  w.__lcTauriAdapterMounted = true;

  const unlistens: Array<() => void> = [];
  let cancelled = false;

  const teardown = () => {
    cancelled = true;
    for (const u of unlistens) {
      try { u(); } catch { /* noop */ }
    }
    unlistens.length = 0;
    w.__lcTauriAdapterMounted = false;
  };

  // Lazy import — keeps the adapter usable from non-Tauri runtimes (vite dev
  // in a browser) without blowing up on import.
  (async () => {
    let listen: (channel: string, handler: (e: { payload: unknown }) => void) => Promise<() => void>;
    try {
      ({ listen } = await import("@tauri-apps/api/event"));
    } catch (err) {
      console.warn("[tauri-adapter] @tauri-apps/api unavailable — adapter is a no-op:", err);
      return;
    }
    if (cancelled) return;

    const register = async <T>(channel: string, fn: (payload: T) => void) => {
      try {
        const u = await listen(channel, (e) => fn(e.payload as T));
        if (cancelled) { u(); return; }
        unlistens.push(u);
      } catch (err) {
        console.warn(`[tauri-adapter] cannot listen on ${channel}:`, err);
      }
    };

    // Progress
    for (const b of PROGRESS_BINDINGS) {
      await register(b.channel, (payload: unknown) => {
        const n = normalizeProgress(payload);
        bus.emit("engine:progress", {
          stage: readStage(payload, b.stage),
          percent: n.percent,
          slug: n.slug,
          idx: n.idx,
          url: n.url,
          note: n.note,
          segmentsDone: n.segmentsDone,
          segmentsTotal: n.segmentsTotal,
        });
      });
    }

    // Completion
    for (const b of COMPLETION_BINDINGS) {
      await register(b.channel, (payload: unknown) => {
        const obj = (payload ?? {}) as Record<string, unknown>;
        bus.emit("engine:complete", {
          kind: b.kind,
          slug: typeof obj.slug === "string" ? obj.slug : undefined,
          idx:  typeof obj.idx  === "number" ? obj.idx  : undefined,
          url:  typeof obj.url  === "string" ? obj.url  : undefined,
          // bake_complete / regenerate_complete embed the full project so
          // the UI can hydrate without an extra get_project RPC roundtrip.
          project: obj.project,
        });
      });
    }

    // Errors
    for (const b of ERROR_BINDINGS) {
      await register(b.channel, (payload: unknown) => {
        const n = normalizeError(payload);
        bus.emit("engine:error", {
          kind: b.kind,
          slug: n.slug,
          idx: n.idx,
          url: n.url,
          error: n.error,
          human: n.human,
          code: n.code,
        });
      });
    }

    // Lifecycle — sidecar:died is special; we surface as engine:error so any
    // route showing a session can flip to a stop-page.
    await register("sidecar:died", (payload: unknown) => {
      const n = normalizeError(payload);
      bus.emit("engine:error", {
        kind: "sidecar-died",
        error: n.error || "Sidecar process exited",
        human: n.human ?? "The clipping engine restarted. Try again.",
        code: n.code ?? "SIDECAR_DIED",
      });
    });
  })();

  return teardown;
}
