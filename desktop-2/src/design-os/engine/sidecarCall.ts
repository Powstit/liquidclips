// ───── IRON GATE IG-002 (v0.8.0) — sidecar RPC contract ─────
// Batch B port of the minimum sidecar-call helpers from
// `desktop/src/lib/sidecar.ts`. Lift-and-shift: shape, error classes,
// ENV: envelope parsing, crash plumbing, and timeout wrapper preserved
// verbatim. Method names and payload shapes MUST match the Python
// `method_*` registry in `python-sidecar/sidecar.py`.
//
// Scope: callable RPC + crash/restart error semantics + withTimeout +
// the event-listener helpers (`onIngestProgress`, `onStageProgress`).
// Out of Batch B scope: every other sidecar method (channels, schedule,
// thumbnail, etc.) — those keep their existing `tryInvoke` mock-fallback
// path in `sidecar-stub.ts`.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ─── Error classes ────────────────────────────────────────────────────
//
// Each class carries a `human` string the FailureCard / toast surface
// reads directly. Callers should never `String(e)` — always pass through
// `humanError(e)` or read `.human` from a typed instance.

/**
 * Sprint #24 — when the Python sidecar throws a classified error it
 * arrives here as a Rust anyhow message prefixed "ENV:{json...}". Caller
 * catches SidecarError and reads .human (friendly) and .code (stable key).
 */
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

/** ship-lens v0.7.13 F3 — wraps any sidecarCall in a Promise.race against
 *  a setTimeout. Used by importReadyClips (60s) and any future long-running
 *  RPC we want to cap before the 1h Rust safety net. SidecarTimeoutError
 *  carries a `human` field so humanError() can render it cleanly. */
export class SidecarTimeoutError extends Error {
  readonly human: string;
  constructor(method: string, ms: number) {
    super(`Sidecar method "${method}" timed out after ${ms}ms`);
    this.name = "SidecarTimeoutError";
    this.human = `The engine is taking longer than expected on "${method}". Try again, or quit and reopen Liquid Clips.`;
  }
}

/** F5 — thrown when the Rust shell auto-restarted the Python sidecar
 *  mid-RPC. In-flight calls reject with this so the UI can toast
 *  "engine restarted — try again" rather than show a generic failure.
 *  The next sidecarCall after a restart will hit the freshly-spawned
 *  process and (typically) succeed. */
export class SidecarRestartedError extends Error {
  readonly human: string;
  constructor() {
    super("The engine restarted unexpectedly. Try again.");
    this.name = "SidecarRestartedError";
    this.human = "The engine restarted unexpectedly. Try again.";
  }
}

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

// ─── withTimeout ──────────────────────────────────────────────────────

export async function withTimeout<T>(p: Promise<T>, ms: number, method: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SidecarTimeoutError(method, ms)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * v0.7.45 P0-1 port (legacy desktop/src/lib/sidecar.ts:186) — wraps any
 * sidecarCall in a withTimeout AND, on timeout, drops the per-project
 * `.cancel` marker via `project_cancel` so a stuck ffmpeg child aborts at
 * its next poll. Used by `regenerateClip` (180s ceiling) and any other
 * long-running per-project RPC. Marker-write failures log but do not
 * mask the original SidecarTimeoutError.
 */
export async function withCancelOnTimeout<T>(
  p: Promise<T>,
  ms: number,
  method: string,
  slug: string,
): Promise<T> {
  try {
    return await withTimeout(p, ms, method);
  } catch (e) {
    if (e instanceof SidecarTimeoutError) {
      // Best-effort cancel marker drop. Don't toast; surface via the
      // original timeout error. Console.warn keeps QA visibility into
      // marker-write failures (silent swallow would mask the next
      // tuple-unpack-style bug like the one this fix closed).
      sidecarCall("project_cancel", { slug }).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn("[withCancelOnTimeout] project_cancel failed", err);
      });
    }
    throw e;
  }
}

// ─── humanError ───────────────────────────────────────────────────────

/**
 * Sprint #25 — convert any thrown value into a single human-readable line.
 * Replaces `setError(String(e))` everywhere. Prefers SidecarError.human
 * (sidecar pre-classified messages), then pattern-matches common Python /
 * Tauri / network failures, falls back to the raw string. Never returns
 * "ModuleNotFoundError: ..." or similar to a user.
 */
export function humanError(e: unknown): string {
  if (e instanceof SidecarError) return e.human;
  if (e instanceof SidecarTimeoutError) return e.human;
  if (e instanceof SidecarRestartedError) return e.human;
  const raw = e instanceof Error ? e.message : String(e);
  if (!raw || raw === "null" || raw === "undefined" || raw === "[object Object]") {
    return "Something went wrong.";
  }
  if (/ModuleNotFoundError|No module named/i.test(raw)) {
    return "The sidecar is missing a required Python package. Open Settings → Diagnose, or reinstall the app.";
  }
  if (/BillingLimitError|billing[_ ]hard[_ ]limit/i.test(raw)) {
    return "OpenAI billing cap reached. Top up your account or raise the cap to keep generating.";
  }
  if (/CancelledError|cancelled before/i.test(raw)) {
    return "Canceled.";
  }
  if (/transcript\.srt missing|stage 3 must run before reframe/i.test(raw)) {
    return "Lift the transcript first — Add Clip needs the source transcribed.";
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
  return raw.replace(/^Error:\s*/i, "");
}

// ─── Pending-call registry + sidecar:died plumbing ────────────────────

let _pendingSeq = 0;
const _pendingRejecters = new Map<number, (e: SidecarCrashedError) => void>();

type SidecarDiedInfo = { exit_code: number | null };
const _sidecarDiedListeners = new Set<(info: SidecarDiedInfo) => void>();
let _sidecarDiedRustUnlistener: UnlistenFn | null = null;
let _sidecarDiedAttachInFlight: Promise<void> | null = null;

function _parseExitCodeFromMessage(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/exit=Some\((-?\d+)\)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function _fireSidecarDied(info: SidecarDiedInfo): void {
  const rejecters = Array.from(_pendingRejecters.values());
  _pendingRejecters.clear();
  for (const reject of rejecters) {
    try {
      reject(new SidecarCrashedError(info.exit_code));
    } catch {
      /* swallow — one bad subscriber can't take down the rest */
    }
  }
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
      /* Listening can fail pre-boot (no Tauri runtime in web preview). */
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
  void _ensureSidecarDiedListening();
  return () => {
    _sidecarDiedListeners.delete(cb);
  };
}

// ─── sidecarCall ──────────────────────────────────────────────────────

export async function sidecarCall<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  void _ensureSidecarDiedListening();

  const callId = ++_pendingSeq;
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
          const envIdx = raw.indexOf("ENV:");
          if (envIdx >= 0) {
            try {
              const env = JSON.parse(raw.slice(envIdx + 4));
              if (env && typeof env === "object" && env.error === "sidecar_restarted") {
                throw new SidecarRestartedError();
              }
              if (env && typeof env === "object" && env.error === "sidecar_exhausted") {
                throw new SidecarCrashedError(null);
              }
              throw new SidecarError(env);
            } catch (parseErr) {
              if (parseErr instanceof SidecarError) throw parseErr;
              if (parseErr instanceof SidecarRestartedError) throw parseErr;
              if (parseErr instanceof SidecarCrashedError) throw parseErr;
              /* fall through with raw */
            }
          }
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

// ─── Tauri-side event subscriptions (helpers; Batch D mounts) ─────────

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

// ─── Graceful-fallback discriminator (Batch B-only helper) ────────────
//
// When the Rust side's `SidecarState` is NOT managed yet (Batch A landed
// the bridge before Batch C copies python-sidecar/), Tauri's command
// extraction fails before our handler body runs. The error string varies
// by Tauri version; this matcher is defensive across plausible shapes.
//
// Callers (sidecar-stub.ts wrappers for the 4 ported methods) use this
// to fall back to the legacy mock implementation transparently during
// the Batch B → C transition. Real sidecar errors (envelope, restart,
// crash, timeout) flow through as their typed classes — they are NOT
// covered by this matcher and surface to the UI.

function _isProdBuild(): boolean {
  const env = (import.meta as unknown as { env?: Record<string, string | boolean> }).env ?? {};
  return env.PROD === true || env.PROD === "true";
}

export function isSidecarUnavailable(e: unknown): boolean {
  if (e instanceof SidecarError) return false;
  if (e instanceof SidecarRestartedError) return false;
  if (e instanceof SidecarCrashedError) return false;
  if (e instanceof SidecarTimeoutError) return false;
  // No Tauri runtime at all (vite dev / unit tests / preview build).
  const noTauri = typeof window === "undefined" || !("__TAURI_INTERNALS__" in window);
  if (noTauri) {
    void logSidecarUnavailable("no_tauri_internals", e, _isProdBuild());
    // Recovery brief P0 (2026-07-08) · Daniel's rule: "If FIXTURE_PROJECT
    // appears anywhere in production, stop and fix that before continuing."
    // Callers gate their fixture returns behind `if (!isSidecarUnavailable(e))`
    // → returning false here forces the real error to propagate in prod.
    // Dev preview keeps the mock so vite dev / unit tests still render.
    return !_isProdBuild();
  }
  const raw = String(e instanceof Error ? e.message : e).toLowerCase();
  const stateError = (
    raw.includes("not managed") ||
    raw.includes("sidecarstate") ||
    raw.includes("sidecar state") ||
    raw.includes("state of type") ||
    raw.includes("command sidecar_call not found") ||
    raw.includes("tauri_internals") ||
    raw.includes("__tauri")
  );
  if (stateError) {
    void logSidecarUnavailable("state_error_match", e, _isProdBuild());
    // Prod ban · see comment above.
    return !_isProdBuild();
  }
  return false;
}

// Phase 1 recovery diagnostic · every isSidecarUnavailable=true is a
// silent FIXTURE_PROJECT fall-through waiting to happen. Late-import so
// no circular dep with lib/diagnosticLogger. `blockedInProd` is true
// when the caller would have fallen back to a fixture but production
// forced a rethrow.
async function logSidecarUnavailable(reason: string, e: unknown, blockedInProd: boolean): Promise<void> {
  try {
    const mod = await import("../../lib/diagnosticLogger");
    const stack = ((e instanceof Error && e.stack) ? e.stack : "").split("\n").slice(0, 4).join(" | ");
    // Emit a fixture_project_detected topic when prod blocks the fallback,
    // sidecar_unavailable_fallthrough when dev lets it through. Both carry
    // the same shape so a single query surfaces every occurrence.
    mod.lcDiag(blockedInProd ? "fixture_project_detected" : "sidecar_unavailable_fallthrough", {
      reason,
      blocked_in_prod: blockedInProd,
      error_msg: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
      stack_trimmed: stack.slice(0, 300),
      call_site: new Error().stack?.split("\n").slice(2, 5).join(" | ").slice(0, 300) ?? "?",
    });
  } catch { /* logger import failed · non-fatal */ }
}
