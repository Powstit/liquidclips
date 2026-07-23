/**
 * IG-FOUNDER-MOMENT-VIDEO · vitest regression for the founder-hook.mp4
 * upgrade in FounderMoments + ActivateFounderPanel.
 *
 * 2026-07-22 · 2.3.36 · Sprint launch-polish
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FM = readFileSync(
  resolve(__dirname, "./FounderMoments.tsx"),
  "utf-8",
);
const AF = readFileSync(
  resolve(__dirname, "../gate/ActivateFounderPanel.tsx"),
  "utf-8",
);

describe("Founder MP4 upgrade · IG-FOUNDER-MOMENT-VIDEO", () => {
  it("both files carry the sentinel", () => {
    expect(FM).toMatch(/IG-FOUNDER-MOMENT-VIDEO/);
    expect(AF).toMatch(/IG-FOUNDER-MOMENT-VIDEO/);
  });

  it("FounderMoments welcome renders SafeVideo with founder-hook.mp4", () => {
    expect(FM).toContain("SafeVideo");
    expect(FM).toContain("/brand/founder/founder-hook.mp4");
    expect(FM).toContain("lc-founder-moment-art--circle");
  });

  it("ActivateFounderPanel processing renders SafeVideo with founder-hook.mp4", () => {
    expect(AF).toContain("SafeVideo");
    expect(AF).toContain("/brand/founder/founder-hook.mp4");
    expect(AF).toContain("lc-activate-art--circle");
  });

  it("circle CSS has border-radius: 50% in both files", () => {
    // The --circle class rule sets border-radius: 50%.
    expect(FM).toMatch(/lc-founder-moment-art--circle\s*\{[\s\S]*?border-radius:\s*50%/);
    expect(AF).toMatch(/lc-activate-art--circle\s*\{[\s\S]*?border-radius:\s*50%/);
  });

  it("poster fallback preserved (SafeVideo falls back to static PNG if MP4 404s)", () => {
    expect(FM).toContain('poster="/brand/founder/seat-unlocked-static.png"');
    expect(AF).toContain('poster="/brand/founder/seat-unlocked-static.png"');
  });

  it("autoplay + muted + playsInline (silent-autoplay browser policy)", () => {
    for (const src of [FM, AF]) {
      expect(src).toContain("autoPlay");
      expect(src).toContain("muted");
      expect(src).toContain("playsInline");
    }
  });

  it("Kade first-clip celebration STAYS PNG (Kade moment, not founder)", () => {
    // First-clip celebration is Kade's persona win, not the founder's
    // voice moment. That branch continues to use kade-first-clip-*.png.
    expect(FM).toContain("kade-first-clip-celebration.png");
  });

  it("data-testid preserved for Playwright coverage", () => {
    expect(FM).toContain('data-testid="founder-moment-welcome-video"');
    expect(AF).toContain('data-testid="activate-founder-video"');
  });
});
