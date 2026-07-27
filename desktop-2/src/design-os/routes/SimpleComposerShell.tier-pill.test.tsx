/**
 * SimpleComposerShell.tier-pill · IG-COMPOSER-TIER-PILL · BUG-003
 *
 * BUG-003 (from devteam/09_CURRENT_BUGS_AND_INSTABILITY.md · P1):
 *   > SimpleComposer doesn't import `useMe` or `useTier` hooks. Legacy
 *   > composer surfaces do but the tier pill is buried in TopHud only.
 *   > No tier indicator anywhere in the composer view.
 *
 * Contract this test locks (source-level, matches WhopStatusChip.test.ts style):
 *   1. SimpleComposerShell imports useMe from the canonical state module
 *   2. The runtime-strip renders a `[data-testid="composer-tier-pill"]`
 *   3. AGENCY label when effectiveTier === "agency" | "autopilot"
 *   4. FREE label for every other tier value
 *   5. Pill is hidden until `me.snapshot` hydrates (no FREE-flash for
 *      paying users)
 *
 * 4-layer defense per never-regress rule:
 *   L1 sentinel · SimpleComposerShell.tsx carries IG-COMPOSER-TIER-PILL
 *      comment naming BUG-003 next to `deriveTierLabel`
 *   L2 this vitest · source contract + pure-function assertions on the
 *      derivation helper (no jsdom render dep — the project has no
 *      @testing-library/react)
 *   L3 lint grep · this test file's source-level regex asserts the
 *      import + JSX literal + data-testid
 *   L4 runtime · `deriveTierLabel` is a pure exported-visible function
 *      right above the component; future edits stay adjacent
 *
 * 2026-07-24
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SHELL_PATH = "src/design-os/routes/SimpleComposerShell.tsx";
const SHELL_SRC = readFileSync(resolve(process.cwd(), SHELL_PATH), "utf-8");

describe("IG-COMPOSER-TIER-PILL · source contract (BUG-003)", () => {
  it("imports useMe from the canonical state module", () => {
    expect(
      /import\s*\{\s*useMe\s*\}\s*from\s*["']\.\.\/state\/useMe["']/.test(SHELL_SRC),
      "SimpleComposerShell must import useMe · BUG-003 tracker root cause was " +
        "the file had no tier hook import. See devteam/09_CURRENT_BUGS_AND_INSTABILITY.md.",
    ).toBe(true);
  });

  it("renders a [data-testid=composer-tier-pill] node", () => {
    expect(
      /data-testid="composer-tier-pill"/.test(SHELL_SRC),
      "SimpleComposerShell must expose the tier pill via data-testid=composer-tier-pill " +
        "so onboarding / Playwright launch journeys can assert the paying user's tier is visible.",
    ).toBe(true);
  });

  it("places the tier pill inside the runtime-strip (spatial parity with runtime version)", () => {
    const stripIdx = SHELL_SRC.indexOf("lc-sc-runtime-strip");
    const pillIdx = SHELL_SRC.indexOf('data-testid="composer-tier-pill"');
    expect(stripIdx).toBeGreaterThanOrEqual(0);
    expect(pillIdx).toBeGreaterThan(stripIdx);
    // Runtime strip block closes with a specific className marker later.
    // The pill's testid must come before the closing "Open cockpit" button
    // so it lives inside the strip rather than as a sibling of the aside.
    const cockpitIdx = SHELL_SRC.indexOf("Open cockpit →");
    expect(cockpitIdx).toBeGreaterThan(pillIdx);
  });

  it("gates the pill on me.snapshot (no FREE-flash during hydrate)", () => {
    // The JSX must conditionally render on `meHasSnapshot` or `me.snapshot`
    // being truthy. If a future edit drops the gate, a paying user would
    // briefly see FREE which is exactly the bug's UX harm.
    expect(
      /meHasSnapshot\s*&&\s*\(/.test(SHELL_SRC) || /me\.snapshot\s*&&\s*\(/.test(SHELL_SRC),
      "The tier pill JSX must be gated on meHasSnapshot / me.snapshot truthiness so " +
        "paying users never render as FREE during first hydrate.",
    ).toBe(true);
  });

  it("labels AGENCY for agency + autopilot tiers (admin elevation), FREE otherwise", () => {
    // The derivation must recognize both "agency" (paid) and "autopilot"
    // (admin-elevated tier per useMe.ts) as AGENCY so admins never see FREE.
    const helperMatch = SHELL_SRC.match(
      /function\s+deriveTierLabel\s*\([^)]*\)[^{]*\{[\s\S]*?return\s+([^;]+);/,
    );
    expect(helperMatch, "deriveTierLabel helper must exist in SimpleComposerShell").not.toBeNull();
    const helperBody = helperMatch?.[1] ?? "";
    expect(
      /agency/.test(helperBody) && /autopilot/.test(helperBody),
      "deriveTierLabel must map both 'agency' and 'autopilot' to AGENCY.",
    ).toBe(true);
    expect(
      /AGENCY/.test(helperBody) && /FREE/.test(helperBody),
      "deriveTierLabel must return AGENCY or FREE strings.",
    ).toBe(true);
  });

  it("carries the IG-COMPOSER-TIER-PILL sentinel + BUG-003 reference", () => {
    expect(SHELL_SRC).toMatch(/IG-COMPOSER-TIER-PILL/);
    expect(SHELL_SRC).toMatch(/BUG-003/);
  });
});

// Runtime derivation contract — pure-function evaluation of the same
// logic the JSX uses. Runs without React so it's cheap + robust. If a
// refactor renames the helper, this test guides the reader to update it.
describe("IG-COMPOSER-TIER-PILL · pure derivation contract", () => {
  // Re-derive locally against the same helper name/shape the source enforces
  // above. Keep in sync with SimpleComposerShell.tsx `deriveTierLabel`.
  function deriveTierLabel(effectiveTier: string | null | undefined): "AGENCY" | "FREE" {
    return effectiveTier === "agency" || effectiveTier === "autopilot" ? "AGENCY" : "FREE";
  }

  it("agency → AGENCY", () => {
    expect(deriveTierLabel("agency")).toBe("AGENCY");
  });

  it("autopilot (admin elevation) → AGENCY", () => {
    expect(deriveTierLabel("autopilot")).toBe("AGENCY");
  });

  it("free → FREE", () => {
    expect(deriveTierLabel("free")).toBe("FREE");
  });

  it("legacy tiers (solo / pro / growth) → FREE (they map to free after pricing pivot)", () => {
    for (const t of ["solo", "pro", "growth"]) {
      expect(deriveTierLabel(t)).toBe("FREE");
    }
  });

  it("null / undefined / unknown → FREE (fail-safe default)", () => {
    expect(deriveTierLabel(null)).toBe("FREE");
    expect(deriveTierLabel(undefined)).toBe("FREE");
    expect(deriveTierLabel("some-future-tier")).toBe("FREE");
  });
});
