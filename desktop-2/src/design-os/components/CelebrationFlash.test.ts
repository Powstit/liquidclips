/**
 * IG-COMPOSER-O regression guard · Celebration flash contract.
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class E row E3.
 *
 * Enforces:
 *   1. The IG-COMPOSER-O sentinel stays in place.
 *   2. Listens for the "composer:celebrate" bus event.
 *   3. Renders POSES.celebration at 240×240.
 *   4. Auto-hides after ~800 ms.
 *   5. CSS respects prefers-reduced-motion.
 *   6. The bus event schema includes "composer:celebrate".
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const COMPONENT = readFileSync(resolve(__dirname, "CelebrationFlash.tsx"), "utf-8");
const STYLES = readFileSync(resolve(__dirname, "CelebrationFlash.css"), "utf-8");
const EVENTS = readFileSync(resolve(__dirname, "..", "bridge", "events.ts"), "utf-8");

describe("IG-COMPOSER-O · Celebration flash contract", () => {
  it("CelebrationFlash.tsx carries the IG-COMPOSER-O sentinel", () => {
    expect(COMPONENT).toMatch(/IRON GATE IG-COMPOSER-O/);
  });

  it("listens for the composer:celebrate bus event", () => {
    expect(COMPONENT).toMatch(/useEvent\(\s*["']composer:celebrate["']/);
  });

  it("renders POSES.celebration (never a hardcoded asset path)", () => {
    expect(COMPONENT).toMatch(/POSES\.celebration/);
    // Reject a hardcoded /brand/kade path outside the registry.
    expect(COMPONENT).not.toMatch(/["'`]\/brand\/kade\/kade-celebration/);
  });

  it("renders at 240×240", () => {
    expect(COMPONENT).toMatch(/width=\{240\}/);
    expect(COMPONENT).toMatch(/height=\{240\}/);
  });

  it("uses an ~800 ms flash window", () => {
    expect(COMPONENT).toMatch(/FLASH_DURATION_MS\s*=\s*800/);
  });

  it("CSS respects prefers-reduced-motion", () => {
    expect(STYLES).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  it("events.ts declares the composer:celebrate schema", () => {
    expect(EVENTS).toMatch(/"composer:celebrate":\s*Record<string,\s*never>/);
  });
});
