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
