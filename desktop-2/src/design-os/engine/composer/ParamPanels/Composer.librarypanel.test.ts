/**
 * IG-COMPOSER-L regression guard · Library source contract.
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class C row C1.
 *
 * Enforces that LibraryPanel:
 *   1. Carries the IG-COMPOSER-L sentinel.
 *   2. Consumes hqLibrary.searchLibrary + getLibraryHandoff + ytThumbnailUrl.
 *   3. Does NOT re-introduce the hollow-theater mock array
 *      (CELLS = [{id:"clip-01"...}] or FILTERS = ["Hormozi"...]).
 *   4. Emits onPick("librarySource", handoff) on tile click.
 *   5. Handles the 4 explicit states (idle · loading · empty · error).
 *   6. Never references the HQ hostname or the shared secret.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PANEL_SRC = readFileSync(resolve(__dirname, "LibraryPanel.tsx"), "utf-8");
const CLIENT_PATH = resolve(__dirname, "..", "..", "..", "..", "lib", "hqLibrary.ts");

describe("IG-COMPOSER-L · Library source contract", () => {
  it("LibraryPanel contains the IG-COMPOSER-L sentinel", () => {
    expect(PANEL_SRC).toMatch(/IRON GATE IG-COMPOSER-L/);
  });

  it("imports searchLibrary, getLibraryHandoff, ytThumbnailUrl from hqLibrary", () => {
    expect(PANEL_SRC).toMatch(/searchLibrary/);
    expect(PANEL_SRC).toMatch(/getLibraryHandoff/);
    expect(PANEL_SRC).toMatch(/ytThumbnailUrl/);
    expect(PANEL_SRC).toMatch(/from\s*["'][^"']*lib\/hqLibrary["']/);
  });

  it("does NOT reintroduce the fixture mock array", () => {
    // The hollow-theater array we're replacing had these exact identifiers.
    expect(PANEL_SRC).not.toMatch(/const\s+CELLS\s*=/);
    expect(PANEL_SRC).not.toMatch(/"clip-01"/);
    expect(PANEL_SRC).not.toMatch(/"clip-02"/);
    expect(PANEL_SRC).not.toMatch(/const\s+FILTERS\s*=\s*\[\s*"Hormozi"/);
  });

  it("dispatches onPick('librarySource', handoff) on tile click", () => {
    expect(PANEL_SRC).toMatch(/onPick\(\s*["']librarySource["']\s*,\s*handoff\s*\)/);
  });

  it("renders the 4 explicit states (idle · loading · empty · error)", () => {
    expect(PANEL_SRC).toMatch(/state === "loading"/);
    expect(PANEL_SRC).toMatch(/state === "empty"/);
    expect(PANEL_SRC).toMatch(/state === "error"/);
    expect(PANEL_SRC).toMatch(/state === "idle"/);
  });

  it("NEVER references the HQ hostname or shared secret", () => {
    expect(PANEL_SRC).not.toMatch(/hq\.liquidclips\.com/);
    expect(PANEL_SRC).not.toMatch(/tally-production/);
    expect(PANEL_SRC).not.toMatch(/HQ_READ_SECRET/);
    expect(PANEL_SRC).not.toMatch(/x-hq-secret/i);
  });

  it("hqLibrary.ts (the client behind this panel) still exists", () => {
    expect(() => readFileSync(CLIENT_PATH, "utf-8")).not.toThrow();
  });
});
