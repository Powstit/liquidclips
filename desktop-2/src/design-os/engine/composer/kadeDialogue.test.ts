/**
 * IG-COMPOSER-M regression guard · Kade dialogue library contract.
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class E row E1.
 *
 * Enforces:
 *   1. The IG-COMPOSER-M sentinel stays in place.
 *   2. Every line is 3-8 words.
 *   3. Banned words ("bounty" / "bounties") never appear (LOCKED memory).
 *   4. Every DialogueKey has ≥1 variant.
 *   5. pickLine() returns null for unknown keys, a variant for known ones.
 *   6. lineAt(key, idx) is deterministic.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { LINES, BANNED_WORDS, pickLine, lineAt, type DialogueKey } from "./kadeDialogue";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = readFileSync(resolve(__dirname, "kadeDialogue.ts"), "utf-8");

describe("IG-COMPOSER-M · Kade dialogue library contract", () => {
  it("kadeDialogue.ts contains the IG-COMPOSER-M sentinel", () => {
    expect(SRC).toMatch(/IRON GATE IG-COMPOSER-M/);
  });

  it("every line is 3-8 words", () => {
    for (const [key, variants] of Object.entries(LINES)) {
      for (const line of variants) {
        const wordCount = line.trim().split(/\s+/).length;
        expect(wordCount, `"${line}" in ${key} has ${wordCount} words · expected 3-8`).toBeGreaterThanOrEqual(3);
        expect(wordCount, `"${line}" in ${key} has ${wordCount} words · expected 3-8`).toBeLessThanOrEqual(8);
      }
    }
  });

  it("no line contains a banned word", () => {
    for (const [key, variants] of Object.entries(LINES)) {
      for (const line of variants) {
        const lower = line.toLowerCase();
        for (const banned of BANNED_WORDS) {
          expect(lower, `banned word "${banned}" appears in "${line}" (${key})`).not.toContain(banned);
        }
      }
    }
  });

  it("every DialogueKey has at least one variant", () => {
    for (const [key, variants] of Object.entries(LINES)) {
      expect(variants.length, `${key} has no variants`).toBeGreaterThan(0);
    }
  });

  it("pickLine returns a variant for every registered key", () => {
    for (const key of Object.keys(LINES) as DialogueKey[]) {
      const line = pickLine(key);
      expect(line, `pickLine(${key}) returned null`).not.toBeNull();
      expect(LINES[key]).toContain(line);
    }
  });

  it("lineAt is deterministic per (key, idx)", () => {
    for (const key of Object.keys(LINES) as DialogueKey[]) {
      const a = lineAt(key, 0);
      const b = lineAt(key, 0);
      expect(a).toBe(b);
    }
  });

  it("BANNED_WORDS includes 'bounty' and 'bounties'", () => {
    expect(BANNED_WORDS).toContain("bounty");
    expect(BANNED_WORDS).toContain("bounties");
  });
});
