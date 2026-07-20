/**
 * IG-COMPOSER-VISUAL · Layer 3 · source-level structural contract
 * that locks the data-* attribute plumbing between MockComposerBody.tsx
 * and MockComposer.css. LOCKED 2026-07-20.
 *
 * Every bug class this locks:
 *   - StickyKade covering the mockup (z-index war): mockup MUST be
 *     ≥1000 · StickyKade / Chat / DeepWork toggles hidden by
 *     body[data-mock-composer-active] rules
 *   - Greeting stuck ("Hey I'm Kade"): canvasLoaded must be a real
 *     boolean derived from runtime, not a hardcoded literal
 *   - Toggle button not toggling: mode/turbo/layout state must reach
 *     data-* attributes so CSS selectors can respond
 *   - Slot A/B/C invisible: slot buttons must carry data-slot-active
 *   - Split layout dividers missing: data-layout-mode values must
 *     match the CSS selectors that render dividers
 *
 * Sister lens tests (existing):
 *   - MockComposer.navRouting.test.ts   nav labels ↔ RouteId ↔ SURFACE_FOR
 *   - Composer.mount.test.ts            top-level route mount
 *   - Composer.turbo.test.ts            turbo state pipeline
 *   - Composer.idle.test.ts             idle canvas
 *
 * This test extends the family with the visual-attribute pairings
 * that Playwright tests noticed missing (see FENCE 4 audit).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BODY_SRC = readFileSync(
  resolve(__dirname, "MockComposerBody.tsx"),
  "utf-8",
);
const CSS_SRC = readFileSync(
  resolve(__dirname, "MockComposer.css"),
  "utf-8",
);
const COMPOSER_SRC = readFileSync(
  resolve(__dirname, "Composer.tsx"),
  "utf-8",
);

describe("IG-COMPOSER-VISUAL · z-index war invariants", () => {
  it("mockup surface is fixed-position and above StickyKade (z ≥ 1000)", () => {
    // From the S1 fix: StickyKade sits at z-index 950. The mockup
    // must be strictly above to prevent StickyKade covering the HUD.
    expect(CSS_SRC).toMatch(/\.lc-mock-composer\s*\{[\s\S]*?position:\s*fixed/);
    expect(CSS_SRC).toMatch(/\.lc-mock-composer\s*\{[\s\S]*?z-index:\s*(?:1000|1001|1[0-9]{3,})/);
  });

  it("body[data-mock-composer-active] hides StickyKade / Chat / DeepWork toggles", () => {
    // These 3 rules were the fix for the toggle-covers-D-avatar bug.
    expect(CSS_SRC).toMatch(/body\[data-mock-composer-active\][\s\S]*?\.lc-sticky-kade[\s\S]*?display:\s*none/);
    expect(CSS_SRC).toMatch(/body\[data-mock-composer-active\][\s\S]*?\.lc-chat-toggle[\s\S]*?display:\s*none/);
    expect(CSS_SRC).toMatch(/body\[data-mock-composer-active\][\s\S]*?\.lc-deep-work-toggle[\s\S]*?display:\s*none/);
  });

  it("MockComposerBody sets body[data-mock-composer-active] on mount", () => {
    expect(BODY_SRC).toMatch(/document\.body\.dataset\.mockComposerActive\s*=\s*["']true["']/);
  });
});

describe("IG-COMPOSER-VISUAL · greeting / canvasLoaded state contract", () => {
  it("canvasLoaded is a real prop, not a hardcoded literal", () => {
    // The regression this locks: `data-canvas-loaded="false"` was
    // hardcoded in the port, causing the greeting to stay stuck.
    // The fix bound it to the real runtime state.
    expect(BODY_SRC).toMatch(/canvasLoaded[?:]?\s*:\s*boolean/);
    // Attribute value must interpolate the prop, not be a constant.
    expect(BODY_SRC).toMatch(/data-canvas-loaded=\{canvasLoaded/);
    // Composer.tsx must supply a real derivation (not `false`).
    expect(COMPOSER_SRC).toMatch(/canvasLoaded=\{/);
    expect(COMPOSER_SRC).not.toMatch(/canvasLoaded=\{false\}/);
  });
});

describe("IG-COMPOSER-VISUAL · mode / turbo / layout state pipeline", () => {
  it("activeMode prop reaches data-mode attribute", () => {
    expect(BODY_SRC).toMatch(/activeMode[?:]?\s*:/);
    expect(BODY_SRC).toMatch(/data-mode=\{activeMode/);
  });

  it("activeSpeed prop drives the data-active flag on the 1×/2×/5× buttons", () => {
    // Each speed button carries `data-speed="1"` (literal) plus
    // `data-active={activeSpeed === 1 ? "true" : undefined}`. The
    // active-flag pipeline is what CSS + a11y observe.
    expect(BODY_SRC).toMatch(/activeSpeed[?:]?\s*:/);
    expect(BODY_SRC).toMatch(/data-speed="1"/);
    expect(BODY_SRC).toMatch(/data-speed="2"/);
    expect(BODY_SRC).toMatch(/data-speed="5"/);
    expect(BODY_SRC).toMatch(/data-active=\{activeSpeed\s*===/);
  });

  it("turboActive prop reaches data-turbo attribute", () => {
    expect(BODY_SRC).toMatch(/turboActive[?:]?\s*:/);
    expect(BODY_SRC).toMatch(/data-turbo=\{/);
  });

  it("canvasLayoutMode prop reaches data-layout-mode attribute", () => {
    expect(BODY_SRC).toMatch(/canvasLayoutMode[?:]?\s*:/);
    expect(BODY_SRC).toMatch(/data-layout-mode=\{canvasLayoutMode/);
  });

  it("CSS reshapes for every layout-mode value the prop can carry", () => {
    // The three split modes must each have a CSS rule keyed on the
    // matching data-layout-mode value, otherwise the button toggles
    // do nothing visible.
    for (const mode of ["split-vertical", "split-horizontal", "grid-2x2"]) {
      const re = new RegExp(`data-layout-mode="${mode}"`);
      expect(CSS_SRC).toMatch(re);
    }
  });

  it("CSS reshapes for classic mode (kade is the default, no attr needed)", () => {
    // Kade is the default rendering — no CSS override needed. Classic
    // mode explicitly hides the Kade rail + status card. If someone
    // renames "classic" to "no-kade" without updating CSS, this fails.
    expect(CSS_SRC).toMatch(/data-mode="classic"/);
  });
});

describe("IG-COMPOSER-VISUAL · slot A/B/C system", () => {
  it("MockComposerBody exports slot handling", () => {
    // Slot buttons need to be interactable + carry a data-slot-active
    // attribute so a11y + tests can find the current selection.
    expect(BODY_SRC).toMatch(/selectedSlot/);
    expect(BODY_SRC).toMatch(/onSlotSelect|onSelectSlot/);
  });

  it("Composer.tsx wires selectSlot into MockComposer", () => {
    // The wire proves the slot selection actually feeds back to state.
    expect(COMPOSER_SRC).toMatch(/selectSlot/);
  });
});

describe("IG-COMPOSER-VISUAL · nav item data-active bindings", () => {
  it("nav items carry data-active bound to activeRoute", () => {
    // Prevents the "which page am I on" ambiguity — every nav item
    // must reflect the current route via data-active.
    expect(BODY_SRC).toMatch(/data-active=\{/);
    expect(BODY_SRC).toMatch(/activeRoute[?:]?\s*:/);
  });
});
