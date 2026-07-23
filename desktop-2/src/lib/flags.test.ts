/**
 * IG-FLAGS-DEFINED · Reliability Sprint L6 · regression tests.
 */
import { describe, expect, it } from "vitest";
import { FLAGS, isFlagEnabled, flagDef, listFlags, type FlagName } from "./flags";

describe("Feature flags", () => {
  it("FLAGS registry is frozen", () => {
    expect(Object.isFrozen(FLAGS)).toBe(true);
  });

  it("every flag has enabled + rolloutPct + description + ownerContact", () => {
    for (const { name, def } of listFlags()) {
      expect(typeof def.enabled, `${name}.enabled`).toBe("boolean");
      expect(typeof def.rolloutPct, `${name}.rolloutPct`).toBe("number");
      expect(def.rolloutPct >= 0 && def.rolloutPct <= 1).toBe(true);
      expect(def.description.length, `${name}.description empty`).toBeGreaterThan(0);
      expect(def.ownerContact.length, `${name}.ownerContact empty`).toBeGreaterThan(0);
    }
  });

  it("disabled flag returns false regardless of rolloutPct", () => {
    const disabled = listFlags().filter(({ def }) => !def.enabled);
    for (const { name } of disabled) {
      expect(isFlagEnabled(name, "any-id")).toBe(false);
    }
  });

  it("kill switch overrides rollout (enabled:false takes precedence)", () => {
    // Sanity — recording tiles are shipped OFF today
    const rec: FlagName = "recording.desktop-capture-tiles";
    expect(FLAGS[rec].enabled).toBe(false);
    expect(isFlagEnabled(rec, "test-user")).toBe(false);
  });

  it("100% rolloutPct returns true for every id", () => {
    const hud: FlagName = "observability.slo-hud";
    expect(FLAGS[hud].enabled).toBe(true);
    expect(FLAGS[hud].rolloutPct).toBe(1);
    for (const id of ["a", "b", "c", "1", "9999", "long-id-fuzz"]) {
      expect(isFlagEnabled(hud, id)).toBe(true);
    }
  });

  it("deterministic bucketing · same id + same flag = same answer", () => {
    const hud: FlagName = "observability.slo-hud";
    const a1 = isFlagEnabled(hud, "id-1");
    const a2 = isFlagEnabled(hud, "id-1");
    expect(a1).toBe(a2);
  });

  it("flagDef returns the frozen def unchanged", () => {
    const d = flagDef("observability.slo-hud");
    expect(d.enabled).toBe(true);
  });
});
