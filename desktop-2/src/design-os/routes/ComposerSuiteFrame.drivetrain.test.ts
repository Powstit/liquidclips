/**
 * IG-COCKPIT-UPSTREAM-DRIVETRAIN · Vitest regression.
 *
 * Verifies the drivetrain contract stays intact:
 *   1. composer-suite.html exposes emitUserAction + setPipelineState
 *      + the co-pilot HUD updater.
 *   2. ComposerSuiteFrame.tsx has the IG sentinel + handleUserAction
 *      + consumes lc:composer:user-action.
 *   3. Every cockpit gesture kind that emitUserAction fires has a
 *      matching switch case in handleUserAction (no orphan wires).
 *   4. State handler in composer-suite.html routes through
 *      setPipelineState (no scattered patches).
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

describe("Kade Cockpit drivetrain contract · IG-COCKPIT-UPSTREAM-DRIVETRAIN", () => {
  it("mockup exposes emitUserAction", () => {
    expect(MOCKUP).toMatch(/window\.emitUserAction\s*=\s*function/);
  });

  it("mockup exposes setPipelineState (downstream drivetrain)", () => {
    expect(MOCKUP).toMatch(/window\.setPipelineState\s*=\s*function/);
  });

  it("mockup exposes co-pilot HUD updater", () => {
    expect(MOCKUP).toMatch(/window\.__updateCopilotHud/);
  });

  it("ComposerSuiteFrame.tsx carries the IG sentinel", () => {
    expect(FRAME).toMatch(/IG-COCKPIT-UPSTREAM-DRIVETRAIN/);
  });

  it("ComposerSuiteFrame.tsx exports handleUserAction reducer", () => {
    expect(FRAME).toMatch(/async function handleUserAction/);
  });

  it("ComposerSuiteFrame.tsx consumes lc:composer:user-action", () => {
    expect(FRAME).toContain("lc:composer:user-action");
  });

  it("state handler routes through setPipelineState (no scattered patches)", () => {
    // The lc:composer:state branch must call setPipelineState — pattern
    // matches: 'if (msg.type === "lc:composer:state") { ... setPipelineState(msg) ... }'
    const stateMatch = /lc:composer:state[\s\S]{0,600}setPipelineState\(msg\)/;
    expect(MOCKUP).toMatch(stateMatch);
  });

  it("every cockpit action kind has a handleUserAction case", () => {
    // Extract every `emitUserAction("kind"...)` from the mockup.
    const kinds = new Set<string>();
    const re = /emitUserAction\(\s*["']([\w.-]+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(MOCKUP)) !== null) kinds.add(m[1]);
    expect(kinds.size).toBeGreaterThan(15); // sanity: many wires

    // Every kind must appear as a case in handleUserAction.
    const orphan: string[] = [];
    for (const k of kinds) {
      const caseRe = new RegExp(`case\\s+["']${k.replace(/\./g, "\\.")}["']`);
      if (!caseRe.test(FRAME)) orphan.push(k);
    }
    expect(orphan, `orphan cockpit actions with no handleUserAction case: ${orphan.join(", ")}`).toEqual([]);
  });

  it("handleUserAction has no duplicate switch cases", () => {
    const cases = [...FRAME.matchAll(/case\s+["']([\w.-]+)["']\s*:/g)].map((m) => m[1]);
    const duplicates = cases.filter((kind, idx) => cases.indexOf(kind) !== idx);
    expect(duplicates).toEqual([]);
  });
});
