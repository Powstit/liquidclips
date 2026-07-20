/**
 * V1-AGENCY-GATE · LC-AGENCY-GATE-001 · regression guard.
 * LOCKED 2026-07-20.
 *
 * Locks the contract:
 *   - setMode("agency") + toggleMode() → agency FAIL when
 *     `/me.effective_tier` is not agency-family OR snapshot absent.
 *   - Store STAYS in current mode on refusal (no side-effect).
 *   - A `agency:gate-refused` event fires with stable code.
 *   - A user-safe toast is emitted with the correct reason copy.
 *   - Downgrade to "clipper" is ALWAYS allowed regardless of tier.
 *
 * The mock strategy: swap `getCachedMeSnapshot` at module load time
 * before importing the store, so the guard reads the fake snapshot.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// The gate reads its snapshot via getCachedMeSnapshot. We mock that
// module before importing anything that depends on it.
let mockSnapshot: { effectiveTier: string | null; rawTier: string | null } | null = null;
vi.mock("../design-os/state/useMe", () => ({
  getCachedMeSnapshot: () => mockSnapshot,
  getCachedMeSource: () => (mockSnapshot ? "real-http" : "unknown"),
}));

// Fake bus so we can inspect emitted events without pulling the whole
// event registry into jsdom.
const busEvents: Array<{ topic: string; payload: unknown }> = [];
vi.mock("../design-os/bridge/events", () => ({
  bus: {
    emit: (topic: string, payload: unknown) => {
      busEvents.push({ topic, payload });
    },
    on: () => () => {},
  },
}));

// Ensure localStorage has a stable starting value for each test.
function resetLocalStorage(initialMode: "clipper" | "agency" = "clipper") {
  const store = new Map<string, string>();
  store.set("lc.mode", initialMode);
  const fake = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  } as unknown as Storage;
  Object.defineProperty(globalThis, "localStorage", { value: fake, writable: true });
  Object.defineProperty(globalThis, "window", { value: { localStorage: fake, addEventListener: () => {} }, writable: true });
}

async function freshStore() {
  // Reload the module so `readPersistedMode()` re-runs with the
  // current localStorage snapshot.
  vi.resetModules();
  const mod = await import("./mode");
  return mod;
}

describe("V1-AGENCY-GATE · setMode entitlement", () => {
  beforeEach(() => {
    busEvents.length = 0;
    mockSnapshot = null;
    resetLocalStorage("clipper");
  });

  it("REFUSES agency toggle when no /me snapshot has hydrated (cold start)", async () => {
    mockSnapshot = null;
    const { useModeStore } = await freshStore();

    useModeStore.getState().setMode("agency");

    expect(useModeStore.getState().mode).toBe("clipper");
    const refusal = busEvents.find((e) => e.topic === "agency:gate-refused");
    expect(refusal).toBeDefined();
    expect((refusal!.payload as { reason: string }).reason).toBe("no_snapshot");
    expect((refusal!.payload as { code: string }).code).toBe("LC-AGENCY-GATE-001");
    const toast = busEvents.find((e) => e.topic === "toast");
    expect(toast).toBeDefined();
    expect((toast!.payload as { kind: string }).kind).toBe("warning");
  });

  it("REFUSES agency toggle when tier is free/clipper", async () => {
    mockSnapshot = { effectiveTier: "clipper", rawTier: "clipper" };
    const { useModeStore } = await freshStore();

    useModeStore.getState().setMode("agency");

    expect(useModeStore.getState().mode).toBe("clipper");
    const refusal = busEvents.find((e) => e.topic === "agency:gate-refused");
    expect(refusal).toBeDefined();
    expect((refusal!.payload as { reason: string }).reason).toBe("tier_not_agency");
    expect((refusal!.payload as { currentTier: string | null }).currentTier).toBe("clipper");
  });

  it("REFUSES agency toggle when tier is solo/pro/growth (paid but not agency)", async () => {
    for (const tier of ["solo", "pro", "growth", "channel", "starter", "studio", "studio_unlimited"]) {
      busEvents.length = 0;
      mockSnapshot = { effectiveTier: tier, rawTier: tier };
      const { useModeStore } = await freshStore();
      useModeStore.getState().setMode("agency");
      expect(useModeStore.getState().mode, `tier=${tier}`).toBe("clipper");
      expect(busEvents.find((e) => e.topic === "agency:gate-refused"), `tier=${tier}`).toBeDefined();
    }
  });

  it("ALLOWS agency toggle when tier is agency", async () => {
    mockSnapshot = { effectiveTier: "agency", rawTier: "agency" };
    const { useModeStore } = await freshStore();

    useModeStore.getState().setMode("agency");

    expect(useModeStore.getState().mode).toBe("agency");
    expect(busEvents.find((e) => e.topic === "agency:gate-refused")).toBeUndefined();
    // Broadcast fired.
    expect(busEvents.find((e) => e.topic === "mode:change")).toBeDefined();
  });

  it("ALLOWS agency toggle for autopilot (admin-elevated) tier", async () => {
    mockSnapshot = { effectiveTier: "autopilot", rawTier: "clipper" };
    const { useModeStore } = await freshStore();

    useModeStore.getState().setMode("agency");

    expect(useModeStore.getState().mode).toBe("agency");
    expect(busEvents.find((e) => e.topic === "agency:gate-refused")).toBeUndefined();
  });

  it("ALLOWS agency toggle for agency_solo / agency_whitelabel tiers", async () => {
    for (const tier of ["agency_solo", "agency_whitelabel"]) {
      busEvents.length = 0;
      mockSnapshot = { effectiveTier: tier, rawTier: tier };
      const { useModeStore } = await freshStore();
      useModeStore.getState().setMode("agency");
      expect(useModeStore.getState().mode, `tier=${tier}`).toBe("agency");
    }
  });

  it("ALLOWS downgrade to clipper regardless of tier", async () => {
    mockSnapshot = { effectiveTier: "clipper", rawTier: "clipper" };
    resetLocalStorage("agency"); // pretend we're already in agency
    const { useModeStore } = await freshStore();

    // No matter what tier claims, going back to clipper is fine.
    useModeStore.getState().setMode("clipper");

    expect(useModeStore.getState().mode).toBe("clipper");
    expect(busEvents.find((e) => e.topic === "agency:gate-refused")).toBeUndefined();
  });

  it("toggleMode() applies the same entitlement gate", async () => {
    mockSnapshot = { effectiveTier: "clipper", rawTier: "clipper" };
    const { useModeStore } = await freshStore();

    // Currently clipper · toggle should attempt agency → REFUSED
    useModeStore.getState().toggleMode();

    expect(useModeStore.getState().mode).toBe("clipper");
    expect(busEvents.find((e) => e.topic === "agency:gate-refused")).toBeDefined();
  });
});

describe("V1-AGENCY-GATE · canUseAgencyMode helper", () => {
  beforeEach(() => {
    busEvents.length = 0;
    resetLocalStorage("clipper");
  });

  it("returns false when snapshot is null", async () => {
    mockSnapshot = null;
    const { canUseAgencyMode } = await freshStore();
    expect(canUseAgencyMode()).toBe(false);
  });

  it("returns false for empty tier strings", async () => {
    mockSnapshot = { effectiveTier: "", rawTier: null };
    const { canUseAgencyMode } = await freshStore();
    expect(canUseAgencyMode()).toBe(false);
  });

  it("returns true for every agency-family backend tier", async () => {
    for (const tier of ["agency", "autopilot", "agency_solo", "agency_whitelabel"]) {
      mockSnapshot = { effectiveTier: tier, rawTier: null };
      const { canUseAgencyMode } = await freshStore();
      expect(canUseAgencyMode(), `tier=${tier}`).toBe(true);
    }
  });

  it("is case-insensitive on the tier string", async () => {
    mockSnapshot = { effectiveTier: "AGENCY", rawTier: null };
    const { canUseAgencyMode } = await freshStore();
    expect(canUseAgencyMode()).toBe(true);
  });

  it("falls back to rawTier when effectiveTier is null", async () => {
    mockSnapshot = { effectiveTier: null, rawTier: "agency" };
    const { canUseAgencyMode } = await freshStore();
    expect(canUseAgencyMode()).toBe(true);
  });
});
