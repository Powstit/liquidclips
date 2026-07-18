/**
 * @vitest-environment jsdom
 *
 * IG-COMPOSER-AA regression guard · Brand preset store contract.
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class F row F5.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  BRAND_PRESET_STORAGE_KEY,
  BRAND_PRESET_CAP,
  createBrandPreset,
  listBrandPresets,
  updateBrandPreset,
  duplicateBrandPreset,
  deleteBrandPreset,
  _resetBrandPresetsForTests,
} from "./brandPresetStore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = readFileSync(resolve(__dirname, "brandPresetStore.ts"), "utf-8");

const SAMPLE_SNAPSHOT = {
  style: { preset: "uncle-daniel" as const, watermark: true, accent: "fuchsia" as const },
  caption: {
    text: "hook",
    style: "fuchsia-pop" as const,
    position: "bottom" as const,
    letterSpacing: 0,
  },
};

beforeEach(() => {
  _resetBrandPresetsForTests();
});

describe("IG-COMPOSER-AA · Brand preset store contract (F5)", () => {
  it("brandPresetStore.ts carries the IG-COMPOSER-AA sentinel", () => {
    expect(SRC).toMatch(/IRON GATE IG-COMPOSER-AA/);
  });

  it("uses the versioned localStorage key", () => {
    expect(BRAND_PRESET_STORAGE_KEY).toBe("lc.composer.brand-presets.v1");
  });

  it("caps stored presets at BRAND_PRESET_CAP", () => {
    for (let i = 0; i < BRAND_PRESET_CAP + 3; i++) {
      createBrandPreset(`preset ${i}`, SAMPLE_SNAPSHOT);
    }
    expect(listBrandPresets().length).toBe(BRAND_PRESET_CAP);
  });

  it("create + list round-trips a preset", () => {
    const p = createBrandPreset("Growth", SAMPLE_SNAPSHOT);
    const all = listBrandPresets();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(p.id);
    expect(all[0].name).toBe("Growth");
    expect(all[0].snapshot.style?.preset).toBe("uncle-daniel");
  });

  it("empty name falls back to 'Untitled'", () => {
    const p = createBrandPreset("", SAMPLE_SNAPSHOT);
    expect(p.name).toBe("Untitled");
  });

  it("updateBrandPreset changes name + updatedAt", async () => {
    const p = createBrandPreset("Personal", SAMPLE_SNAPSHOT);
    // Wait a tick so updatedAt shifts.
    await new Promise((r) => setTimeout(r, 5));
    const updated = updateBrandPreset(p.id, { name: "Personal · v2" });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("Personal · v2");
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(p.updatedAt);
  });

  it("updateBrandPreset returns null for unknown id", () => {
    expect(updateBrandPreset("bp_missing", { name: "nope" })).toBeNull();
  });

  it("duplicateBrandPreset appends ' (copy)' to the name", () => {
    const p = createBrandPreset("Client", SAMPLE_SNAPSHOT);
    const dup = duplicateBrandPreset(p.id);
    expect(dup).not.toBeNull();
    expect(dup!.name).toBe("Client (copy)");
    expect(dup!.id).not.toBe(p.id);
  });

  it("deleteBrandPreset returns true on hit, false on miss", () => {
    const p = createBrandPreset("temp", SAMPLE_SNAPSHOT);
    expect(deleteBrandPreset(p.id)).toBe(true);
    expect(deleteBrandPreset(p.id)).toBe(false);
    expect(listBrandPresets()).toHaveLength(0);
  });

  it("malformed storage payload does not crash listBrandPresets", () => {
    localStorage.setItem(BRAND_PRESET_STORAGE_KEY, "not-json");
    expect(listBrandPresets()).toEqual([]);
    localStorage.setItem(BRAND_PRESET_STORAGE_KEY, JSON.stringify({ not: "an array" }));
    expect(listBrandPresets()).toEqual([]);
  });
});
