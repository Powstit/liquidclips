/**
 * V1(b)-DEBUG-TIER-STICKY · regression guard for the Style ↔ Publish
 * watermark parity bug. LOCKED 2026-07-20.
 *
 * The bug this locks: `__lcDebugSetTier("pro")` fired against the
 * global test seam did NOT survive when a useTierCaps consumer
 * (StyleModule / PublishModule) unmounted and remounted. The
 * remounted consumer's `useState(null)` initialiser ignored every
 * prior debug override, tier fell back to `clipper`, watermark
 * auto-locked, and the Style→Publish parity check broke in
 * full-clipping-journey.spec.ts (step 7 line 316).
 *
 * The fix: currentDebugOverride is a module-level mirror. useState
 * seeds from it via a lazy initialiser so late-mounted consumers
 * see the currently-active override.
 *
 * Real customers are unaffected (their tier comes from /me via
 * cachedSnapshot which is already sticky). This fence only
 * guarantees the test seam behaves the same way.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { __getDebugTierOverride } from "./useTierCaps";

describe("V1(b)-DEBUG-TIER-STICKY · __lcDebugSetTier survives remounts", () => {
  beforeEach(() => {
    // Reset the debug override to null between tests so nothing leaks.
    if (typeof window !== "undefined" && typeof window.__lcDebugSetTier === "function") {
      window.__lcDebugSetTier(null);
    }
  });

  it("initial state is null", () => {
    expect(__getDebugTierOverride()).toBeNull();
  });

  it("setting __lcDebugSetTier persists in the module-level mirror", () => {
    if (typeof window === "undefined") return; // jsdom-required
    expect(window.__lcDebugSetTier).toBeDefined();
    window.__lcDebugSetTier!("pro");
    expect(__getDebugTierOverride()).toBe("pro");
    window.__lcDebugSetTier!("agency");
    expect(__getDebugTierOverride()).toBe("agency");
  });

  it("clearing with null resets the mirror", () => {
    if (typeof window === "undefined") return;
    window.__lcDebugSetTier!("pro");
    expect(__getDebugTierOverride()).toBe("pro");
    window.__lcDebugSetTier!(null);
    expect(__getDebugTierOverride()).toBeNull();
  });

  it("the mirror is what a late-mounted useTierCaps would see via its lazy initialiser", () => {
    // We can't easily mount React hooks here without a full jsdom +
    // testing-library setup, but the whole point of the fix is that
    // useState's lazy initialiser reads `currentDebugOverride`. Assert
    // that the source-text of useTierCaps.ts contains the exact wire.
    // Belt-and-braces so a future refactor can't quietly remove the
    // sticky seam.
    const fs = require("node:fs");
    const path = require("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "./useTierCaps.ts"),
      "utf-8",
    );
    expect(src).toMatch(
      /useState<Tier \| null>\s*\(\s*\(\)\s*=>\s*currentDebugOverride\s*\)/,
    );
    // Setter also updates the module-level mirror.
    expect(src).toMatch(
      /window\.__lcDebugSetTier\s*=\s*\(\s*t[^)]*\)\s*=>\s*\{[\s\S]{0,200}?currentDebugOverride\s*=\s*t/,
    );
  });
});
