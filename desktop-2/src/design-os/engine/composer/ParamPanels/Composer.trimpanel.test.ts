/**
 * IG-COMPOSER-H regression guard · Trim reuse contract.
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class A row A3.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PANEL_SRC = readFileSync(resolve(__dirname, "TrimPanel.tsx"), "utf-8");
const MODULE_PATH = resolve(__dirname, "..", "..", "cockpit", "TrimModule.tsx");

describe("IG-COMPOSER-H · Trim reuse contract", () => {
  it("TrimPanel contains the IG-COMPOSER-H sentinel", () => {
    expect(PANEL_SRC).toMatch(/IRON GATE IG-COMPOSER-H/);
  });
  it("imports useCockpit from CockpitContext", () => {
    expect(PANEL_SRC).toMatch(
      /import\s*\{\s*useCockpit\s*\}\s*from\s*["']\.\.\/\.\.\/cockpit\/CockpitContext["']/,
    );
  });
  it("calls setTrim (shared write path with TrimModule)", () => {
    expect(PANEL_SRC).toMatch(/setTrim\(/);
    expect(PANEL_SRC).not.toMatch(/useTrimStore|setBespokeTrim/);
  });
  it("TrimModule.tsx still exists (Workstation-side co-consumer)", () => {
    expect(existsSync(MODULE_PATH)).toBe(true);
  });
});
