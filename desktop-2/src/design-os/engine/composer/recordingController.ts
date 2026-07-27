/**
 * recordingController · Screen recording orchestration.
 *
 * ⚠ IRON GATE IG-COCKPIT-SCREEN-RECORDING · one entry point per action.
 *
 * Wraps the nativeCapture IPC + useRecordingState store into three
 * imperative operations the cockpit's `handleUserAction` reducer calls:
 *
 *   startRecording(targetIdx)   — enumerate targets → check permission
 *                                 → screen_capture_start → set status
 *   stopRecording()             — screen_capture_stop → set status
 *                                 → ready for file-path ingest follow-up
 *   ensureTargetsLoaded()       — cache list of displays/windows
 *
 * Every function is idempotent + fail-loud (never silently no-op).
 *
 * 2026-07-22 · Bundle 2 · Sprint drivetrain-3
 */

import {
  nativeCaptureListTargets,
  nativeCaptureRequestPermission,
  nativeCaptureStart,
  nativeCaptureStop,
  nativeCaptureSupportStatus,
} from "./nativeCapture";
import { useRecordingState } from "../../state/useRecordingState";
import { lcDiag } from "../../../lib/diagnosticLogger";
import { bus } from "../../bridge";

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
export async function startRecording(targetIdx: number): Promise<void> {
  await ensureTargetsLoaded();
  const s = useRecordingState.getState();
  const target = s.targets[targetIdx];
  if (!target) {
    s.setError(`no target at index ${targetIdx}`);
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
    const resp = await nativeCaptureStart(target.id);
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

/** Stop the current recording. Returns the file path if the sidecar
 *  hands one back (future-proof: current stop RPC just returns duration;
 *  the file path is emitted via engine:complete when the writer flushes). */
export async function stopRecording(): Promise<void> {
  const s = useRecordingState.getState();
  if (s.status !== "active" || !s.sessionId) {
    void lcDiag("recording_stop_refused_not_active", { status: s.status });
    return;
  }
  s.setStatus("stopping");
  try {
    const resp = await nativeCaptureStop(s.sessionId);
    void lcDiag("recording_stopped", { sessionId: resp.sessionId, durationMs: resp.durationMs });
    bus.emit("kade:mood", { mood: "idle" });
    // IG-RECORDING-HONEST-STOP · 2026-07-24
    //
    // The Rust `screen_capture` module (src-tauri/src/screen_capture.rs:20-23)
    // is EXPLICIT that "Encoding to MP4 is intentionally OUT OF SCOPE"
    // for this shell version. scap holds the capture handle (which
    // lights the macOS Screen Recording indicator), consumes BGRA
    // frames, and returns duration on stop — no file is written to
    // disk yet. Saying "Recording saved" would lie about a file that
    // does not exist. Copy below matches reality: capture stopped,
    // duration recorded, no MP4 yet, import path lands with the
    // sidecar writer (Bundle 2b).
    //
    // See Daniel's memory rule:
    //   feedback_never_claim_moving_without_visible_evidence.md
    bus.emit("kade:speak", {
      title: "Capture stopped",
      body: `Held the capture for ${Math.round(resp.durationMs / 1000)}s from ${s.targetLabel ?? "screen"}. MP4 encoder ships in the next shell release · no file saved to disk yet.`,
      severity: "info",
    });
    // NB: auto-ingest to sidecar (Bundle 2b) happens once the capture
    // writer emits the finished file path via engine:complete. For now
    // we log the intent + reset state.
    s.reset();
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
