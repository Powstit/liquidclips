/**
 * IG-COCKPIT-EDITOR-WIRES · Bundle 3 vitest.
 * 2026-07-22 · 2.3.37
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FRAME = readFileSync(resolve(__dirname, "./ComposerSuiteFrame.tsx"), "utf-8");
const MOCKUP = readFileSync(resolve(__dirname, "../../../public/mockup/composer-suite.html"), "utf-8");
const VOICE = readFileSync(resolve(__dirname, "../engine/composer/voiceInput.ts"), "utf-8");

describe("Bundle 3 · editor wires · IG-COCKPIT-EDITOR-WIRES", () => {
  it("all three files carry the sentinel", () => {
    for (const src of [FRAME, MOCKUP, VOICE]) {
      expect(src).toMatch(/IG-COCKPIT-EDITOR-WIRES/);
    }
  });

  it("E1 · trim.tighten dispatches sidecar.regenerateClip", () => {
    expect(FRAME).toMatch(/case "trim\.tighten"[\s\S]*?sidecar\.regenerateClip/);
  });

  it("E2 · captions.* dispatches sidecar.editCaptions", () => {
    expect(FRAME).toMatch(/case "captions\.(style|position|wpl|karaoke\.toggle)"[\s\S]*?sidecar\.editCaptions/);
  });

  it("E3 · voice.toggle calls beginOneShotVoiceCapture", () => {
    expect(FRAME).toMatch(/case "voice\.toggle"[\s\S]*?beginOneShotVoiceCapture/);
    expect(VOICE).toContain("export function beginOneShotVoiceCapture");
  });

  it("E4 · library.pick calls searchLibrary + acceptSource", () => {
    expect(FRAME).toMatch(/case "library\.pick"[\s\S]*?searchLibrary\(/);
    expect(FRAME).toMatch(/case "library\.pick"[\s\S]*?brain\.acceptSource\(\s*\{\s*url/);
  });

  it("E5 · history strip Wheel 12 in mockup drivetrain", () => {
    expect(MOCKUP).toMatch(/Wheel 12[\s\S]*?state\.history/);
    // Each chip must wire click → emitUserAction("history.repeat", …)
    expect(MOCKUP).toMatch(/emitUserAction\(\s*"history\.repeat"/);
  });

  it("history included in pushState payload + effect deps", () => {
    expect(FRAME).toMatch(/history:\s*history\.slice/);
    // Effect deps array must include history.
    expect(FRAME).toMatch(/}, \[[^\]]*history[^\]]*\]/);
  });

  it("captions fallback to utter when no activeSlug (safe default)", () => {
    // The captions case must handle activeSlug absence with utter().
    expect(FRAME).toMatch(/case "captions\.(style|position|wpl|karaoke\.toggle)":[\s\S]*?utter\(/);
  });

  it("trim.tighten falls through to utter when no activeSlug", () => {
    expect(FRAME).toMatch(/case "trim\.tighten"[\s\S]*?utter\(/);
  });
});
