/**
 * IG-COCKPIT-SCREEN-RECORDING · Vitest regression.
 *
 * Verifies the screen-recording contract stays intact:
 *   1. useRecordingState exposes the four-status enum.
 *   2. recordingController exports start / stop / toggle.
 *   3. Controller routes IPC through nativeCapture (no raw invoke).
 *   4. ComposerSuiteFrame pushes recording state + wires F2 hotkey.
 *   5. handleUserAction has record.source + record.stop + record.toggle.
 *   6. composer-suite.html implements Wheel 9 for the REC pill.
 *   7. Dispatch readback reports REC pill visible + text.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const STORE = readFileSync(
  resolve(__dirname, "../../state/useRecordingState.ts"),
  "utf-8",
);
const CTRL = readFileSync(
  resolve(__dirname, "./recordingController.ts"),
  "utf-8",
);
const COPY_MAP = readFileSync(
  resolve(__dirname, "../../copy/copyMap.ts"),
  "utf-8",
);
const FRAME = readFileSync(
  resolve(__dirname, "../../routes/ComposerSuiteFrame.tsx"),
  "utf-8",
);
const MOCKUP = readFileSync(
  resolve(__dirname, "../../../../public/mockup/composer-suite.html"),
  "utf-8",
);
const DISPATCH = readFileSync(
  resolve(__dirname, "../../../lib/remoteControlDispatch.ts"),
  "utf-8",
);

describe("Kade Cockpit screen recording · IG-COCKPIT-SCREEN-RECORDING", () => {
  it("every file carries the IG sentinel", () => {
    for (const src of [STORE, CTRL, FRAME, MOCKUP, DISPATCH]) {
      expect(src).toMatch(/IG-COCKPIT-SCREEN-RECORDING/);
    }
  });

  it("useRecordingState exposes the 4-state enum", () => {
    expect(STORE).toMatch(/"idle"/);
    expect(STORE).toMatch(/"arming"/);
    expect(STORE).toMatch(/"active"/);
    expect(STORE).toMatch(/"stopping"/);
    expect(STORE).toMatch(/export const useRecordingState/);
  });

  it("recordingController exports start / stop / toggle", () => {
    expect(CTRL).toMatch(/export async function startRecording/);
    expect(CTRL).toMatch(/export async function stopRecording/);
    expect(CTRL).toMatch(/export async function toggleRecording/);
  });

  it("controller routes through nativeCapture · no raw invoke", () => {
    expect(CTRL).toContain("nativeCaptureStart");
    expect(CTRL).toContain("nativeCaptureStop");
    // Raw invoke() is forbidden in the controller — must route through
    // the typed nativeCapture wrapper.
    expect(CTRL).not.toMatch(/\binvoke\(/);
  });

  it("stop success copy stays honest until recording auto-ingest has a file path", () => {
    // Banned overclaims — historically the copy said "Auto-clip queued"
    // AND "Recording saved" even though scap holds the capture handle
    // but the Rust module never writes an MP4 (see
    // src-tauri/src/screen_capture.rs:20-23 · "Encoding to MP4 is
    // intentionally OUT OF SCOPE"). Both phrasings deceived the user;
    // both are forbidden until the sidecar writer lands.
    expect(CTRL).not.toMatch(/Auto-clip queued/i);
    expect(COPY_MAP).not.toMatch(/Auto-clip queued/i);
    // "Recording saved" as a title claims a file exists. Ban it in the
    // stop-success emit block (CTRL). The copy map may keep it if the
    // string is only used post-encoder-ship — check separately.
    const stopBlock = CTRL.match(/stopRecording[\s\S]*?catch \(exc\)/);
    expect(stopBlock).not.toBeNull();
    expect(
      stopBlock?.[0].includes('title: "Recording saved"'),
      "The stopRecording success emit must NOT use title 'Recording saved' — no file is written today. " +
        "See IG-RECORDING-HONEST-STOP.",
    ).toBe(false);
    // Honest replacement contract: title reads "Capture stopped" (matches
    // what actually happened at the OS level) and body explicitly says
    // no file is saved to disk yet.
    expect(CTRL).toMatch(/Capture stopped/);
    expect(CTRL).toMatch(/no file saved to disk yet/);
    // Sentinel marker so a grep for the memory-locked honesty rule lands
    // on the right block.
    expect(CTRL).toMatch(/IG-RECORDING-HONEST-STOP/);
  });

  it("ComposerSuiteFrame pushes recording state to iframe", () => {
    expect(FRAME).toMatch(/recording:\s*\{/);
    expect(FRAME).toMatch(/seconds_elapsed/);
    expect(FRAME).toMatch(/target_label/);
  });

  it("F2 global hotkey handler wired in ComposerSuiteFrame", () => {
    expect(FRAME).toMatch(/e\.key\s*===\s*"F2"/);
    expect(FRAME).toMatch(/toggleRecording/);
  });

  it("handleUserAction has record.source + record.stop + record.toggle", () => {
    expect(FRAME).toContain('case "record.source"');
    expect(FRAME).toContain('case "record.stop"');
    expect(FRAME).toContain('case "record.toggle"');
  });

  it("mockup drivetrain Wheel 9 handles REC pill", () => {
    expect(MOCKUP).toMatch(/Wheel 9\s*·\s*IG-COCKPIT-SCREEN-RECORDING/);
    // Wheel 9 must read state.recording · not scattered patches.
    const wheel9 = MOCKUP.slice(
      MOCKUP.indexOf("Wheel 9"),
      MOCKUP.indexOf("Wheel 8"),
    );
    expect(wheel9).toContain("state.recording");
    expect(wheel9).toContain("rec-pill");
  });

  it("dispatch readback exposes rec_pill_visible + rec_pill_text", () => {
    expect(DISPATCH).toContain("rec_pill_visible:");
    expect(DISPATCH).toContain("rec_pill_text:");
  });

  it("state hook + controller pair share the four-state enum", () => {
    // Controller's setStatus calls must only use enum values from the store.
    const setStatusCalls = [...CTRL.matchAll(/setStatus\("([^"]+)"\)/g)].map(m => m[1]);
    const allowed = new Set(["idle", "arming", "active", "stopping"]);
    for (const s of setStatusCalls) {
      expect(allowed.has(s), `unknown status "${s}" set by controller`).toBe(true);
    }
    expect(setStatusCalls.length).toBeGreaterThan(3);
  });
});
