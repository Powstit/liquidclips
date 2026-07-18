/**
 * IG-COMPOSER-I regression guard · Captions reuse contract.
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class A row A4.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PANEL_SRC = readFileSync(resolve(__dirname, "CaptionsPanel.tsx"), "utf-8");
const MODULE_PATH = resolve(__dirname, "..", "..", "cockpit", "CaptionModule.tsx");

describe("IG-COMPOSER-I · Captions reuse contract", () => {
  it("CaptionsPanel contains the IG-COMPOSER-I sentinel", () => {
    expect(PANEL_SRC).toMatch(/IRON GATE IG-COMPOSER-I/);
  });
  it("imports useCockpit from CockpitContext", () => {
    expect(PANEL_SRC).toMatch(/useCockpit[\s\S]{0,200}?CockpitContext/);
  });
  it("calls setCaption (shared write path with CaptionModule)", () => {
    expect(PANEL_SRC).toMatch(/setCaption\(/);
    expect(PANEL_SRC).not.toMatch(/useCaptionStore|setBespokeCaption/);
  });
  it("CaptionModule.tsx still exists (Workstation-side co-consumer)", () => {
    expect(existsSync(MODULE_PATH)).toBe(true);
  });
});
