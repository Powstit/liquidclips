/**
 * IG-COMPOSER-G regression guard · locks the ReactionPanel reuse
 * contract so Composer keeps writing through the SAME CockpitContext
 * setter that Workstation's ReactionModule uses.
 *
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class A row A2.
 *
 * Runs under vitest.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PANEL_SRC = readFileSync(resolve(__dirname, "ReactionPanel.tsx"), "utf-8");
const MODULE_PATH = resolve(
  __dirname,
  "..",
  "..",
  "cockpit",
  "ReactionModule.tsx",
);

describe("IG-COMPOSER-G · Reaction reuse contract", () => {
  it("ReactionPanel contains the IG-COMPOSER-G iron gate sentinel", () => {
    expect(PANEL_SRC).toMatch(/IRON GATE IG-COMPOSER-G/);
  });

  it("imports useCockpit + ReactionLayoutKey from CockpitContext", () => {
    expect(PANEL_SRC).toMatch(
      /import\s*\{[\s\S]*?useCockpit[\s\S]*?ReactionLayoutKey[\s\S]*?\}\s*from\s*["']\.\.\/\.\.\/cockpit\/CockpitContext["']/,
    );
  });

  it("calls setReaction (never a bespoke setter)", () => {
    // Anti-pattern the sentinel forbids: a local `setBespokeReaction`
    // or Zustand `useReactionStore().set` bypasses the CockpitContext
    // write path · silently forks the persistence contract.
    expect(PANEL_SRC).toMatch(/setReaction\(/);
    expect(PANEL_SRC).not.toMatch(/useReactionStore/);
    expect(PANEL_SRC).not.toMatch(/setBespokeReaction/);
  });

  it("destructures setReaction from useCockpit()", () => {
    // Matches `const { ..., setReaction } = useCockpit();` OR
    // `const cockpit = useCockpit(); ... cockpit.setReaction`.
    expect(PANEL_SRC).toMatch(
      /useCockpit\(\)[\s\S]{0,200}?setReaction|setReaction[\s\S]{0,200}?useCockpit\(\)/,
    );
  });

  it("ReactionModule.tsx still exists (Workstation-side co-consumer)", () => {
    // Deleting ReactionModule would strand Workstation users · both
    // surfaces share the CockpitSettings.reaction target and the
    // shared export path.
    expect(existsSync(MODULE_PATH)).toBe(true);
  });
});
