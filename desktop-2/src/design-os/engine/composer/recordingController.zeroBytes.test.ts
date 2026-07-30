/**
 * recordingController · zero-byte output detection · regression guard.
 * 2026-07-30.
 *
 * Both stop paths (screen lane via nativeCaptureStop, camera lane via
 * saveMediaRecording) used to celebrate "Recording saved!" and emit
 * `source:drop` (auto-ingesting the file into the clip pipeline)
 * unconditionally on ANY successful stop — including one that produced
 * a genuinely empty file (encoder crash, disconnected device, disk
 * full). A 0-byte file silently entering the ingest pipeline would fail
 * there in a much more confusing way, far from the actual cause.
 *
 * These tests mock the IPC layer to return outputBytes: 0 and verify:
 *   - an honest error is set (session.lastError)
 *   - status returns to "idle" (not left hanging on "stopping")
 *   - NO "Recording saved" toast fires
 *   - NO source:drop fires (the broken file must not reach ingest)
 *   - a distinct recording_stop_zero_bytes diagnostic fires
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeCaptureStopMock = vi.fn();
const saveMediaRecordingMock = vi.fn();
const startMediaCaptureMock = vi.fn();
const busEmitMock = vi.fn();
const lcDiagMock = vi.fn();

vi.mock("./nativeCapture", () => ({
  nativeCaptureListTargets: vi.fn(async () => []),
  nativeCaptureRequestPermission: vi.fn(async () => true),
  nativeCaptureStart: vi.fn(),
  nativeCaptureStop: (...args: unknown[]) => nativeCaptureStopMock(...args),
  nativeCaptureSupportStatus: vi.fn(async () => ({ supported: true, hasPermission: true })),
  saveMediaRecording: (...args: unknown[]) => saveMediaRecordingMock(...args),
}));
vi.mock("./mediaCapture", () => ({
  startMediaCapture: (...args: unknown[]) => startMediaCaptureMock(...args),
}));
vi.mock("../../bridge", () => ({
  bus: { emit: (...args: unknown[]) => busEmitMock(...args) },
}));
vi.mock("../../../lib/diagnosticLogger", () => ({
  lcDiag: (...args: unknown[]) => lcDiagMock(...args),
}));

// Single static import — NOT re-imported per test. Dynamic re-import
// combined with vi.resetModules() was creating a second, disconnected
// useRecordingState singleton per test (the module under test would
// read/write a fresh store instance the test's own state manipulation
// never touched) — a test-harness bug, not a production one.
import { useRecordingState } from "../../state/useRecordingState";
import { startCameraRecording, stopRecording } from "./recordingController";

beforeEach(() => {
  nativeCaptureStopMock.mockReset();
  saveMediaRecordingMock.mockReset();
  startMediaCaptureMock.mockReset();
  busEmitMock.mockReset();
  lcDiagMock.mockReset();
  useRecordingState.getState().reset();
});

describe("recordingController · zero-byte stop (screen lane)", () => {
  it("sets an honest error, returns to idle, and never fires source:drop when the encoder wrote 0 bytes", async () => {
    const s = useRecordingState.getState();
    s.setStatus("active");
    s.setSession("sess-1", Date.now());
    s.setTarget("scap-target-0", "Display 1");

    nativeCaptureStopMock.mockResolvedValue({
      sessionId: "sess-1",
      durationMs: 5000,
      outputPath: "/Users/mac/LiquidClips/recordings/sess-1.mp4",
      outputBytes: 0,
    });

    await stopRecording();

    expect(useRecordingState.getState().status).toBe("idle");
    expect(useRecordingState.getState().lastError).toMatch(/no file|zero bytes|ffmpeg/i);

    const emittedKinds = busEmitMock.mock.calls.map((c) => c[0]);
    expect(emittedKinds).not.toContain("source:drop");
    const speakCalls = busEmitMock.mock.calls.filter((c) => c[0] === "kade:speak");
    expect(speakCalls.some((c) => /saved to/i.test(c[1]?.body ?? ""))).toBe(false);
    expect(speakCalls.some((c) => c[1]?.title === "Recording failed to save")).toBe(true);

    const diagEvents = lcDiagMock.mock.calls.map((c) => c[0]);
    expect(diagEvents).toContain("recording_stop_zero_bytes");
  });

  it("still behaves correctly (saved + source:drop) for a real, non-empty file — proves the check doesn't false-positive", async () => {
    const s = useRecordingState.getState();
    s.setStatus("active");
    s.setSession("sess-2", Date.now());
    s.setTarget("scap-target-0", "Display 1");

    nativeCaptureStopMock.mockResolvedValue({
      sessionId: "sess-2",
      durationMs: 5000,
      outputPath: "/Users/mac/LiquidClips/recordings/sess-2.mp4",
      outputBytes: 1_234_567,
    });

    await stopRecording();

    const emittedKinds = busEmitMock.mock.calls.map((c) => c[0]);
    expect(emittedKinds).toContain("source:drop");
    const dropCall = busEmitMock.mock.calls.find((c) => c[0] === "source:drop");
    expect(dropCall?.[1]).toEqual({ paths: ["/Users/mac/LiquidClips/recordings/sess-2.mp4"] });
    expect(useRecordingState.getState().lastRecordingPath).toBe(
      "/Users/mac/LiquidClips/recordings/sess-2.mp4",
    );
  });
});

describe("recordingController · zero-byte stop (camera lane)", () => {
  it("sets an honest error, returns to idle, and never fires source:drop when MediaRecorder returned an empty blob", async () => {
    startMediaCaptureMock.mockResolvedValue({
      stream: {} as MediaStream,
      stop: vi.fn(async () => ({
        blob: new Blob([]),
        mimeType: "video/webm",
        durationMs: 3000,
      })),
      cancel: vi.fn(),
    });
    saveMediaRecordingMock.mockResolvedValue({
      outputPath: "/Users/mac/LiquidClips/recordings/cam-1.webm",
      outputBytes: 0,
    });

    await startCameraRecording(undefined, false);
    expect(useRecordingState.getState().status).toBe("active");

    await stopRecording();

    expect(useRecordingState.getState().status).toBe("idle");
    expect(useRecordingState.getState().lastError).toMatch(/no bytes|empty blob|zero/i);

    const emittedKinds = busEmitMock.mock.calls.map((c) => c[0]);
    expect(emittedKinds).not.toContain("source:drop");
    const speakCalls = busEmitMock.mock.calls.filter((c) => c[0] === "kade:speak");
    expect(speakCalls.some((c) => c[1]?.title === "Recording failed to save")).toBe(true);

    const diagEvents = lcDiagMock.mock.calls.map((c) => c[0]);
    expect(diagEvents).toContain("recording_stop_zero_bytes");
  });

  it("still behaves correctly (saved + source:drop) for a real, non-empty camera recording", async () => {
    startMediaCaptureMock.mockResolvedValue({
      stream: {} as MediaStream,
      stop: vi.fn(async () => ({
        blob: new Blob(["fake-video-bytes"]),
        mimeType: "video/webm",
        durationMs: 4000,
      })),
      cancel: vi.fn(),
    });
    saveMediaRecordingMock.mockResolvedValue({
      outputPath: "/Users/mac/LiquidClips/recordings/cam-2.webm",
      outputBytes: 987_654,
    });

    await startCameraRecording(undefined, true);
    await stopRecording();

    const emittedKinds = busEmitMock.mock.calls.map((c) => c[0]);
    expect(emittedKinds).toContain("source:drop");
    expect(useRecordingState.getState().lastRecordingPath).toBe(
      "/Users/mac/LiquidClips/recordings/cam-2.webm",
    );
  });
});
