/**
 * useWatermarkRemovalPaywall + WatermarkTrialConfirmModal + wire tests
 *
 * C1-T5 · 2026-07-05 · locks the watermark-removal paywall contract:
 *   * useWatermarkRemovalPaywall hook exists + wires to backend via bridgeToBackend
 *   * Trigger is wrapped in useAuditableAction("watermark.remove", …)
 *   * Free clipper path fires bus.emit("auth:open-panel", {})
 *   * Trial-active path fires POST /me/trial/approve
 *   * OverlayTemplateGallery watermark toggle uses paywall.trigger (not dead toast)
 *   * ExportPanel has an "Upgrade to remove" / "Charge now" button
 *   * Both surfaces mount the confirmation modal
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HOOK_SRC = readFileSync(resolve(__dirname, "useWatermarkRemovalPaywall.ts"), "utf-8");
const MODAL_SRC = readFileSync(
  resolve(__dirname, "../components/paywall/WatermarkTrialConfirmModal.tsx"),
  "utf-8",
);
const OTG_SRC = readFileSync(
  resolve(__dirname, "../design-os/studio/OverlayTemplateGallery.tsx"),
  "utf-8",
);
const EXP_SRC = readFileSync(
  resolve(__dirname, "../design-os/studio/ExportPanel.tsx"),
  "utf-8",
);

describe("useWatermarkRemovalPaywall · C1-T5 contract", () => {
  it("wraps the trial-charge call in useAuditableAction('watermark.remove', …)", () => {
    expect(HOOK_SRC).toMatch(/useAuditableAction<[^>]*>\(\s*["']watermark\.remove["']/);
  });

  it("POSTs to /me/trial/approve via bridgeToBackend", () => {
    expect(HOOK_SRC).toMatch(
      /bridgeToBackend<[^>]*>\(\s*["']POST["']\s*,\s*["']\/me\/trial\/approve["']/,
    );
  });

  it("Free tier path fires bus.emit('auth:open-panel', …)", () => {
    expect(HOOK_SRC).toMatch(/bus\.emit\(\s*["']auth:open-panel["']/);
  });

  it("distinguishes trial-active from free tier via subscriptionStatus", () => {
    expect(HOOK_SRC).toMatch(/subscriptionStatus/);
    expect(HOOK_SRC).toMatch(/sub === ["']trial["']\s*\|\|\s*sub === ["']trialing["']/);
  });

  it("reloads /me after successful trial→paid conversion so tier flips", () => {
    expect(HOOK_SRC).toMatch(/me\.reload\(\)/);
  });
});

describe("WatermarkTrialConfirmModal · C1-T5 surface", () => {
  it("renders a Keep + Charge two-choice dialog", () => {
    expect(MODAL_SRC).toMatch(/data-testid="watermark-trial-confirm-modal"/);
    expect(MODAL_SRC).toMatch(/data-testid="watermark-trial-keep"/);
    expect(MODAL_SRC).toMatch(/data-testid="watermark-trial-charge"/);
  });

  it("names the money-moment price explicitly ($99.99)", () => {
    expect(MODAL_SRC).toMatch(/\$99\.99/);
  });

  it("gates the Charge button on pending so a spam click doesn't double-charge", () => {
    expect(MODAL_SRC).toMatch(/disabled=\{paywall\.pending\}/);
  });
});

describe("OverlayTemplateGallery watermark toggle · C1-T5 wire", () => {
  it("no longer surfaces the dead 'upgrade to remove' toast on lock", () => {
    // The prior dead nudge is gone · was:
    //   bus.emit("toast", { title: "Watermark", body: "Free clips ship with…" })
    expect(OTG_SRC).not.toMatch(
      /bus\.emit\(\s*["']toast["'][\s\S]*?title:\s*["']Watermark["'][\s\S]*?body:\s*["']Free clips ship/,
    );
  });

  it("imports and calls the shared paywall hook", () => {
    expect(OTG_SRC).toMatch(
      /import\s*{[^}]*useWatermarkRemovalPaywall[^}]*}\s*from\s*["']\.\.\/\.\.\/lib\/useWatermarkRemovalPaywall["']/,
    );
    expect(OTG_SRC).toMatch(/paywall\.trigger\(\s*["']OverlayTemplateGallery["']\s*\)/);
  });

  it("mounts the trial confirmation modal", () => {
    expect(OTG_SRC).toMatch(/<WatermarkTrialConfirmModal\s+paywall=\{paywall\}\s*\/>/);
  });
});

describe("ExportPanel upgrade affordance · C1-T5 wire", () => {
  it("imports and calls the shared paywall hook", () => {
    expect(EXP_SRC).toMatch(
      /import\s*{[^}]*useWatermarkRemovalPaywall[^}]*}\s*from\s*["']\.\.\/\.\.\/lib\/useWatermarkRemovalPaywall["']/,
    );
    expect(EXP_SRC).toMatch(/paywall\.trigger\(\s*["']ExportPanel["']\s*\)/);
  });

  it("renders an Upgrade / Charge CTA next to the locked watermark line", () => {
    expect(EXP_SRC).toMatch(/data-testid="watermark-upgrade-cta"/);
    expect(EXP_SRC).toMatch(/Upgrade to remove/);
    expect(EXP_SRC).toMatch(/Charge now/);
  });

  it("mounts the trial confirmation modal", () => {
    expect(EXP_SRC).toMatch(/<WatermarkTrialConfirmModal\s+paywall=\{paywall\}\s*\/>/);
  });
});
