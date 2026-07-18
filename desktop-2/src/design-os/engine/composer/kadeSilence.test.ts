/**
 * IG-COMPOSER-Q regression guard · Silence rule contract.
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class E row E5.
 *
 * Enforces:
 *   1. The IG-COMPOSER-Q sentinel stays in place.
 *   2. SILENCE_THRESHOLD = 5 (master plan lock).
 *   3. SILENCE_RATE = 1/3 (master plan lock).
 *   4. Below threshold, shouldEmitFor always returns true.
 *   5. At/past threshold, shouldEmitFor honours the roll vs SILENCE_RATE.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  SILENCE_THRESHOLD,
  SILENCE_RATE,
  shouldEmitFor,
} from "./kadeSilence";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = readFileSync(resolve(__dirname, "kadeSilence.ts"), "utf-8");

describe("IG-COMPOSER-Q · Silence rule contract", () => {
  it("kadeSilence.ts carries the IG-COMPOSER-Q sentinel", () => {
    expect(SRC).toMatch(/IRON GATE IG-COMPOSER-Q/);
  });

  it("SILENCE_THRESHOLD is locked at 5", () => {
    expect(SILENCE_THRESHOLD).toBe(5);
  });

  it("SILENCE_RATE is locked at 1/3", () => {
    expect(SILENCE_RATE).toBe(1 / 3);
  });

  it("below threshold, shouldEmitFor always emits regardless of roll", () => {
    for (let count = 0; count < SILENCE_THRESHOLD; count++) {
      expect(shouldEmitFor(count, 0.0)).toBe(true);
      expect(shouldEmitFor(count, 0.5)).toBe(true);
      expect(shouldEmitFor(count, 0.999)).toBe(true);
    }
  });

  it("at threshold, shouldEmitFor emits when roll < 1/3 and stays silent otherwise", () => {
    expect(shouldEmitFor(SILENCE_THRESHOLD, 0.0)).toBe(true);
    expect(shouldEmitFor(SILENCE_THRESHOLD, 0.33)).toBe(true);
    expect(shouldEmitFor(SILENCE_THRESHOLD, 0.34)).toBe(false);
    expect(shouldEmitFor(SILENCE_THRESHOLD, 0.99)).toBe(false);
  });

  it("well past threshold, the same emission rule holds (no drift)", () => {
    expect(shouldEmitFor(20, 0.1)).toBe(true);
    expect(shouldEmitFor(50, 0.9)).toBe(false);
  });
});
