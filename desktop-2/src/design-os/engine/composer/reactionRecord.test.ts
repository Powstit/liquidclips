/**
 * IG-COMPOSER-JJ regression guard · Screen + Camera Reaction Record.
 *
 * Enforces the contract across:
 *   * reactionRecord.ts orchestrator
 *   * ReactionRecordPreview.tsx split UI
 *   * RecordPanel.tsx tile + audio-device picker
 *   * events.ts new bus channel
 *   * python-sidecar/screen_recorder.py + sidecar.py RPC dispatch
 *   * mediaCapture.ts device enumeration + deviceId support
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ORCH = readFileSync(resolve(__dirname, "reactionRecord.ts"), "utf-8");
const PREVIEW = readFileSync(resolve(__dirname, "ReactionRecordPreview.tsx"), "utf-8");
const PANEL = readFileSync(resolve(__dirname, "ParamPanels/RecordPanel.tsx"), "utf-8");
const MEDIA = readFileSync(resolve(__dirname, "mediaCapture.ts"), "utf-8");
const EVENTS = readFileSync(resolve(__dirname, "..", "..", "bridge", "events.ts"), "utf-8");
const COMPOSER = readFileSync(resolve(__dirname, "..", "..", "routes", "Composer.tsx"), "utf-8");
const SIDECAR_PY = readFileSync(
  resolve(__dirname, "..", "..", "..", "..", "..", "python-sidecar", "sidecar.py"),
  "utf-8",
);
const RECORDER_PY = readFileSync(
  resolve(__dirname, "..", "..", "..", "..", "..", "python-sidecar", "screen_recorder.py"),
  "utf-8",
);

describe("IG-COMPOSER-JJ · Screen + Camera Reaction Record contract", () => {
  it("reactionRecord.ts carries the IG-COMPOSER-JJ sentinel", () => {
    expect(ORCH).toMatch(/IRON GATE IG-COMPOSER-JJ/);
  });

  it("ReactionRecordPreview.tsx carries the IG-COMPOSER-JJ sentinel", () => {
    expect(PREVIEW).toMatch(/IRON GATE IG-COMPOSER-JJ/);
  });

  it("orchestrator starts both lanes in parallel via Promise.all", () => {
    expect(ORCH).toMatch(/Promise\.all\(/);
    expect(ORCH).toMatch(/startMediaCapture/);
    expect(ORCH).toMatch(/"screen_recording_start"/);
  });

  it("orchestrator wires the sidecar merge RPC", () => {
    expect(ORCH).toMatch(/"reaction_recording_merge"/);
  });

  it("mediaCapture supports deviceId + enumerateMediaInputs", () => {
    expect(MEDIA).toMatch(/audioDeviceId\?:\s*string/);
    expect(MEDIA).toMatch(/videoDeviceId\?:\s*string/);
    expect(MEDIA).toMatch(/export async function enumerateMediaInputs/);
    expect(MEDIA).toMatch(/deviceId:\s*\{\s*exact:\s*opts\.audioDeviceId\s*\}/);
  });

  it("RecordPanel exposes the Screen + Camera · React tile", () => {
    expect(PANEL).toMatch(/value:\s*"reaction"/);
    expect(PANEL).toMatch(/Screen \+ Camera · React/);
  });

  it("RecordPanel renders the audio input picker", () => {
    expect(PANEL).toMatch(/data-testid="composer-record-audio-device"/);
  });

  it("RecordPanel calls startReactionRecording on tile click", () => {
    expect(PANEL).toMatch(/startReactionRecording/);
  });

  it("events.ts declares the composer:reaction-preview channel", () => {
    expect(EVENTS).toMatch(/"composer:reaction-preview":\s*\{/);
    expect(EVENTS).toMatch(/stream:\s*MediaStream\s*\|\s*null/);
  });

  it("Composer.tsx mounts ReactionRecordPreview", () => {
    expect(COMPOSER).toMatch(/<ReactionRecordPreview/);
    expect(COMPOSER).toMatch(/useEvent\(\s*"composer:reaction-preview"/);
  });

  it("sidecar.py dispatches all 4 new RPC methods", () => {
    expect(SIDECAR_PY).toMatch(/"screen_recording_start":/);
    expect(SIDECAR_PY).toMatch(/"screen_recording_stop":/);
    expect(SIDECAR_PY).toMatch(/"screen_recording_list_devices":/);
    expect(SIDECAR_PY).toMatch(/"reaction_recording_merge":/);
  });

  it("screen_recorder.py uses ffmpeg avfoundation + keeps track of session Popens", () => {
    expect(RECORDER_PY).toMatch(/IRON GATE IG-COMPOSER-JJ/);
    expect(RECORDER_PY).toMatch(/"avfoundation"/);
    expect(RECORDER_PY).toMatch(/_SESSIONS/);
    expect(RECORDER_PY).toMatch(/def start_screen_recording/);
    expect(RECORDER_PY).toMatch(/def stop_screen_recording/);
    expect(RECORDER_PY).toMatch(/def merge_reaction_recording/);
  });

  it("merge_reaction_recording covers ALL 9 ReactionLayoutKey values (P1-1 fix)", () => {
    // All 9 members of ReactionLayoutKey must have an explicit branch
    // in the merge · no silent default drift. `full-overlay` was
    // added post-audit.
    for (const k of [
      "top-bottom", "side-by-side", "grid-2x2",
      "pip-tr", "pip-tl", "pip-br", "pip-bl",
      "solo", "full-overlay",
    ]) {
      expect(RECORDER_PY).toMatch(new RegExp(k));
    }
    expect(RECORDER_PY).toMatch(/force_original_aspect_ratio=increase/);
  });

  it("merge rejects unknown layouts with ValueError (P1-1 fix · no silent default)", () => {
    expect(RECORDER_PY).toMatch(/unknown reaction layout/);
    expect(RECORDER_PY).toMatch(/valid_layouts\s*=\s*\{/);
  });

  it("orchestrator does NOT pass audio_index to the screen lane (P1-2 fix)", () => {
    // WebRTC UUID vs avfoundation int addressing split eliminated · mic
    // is captured exclusively by the camera MediaRecorder lane.
    expect(ORCH).not.toMatch(/audioIndex\?:\s*number/);
    expect(ORCH).toMatch(/audio_index:\s*null/);
  });
});
