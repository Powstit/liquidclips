/**
 * CommandRoom · Home Whop CTA · superseded by IG-HOME-REDESIGN (2026-07-22).
 *
 * ORIGINAL CONTRACT (BUG-014 · Train A2 · 2026-07-12)
 * ---------------------------------------------------
 * Locked that CommandRoom mounted `<WhopStatusChip mountSite="home-hero" />`
 * inside a clipper-only `!isAgency` guard as the Whop-connect CTA hero.
 *
 * NEW CONTRACT (IG-HOME-REDESIGN · 2026-07-22)
 * --------------------------------------------
 * The Home cockpit has been redesigned to the industry-standard 4-tile
 * grid (Make · Library · Earn · Community) per
 * `desktop-2/docs/HEURISTIC_EVAL_2026-07-22.md`. Per L7 (one primary
 * action per view), the Home hero WhopStatusChip mount is removed;
 * the same chip still mounts in TopHud (persistent chrome), which is
 * the canonical writer for BC-002 across the whole app. That means
 * linked users still see nothing (chip returns null when linked) and
 * unlinked users still see the CTA — just from the persistent chrome,
 * not duplicated on Home.
 *
 * This test now:
 *   - locks that CommandRoom no longer mounts WhopStatusChip on Home
 *     (no `home-hero` variant here)
 *   - preserves the chip's canonical null-when-linked behaviour so the
 *     TopHud mount can rely on it
 *   - is co-located with the file it guards so vitest's
 *     `src/**\/*.test.ts` include picks it up
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOM_SRC = readFileSync(
  resolve(__dirname, "CommandRoom.tsx"),
  "utf-8",
);
const CHIP_SRC = readFileSync(
  resolve(__dirname, "..", "components", "WhopStatusChip.tsx"),
  "utf-8",
);

describe("CommandRoom · Home Whop CTA mount contract", () => {
  it("does NOT mount WhopStatusChip on Home (redesign moves chip to TopHud only)", () => {
    // IG-HOME-REDESIGN · L7 one primary action per view. The Home hero
    // WhopStatusChip mount is retired; the chip still lives in TopHud
    // (persistent chrome) where it is the single canonical writer for
    // BC-002. Duplicating it on Home broke L7 (two CTAs on the same
    // above-the-fold surface).
    expect(ROOM_SRC).not.toMatch(/<WhopStatusChip\s+mountSite="home-hero"/);
    expect(ROOM_SRC).not.toMatch(
      /import\s*\{\s*WhopStatusChip\s*\}\s*from\s+"\.\.\/components\/WhopStatusChip"/,
    );
  });

  it("does not hardcode a duplicate 'Connect Whop' button in the room body", () => {
    // BC-002 sweep · the CTA still flows through the single canonical
    // component (WhopStatusChip in TopHud). A hardcoded button here
    // would create a THIRD writer.
    expect(ROOM_SRC).not.toMatch(/onClick=\{[^}]*connectWhop/);
    expect(ROOM_SRC).not.toMatch(/"Connect Whop"/);
  });

  it("chip renders the linked branch as null so linked users see nothing", () => {
    // Locks the chip's self-hide contract for the linked state on
    // whichever mount is active. Together with the previous tests this
    // guarantees: linked user → the persistent-chrome CTA is absent
    // (no visual noise), and unlinked user → the CTA is present in
    // TopHud (the money surface).
    expect(CHIP_SRC).toMatch(/if \(state !== "unlinked"\) return null/);
  });

  it("chip's canonical variant sets the whop_cta telemetry topic", () => {
    // Chip emits the shared ``whop_status_chip_impression`` topic with
    // mount_site in the payload. Grep confirms the mount_site payload
    // reaches lcDiag.
    expect(CHIP_SRC).toMatch(/mount_site:\s*mountSite/);
    expect(CHIP_SRC).toMatch(/lcDiag\("whop_status_chip_impression"/);
  });
});
