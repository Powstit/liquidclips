/**
 * recordingController · Screen recording orchestration.
 *
 * ⚠ IRON GATE IG-COCKPIT-SCREEN-RECORDING · one entry point per action.
 *
 * Wraps the nativeCapture IPC + useRecordingState store into three
 * imperative operations the cockpit's `handleUserAction` reducer calls:
 *
 *   startRecording(targetIdx)     — enumerate targets → check permission
 *                                   → screen_capture_start → set status
 *   startCameraRecording(device)  — getUserMedia + MediaRecorder (no scap)
 *   stopRecording()                — dispatches to whichever lane is live,
 *                                    saves the file, then emits
 *                                    bus "source:drop" so GlobalDropConsumer
 *                                    auto-ingests it into Workstation exactly
 *                                    like a dragged-in file.
 *   ensureTargetsLoaded()          — cache list of displays/windows
 *
 * Every function is idempotent + fail-loud (never silently no-op).
 *
 * 2026-07-22 · Bundle 2 · Sprint drivetrain-3
 * 2026-07-28 · camera lane + source:drop auto-ingest wiring
 */

import {
  nativeCaptureListTargets,
  nativeCaptureRequestPermission,
  nativeCaptureStart,
  nativeCaptureStop,
  nativeCaptureSupportStatus,
  saveMediaRecording,
} from "./nativeCapture";
import { startMediaCapture, type MediaCaptureSession } from "./mediaCapture";
import { useRecordingState } from "../../state/useRecordingState";
import { lcDiag } from "../../../lib/diagnosticLogger";
import { bus } from "../../bridge";

// Camera recordings go through getUserMedia + MediaRecorder (see
// mediaCapture.ts), not scap — there's no Tauri-side session_id for
// this lane, so the live session is held here instead of in Rust.
// stopRecording() checks this before falling back to the scap/native
// stop path, so ActiveView's Stop button + the F2 toggle don't need to
// know which capture lane is actually running.
let activeCameraSession: MediaCaptureSession | null = null;

/** Load targets into the store (idempotent · reloads on demand). */
export async function ensureTargetsLoaded(force = false): Promise<void> {
  const s = useRecordingState.getState();
  if (!force && s.targets.length > 0) return;
  s.setStatus("arming");
  try {
    const support = await nativeCaptureSupportStatus();
    if (!support.supported) {
      s.setError("screen capture not supported on this platform");
      s.setStatus("idle");
      return;
    }
    if (!support.hasPermission) {
      const granted = await nativeCaptureRequestPermission();
      if (!granted) {
        s.setError("screen recording permission denied · System Settings → Privacy & Security → Screen Recording");
        s.setStatus("idle");
        return;
      }
    }
    const targets = await nativeCaptureListTargets();
    s.setTargets(targets);
    s.setStatus("idle");
    void lcDiag("recording_targets_loaded", { count: targets.length });
  } catch (exc) {
    const msg = (exc as Error).message ?? "targets_load_failed";
    s.setError(msg.slice(0, 200));
    s.setStatus("idle");
    void lcDiag("recording_targets_load_failed", { message: msg.slice(0, 200) });
  }
}

/** Start recording target at the given index (from useRecordingState.targets). */
export async function startRecording(
  targetIdx: number,
  resolution?: "720p" | "1080p" | "4k",
): Promise<void> {
  await ensureTargetsLoaded();
  let s = useRecordingState.getState();
  if (s.targets.length === 0) {
    // The first load can race a just-granted permission (macOS hasn't
    // finished registering it yet) or simply return stale/empty state —
    // force one fresh re-enumeration before giving up on the user.
    await ensureTargetsLoaded(true);
    s = useRecordingState.getState();
  }
  const target = s.targets[targetIdx];
  if (!target) {
    s.setError(
      s.targets.length === 0
        ? "no recordable displays or windows found · check Screen Recording permission in System Settings → Privacy & Security"
        : `no target at index ${targetIdx} · only ${s.targets.length} available`,
    );
    return;
  }
  // Guard: refuse if already active.
  if (s.status === "active") {
    void lcDiag("recording_start_refused_already_active", { targetIdx });
    return;
  }
  s.setError(null);
  s.setTarget(target.id, target.label);
  s.setStatus("arming");
  try {
    const resp = await nativeCaptureStart(`rec_${Date.now().toString(36)}`, targetIdx, resolution);
    s.setSession(resp.sessionId, resp.startedAtMs);
    s.setStatus("active");
    bus.emit("kade:mood", { mood: "thinking" });
    bus.emit("kade:speak", {
      title: "Recording · " + target.label,
      body: "Kade is capturing your screen. Click STOP or press F2 again to finish.",
      severity: "info",
    });
    void lcDiag("recording_started", { targetIdx, sessionId: resp.sessionId, label: target.label });
  } catch (exc) {
    const msg = (exc as Error).message ?? "start_failed";
    s.setError(msg.slice(0, 200));
    s.setStatus("idle");
    bus.emit("kade:mood", { mood: "alert" });
    bus.emit("kade:speak", { title: "Recording failed", body: msg.slice(0, 160), severity: "warn" });
    void lcDiag("recording_start_failed", { targetIdx, message: msg.slice(0, 200) });
  }
}

/** Start a camera recording via getUserMedia + MediaRecorder (mediaCapture.ts) —
 *  no scap Target, no session_id round-trip through Rust. Populates the
 *  same useRecordingState fields as startRecording() so ActiveView /
 *  the F2 toggle / stopRecording() don't need to know which lane is live.
 *  `withMic` records real microphone audio into the same file (WebM
 *  supports both tracks natively) — not the disabled screen-capture
 *  "Audio input" picker; this is a genuinely working audio path since
 *  it goes through getUserMedia, not scap. */
export async function startCameraRecording(
  deviceId?: string,
  withMic = false,
): Promise<void> {
  const s = useRecordingState.getState();
  if (s.status === "active") {
    void lcDiag("recording_start_refused_already_active", { source: "camera" });
    return;
  }
  s.setError(null);
  s.setStatus("arming");
  const label = withMic ? "Camera + Mic" : "Camera";
  try {
    const session = await startMediaCapture({
      video: true,
      audio: withMic,
      videoDeviceId: deviceId,
    });
    activeCameraSession = session;
    s.setTarget("camera", label);
    s.setSession(`cam_${Date.now().toString(36)}`, Date.now());
    s.setStatus("active");
    bus.emit("kade:mood", { mood: "thinking" });
    bus.emit("kade:speak", {
      title: "Recording · " + label,
      body: "Kade is capturing your camera. Click STOP or press F2 again to finish.",
      severity: "info",
    });
    void lcDiag("recording_started", { source: "camera", withMic });
  } catch (exc) {
    const msg = (exc as Error).message ?? "start_failed";
    s.setError(msg.slice(0, 200));
    s.setStatus("idle");
    bus.emit("kade:mood", { mood: "alert" });
    bus.emit("kade:speak", { title: "Recording failed", body: msg.slice(0, 160), severity: "warn" });
    void lcDiag("recording_start_failed", { source: "camera", message: msg.slice(0, 200) });
  }
}

/** Stop a live camera recording — stop the MediaRecorder (mediaCapture.ts
 *  returns the finished Blob), then hand it to save_media_recording so it
 *  lands on disk in the same ~/LiquidClips/Recordings/ directory the
 *  scap/ffmpeg path writes to. Split out from stopRecording() below only
 *  because the two lanes have nothing in common past "update the store
 *  + tell the user" — stopRecording() dispatches here when a camera
 *  session is live. */
async function stopCameraRecording(): Promise<void> {
  const s = useRecordingState.getState();
  const session = activeCameraSession;
  if (!session) {
    void lcDiag("recording_stop_refused_not_active", { status: s.status, source: "camera" });
    return;
  }
  activeCameraSession = null;
  s.setStatus("stopping");
  try {
    const recording = await session.stop();
    const saved = await saveMediaRecording(recording.blob, recording.mimeType);
    void lcDiag("recording_stopped", {
      source: "camera",
      durationMs: recording.durationMs,
      outputPath: saved.outputPath,
      outputBytes: saved.outputBytes,
    });
    bus.emit("kade:mood", { mood: "idle" });
    bus.emit("kade:speak", {
      title: "Recording saved",
      body: `Captured ${Math.round(recording.durationMs / 1000)}s from Camera · saved to ${saved.outputPath}.`,
      severity: "info",
    });
    // Same channel a dragged-in file uses (DropOverlay/UploadPortal) —
    // GlobalDropConsumer picks this up from any route, routes to
    // Workstation, and kicks off the real ingest → clips pipeline.
    // Without this a recording just sits in ~/LiquidClips/Recordings/
    // as a file nothing in the app knows exists yet.
    bus.emit("source:drop", { paths: [saved.outputPath] });
    s.reset();
    useRecordingState.getState().setRecordingPath(saved.outputPath);
  } catch (exc) {
    const msg = (exc as Error).message ?? "stop_failed";
    s.setError(msg.slice(0, 200));
    s.setStatus("idle");
    bus.emit("kade:mood", { mood: "alert" });
    bus.emit("kade:speak", { title: "Stop failed", body: msg.slice(0, 160), severity: "warn" });
    void lcDiag("recording_stop_failed", { source: "camera", message: msg.slice(0, 200) });
  }
}

/** Stop the current recording. screen_capture.rs now actually encodes
 *  and writes an MP4 (2026-07 ffmpeg-pipe fix) — outputPath/outputBytes
 *  are real, on-disk facts, not a future-proofing placeholder. */
export async function stopRecording(): Promise<void> {
  if (activeCameraSession) {
    await stopCameraRecording();
    return;
  }
  const s = useRecordingState.getState();
  if (s.status !== "active" || !s.sessionId) {
    void lcDiag("recording_stop_refused_not_active", { status: s.status });
    return;
  }
  s.setStatus("stopping");
  try {
    const resp = await nativeCaptureStop(s.sessionId);
    void lcDiag("recording_stopped", {
      sessionId: resp.sessionId,
      durationMs: resp.durationMs,
      outputPath: resp.outputPath,
      outputBytes: resp.outputBytes,
    });
    bus.emit("kade:mood", { mood: "idle" });
    bus.emit("kade:speak", {
      title: "Recording saved",
      body: `Captured ${Math.round(resp.durationMs / 1000)}s from ${s.targetLabel ?? "screen"} · saved to ${resp.outputPath}.`,
      severity: "info",
    });
    // Same channel a dragged-in file uses (DropOverlay/UploadPortal) —
    // GlobalDropConsumer picks this up from any route, routes to
    // Workstation, and kicks off the real ingest → clips pipeline.
    bus.emit("source:drop", { paths: [resp.outputPath] });
    s.reset();
    // reset() clears lastRecordingPath along with everything else — set
    // it again after so the surface can point the user at the real file.
    useRecordingState.getState().setRecordingPath(resp.outputPath);
  } catch (exc) {
    const msg = (exc as Error).message ?? "stop_failed";
    s.setError(msg.slice(0, 200));
    s.setStatus("idle");
    bus.emit("kade:mood", { mood: "alert" });
    bus.emit("kade:speak", { title: "Stop failed", body: msg.slice(0, 160), severity: "warn" });
    void lcDiag("recording_stop_failed", { sessionId: s.sessionId, message: msg.slice(0, 200) });
  }
}

/** Toggle · used by the F2 hotkey. */
export async function toggleRecording(): Promise<void> {
  const s = useRecordingState.getState();
  if (s.status === "active") {
    await stopRecording();
  } else if (s.status === "idle") {
    // Default target: display 0 (most common single-monitor flow).
    await ensureTargetsLoaded();
    await startRecording(0);
  }
}
