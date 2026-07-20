/**
 * FINISH-8/9 · Home tiles for Screen Record + Kade Tutorial
 *
 * Freezes the wiring for the two viral-flywheel entry points Daniel
 * asked for (2026-07-20). Verifies:
 *
 *   1. CommandRoom.tsx renders `home-tile-6` (Screen Record) and
 *      `home-tile-7` (Kade Tutorial) testIds.
 *   2. Both tiles have onClick handlers that call
 *      `setPendingComposerIntent(...)` before navigating.
 *   3. Composer.tsx imports + consumes the pending intent buffer on
 *      mount and auto-submits via submitCommand.
 *
 * Missing any of these = a future refactor silently broke the F2 viral
 * flywheel per locked memory `liquid_clips_tool_is_the_content_flywheel`.
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

describe("FINISH-8/9 · Home tiles route to Composer with auto-fire intent", () => {
  describe("CommandRoom.tsx", () => {
    it("imports setPendingComposerIntent from lib", () => {
      expect(COMMAND_ROOM).toMatch(
        /import\s*{\s*setPendingComposerIntent\s*}\s*from\s*["'][^"']*pendingComposerIntent/,
      );
    });

    it("has home-tile-6 with data-testid Screen Record", () => {
      expect(COMMAND_ROOM).toMatch(/data-testid="home-tile-6"/);
      expect(COMMAND_ROOM).toMatch(/testId="home-command-screen-record"/);
    });

    it("has home-tile-7 with data-testid Kade Tutorial", () => {
      expect(COMMAND_ROOM).toMatch(/data-testid="home-tile-7"/);
      expect(COMMAND_ROOM).toMatch(/testId="home-command-kade-tutorial"/);
    });

    it("Screen Record onClick queues `record my screen` intent", () => {
      expect(COMMAND_ROOM).toMatch(
        /goScreenRecord[\s\S]{0,200}setPendingComposerIntent\(["']record my screen["']\)/,
      );
    });

    it("Kade Tutorial onClick queues `record tutorial` intent", () => {
      expect(COMMAND_ROOM).toMatch(
        /goKadeTutorial[\s\S]{0,200}setPendingComposerIntent\(["']record tutorial["']\)/,
      );
    });
  });

  describe("Composer.tsx", () => {
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
