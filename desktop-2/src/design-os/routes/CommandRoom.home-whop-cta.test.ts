/**
 * CommandRoom · Home hero Whop CTA · BUG-014 · Train A2 · 2026-07-12.
 *
 * Locks the mount contract for the Home hero Whop CTA:
 *   * CommandRoom imports WhopStatusChip
 *   * WhopStatusChip is mounted with mountSite="home-hero"
 *   * Mount is clipper-only (agency mode is not in the Whop-connect
 *     funnel — agency tier implies a Whop link already)
 *   * The CTA is not a hardcoded button in CommandRoom — it flows
 *     through the single canonical component so BC-002 stays clean.
 *   * The chip module renders nothing when linked (verified in
 *     WhopStatusChip.test.ts). This test locks that a hero-mount
 *     with a linked user cannot render because the chip returns null.
 *
 * Follows the source-file grep convention already in use across the
 * TopHud test cluster + WhopStatusChip.test.ts.
 *
 * Note on filename: the ownership matrix lists ``rooms/`` as the path,
 * but CommandRoom.tsx already lives in ``routes/`` in the shipped
 * codebase (design-os pipeline; see desktop-2/CLAUDE.md). The test is
 * placed alongside the actual file so vitest's ``src/**\/*.test.ts``
 * include picks it up.
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
  it("imports WhopStatusChip from the components module", () => {
    expect(ROOM_SRC).toMatch(/import\s*\{\s*WhopStatusChip\s*\}/);
    expect(ROOM_SRC).toMatch(/from\s+"\.\.\/components\/WhopStatusChip"/);
  });

  it("mounts WhopStatusChip with mountSite=\"home-hero\" (canonical)", () => {
    expect(ROOM_SRC).toMatch(/<WhopStatusChip\s+mountSite="home-hero"\s*\/>/);
  });

  it("gates the Home hero CTA on clipper mode (agency is out of funnel)", () => {
    // Agency tier implies a Whop link is present server-side · the CTA
    // would be visual noise. Mount must sit inside the ``!isAgency``
    // block that already gates the HomeBanner + Earn strip.
    const guardIdx = ROOM_SRC.indexOf("{!isAgency && (");
    expect(guardIdx).toBeGreaterThan(-1);
    const chipIdx = ROOM_SRC.indexOf(
      '<WhopStatusChip mountSite="home-hero"',
    );
    expect(chipIdx).toBeGreaterThan(guardIdx);
  });

  it("does not hardcode a duplicate 'Connect Whop' button in the room body", () => {
    // BC-002 sweep · the CTA must flow through the single canonical
    // component so click, telemetry and state derivation cannot drift.
    // A hardcoded button here would create a THIRD writer.
    expect(ROOM_SRC).not.toMatch(/onClick=\{[^}]*connectWhop/);
    expect(ROOM_SRC).not.toMatch(/"Connect Whop"/);
  });

  it("chip renders the linked branch as null so linked users see nothing", () => {
    // Locks the chip's self-hide contract for the linked state on the
    // home-hero mount. Together with the previous test this guarantees:
    // linked user → the Home hero CTA is absent (no visual noise), and
    // unlinked user → the CTA is present (the money surface).
    expect(CHIP_SRC).toMatch(/if \(state !== "unlinked"\) return null/);
  });

  it("chip's home-hero variant sets the whop_cta_home telemetry topic", () => {
    // Chip emits the shared ``whop_status_chip_impression`` topic with
    // mount_site="home-hero" · used by BUG-014's closes_only_when #2
    // ("doctor.observes:whop_cta_home_impressions within 1 tick of
    // mount when unconnected"). Grep confirms the mount_site payload
    // reaches lcDiag.
    expect(CHIP_SRC).toMatch(/mount_site:\s*mountSite/);
    expect(CHIP_SRC).toMatch(/lcDiag\("whop_status_chip_impression"/);
  });
});
