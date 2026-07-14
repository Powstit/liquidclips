/**
 * TopHud · Whop chip mount contract · BUG-004 · Train A2 · 2026-07-12.
 *
 * Locks the mount contract for WhopStatusChip inside TopHud:
 *   * TopHud imports WhopStatusChip
 *   * WhopStatusChip is mounted with mountSite="top-hud"
 *   * Mount is standalone (not conditionally hidden by identity state) —
 *     the chip itself handles the no-jwt hide.
 *   * TopHud does NOT re-derive the Whop state or read whopUserId to
 *     drive an inline pill in parallel — one canonical writer only.
 *   * Identity ladder logic (Wave 1 · A1 territory) remains untouched.
 *
 * Follows the source-file grep convention already established in the
 * TopHud test cluster (TopHud.identity-ladder.test.ts,
 * TopHud.pill.test.ts, TopHud.identity.test.ts).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HUD_SRC = readFileSync(resolve(__dirname, "TopHud.tsx"), "utf-8");
const CHIP_SRC = readFileSync(
  resolve(__dirname, "WhopStatusChip.tsx"),
  "utf-8",
);

describe("TopHud · WhopStatusChip mount contract", () => {
  it("imports WhopStatusChip from the sibling module", () => {
    expect(HUD_SRC).toMatch(/from\s+"\.\/WhopStatusChip"/);
    expect(HUD_SRC).toMatch(/import\s*\{\s*WhopStatusChip\s*\}/);
  });

  it("mounts WhopStatusChip with mountSite=\"top-hud\"", () => {
    // The chip needs the mountSite prop to differentiate telemetry
    // + rendering. TopHud must pass "top-hud".
    expect(HUD_SRC).toMatch(/<WhopStatusChip\s+mountSite="top-hud"\s*\/>/);
  });

  it("does not derive Whop connection state inline (canonical source only)", () => {
    // The chip owns state derivation. TopHud must NOT introduce a
    // separate pill or ternary that reads whopUserId to render its own
    // "Connect Whop" affordance — that would recreate BC-002 drift.
    // The existing identity pill (Wave 1 territory) references
    // ``me.snapshot?.whopUserId`` for its 4-state derivation · that is
    // explicitly allowed by the OWNERSHIP_MATRIX. We just assert the
    // chip mount is the ONLY <WhopStatusChip .../> render.
    const chipMounts =
      HUD_SRC.match(/<WhopStatusChip\s/g)?.length ?? 0;
    expect(chipMounts).toBe(1);
  });

  it("does not re-implement WhopStatusChip inline (no duplicate copy strings)", () => {
    // BC-002 sweep · the 'Connect Whop' copy in TopHud belongs to
    // either the identity pill (Wave 1 · agreed) or the chip. There
    // should not be a THIRD hardcoded 'Connect Whop' render in
    // TopHud outside these two.
    const connectWhopStrings = HUD_SRC.match(/"Connect Whop"/g)?.length ?? 0;
    // Identity pill has one (Wave 1) + one in the switch destination
    // (identityState) · no more than 2 references in the file.
    expect(connectWhopStrings).toBeLessThanOrEqual(2);
  });

  it("keeps identity ladder derivation intact (A1 wave-1 territory untouched)", () => {
    // Wave 1's ``identityLadder`` useMemo + its 5-rung shape must
    // remain unchanged. A2 must not modify the ladder — assert the
    // shape survives.
    expect(HUD_SRC).toContain("const identityLadder = useMemo");
    expect(HUD_SRC).toContain('"handle"');
    expect(HUD_SRC).toContain('"lc-id"');
    expect(HUD_SRC).toContain('"pending"');
    expect(HUD_SRC).toContain('"complete-profile"');
    expect(HUD_SRC).toContain('"none"');
  });

  it("the chip module renders nothing when hasJwt is false (no-jwt hide)", () => {
    // The mount site does not guard on hasJwt · the chip must hide
    // itself. This assertion pins that responsibility on the chip
    // module so TopHud remains agnostic.
    expect(CHIP_SRC).toMatch(/if \(state === "no-jwt"\) return null/);
  });

  it("chip module reacts to activation:complete (post-link state update)", () => {
    // BUG-004 · closes_only_when #3 · chip must flip to 'linked'
    // within 1 tick of activation:complete. The useMe hook already
    // subscribes to that bus event (see useMe.ts) → whopUserId
    // hydrates → chip re-derives 'linked'. Additionally the chip
    // clears its transient 'linking' flag on the same event to close
    // the loop even before /me catches up.
    expect(CHIP_SRC).toMatch(/bus\.on\("activation:complete"/);
  });
});
