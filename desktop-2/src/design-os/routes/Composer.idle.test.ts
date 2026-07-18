/**
 * IG-COMPOSER-F regression guard · locks the Composer idle canvas
 * contract. On fresh mount the canvas is blank until Kade acts.
 *
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class A row A11.
 *
 * Root failure this guard prevents: widening the canvasLoaded predicate
 * to include hydration / mount / session-ready signals silently
 * materialises the reel chrome BEFORE Kade acts · breaks the
 * "AI brings the content" theme Daniel locked 2026-07-18.
 *
 * Runs under vitest.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const COMPOSER_SRC = readFileSync(resolve(__dirname, "Composer.tsx"), "utf-8");
const COMPOSER_CSS = readFileSync(resolve(__dirname, "Composer.css"), "utf-8");

describe("IG-COMPOSER-F · Idle canvas contract", () => {
  it("Composer.tsx contains the IG-COMPOSER-F iron gate sentinel", () => {
    expect(COMPOSER_SRC).toMatch(/IRON GATE IG-COMPOSER-F/);
  });

  it("canvasLoaded derives from exactly activeFlow + askQueue", () => {
    // Widening the predicate is the specific regression the sentinel
    // forbids. Anchor the exact expression to catch drift.
    expect(COMPOSER_SRC).toMatch(
      /const\s+canvasLoaded\s*=\s*runtime\.activeFlow\s*!==\s*null\s*\|\|\s*!!runtime\.askQueue\s*;/,
    );
  });

  it("canvasAsking derives strictly from runtime.askQueue truthiness", () => {
    expect(COMPOSER_SRC).toMatch(
      /const\s+canvasAsking\s*=\s*!!runtime\.askQueue\s*;/,
    );
  });

  it("data-canvas-loaded attribute is applied on the .lc-composer root", () => {
    // The attribute MUST live on the SAME element that carries the
    // `lc-composer` class · CSS descendant selectors depend on it.
    expect(COMPOSER_SRC).toMatch(
      /className="lc-composer"[\s\S]{0,400}?data-canvas-loaded=\{canvasLoaded/,
    );
  });

  it("data-canvas-asking attribute is applied on the .lc-composer root", () => {
    expect(COMPOSER_SRC).toMatch(
      /className="lc-composer"[\s\S]{0,400}?data-canvas-asking=\{canvasAsking/,
    );
  });

  it("CSS has a rule keyed on data-canvas-loaded=\"false\"", () => {
    // The initial state must be visually observable · without a rule
    // for false-state the "blank canvas" theme is not enforced by the
    // stylesheet.
    expect(COMPOSER_CSS).toMatch(/data-canvas-loaded="false"/);
  });

  it("initial state IS false · runtime.activeFlow starts as null in INITIAL_RUNTIME", () => {
    // Confirm the reducer initial state so `canvasLoaded` starts false
    // on mount.
    expect(COMPOSER_SRC).toMatch(/INITIAL_RUNTIME[\s\S]{0,600}?activeFlow:\s*null/);
    expect(COMPOSER_SRC).toMatch(/INITIAL_RUNTIME[\s\S]{0,600}?askQueue:\s*null/);
  });
});
