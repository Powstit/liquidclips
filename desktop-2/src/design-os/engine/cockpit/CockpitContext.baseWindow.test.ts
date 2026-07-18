/**
 * IG-COMPOSER-E regression guard · locks the Composer session
 * persistence contract on CockpitContext.tsx so old clips keep
 * loading + new Composer writes keep round-tripping through the
 * per-clip localStorage store.
 *
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class A row A10.
 *
 * Root failure this guard prevents: making baseWindow non-optional (or
 * removing it) silently corrupts every v0.7-era clip entry on open ·
 * dropping the setBaseWindow → clipSettingsStore.write wiring means
 * Composer commands look like they persist but don't.
 *
 * Runs under vitest.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CTX_SRC = readFileSync(resolve(__dirname, "CockpitContext.tsx"), "utf-8");

describe("IG-COMPOSER-E · Composer session persistence contract", () => {
  it("CockpitContext.tsx contains the IG-COMPOSER-E iron gate sentinel", () => {
    expect(CTX_SRC).toMatch(/IRON GATE IG-COMPOSER-E/);
  });

  it("ComposerBaseWindow interface is exported", () => {
    expect(CTX_SRC).toMatch(/export interface ComposerBaseWindow \{/);
  });

  it("every ComposerBaseWindow field is optional (`?:`)", () => {
    // Extract the interface body between the open brace and the next
    // top-level closing brace on its own line.
    const start = CTX_SRC.indexOf("export interface ComposerBaseWindow {");
    expect(start).toBeGreaterThan(-1);
    const end = CTX_SRC.indexOf("\n}\n", start);
    expect(end).toBeGreaterThan(start);
    const body = CTX_SRC.slice(start, end);
    // Every field declaration line inside must include `?:`. Grab lines
    // that look like `  <name>?: <type>;` (ignore comments + blank).
    const fieldLines = body
      .split(/\r?\n/)
      .filter((l) => /^\s{2}[a-zA-Z_][a-zA-Z0-9_]*\s*[?:]/.test(l));
    expect(fieldLines.length).toBeGreaterThan(5);
    for (const line of fieldLines) {
      // Every field MUST have the optional marker · non-optional lines
      // trip this guard.
      expect(line).toMatch(/[a-zA-Z_][a-zA-Z0-9_]*\?:/);
    }
  });

  it("CockpitSettings includes `baseWindow?: ComposerBaseWindow`", () => {
    // Optionality on the parent field means legacy clip loads (v0.7-era)
    // that lack the key spread cleanly · reverting to non-optional
    // reintroduces the crash-on-legacy-open failure.
    expect(CTX_SRC).toMatch(/baseWindow\?:\s*ComposerBaseWindow/);
  });

  it("seedFor merges saved.baseWindow over the default empty object", () => {
    // The merge is what makes A10 real · dropping either side of the
    // spread silently wipes user state on the next clip switch.
    expect(CTX_SRC).toMatch(
      /baseWindow:\s*\{[\s\S]{0,100}?base\.baseWindow[\s\S]{0,100}?saved\.baseWindow[\s\S]{0,100}?\}/,
    );
  });

  it("setBaseWindow setter is exposed on CockpitContextValue", () => {
    expect(CTX_SRC).toMatch(/setBaseWindow:\s*\(next:\s*Partial<ComposerBaseWindow>\)/);
  });

  it("setBaseWindow wires through the patch() helper (clipSettingsStore.write)", () => {
    // The patch() helper is the ONLY path that writes to
    // clipSettingsStore · adding a bespoke setter that skips patch
    // breaks the "write-through" invariant.
    expect(CTX_SRC).toMatch(/setBaseWindow:\s*\(n\)\s*=>\s*patch\("baseWindow",\s*n\)/);
  });

  it("clipSettingsStore.write receives the section payload", () => {
    // Guard against a refactor that pushes the whole cockpit state
    // through write · the section-scoped write is what protects
    // unrelated stored sections from a partial edit.
    expect(CTX_SRC).toMatch(
      /clipSettingsStore\.write\(\s*slug,\s*clip\.idx,\s*\{[\s\S]{0,80}?\}\s*as\s+Partial<CockpitSettings>/,
    );
  });
});
