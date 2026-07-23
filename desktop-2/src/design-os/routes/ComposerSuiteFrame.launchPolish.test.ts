/**
 * IG-COCKPIT-LAUNCH-POLISH · 2.3.35 vitest regression.
 *
 * Enforces:
 *   1. Record source tiles 1-4 = coming-soon (until Rust encoder v2.4)
 *   2. ASK panel populates with Paste URL + Pick file when awaitingSource
 *   3. UpdateReadyPill positioned top-LEFT (no collision with REMOTE pill)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MOCKUP = readFileSync(
  resolve(__dirname, "../../../public/mockup/composer-suite.html"),
  "utf-8",
);
const FRAME = readFileSync(
  resolve(__dirname, "./ComposerSuiteFrame.tsx"),
  "utf-8",
);
const PILL = readFileSync(
  resolve(__dirname, "../../components/UpdateReadyPill.tsx"),
  "utf-8",
);

describe("Launch Polish · 2.3.35 · IG-COCKPIT-LAUNCH-POLISH", () => {
  it("mockup carries IG-COCKPIT-COMING-SOON + IG-COCKPIT-ASK-SOURCE", () => {
    expect(MOCKUP).toMatch(/IG-COCKPIT-COMING-SOON/);
    expect(MOCKUP).toMatch(/IG-COCKPIT-ASK-SOURCE/);
  });

  it("record tiles 1-4 (Display, Window, Scr+mic, Scr+audio) = coming-soon", () => {
    for (const idx of [1, 2, 3, 4]) {
      const re = new RegExp(`data-idx="${idx}"[^>]*data-status="coming-soon"`);
      expect(MOCKUP, `tile idx=${idx} must be coming-soon`).toMatch(re);
    }
  });

  it("tutorial (idx 0) + camera (idx 5) tiles STAY LIVE (not coming-soon)", () => {
    // The tile line for idx 0 and 5 must NOT include coming-soon status.
    // Check the tile itself (before end tag).
    const idx0 = MOCKUP.match(/data-idx="0"[^>]*/g)?.[0] ?? "";
    const idx5 = MOCKUP.match(/data-idx="5"[^>]*/g)?.[0] ?? "";
    expect(idx0, "tutorial tile").not.toContain("coming-soon");
    expect(idx5, "camera tile").not.toContain("coming-soon");
  });

  it("CSS gates coming-soon tiles (pointer-events + opacity)", () => {
    expect(MOCKUP).toMatch(/data-status='coming-soon'[^{]*\{[^}]*pointer-events:\s*none/);
    expect(MOCKUP).toMatch(/data-status='coming-soon'[^{]*\{[^}]*opacity:/);
  });

  it("Wheel 11 drivetrain reads awaitingSource + populates ASK panel", () => {
    expect(MOCKUP).toMatch(/Wheel 11\s*·\s*IG-COCKPIT-ASK-SOURCE/);
    expect(MOCKUP).toContain("state.awaitingSource");
    // The two option buttons.
    expect(MOCKUP).toContain('data-ask-option="paste-url"');
    expect(MOCKUP).toContain('data-ask-option="pick-file"');
  });

  it("ASK panel populate title = Where's the source?", () => {
    expect(MOCKUP).toContain("Where's the source?");
  });

  it("handleUserAction has source.paste-url + source.pick-file cases", () => {
    expect(FRAME).toContain('case "source.paste-url"');
    expect(FRAME).toContain('case "source.pick-file"');
    // pick-file MUST call brain.pickFile()
    expect(FRAME).toMatch(/case "source\.pick-file":[\s\S]*?brain\.pickFile\(\)/);
  });

  it("frame carries IG-COCKPIT-ASK-SOURCE sentinel", () => {
    expect(FRAME).toMatch(/IG-COCKPIT-ASK-SOURCE/);
  });

  it("UpdateReadyPill positioned top-LEFT (left: 88, no right: 200)", () => {
    expect(PILL).toMatch(/left:\s*88/);
    expect(PILL).not.toContain("right: 200");
    // Reason comment for future auditors.
    expect(PILL).toMatch(/top-right . top-left|top-LEFT|left: 88/);
  });

  it("PILL still uses Tauri relaunch (never regressed to reload)", () => {
    // Belt-and-braces: the earlier IG-COCKPIT-UPDATE-PILL bug fix must remain.
    expect(PILL).toContain("relaunch");
    // The onClick handler must NOT be a plain reload as the primary path.
    // reload() is only allowed as the fallback catch branch.
    const onClickMatch = PILL.match(/onClick=\{[\s\S]*?\}\}/);
    expect(onClickMatch?.[0] ?? "").toContain("relaunch()");
  });
});
