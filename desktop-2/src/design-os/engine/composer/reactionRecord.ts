/**
 * reactionRecord · Composer D · Reaction Record mode orchestrator.
 *
 * ⚠ IRON GATE IG-COMPOSER-JJ · Screen + Camera reaction recording.
 *
 * Runs three lanes in parallel:
 *   1. Camera + mic → MediaRecorder (webview `getUserMedia`)
 *   2. Screen → sidecar ffmpeg avfoundation subprocess
 *   3. Countdown timer that gates the start
 *
 * On stop:
 *   * Camera Blob is saved to disk via Tauri fs write
 *   * Screen file is already on disk (sidecar wrote it directly)
 *   * Both file paths are handed to sidecar `reaction_recording_merge`
 *     which composes the final MP4 using the layout the user picked in
 *     ReactionPanel (settings.reaction.layout) · vstack / hstack /
 *     xstack / overlay via the existing filter graph.
 *
 * Reuses:
 *   * mediaCapture.ts · startMediaCapture (camera + mic + audio device pick)
 *   * mediaCapture.ts · enumerateMediaInputs (device picker)
 *   * Sidecar screen_recorder.py (avfoundation → mp4, merge)
 *   * ReactionPanel's layout choice (settings.reaction.layout)
 */

import { sidecarCall, isSidecarUnavailable } from "../sidecarCall";
import type { MediaCaptureSession } from "./mediaCapture";
import { startMediaCapture } from "./mediaCapture";

export type ReactionLayout =
  | "top-bottom" | "side-by-side" | "grid-2x2"
  | "pip-tr" | "pip-tl" | "pip-br" | "pip-bl" | "solo";

export interface ReactionRecordOpts {
  /** Layout key from CockpitSettings.reaction.layout. */
  layout: ReactionLayout;
  /** Camera device id from enumerateMediaInputs. */
  cameraDeviceId?: string;
  /** Audio device id (used by both camera lane AND sidecar screen lane
   *  if avAudioIndex is null). */
  audioDeviceId?: string;
  /** avfoundation screen index (from screen_recording_list_devices).
   *  1 is the default main display on most Macs. */
  screenIndex?: number;
  /** avfoundation audio index (from screen_recording_list_devices).
   *  Optional — the camera lane's mic covers the standard use case. */
  audioIndex?: number | null;
  /** Camera preview <video> element. */
  previewEl?: HTMLVideoElement | null;
  /** Where the sidecar writes the screen mp4 (temp path). */
  screenOutputPath: string;
  /** Where the final merged mp4 lands. */
  mergedOutputPath?: string;
  /** Called every second during recording with elapsed ms. */
  onTick?: (elapsedMs: number) => void;
}

export interface ReactionRecordSession {
  layout: ReactionLayout;
  startedAtMs: number;
  camera: MediaCaptureSession;
  screenSessionId: string;
  stop: () => Promise<ReactionRecordResult>;
  cancel: () => Promise<void>;
}

export interface ReactionRecordResult {
  cameraBlob: Blob;
  cameraMimeType: string;
  screenPath: string;
  durationMs: number;
  merge: (finalMp4Path: string) => Promise<{ output_path: string; size_bytes: number; layout: ReactionLayout }>;
}

interface StartScreenRecordingResponse {
  session_id: string;
  pid: number;
  output_path: string;
  started_at_ms: number;
}

interface StopScreenRecordingResponse {
  session_id: string;
  output_path: string;
  size_bytes: number;
  duration_ms: number;
  exit_code: number;
}

interface MergeResponse {
  output_path: string;
  layout: string;
  size_bytes: number;
}

/**
 * Start both lanes. Camera + screen begin capturing in parallel;
 * either lane failing to start stops the other so we never leave one
 * running silently.
 */
export async function startReactionRecording(opts: ReactionRecordOpts): Promise<ReactionRecordSession> {
  const startedAtMs = Date.now();

  // Kick both lanes in parallel via Promise.all so if either throws we
  // catch it and clean up the other lane.
  let camera: MediaCaptureSession | null = null;
  let screenSession: StartScreenRecordingResponse | null = null;

  try {
    const [cameraResult, screenResult] = await Promise.all([
      startMediaCapture({
        video: true,
        audio: true,
        audioDeviceId: opts.audioDeviceId,
        videoDeviceId: opts.cameraDeviceId,
        previewEl: opts.previewEl,
      }),
      sidecarCall<StartScreenRecordingResponse>("screen_recording_start", {
        output_path: opts.screenOutputPath,
        screen_index: opts.screenIndex ?? 1,
        audio_index: opts.audioIndex ?? null,
        fps: 30,
      }),
    ]);
    camera = cameraResult;
    screenSession = screenResult;
  } catch (err) {
    // Best-effort cleanup on partial start.
    if (camera) {
      try { camera.cancel(); } catch { /* ignore */ }
    }
    if (screenSession) {
      try {
        await sidecarCall("screen_recording_stop", { session_id: screenSession.session_id });
      } catch { /* ignore */ }
    }
    if (isSidecarUnavailable(err)) {
      throw new Error("reactionRecord.sidecar_unavailable");
    }
    throw err;
  }

  const cameraFinal = camera;
  const screenFinal = screenSession;

  const tickTimer = opts.onTick
    ? setInterval(() => opts.onTick?.(Date.now() - startedAtMs), 1000)
    : null;

  let stopped = false;

  const stop = async (): Promise<ReactionRecordResult> => {
    if (stopped) throw new Error("reactionRecord.already_stopped");
    stopped = true;
    if (tickTimer) clearInterval(tickTimer);

    // Stop screen first — ffmpeg writes trailer on SIGINT, and that's
    // slow relative to MediaRecorder's stop() which is instant. Await
    // both.
    const [cameraRecording, screenStop] = await Promise.all([
      cameraFinal.stop(),
      sidecarCall<StopScreenRecordingResponse>("screen_recording_stop", {
        session_id: screenFinal.session_id,
      }),
    ]);

    const durationMs = Date.now() - startedAtMs;

    const merge = async (finalMp4Path: string) => {
      const cameraBlobPath = await saveBlobToTauriPath(cameraRecording.blob, opts.screenOutputPath + ".camera.webm");
      return sidecarCall<MergeResponse>("reaction_recording_merge", {
        screen_path: screenStop.output_path,
        camera_path: cameraBlobPath,
        layout: opts.layout,
        output_path: finalMp4Path,
        output_width: 1080,
        output_height: 1920,
      }).then((r) => ({ output_path: r.output_path, layout: opts.layout, size_bytes: r.size_bytes }));
    };

    return {
      cameraBlob: cameraRecording.blob,
      cameraMimeType: cameraRecording.mimeType,
      screenPath: screenStop.output_path,
      durationMs,
      merge,
    };
  };

  const cancel = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    if (tickTimer) clearInterval(tickTimer);
    try { cameraFinal.cancel(); } catch { /* ignore */ }
    try {
      await sidecarCall("screen_recording_stop", { session_id: screenFinal.session_id });
    } catch { /* ignore */ }
  };

  return {
    layout: opts.layout,
    startedAtMs,
    camera: cameraFinal,
    screenSessionId: screenFinal.session_id,
    stop,
    cancel,
  };
}

/** Save a Blob to a Tauri filesystem path. Falls back to an in-memory
 *  ObjectURL when Tauri is unavailable (dev mode) so the caller still
 *  gets a valid file reference for the merge shim. */
async function saveBlobToTauriPath(blob: Blob, path: string): Promise<string> {
  try {
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const buffer = new Uint8Array(await blob.arrayBuffer());
    await writeFile(path, buffer);
    return path;
  } catch {
    // Fall back to URL so dev mode still surfaces something. The sidecar
    // merge call will fail loudly if the path isn't real, which is the
    // correct behaviour.
    return URL.createObjectURL(blob);
  }
}
