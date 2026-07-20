/**
 * V1(b)-BOOT-RECONCILE · LC-AGENCY-GATE-001 boot-time reconciliation.
 * LOCKED 2026-07-20.
 *
 * Sister of mode.agencyGate.test.ts:
 *   - agencyGate test covers RUNTIME setMode() refusal.
 *   - THIS test covers BOOT reconciliation: if stored mode="agency" +
 *     effective_tier not agency-family → force clipper on next tick
 *     after /me hydrates.
 *
 * This tests the pure function `reconcilePersistedModeAgainstTier`
 * which the React `<ModeReconciler />` component calls via useEffect.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

let mockSnapshot: { effectiveTier: string | null; rawTier: string | null } | null = null;
vi.mock("../design-os/state/useMe", () => ({
  getCachedMeSnapshot: () => mockSnapshot,
  getCachedMeSource: () => (mockSnapshot ? "real-http" : "unknown"),
}));

const busEvents: Array<{ topic: string; payload: unknown }> = [];
vi.mock("../design-os/bridge/events", () => ({
  bus: {
    emit: (topic: string, payload: unknown) => {
      busEvents.push({ topic, payload });
    },
    on: () => () => {},
  },
}));

function resetLocalStorage(initialMode: "clipper" | "agency") {
  const store = new Map<string, string>();
  store.set("lc.mode", initialMode);
  const fake = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
    _dump: () => Object.fromEntries(store),
  } as unknown as Storage & { _dump: () => Record<string, string> };
  Object.defineProperty(globalThis, "localStorage", { value: fake, writable: true });
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: fake, addEventListener: () => {} },
    writable: true,
  });
  return fake as Storage & { _dump: () => Record<string, string> };
}

async function freshStore() {
  vi.resetModules();
  return await import("./mode");
}

describe("V1(b)-BOOT-RECONCILE · reconcilePersistedModeAgainstTier", () => {
  beforeEach(() => {
    busEvents.length = 0;
    mockSnapshot = null;
  });

  it("no-op when snapshot is not yet hydrated", async () => {
    resetLocalStorage("agency");
    mockSnapshot = null;
    const { reconcilePersistedModeAgainstTier } = await freshStore();

    const r = reconcilePersistedModeAgainstTier();

    expect(r.reconciled).toBe(false);
    expect(r.reason).toBe("no_snapshot");
    expect(r.previousMode).toBe("agency");
    expect(r.newMode).toBe("agency");
    expect(busEvents).toEqual([]);
  });

  it("no-op when stored mode is already clipper", async () => {
    resetLocalStorage("clipper");
    mockSnapshot = { effectiveTier: "clipper", rawTier: "clipper" };
    const { reconcilePersistedModeAgainstTier } = await freshStore();

    const r = reconcilePersistedModeAgainstTier();

    expect(r.reconciled).toBe(false);
    expect(r.reason).toBe("already_clipper");
    expect(busEvents).toEqual([]);
  });

  it("no-op when stored mode=agency AND tier qualifies", async () => {
    resetLocalStorage("agency");
    mockSnapshot = { effectiveTier: "agency", rawTier: "agency" };
    const { reconcilePersistedModeAgainstTier } = await freshStore();

    const r = reconcilePersistedModeAgainstTier();

    expect(r.reconciled).toBe(false);
    expect(r.reason).toBe("tier_qualifies");
    expect(r.newMode).toBe("agency");
    expect(busEvents).toEqual([]);
  });

  it("DOWNGRADES when stored mode=agency + effective_tier=free", async () => {
    const ls = resetLocalStorage("agency");
    mockSnapshot = { effectiveTier: "free", rawTier: "free" };
    const { reconcilePersistedModeAgainstTier } = await freshStore();

    const r = reconcilePersistedModeAgainstTier();

    expect(r.reconciled).toBe(true);
    expect(r.reason).toBe("downgraded");
    expect(r.previousMode).toBe("agency");
    expect(r.newMode).toBe("clipper");
    // localStorage was rewritten to clipper.
    expect(ls.getItem("lc.mode")).toBe("clipper");
    // Bus fired the change + the refusal audit event.
    expect(busEvents.find((e) => e.topic === "mode:change")).toBeDefined();
    const refusal = busEvents.find((e) => e.topic === "agency:gate-refused");
    expect(refusal).toBeDefined();
    expect((refusal!.payload as { code: string }).code).toBe("LC-AGENCY-GATE-001");
  });

  it("DOWNGRADES when stored mode=agency + effective_tier=studio", async () => {
    resetLocalStorage("agency");
    mockSnapshot = { effectiveTier: "studio", rawTier: "studio" };
    const { reconcilePersistedModeAgainstTier } = await freshStore();
    const r = reconcilePersistedModeAgainstTier();
    expect(r.reconciled).toBe(true);
    expect(r.newMode).toBe("clipper");
  });

  it("DOWNGRADES for every non-agency backend tier", async () => {
    for (const tier of ["free", "starter", "clipper", "solo", "pro", "growth", "channel", "studio", "studio_unlimited"]) {
      busEvents.length = 0;
      const ls = resetLocalStorage("agency");
      mockSnapshot = { effectiveTier: tier, rawTier: tier };
      const { reconcilePersistedModeAgainstTier } = await freshStore();
      const r = reconcilePersistedModeAgainstTier();
      expect(r.reconciled, `tier=${tier}`).toBe(true);
      expect(ls.getItem("lc.mode"), `tier=${tier}`).toBe("clipper");
    }
  });

  it("keeps agency when tier is autopilot (admin-elevated)", async () => {
    resetLocalStorage("agency");
    mockSnapshot = { effectiveTier: "autopilot", rawTier: "clipper" };
    const { reconcilePersistedModeAgainstTier } = await freshStore();
    const r = reconcilePersistedModeAgainstTier();
    expect(r.reconciled).toBe(false);
    expect(r.reason).toBe("tier_qualifies");
    expect(r.newMode).toBe("agency");
  });

  it("keeps agency when tier is agency_solo / agency_whitelabel", async () => {
    for (const tier of ["agency_solo", "agency_whitelabel"]) {
      resetLocalStorage("agency");
      mockSnapshot = { effectiveTier: tier, rawTier: tier };
      const { reconcilePersistedModeAgainstTier } = await freshStore();
      const r = reconcilePersistedModeAgainstTier();
      expect(r.reconciled, `tier=${tier}`).toBe(false);
    }
  });

  it("is idempotent · running twice returns the same result", async () => {
    resetLocalStorage("agency");
    mockSnapshot = { effectiveTier: "free", rawTier: "free" };
    const { reconcilePersistedModeAgainstTier } = await freshStore();
    const first = reconcilePersistedModeAgainstTier();
    expect(first.reconciled).toBe(true);
    busEvents.length = 0;
    const second = reconcilePersistedModeAgainstTier();
    // Second call sees mode=clipper already → no-op.
    expect(second.reconciled).toBe(false);
    expect(second.reason).toBe("already_clipper");
    // No spurious extra bus emits.
    expect(busEvents).toEqual([]);
  });
});
