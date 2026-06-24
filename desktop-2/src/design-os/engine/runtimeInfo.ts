/**
 * runtimeInfo · single source of truth for engine runtime state
 *
 * Phase 6C-Lockdown. Used by the health panel + error-boundary tagging +
 * runtime honesty labels in the UI. NEVER lies: if the real sidecar isn't
 * reachable, mode === "mock".
 *
 * Detection is conservative:
 *   - Tauri runtime present?       → check `window.__TAURI_INTERNALS__`
 *   - sidecar_call command wired?  → ping with a tiny payload, observe error
 *   - ffmpeg / yt-dlp installed?   → check_deps probe (real RPC only)
 *   - last run status              → in-memory + persisted via session store
 *
 * No persistence here — purely a read-time snapshot. The session-persistence
 * module imports `runtimeMode()` for tagging.
 */

import { bus, useEvent } from "../bridge";
import { useEffect, useState } from "react";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export type RuntimeMode = "mock" | "real";

export type ProbeStatus = "unknown" | "ready" | "missing";

export interface RuntimeInfo {
  mode: RuntimeMode;
  tauriPresent: boolean;
  sidecarCallAvailable: ProbeStatus;
  ffmpeg: ProbeStatus;
  ytDlp: ProbeStatus;
  fasterWhisper: ProbeStatus;
  /** Captured from last engine:* event the bus saw. */
  lastRun: LastRunStatus;
}

export interface LastRunStatus {
  phase: "idle" | "running" | "complete" | "error";
  stage?: string;
  slug?: string;
  url?: string;
  /** Human-rendered error if phase === "error". */
  message?: string;
  at: string | null;
}

const STATE: {
  mode: RuntimeMode;
  tauriPresent: boolean;
  sidecarCallAvailable: ProbeStatus;
  ffmpeg: ProbeStatus;
  ytDlp: ProbeStatus;
  fasterWhisper: ProbeStatus;
  lastRun: LastRunStatus;
} = {
  mode: "mock",
  tauriPresent: false,
  sidecarCallAvailable: "unknown",
  ffmpeg: "unknown",
  ytDlp: "unknown",
  fasterWhisper: "unknown",
  lastRun: { phase: "idle", at: null },
};

/** Probe the runtime once. Subsequent calls just read the cache. */
let probed = false;
let probing: Promise<void> | null = null;

async function probe(): Promise<void> {
  if (probed || probing) return probing ?? undefined;
  probing = (async () => {
    if (typeof window === "undefined") return;
    STATE.tauriPresent = !!window.__TAURI_INTERNALS__;
    if (!STATE.tauriPresent) {
      STATE.mode = "mock";
      probed = true;
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      // Try the sidecar_call command at all — even a `ping` will tell us
      // whether the Rust shell registered the command.
      try {
        await invoke("sidecar_call", { method: "ping", params: {} });
        STATE.sidecarCallAvailable = "ready";
        STATE.mode = "real";
      } catch (e) {
        // Command not registered → still tauri, still mock.
        STATE.sidecarCallAvailable = "missing";
        STATE.mode = "mock";
        void e;
      }
      if (STATE.sidecarCallAvailable === "ready") {
        try {
          const deps = await invoke<{ ok: boolean; missing: string[]; errors?: Record<string, string> }>(
            "sidecar_call", { method: "check_deps", params: {} },
          );
          if (deps && Array.isArray(deps.missing)) {
            STATE.ffmpeg        = deps.missing.includes("ffmpeg")          ? "missing" : "ready";
            STATE.ytDlp         = deps.missing.includes("yt_dlp")          ? "missing" : "ready";
            STATE.fasterWhisper = deps.missing.includes("faster_whisper")  ? "missing" : "ready";
          }
        } catch {
          // check_deps failed but ping worked — leave as unknown.
        }
      }
    } catch {
      STATE.mode = "mock";
    } finally {
      probed = true;
    }
  })();
  await probing;
}

void probe();

/** Subscribe to engine:* once at module load so lastRun stays fresh. */
let busSubscribed = false;
function subscribeBusOnce(): void {
  if (busSubscribed) return;
  busSubscribed = true;
  bus.on("engine:progress", (p) => {
    STATE.lastRun = {
      phase: "running",
      stage: p.stage,
      slug: p.slug,
      url: p.url,
      at: new Date().toISOString(),
    };
  });
  bus.on("engine:complete", (p) => {
    STATE.lastRun = {
      phase: "complete",
      slug: p.slug,
      url: p.url,
      at: new Date().toISOString(),
    };
  });
  bus.on("engine:error", (p) => {
    STATE.lastRun = {
      phase: "error",
      slug: p.slug,
      url: p.url,
      message: p.human ?? p.error,
      at: new Date().toISOString(),
    };
  });
}
subscribeBusOnce();

/* ============================================================
   Public API
   ============================================================ */

export function getRuntimeInfo(): RuntimeInfo {
  return { ...STATE };
}

export function runtimeMode(): RuntimeMode {
  return STATE.mode;
}

/** Force a fresh probe (e.g. after the user installs the sidecar runtime). */
export async function refreshRuntimeProbes(): Promise<RuntimeInfo> {
  probed = false;
  probing = null;
  await probe();
  return getRuntimeInfo();
}

/** Hook · re-render on engine events. Light — only triggers when phase changes. */
export function useRuntimeInfo(): RuntimeInfo {
  const [snap, setSnap] = useState<RuntimeInfo>(() => getRuntimeInfo());
  useEvent("engine:progress", () => setSnap(getRuntimeInfo()));
  useEvent("engine:complete", () => setSnap(getRuntimeInfo()));
  useEvent("engine:error", () => setSnap(getRuntimeInfo()));
  // Pick up async probe completion
  useEffect(() => {
    let cancelled = false;
    void probe().then(() => { if (!cancelled) setSnap(getRuntimeInfo()); });
    return () => { cancelled = true; };
  }, []);
  return snap;
}
