/**
 * IG-COMPOSER-V regression guard · Voice input contract.
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class E row E6.
 *
 * Enforces:
 *   1. IG-COMPOSER-V sentinel stays in place.
 *   2. useVoiceInput exports the expected surface.
 *   3. isWebSpeechAvailable returns false in the node test env.
 *   4. readTranscript concatenates result transcripts.
 *   5. forceSidecar path surfaces a recoverable error (not yet wired).
 *   6. Composer.tsx does NOT re-implement voice input outside this module.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { isWebSpeechAvailable, readTranscript } from "./voiceInput";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = readFileSync(resolve(__dirname, "voiceInput.ts"), "utf-8");
const COMPOSER = readFileSync(
  resolve(__dirname, "..", "..", "routes", "Composer.tsx"),
  "utf-8",
);

describe("IG-COMPOSER-V · Voice input contract", () => {
  it("voiceInput.ts contains the IG-COMPOSER-V sentinel", () => {
    expect(SRC).toMatch(/IRON GATE IG-COMPOSER-V/);
  });

  it("exports the useVoiceInput hook + helpers", () => {
    expect(SRC).toMatch(/export function useVoiceInput/);
    expect(SRC).toMatch(/export function isWebSpeechAvailable/);
    expect(SRC).toMatch(/export function readTranscript/);
  });

  it("isWebSpeechAvailable returns false in the node test env", () => {
    expect(isWebSpeechAvailable()).toBe(false);
  });

  it("readTranscript concatenates the first alternative of every result", () => {
    const event = {
      results: [
        [{ transcript: "add my reaction " }],
        [{ transcript: "to slot B" }],
      ],
    };
    expect(readTranscript(event)).toBe("add my reaction to slot B");
  });

  it("readTranscript handles malformed input gracefully", () => {
    expect(readTranscript({})).toBe("");
    expect(readTranscript(null)).toBe("");
    expect(readTranscript({ results: [] })).toBe("");
  });

  it("declares a state machine of idle · listening · transcribing · error", () => {
    expect(SRC).toMatch(/"idle"\s*\|\s*"listening"\s*\|\s*"transcribing"\s*\|\s*"error"/);
  });

  it("Composer.tsx does NOT re-implement Web Speech / MediaRecorder outside voiceInput.ts", () => {
    expect(COMPOSER).not.toMatch(/new\s+SpeechRecognition\(\)/);
    expect(COMPOSER).not.toMatch(/new\s+webkitSpeechRecognition\(\)/);
    expect(COMPOSER).not.toMatch(/new\s+MediaRecorder\(/);
  });
});
