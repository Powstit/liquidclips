/**
 * WhopStatusChip · state contract · BUG-004 + BUG-014 · 2026-07-12.
 *
 * Locks the four-state derivation contract for the chip:
 *   1. ``no-jwt``   · ``!hasJwt``               → render nothing
 *   2. ``linking``  · transient after CTA click → "Linking…"
 *   3. ``linked``   · truthy whopUserId         → "Whop linked"
 *   4. ``unlinked`` · JWT + null whopUserId     → "Connect Whop"
 *
 * Follows the source-file grep convention already in use across
 * ``TopHud.identity-ladder.test.ts`` / ``TopHud.pill.test.ts`` — the
 * contract is a static shape, so grep-level assertions are sufficient
 * and much cheaper than spinning up jsdom.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  deriveWhopChipState,
  type WhopChipState,
} from "./WhopStatusChip";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CHIP_SRC = readFileSync(resolve(__dirname, "WhopStatusChip.tsx"), "utf-8");

describe("WhopStatusChip · four-state derivation contract", () => {
  it("unlinked · hasJwt AND no whopUserId → 'unlinked'", () => {
    // The primary money state — a signed-in user without a linked
    // Whop must always see the CTA. BUG-004 exists because this state
    // was silently invisible in TopHud's overloaded identity pill.
    const s: WhopChipState = deriveWhopChipState(true, null, false);
    expect(s).toBe("unlinked");
    // undefined is treated the same as null (snapshot may be null while
    // hydrating) so the CTA still appears — safer to over-render the
    // CTA than to hide it during hydration.
    const s2: WhopChipState = deriveWhopChipState(true, undefined, false);
    expect(s2).toBe("unlinked");
  });

  it("linking · hasJwt AND transient linking flag → 'linking'", () => {
    // Fires between click and activation:complete. Copy is 'Linking…'
    // so the user sees the OAuth round-trip in flight instead of a
    // frozen 'Connect Whop' chip.
    const s: WhopChipState = deriveWhopChipState(true, null, true);
    expect(s).toBe("linking");
  });

  it("linked · hasJwt AND truthy whopUserId → 'linked'", () => {
    // Post-activation. Chip should display green 'Whop linked' — no
    // click affordance (already connected).
    const s: WhopChipState = deriveWhopChipState(true, "user_abc123", false);
    expect(s).toBe("linked");
    // Linked wins over linking · once whopUserId lands, the chip
    // must not stay in the transient state.
    const s2: WhopChipState = deriveWhopChipState(true, "user_abc123", true);
    expect(s2).toBe("linked");
  });

  it("no-jwt · !hasJwt → 'no-jwt' (chip renders nothing)", () => {
    // Auth path first · the identity pill drives sign-in. Chip must
    // not compete for attention until the user has a JWT.
    const s: WhopChipState = deriveWhopChipState(false, null, false);
    expect(s).toBe("no-jwt");
    // Even if the backend somehow returned a whopUserId without a JWT
    // (impossible in practice · defensive check), the chip stays hidden
    // because auth is the prerequisite.
    const s2: WhopChipState = deriveWhopChipState(false, "user_abc123", false);
    expect(s2).toBe("no-jwt");
  });
});

describe("WhopStatusChip · component wiring contract", () => {
  it("reads whopUserId from useMe (canonical source)", () => {
    expect(CHIP_SRC).toMatch(/useMe\(\)/);
    expect(CHIP_SRC).toMatch(/whopUserId/);
  });

  it("reads hasJwt from useAuth (canonical source)", () => {
    // Both hooks are RO for A2 (see OWNERSHIP_MATRIX_TRAIN_A.md). The
    // chip must NEVER call getJwt() directly or maintain its own
    // subscription — that's the state-drift trifecta pattern the wave
    // is eliminating.
    expect(CHIP_SRC).toMatch(/useAuth\(\)/);
    expect(CHIP_SRC).not.toMatch(/getJwt\(\)/);
  });

  it("calls the shared connectWhop() helper on CTA click", () => {
    // Every Whop CTA (Wallet, Settings, TopHud identity pill, this chip)
    // must fire the SAME OAuth start flow — connectWhop() is the shared
    // helper introduced in AU-B-3. Duplicating the flow inline is a
    // BC-002 regression.
    expect(CHIP_SRC).toMatch(/import\s*\{\s*connectWhop\s*\}/);
    expect(CHIP_SRC).toMatch(/connectWhop\(\)/);
  });

  it("emits the three required telemetry topics via lcDiag", () => {
    // Every topic is contract-locked by the BUG-004 fix. Doctor uses
    // these to prove the chip is visible on every route AND that the
    // click funnel completes.
    expect(CHIP_SRC).toMatch(/lcDiag\("whop_status_chip_impression"/);
    expect(CHIP_SRC).toMatch(/lcDiag\("whop_connect_cta_clicked"/);
    expect(CHIP_SRC).toMatch(/lcDiag\("whop_status_transition"/);
  });

  it("renders two mount variants distinguished by mountSite prop", () => {
    // TopHud gets a compact pill · Home hero gets a full CTA card.
    // Both funnel through the same state derivation so the two surfaces
    // can never disagree on connection status.
    expect(CHIP_SRC).toMatch(/mountSite === "home-hero"/);
    expect(CHIP_SRC).toMatch(/data-whop-chip-mount="top-hud"/);
    expect(CHIP_SRC).toMatch(/data-whop-chip-mount="home-hero"/);
  });

  it("home-hero variant is conditional on unlinked state", () => {
    // The Home hero card is a full CTA · it must NOT render when the
    // user is already linked (would be visual noise). The top-hud chip
    // covers the linked / linking states in the persistent chrome.
    expect(CHIP_SRC).toMatch(/mountSite === "home-hero"/);
    expect(CHIP_SRC).toMatch(/if \(state !== "unlinked"\) return null/);
  });

  it("exposes data-whop-chip-state on both mount variants for Doctor QA", () => {
    // Doctor + ship-lens walk both surfaces and snapshot the current
    // state via this attribute. Missing = ship-lens fail.
    const matches = CHIP_SRC.match(/data-whop-chip-state=\{state\}/g);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
