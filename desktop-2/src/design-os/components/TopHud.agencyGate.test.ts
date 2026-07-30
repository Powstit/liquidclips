/**
 * TopHud · Agency pill self-elevation gate · regression guard.
 * 2026-07-30.
 *
 * V1-AGENCY-GATE (mode.ts, LOCKED 2026-07-20) refuses setMode("agency")
 * for any tier that isn't agency-family — but only inside
 * useModeStore.setMode/toggleMode. TopHud maintains its OWN separate
 * useState + persistAndBroadcast path (it's the canonical mode writer;
 * useModeStore is a bridge over it, per mode.ts's file header), so the
 * gate was never applied to the actual Clipper/Agency pill a user
 * clicks in the persistent top bar. Any signed-in free/clipper-tier
 * user could click straight into Agency mode and land on a tab of
 * permanently-403'd "Owner access required" panels.
 *
 * Source-file grep pattern mirrors the shipped convention for this
 * file (see TopHud.pill.test.ts) — desktop-2 has no
 * @testing-library/react dependency, so component-level regressions
 * here are locked as static source contracts rather than rendered
 * interaction tests.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HUD_SRC = readFileSync(resolve(__dirname, "TopHud.tsx"), "utf-8");

describe("TopHud · Agency pill · V1-AGENCY-GATE parity", () => {
  it("imports canUseAgencyMode from the canonical gate module", () => {
    expect(HUD_SRC).toMatch(
      /import\s*{\s*canUseAgencyMode\s*}\s*from\s*['"]\.\.\/\.\.\/state\/mode['"]/,
    );
  });

  it("the Agency radio button's onClick checks canUseAgencyMode() before setMode(\"agency\")", () => {
    // Isolate the Agency button's JSX block (between its aria-checked
    // and the closing >Agency</button>) and assert the gate check
    // appears BEFORE the local setMode call inside it.
    const agencyButtonMatch = HUD_SRC.match(
      /aria-checked=\{mode === "agency"\}[\s\S]*?>Agency<\/button>/,
    );
    expect(agencyButtonMatch).not.toBeNull();
    const block = agencyButtonMatch![0];
    expect(block).toContain("canUseAgencyMode()");
    const gateIdx = block.indexOf("canUseAgencyMode()");
    const setModeIdx = block.indexOf('setMode("agency")');
    expect(setModeIdx).toBeGreaterThan(gateIdx);
    // Refusal path must return before reaching setMode.
    const refusalBlockIdx = block.indexOf("if (!canUseAgencyMode())");
    const returnIdx = block.indexOf("return;", refusalBlockIdx);
    expect(returnIdx).toBeGreaterThan(refusalBlockIdx);
    expect(returnIdx).toBeLessThan(setModeIdx);
  });

  it("emits the same stable LC-AGENCY-GATE-001 code + agency:gate-refused event as the canonical gate", () => {
    expect(HUD_SRC).toContain("LC-AGENCY-GATE-001");
    expect(HUD_SRC).toContain('"agency:gate-refused"');
  });

  it("the Clipper radio button has no gate (downgrade is always allowed)", () => {
    const clipperButtonMatch = HUD_SRC.match(
      /aria-checked=\{mode === "clipper"\}[\s\S]*?>Clipper<\/button>/,
    );
    expect(clipperButtonMatch).not.toBeNull();
    expect(clipperButtonMatch![0]).not.toContain("canUseAgencyMode");
  });
});
