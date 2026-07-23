/**
 * IG-COCKPIT-SUCCESS-STATE · Vitest regression.
 *
 * The composer mockup must expose a state machine driven by
 * setPipelineState:
 *   idle    → no progress, no clips        (welcoming)
 *   working → progress != null              (transcript + playhead lead)
 *   ready   → clips > 0 && progress == null (payoff moment · clip stack)
 *   editing → user picks a clip             (future bundle)
 *
 * The success banner appears only in "ready" and is removed elsewhere.
 * The main #kade avatar dims in ready state so the DOING-card portrait
 * is the single hero (fixes the twin-Kade duplicate bug).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MOCKUP = readFileSync(
  resolve(__dirname, "../../../public/mockup/composer-suite.html"),
  "utf-8",
);
const DISPATCH = readFileSync(
  resolve(__dirname, "../../lib/remoteControlDispatch.ts"),
  "utf-8",
);

describe("Kade Cockpit success-state contract · IG-COCKPIT-SUCCESS-STATE", () => {
  it("mockup + dispatch carry the sentinel", () => {
    expect(MOCKUP).toMatch(/IG-COCKPIT-SUCCESS-STATE/);
    expect(DISPATCH).toMatch(/IG-COCKPIT-SUCCESS-STATE/);
  });

  it("setPipelineState computes the four-state machine", () => {
    expect(MOCKUP).toMatch(/composerState\s*=\s*"idle"/);
    expect(MOCKUP).toMatch(/composerState\s*=\s*"working"/);
    expect(MOCKUP).toMatch(/composerState\s*=\s*"ready"/);
    // editing is future; not required yet
  });

  it("mockup applies data-composer-state via setAttribute", () => {
    expect(MOCKUP).toMatch(/setAttribute\(\s*"data-composer-state"\s*,\s*composerState\s*\)/);
  });

  it("CSS overrides exist for working + ready states", () => {
    expect(MOCKUP).toMatch(/data-composer-state='working'/);
    expect(MOCKUP).toMatch(/data-composer-state='ready'/);
  });

  it("ready state hides all param panels + brief-card + rec-pill", () => {
    // The single ready-state block enumerates each region name.
    const readyBlock = MOCKUP.slice(
      MOCKUP.indexOf("data-composer-state='ready']"),
      MOCKUP.indexOf("clip-stack-in") || undefined,
    );
    expect(readyBlock).toContain(".param-panel");
    expect(readyBlock).toContain(".rec-pill");
    expect(readyBlock).toContain(".transcript-strip");
    expect(readyBlock).toContain(".brief-card");
    expect(readyBlock).toContain("display: none !important");
  });

  it("ready state promotes clip-stack to center stage", () => {
    expect(MOCKUP).toMatch(/data-composer-state='ready'\]\s+\.clip-stack\s*\{[^}]*display:\s*flex/i);
  });

  it("ready state dims main Kade avatar (twin-Kade duplicate fix)", () => {
    expect(MOCKUP).toMatch(/data-composer-state='ready'\]\s*#kade\s*\{/);
  });

  it("success banner element is created + labelled in ready state", () => {
    expect(MOCKUP).toMatch(/lc-success-banner/);
    expect(MOCKUP).toMatch(/🎬 Ready · /);
  });

  it("success banner is removed when leaving ready state", () => {
    // The setPipelineState must call banner.remove() outside "ready".
    expect(MOCKUP).toMatch(/banner\.remove\(\)/);
  });

  it("dispatch readback reports composer_state + success_banner_text", () => {
    expect(DISPATCH).toMatch(/composer_state:/);
    expect(DISPATCH).toMatch(/success_banner_text:/);
    expect(DISPATCH).toMatch(/copilot_hud_mode:/);
  });
});
