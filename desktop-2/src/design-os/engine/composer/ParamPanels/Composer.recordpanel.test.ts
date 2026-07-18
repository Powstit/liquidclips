/**
 * IG-COMPOSER-II regression guard · Record source contract (end-to-end).
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class D.
 *
 * Enforces:
 *   1. IG-COMPOSER-II sentinel stays in place.
 *   2. RecordPanel imports the real capture APIs (mediaCapture +
 *      nativeCapture) · no more "Agent 3 wires this later" placeholder.
 *   3. Every source-tile click routes to startMediaCapture / nativeCaptureStart.
 *   4. REC pill + Stop button + preview render when a session is active.
 *   5. onPick emits the recording payload on stop so Composer's runtime
 *      reducer can persist the take.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = readFileSync(resolve(__dirname, "RecordPanel.tsx"), "utf-8");

describe("IG-COMPOSER-II · Record source contract (end-to-end)", () => {
  it("RecordPanel.tsx carries the IG-COMPOSER-II sentinel", () => {
    expect(SRC).toMatch(/IRON GATE IG-COMPOSER-II/);
  });

  it("imports startMediaCapture from mediaCapture", () => {
    expect(SRC).toMatch(/startMediaCapture/);
    expect(SRC).toMatch(/from\s+"\.\.\/mediaCapture"/);
  });

  it("imports nativeCaptureStart + nativeCaptureStop from nativeCapture", () => {
    expect(SRC).toMatch(/nativeCaptureStart/);
    expect(SRC).toMatch(/nativeCaptureStop/);
    expect(SRC).toMatch(/from\s+"\.\.\/nativeCapture"/);
  });

  it("does NOT retain the 'Agent 3 wires it later' placeholder comment", () => {
    expect(SRC).not.toMatch(/Agent 3 wires it to the actual sidecar RPC/);
  });

  it("routes camera to startMediaCapture({ video: true", () => {
    expect(SRC).toMatch(/startMediaCapture\(\s*\{\s*video:\s*true/);
  });

  it("routes display / window / screen-audio to nativeCaptureStart", () => {
    expect(SRC).toMatch(/nativeCaptureStart\(\s*sessionId\s*\)/);
  });

  it("renders REC pill + Stop button + preview <video>", () => {
    expect(SRC).toMatch(/data-testid="composer-record-pill"/);
    expect(SRC).toMatch(/data-testid="composer-record-stop"/);
    expect(SRC).toMatch(/data-testid="composer-record-preview"/);
  });

  it("onPick emits a recording payload on stop", () => {
    expect(SRC).toMatch(/onPick\(\s*"recording"/);
    expect(SRC).toMatch(/previewUrl:/);
    expect(SRC).toMatch(/durationMs:/);
  });
});
