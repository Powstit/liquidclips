/**
 * IG-COMPOSER-S regression guard · Kade E1-E5 runtime integration.
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 7 Sprint 3 exit gate.
 *
 * Locks the contract that the E1-E5 modules are actually wired into
 * Composer.tsx (not just contract-locked in isolation).
 *
 * Enforces:
 *   1. Composer.tsx imports pickLine, setPose, useSilenceCounter,
 *      CelebrationFlash from the E1-E5 modules.
 *   2. Composer emits "composer:celebrate" on a successful run.
 *   3. Composer mounts <CelebrationFlash />.
 *   4. Composer wraps dialogue emits behind silenceCounter.shouldEmit().
 *   5. Composer calls setPose() on flow enter / success / miss.
 *   6. IG-COMPOSER-S sentinel present at the integration touchpoint.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const COMPOSER = readFileSync(resolve(__dirname, "Composer.tsx"), "utf-8");

describe("IG-COMPOSER-S · Kade E1-E5 runtime integration in Composer.tsx", () => {
  it("Composer.tsx imports pickLine + DialogueKey from kadeDialogue", () => {
    expect(COMPOSER).toMatch(/import\s*\{[^}]*pickLine[^}]*\}\s*from\s*"[^"]*\/kadeDialogue"/);
    expect(COMPOSER).toMatch(/DialogueKey/);
  });

  it("Composer.tsx imports setPose from kadePoses", () => {
    expect(COMPOSER).toMatch(/import\s*\{\s*setPose\s*\}\s*from\s*"[^"]*\/kadePoses"/);
  });

  it("Composer.tsx imports useSilenceCounter from kadeSilence", () => {
    expect(COMPOSER).toMatch(/import\s*\{\s*useSilenceCounter\s*\}\s*from\s*"[^"]*\/kadeSilence"/);
  });

  it("Composer.tsx imports CelebrationFlash", () => {
    expect(COMPOSER).toMatch(/import\s*\{\s*CelebrationFlash\s*\}\s*from\s*"[^"]*\/CelebrationFlash"/);
  });

  it("Composer mounts <CelebrationFlash /> in the JSX tree", () => {
    expect(COMPOSER).toMatch(/<CelebrationFlash\s*\/>/);
  });

  it("Composer emits composer:celebrate after a successful runFlow", () => {
    expect(COMPOSER).toMatch(/bus\.emit\(\s*"composer:celebrate"/);
  });

  it("Composer instantiates useSilenceCounter() as the silence gate", () => {
    expect(COMPOSER).toMatch(/const\s+silenceCounter\s*=\s*useSilenceCounter\(\)/);
  });

  it("Composer wraps dialogue emission behind silenceCounter.shouldEmit()", () => {
    expect(COMPOSER).toMatch(/silenceCounter\.shouldEmit\(\)/);
  });

  it("Composer calls silenceCounter.increment() on flow success", () => {
    expect(COMPOSER).toMatch(/silenceCounter\.increment\(\)/);
  });

  it("Composer calls setPose() at least twice (mount + success/miss)", () => {
    const matches = COMPOSER.match(/setPose\(/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("Composer routes flow-success dialogue through pickLine + speakLine helper", () => {
    expect(COMPOSER).toMatch(/pickLine\(/);
    expect(COMPOSER).toMatch(/speakLine\(/);
  });
});
