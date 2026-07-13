/**
 * UpdateBeacon.no-reload-wording · Wave D1 · j015-runtime-update.
 *
 * Grep guard: the word "Reload" must not appear anywhere in the
 * update sub-tree source code. Daniel proof requirement 10:
 *
 *   > No "Reload" wording that implies same-session activation while
 *   > BUG-012 remains open · replace with "Restart to continue" /
 *   > "Update ready" / "Restart now" / "Try again"
 *
 * This test file grep-asserts the constraint across:
 *   - `desktop-2/src/components/UpdateBeacon.tsx`
 *   - `desktop-2/src/design-os/update/UpdateReadyIndicator.tsx`
 *   - `desktop-2/src/design-os/update/RestartGate.tsx`
 *   - `desktop-2/src/lib/updateJourney.ts`
 *
 * If a future edit reintroduces "Reload" as a user-facing string,
 * this test fails and the CI blocks the commit.
 *
 * Notes:
 *   - Case-insensitive · we don't want "reload" to slip in either.
 *   - Word-boundary regex: `\breload\b` catches "Reload" and
 *     "reload" but not "reloader" (fine — that's not a wording).
 *   - The test file itself contains the word `Reload` as documentation.
 *     That's OK because this test does not check its own file.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILES_UNDER_GUARD = [
  "src/components/UpdateBeacon.tsx",
  "src/design-os/update/UpdateReadyIndicator.tsx",
  "src/design-os/update/RestartGate.tsx",
  "src/lib/updateJourney.ts",
];

describe("Wave D1 · grep guard · no `Reload` wording in the update sub-tree", () => {
  for (const rel of FILES_UNDER_GUARD) {
    it(`${rel} contains ZERO word-boundary "reload" matches`, () => {
      const abs = resolve(process.cwd(), rel);
      const content = readFileSync(abs, "utf-8");
      const matches = content.match(/\breload\b/gi);
      expect(
        matches,
        `${rel} still has "Reload"-family wording: ${matches?.join(", ")}. ` +
          `Replace with "Restart to continue" / "Restart now" / "Try again" per j015 §State 4.`,
      ).toBeNull();
    });
  }
});
