/**
 * IG-COMPOSER-W regression guard · ComposerKade contract.
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class E row E4.
 *
 * Enforces:
 *   1. IG-COMPOSER-W sentinel stays in place.
 *   2. Listens for both "kade:move" and "kade:pose" bus events.
 *   3. Uses clampMoveDuration to honour the turbo 40ms floor.
 *   4. Renders POSES[pose] as the img src (never a hardcoded path).
 *   5. data-kade-pos attribute is written on the element for QA + tests.
 *   6. CSS respects prefers-reduced-motion.
 *   7. Composer.tsx mounts <ComposerKade /> and emits at least one moveKade call.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = readFileSync(resolve(__dirname, "ComposerKade.tsx"), "utf-8");
const CSS = readFileSync(resolve(__dirname, "ComposerKade.css"), "utf-8");
const COMPOSER = readFileSync(
  resolve(__dirname, "..", "..", "routes", "Composer.tsx"),
  "utf-8",
);

describe("IG-COMPOSER-W · ComposerKade contract", () => {
  it("ComposerKade.tsx carries the IG-COMPOSER-W sentinel", () => {
    expect(SRC).toMatch(/IRON GATE IG-COMPOSER-W/);
  });

  it("listens for kade:move via useEvent", () => {
    expect(SRC).toMatch(/useEvent\(\s*"kade:move"/);
  });

  it("listens for kade:pose via useEvent", () => {
    expect(SRC).toMatch(/useEvent\(\s*"kade:pose"/);
  });

  it("uses clampMoveDuration to honour the turbo floor", () => {
    expect(SRC).toMatch(/clampMoveDuration\(/);
  });

  it("renders POSES[pose] as the img src (no hardcoded asset path)", () => {
    expect(SRC).toMatch(/src=\{POSES\[pose\]\}/);
    expect(SRC).not.toMatch(/["'`]\/brand\/kade\/kade-/);
  });

  it("writes data-kade-pos on the element for QA + parse round-trip", () => {
    expect(SRC).toMatch(/data-kade-pos=\{dataPos\}/);
  });

  it("CSS respects prefers-reduced-motion", () => {
    expect(CSS).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  it("Composer.tsx imports moveKade and calls it at least once", () => {
    expect(COMPOSER).toMatch(/import\s*\{[^}]*moveKade[^}]*\}\s*from\s*"[^"]*\/kadeMove"/);
    expect(COMPOSER).toMatch(/moveKade\(/);
  });

  it("Composer.tsx mounts <ComposerKade />", () => {
    expect(COMPOSER).toMatch(/<ComposerKade\b/);
  });
});
