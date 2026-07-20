/**
 * sidecarSafe · Fence 1 of the 5-layer defense against silent sidecar hangs.
 * LOCKED 2026-07-19 · reference: `feedback_never_regress_4_layer_defense.md`.
 *
 * The regression this exists to prevent:
 *   Composer.tsx:559 shipped `void sidecar.ingestUrl(...)` with no `.catch()`.
 *   Sidecar-unavailable / IPC timeout / whisper-crash all became a silent
 *   5-minute hang — user saw "fetching" then nothing forever. No Kade line,
 *   no toast, no diagnostic. Composer.tsx:565 now carries the fix inline,
 *   but only for that one call site.
 *
 * This wrapper is the class-level fix. Every high-stakes sidecar method is
 * re-exported here with a signature that REQUIRES an `onError` callback.
 * The wrapper internally attaches `.catch(opts.onError)` so the caller can
 * never forget. Callers who ALSO want to await the promise still can — the
 * wrapper returns the same Promise the underlying method returns.
 *
 * Why a wrapper and not a signature change on `sidecar.*` itself?
 * ------------------------------------------------------------------
 * The current `sidecar.*` API has ~9 live call sites. All but one already
 * handle errors correctly (await+try/catch or .then().catch()). Forcing a
 * signature change would rewrite perfectly-safe callers just to add a
 * redundant `onError` — pure noise. Instead:
 *   - New callers use `sidecarSafe.*` (compile-time enforcement of onError)
 *   - Existing callers stay on `sidecar.*` (proven safe already)
 *   - Fence 3 (lint-no-silent-sidecar.sh) bans `void sidecar.*` and
 *     unwrapped high-stakes calls with no visible .catch, forcing every
 *     NEW caller to either await+try/catch, chain .catch, or use
 *     `sidecarSafe.*` — the class of "silent hang" bugs can never ship
 *     again regardless of which path the caller picks.
 *
 * Callers example:
 *   sidecarSafe.ingestUrl(url, { onError: (e) => showToast(e.message) });
 *   await sidecarSafe.startRun(path, { onError: (e) => bus.emit(...) });
 */

import { sidecar, exportApi, type ExportClipParams } from "../design-os/engine/sidecar-stub";
import type { ProjectMeta, StageName } from "../design-os/engine/types";

/** Options shared by every safe wrapper. onError is REQUIRED. */
export interface SidecarSafeOpts {
  /** Fires when the underlying sidecar promise rejects. The wrapper
   *  attaches `.catch(onError)` internally so the rejection never
   *  becomes an unhandled promise. Callers who ALSO await the returned
   *  promise still get the rejection re-thrown at their await site so
   *  they can render inline UI state — onError is the fallback for
   *  fire-and-forget paths. */
  onError: (e: Error) => void;
}

/** Normalize any thrown value to an Error for the onError contract. */
function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  return new Error(typeof e === "string" ? e : JSON.stringify(e));
}

export const sidecarSafe = {
  /** Safe wrapper around `sidecar.ingestUrl`. Required onError catches the
   *  sidecar-unavailable / IPC-timeout / whisper-crash class of silent
   *  hangs that broke Composer.tsx pre-2026-07-19. */
  ingestUrl(
    url: string,
    opts: SidecarSafeOpts & {
      brief?: string;
      intent?: "clips" | "script";
      clipCount?: number;
      runId?: string;
    },
  ): Promise<{ project: ProjectMeta; downloaded_path?: string }> {
    const p = sidecar.ingestUrl(url, opts.brief, opts.intent, opts.clipCount, opts.runId);
    p.catch((e) => opts.onError(toError(e)));
    return p;
  },

  /** Safe wrapper around `sidecar.startRun`. */
  startRun(
    sourcePath: string,
    opts: SidecarSafeOpts & {
      brief?: string;
      intent?: "clips" | "script";
      clipCount?: number;
      runId?: string;
    },
  ): Promise<{ project: ProjectMeta }> {
    const p = sidecar.startRun(sourcePath, opts.brief, opts.intent, opts.clipCount, opts.runId);
    p.catch((e) => opts.onError(toError(e)));
    return p;
  },

  /** Safe wrapper around `sidecar.pickMoreClips`. */
  pickMoreClips(
    slug: string,
    opts: SidecarSafeOpts,
  ): Promise<{ project: ProjectMeta; added?: number; skipped?: number }> {
    const p = sidecar.pickMoreClips(slug);
    p.catch((e) => opts.onError(toError(e)));
    return p;
  },

  /** Safe wrapper around `sidecar.runStage`. */
  runStage(
    slug: string,
    stage: StageName,
    opts: SidecarSafeOpts,
  ): Promise<{ project: ProjectMeta }> {
    const p = sidecar.runStage(slug, stage);
    p.catch((e) => opts.onError(toError(e)));
    return p;
  },

  /** Safe wrapper around `exportApi.exportClip`. Money-moment surface — a
   *  silent hang here loses a Publish. onError REQUIRED. */
  exportClip(
    params: ExportClipParams,
    opts: SidecarSafeOpts,
  ): Promise<{ jobId: string; outputPath: string }> {
    const p = exportApi.exportClip(params);
    p.catch((e) => opts.onError(toError(e)));
    return p;
  },
};

export type SidecarSafe = typeof sidecarSafe;
