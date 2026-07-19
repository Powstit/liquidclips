/**
 * IG-COMPOSER-TUT regression guard · Tutorial mode wire (2026-07-19)
 *
 * Locks the "Tool IS the content" flywheel contract:
 *
 *   1. Tutorial tile click fires the sidecar `screen_recording_start`
 *      RPC (single-lane · no camera · matches the reactionRecord.ts
 *      pattern but without the camera lane).
 *   2. Tutorial stop fires `screen_recording_stop` and emits the
 *      `composer:tutorial-recorded` + `tutorial:active: false` bus
 *      events so downstream consumers (auto-suggest clips, marketing
 *      pipeline) get the output path.
 *   3. On-screen watermark component `TutorialWatermarkOverlay` mounts
 *      when `tutorial:active === true` and renders the referral URL.
 *   4. The stub `return;` at the old RecordPanel.tsx branch is gone —
 *      any diff that reintroduces it (accidentally reverting) fails.
 *
 * Runs under vitest.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PANEL_SRC = readFileSync(
  resolve(__dirname, "ParamPanels", "RecordPanel.tsx"),
  "utf-8",
);
const EVENTS_SRC = readFileSync(
  resolve(__dirname, "..", "..", "bridge", "events.ts"),
  "utf-8",
);
const OVERLAY_SRC = readFileSync(
  resolve(__dirname, "..", "..", "components", "TutorialWatermarkOverlay.tsx"),
  "utf-8",
);
const APPSHELL_SRC = readFileSync(
  resolve(__dirname, "..", "..", "components", "AppShell.tsx"),
  "utf-8",
);

describe("IG-COMPOSER-TUT · Tutorial recording contract", () => {
  it("RecordPanel carries the IG-COMPOSER-TUT sentinel", () => {
    expect(PANEL_SRC).toMatch(/IRON GATE IG-COMPOSER-TUT/);
  });

  it("Tutorial tile calls sidecarCall(screen_recording_start) with audio_index null", () => {
    const tutorialIdx = PANEL_SRC.indexOf('source === "tutorial"');
    expect(tutorialIdx).toBeGreaterThan(-1);
    // Take the tutorial branch's body and confirm the RPC + shape.
    const tutorialBlock = PANEL_SRC.slice(tutorialIdx, tutorialIdx + 3000);
    expect(tutorialBlock).toMatch(/sidecarCall<[^>]*>\(\s*"screen_recording_start"/);
    // Single-lane · no camera · null audio_index (mic handled by other
    // tiles when the clipper wants mic).
    expect(tutorialBlock).toMatch(/audio_index:\s*null/);
    // Screen index 1 = default main display.
    expect(tutorialBlock).toMatch(/screen_index:\s*1/);
  });

  it("Tutorial tile is NOT a return-only stub anymore", () => {
    // Old bug: RecordPanel.tsx had `if (source === "tutorial") { return; }`
    // as the entire branch. The wire must not regress to that.
    expect(PANEL_SRC).not.toMatch(/if \(source === "tutorial"\) \{\s*return;\s*\}/);
  });

  it("Tutorial start emits tutorial:active(true) + kade:speak", () => {
    const tutorialIdx = PANEL_SRC.indexOf('source === "tutorial"');
    const tutorialBlock = PANEL_SRC.slice(tutorialIdx, tutorialIdx + 3500);
    expect(tutorialBlock).toMatch(/bus\.emit\(\s*"tutorial:active"/);
    expect(tutorialBlock).toMatch(/active:\s*true/);
    expect(tutorialBlock).toMatch(/bus\.emit\(\s*"kade:speak"/);
  });

  it("stopSession() dispatches sidecar screen_recording_stop for the tutorial kind", () => {
    // Not the reaction path (that has its own stop). The generic
    // stopSession must handle the tutorial branch cleanly.
    expect(PANEL_SRC).toMatch(/session\.kind === "tutorial"/);
    expect(PANEL_SRC).toMatch(/sidecarCall<[^>]*>\(\s*"screen_recording_stop"/);
  });

  it("onStop emits composer:tutorial-recorded + tutorial:active(false)", () => {
    const onStopIdx = PANEL_SRC.indexOf("const onStop");
    const onStopBlock = PANEL_SRC.slice(onStopIdx, onStopIdx + 4000);
    expect(onStopBlock).toMatch(/active\.kind === "tutorial"/);
    expect(onStopBlock).toMatch(/bus\.emit\(\s*"tutorial:active"[\s\S]*?active:\s*false/);
    expect(onStopBlock).toMatch(/bus\.emit\(\s*"composer:tutorial-recorded"/);
  });
});

describe("IG-COMPOSER-TUT · event registry declarations", () => {
  it("events.ts declares tutorial:active with active + output_path fields", () => {
    expect(EVENTS_SRC).toMatch(/"tutorial:active":\s*\{[\s\S]*?active:\s*boolean[\s\S]*?output_path:\s*string\s*\|\s*null/);
  });

  it("events.ts declares composer:tutorial-recorded with output_path + duration_ms", () => {
    expect(EVENTS_SRC).toMatch(/"composer:tutorial-recorded":\s*\{[\s\S]*?output_path:\s*string\s*\|\s*null[\s\S]*?duration_ms:\s*number/);
  });
});

describe("IG-COMPOSER-TUT · on-screen watermark overlay", () => {
  it("TutorialWatermarkOverlay subscribes to tutorial:active", () => {
    expect(OVERLAY_SRC).toMatch(/bus\.on\(\s*"tutorial:active"/);
  });

  it("overlay renders liquidclips.app/r/{handle} watermark text", () => {
    expect(OVERLAY_SRC).toMatch(/liquidclips\.app\/r\//);
    expect(OVERLAY_SRC).toMatch(/me\.snapshot\?\.handle/);
  });

  it("overlay renders null when inactive · zero baseline drift", () => {
    // Regression guard: overlay MUST early-return null when active
    // is false so screen recordings started from OTHER tiles (Reaction /
    // Display / etc.) never accidentally get the tutorial watermark.
    expect(OVERLAY_SRC).toMatch(/if \(!active\) return null/);
  });

  it("overlay has pointer-events: none so it never steals clicks", () => {
    expect(OVERLAY_SRC).toMatch(/pointerEvents:\s*"none"/);
  });

  it("AppShell mounts <TutorialWatermarkOverlay />", () => {
    expect(APPSHELL_SRC).toMatch(/import\s*\{\s*TutorialWatermarkOverlay\s*\}/);
    expect(APPSHELL_SRC).toMatch(/<TutorialWatermarkOverlay\s*\/>/);
  });
});
