/**
 * IG-COMPOSER-J regression guard · Watermark preset contract.
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class A row A5.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PANEL_SRC = readFileSync(resolve(__dirname, "WatermarkPanel.tsx"), "utf-8");
const EXPORT_PATH = resolve(
  __dirname, "..", "..", "..", "studio", "ExportPanel.tsx",
);

describe("IG-COMPOSER-J · Watermark preset contract", () => {
  it("WatermarkPanel contains the IG-COMPOSER-J sentinel", () => {
    expect(PANEL_SRC).toMatch(/IRON GATE IG-COMPOSER-J/);
  });
  it("imports useCockpit from CockpitContext", () => {
    expect(PANEL_SRC).toMatch(
      /import\s*\{\s*useCockpit\s*\}\s*from\s*["']\.\.\/\.\.\/cockpit\/CockpitContext["']/,
    );
  });
  it("calls setStyle with watermark field (shared with ExportPanel render)", () => {
    expect(PANEL_SRC).toMatch(/setStyle\(\s*\{\s*watermark:/);
    expect(PANEL_SRC).not.toMatch(/useWatermarkStore|setBespokeWatermark/);
  });
  it("ExportPanel.tsx still exists (Workstation-side watermark renderer)", () => {
    expect(existsSync(EXPORT_PATH)).toBe(true);
  });

  // ── IG-COMPOSER-R integration · referral URL burn ────────────────
  it("imports getReferralUrl from the referral URL contract", () => {
    expect(PANEL_SRC).toMatch(/import\s*\{\s*getReferralUrl\s*\}\s*from\s*"[^"]*\/referralUrl"/);
  });
  it("imports useMe to source the identity handle", () => {
    expect(PANEL_SRC).toMatch(/import\s*\{\s*useMe\s*\}\s*from\s*"[^"]*\/useMe"/);
  });
  it("writes watermarkHandle to CockpitSettings.baseWindow via setBaseWindow", () => {
    expect(PANEL_SRC).toMatch(/setBaseWindow\(\s*\{\s*watermarkHandle:/);
  });
  it("writes watermarkPreset to CockpitSettings.baseWindow via setBaseWindow", () => {
    expect(PANEL_SRC).toMatch(/setBaseWindow\(\s*\{\s*watermarkPreset:/);
  });
  it("computes referralUrl by calling getReferralUrl(handle)", () => {
    expect(PANEL_SRC).toMatch(/const\s+referralUrl\s*=\s*getReferralUrl\(handle\)/);
  });
});
