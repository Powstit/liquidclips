/**
 * FINISH-8/9 · Home tiles for Screen Record + Kade Tutorial
 *   · superseded by IG-HOME-REDESIGN (2026-07-22)
 *
 * ORIGINAL CONTRACT (2026-07-20)
 * ------------------------------
 * Froze the wiring for two viral-flywheel entry points:
 *   1. `home-tile-6` (Screen Record) + `home-tile-7` (Kade Tutorial)
 *   2. Each tile's onClick called `setPendingComposerIntent(...)` before
 *      routing to Composer, so the Kade avatar auto-answered the intent
 *      on mount.
 *
 * NEW CONTRACT (IG-HOME-REDESIGN · 2026-07-22)
 * --------------------------------------------
 * Per `desktop-2/docs/HEURISTIC_EVAL_2026-07-22.md` the Home cockpit was
 * redesigned to the industry-standard 4-tile grid
 * (Make · Library · Earn · Community). Kade is REMOVED from Home per L4
 * (Cursor pattern) and summonable via ⌘K only. The Kade-driven Screen
 * Record + Tutorial tiles were retired from Home because:
 *
 *   - L7 · one primary action per view — Home has 4 tiles, not 7.
 *   - L4 · Kade lives on the Composer surface, not Home. Any tile that
 *          pre-queues a Kade intent must sit inside the Composer route.
 *
 * The viral-flywheel entry points still exist:
 *   - F2 hotkey remains bound in ComposerSuiteFrame.tsx.
 *   - The Composer route consumes pending intents on mount via
 *     consumePendingComposerIntent (verified below).
 *
 * The Make tile on Home (which routes to Composer) is the single Home
 * entry point into Kade-driven flows.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const COMMAND_ROOM = readFileSync(
  resolve(__dirname, "CommandRoom.tsx"),
  "utf8",
);
const COMPOSER = readFileSync(
  resolve(__dirname, "Composer.tsx"),
  "utf8",
);

describe("Home tiles · IG-HOME-REDESIGN 4-tile contract (Screen Record / Tutorial retired)", () => {
  describe("CommandRoom.tsx", () => {
    it("no longer imports setPendingComposerIntent (Home does not queue intents)", () => {
      // Under IG-HOME-REDESIGN Home only navigates; the Composer surface
      // owns intent priming. Any re-import from Home would resurrect the
      // Kade-on-Home mount pattern.
      expect(COMMAND_ROOM).not.toMatch(
        /import\s*{\s*setPendingComposerIntent\s*}/,
      );
    });

    it("does NOT mount home-tile-6 (Screen Record retired from Home surface)", () => {
      expect(COMMAND_ROOM).not.toMatch(/data-testid="home-tile-6"/);
      expect(COMMAND_ROOM).not.toMatch(/testId="home-command-screen-record"/);
    });

    it("does NOT mount home-tile-7 (Kade Tutorial retired from Home surface)", () => {
      expect(COMMAND_ROOM).not.toMatch(/data-testid="home-tile-7"/);
      expect(COMMAND_ROOM).not.toMatch(/testId="home-command-kade-tutorial"/);
    });

    it("does NOT wire goScreenRecord / goKadeTutorial (Kade-priming logic removed)", () => {
      expect(COMMAND_ROOM).not.toMatch(/goScreenRecord/);
      expect(COMMAND_ROOM).not.toMatch(/goKadeTutorial/);
    });

    it("routes the Make tile into Composer (single Home entry into Kade flows)", () => {
      expect(COMMAND_ROOM).toMatch(
        /goComposer[\s\S]{0,200}route:\s*"composer"/,
      );
    });
  });

  describe("Composer.tsx (viral-flywheel intent-consumption still lives here)", () => {
    it("imports consumePendingComposerIntent from lib", () => {
      expect(COMPOSER).toMatch(
        /import\s*{\s*consumePendingComposerIntent\s*}\s*from\s*["'][^"']*pendingComposerIntent/,
      );
    });

    it("consumes pending intent + auto-submits on mount", () => {
      // Anchor: the consume call must land inside a useEffect with an
      // empty dep array, AND the returned value must feed submitCommand
      // (via a ref to avoid dep-array churn). This assertion is loose on
      // whitespace but strict on the semantic chain.
      expect(COMPOSER).toMatch(
        /consumePendingComposerIntent\(\)[\s\S]{0,300}submitCommandRef\.current\(pending\)/,
      );
    });
  });
});
