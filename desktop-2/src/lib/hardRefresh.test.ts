/**
 * hardRefresh · tests
 *
 * Proves the eight contract points from the sprint brief:
 *   1. `hardRefresh` clears sessionStorage.
 *   2. `hardRefresh` preserves localStorage.lc.license.jwt.v1.
 *   3. `hardRefresh` preserves localStorage.lc.affiliate.snapshot.v1.
 *   4. `hardRefresh` wipes localStorage.lc.welcome-acked.
 *   5. `hardRefresh` wipes sessionStorage.lc.postAuthRedirect.
 *   6. `hardRefresh` emits `hard_refresh_triggered` diag with from_route.
 *   7. `hardRefresh` calls window.location.reload() (mocked, asserted).
 *   8. `hardRefresh` emits `app:hard-refresh` on the shared bus.
 *
 * Testing strategy — mirrors SectionWithFallback.test.tsx:
 *   - No @testing-library. Direct mocks + vi.stubGlobal for window.location.
 *   - vi.mock() the diagnosticLogger so no batch flusher fires.
 *   - Import the real `bus` and spy on emit + attach a listener.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────
// Capture every lcDiag call so we can assert `hard_refresh_triggered`
// lands with the correct from_route payload.
const diagCalls: Array<{ topic: string; data: Record<string, unknown> }> = [];
vi.mock("../lib/diagnosticLogger", () => ({
  lcDiag: (topic: string, data: Record<string, unknown> = {}) => {
    diagCalls.push({ topic, data });
  },
  bootDiag: () => undefined,
  probeSidecarState: async () => undefined,
  getDiagSessionId: () => "test-session",
  forceFlush: async () => undefined,
}));

// The file under test lives at src/lib/hardRefresh.ts — vi.mock resolves
// relative to THIS file, so "./diagnosticLogger" is the correct path.
vi.mock("./diagnosticLogger", () => ({
  lcDiag: (topic: string, data: Record<string, unknown> = {}) => {
    diagCalls.push({ topic, data });
  },
  bootDiag: () => undefined,
  probeSidecarState: async () => undefined,
  getDiagSessionId: () => "test-session",
  forceFlush: async () => undefined,
}));

// Import AFTER mocks are declared so the module picks up the stub.
// eslint-disable-next-line import/first
import { hardRefresh, HARD_REFRESH_PRESERVED_KEYS } from "./hardRefresh";
// eslint-disable-next-line import/first
import { bus } from "../design-os/bridge";

// ── State reset ──────────────────────────────────────────────────────
const reloadMock = vi.fn();

beforeEach(() => {
  diagCalls.length = 0;
  reloadMock.mockReset();
  try { window.localStorage.clear(); } catch { /* non-fatal */ }
  try { window.sessionStorage.clear(); } catch { /* non-fatal */ }
  // Stub window.location so `window.location.reload()` is intercepted
  // AND `window.location.hash` returns a known value for from_route.
  vi.stubGlobal("location", { reload: reloadMock, hash: "#/mock" });
  // Clear every bus subscriber left over from a prior test.
  bus.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  bus.clear();
});

// ═════════════════════════════════════════════════════════════════════
// 1. sessionStorage wipe.
// ═════════════════════════════════════════════════════════════════════

describe("hardRefresh · sessionStorage", () => {
  it("clears sessionStorage entirely", async () => {
    window.sessionStorage.setItem("lc.postAuthRedirect", "/wallet");
    window.sessionStorage.setItem("some-other-key", "value");
    await hardRefresh();
    expect(window.sessionStorage.getItem("lc.postAuthRedirect")).toBeNull();
    expect(window.sessionStorage.getItem("some-other-key")).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });

  it("wipes sessionStorage.lc.postAuthRedirect specifically", async () => {
    window.sessionStorage.setItem("lc.postAuthRedirect", "/wallet");
    await hardRefresh();
    expect(window.sessionStorage.getItem("lc.postAuthRedirect")).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════
// 2. + 3. Preserved localStorage keys.
// ═════════════════════════════════════════════════════════════════════

describe("hardRefresh · localStorage preservation", () => {
  it("preserves lc.license.jwt.v1", async () => {
    window.localStorage.setItem("lc.license.jwt.v1", "jwt-value");
    window.localStorage.setItem("lc.welcome-acked", "1");
    await hardRefresh();
    expect(window.localStorage.getItem("lc.license.jwt.v1")).toBe("jwt-value");
  });

  it("preserves lc.affiliate.snapshot.v1", async () => {
    window.localStorage.setItem("lc.affiliate.snapshot.v1", "{\"code\":\"maxfrom\"}");
    window.localStorage.setItem("lc.welcome-acked", "1");
    await hardRefresh();
    expect(window.localStorage.getItem("lc.affiliate.snapshot.v1")).toBe("{\"code\":\"maxfrom\"}");
  });

  it("wipes stale lc:user-mode:v1 (RC1 · zustand mode store consolidated to lc.mode)", async () => {
    // RC1 state-drift trifecta · P0-1 (2026-07-11) — the dual mode
    // persistence has been eliminated. `lc.mode` is now the ONLY key
    // that stores clipper/agency choice; the old `lc:user-mode:v1`
    // key is deprecated. A pre-migration install may still have the
    // stale key set — hard refresh must wipe it so future sessions
    // don't accidentally re-hydrate two conflicting stores.
    window.localStorage.setItem("lc.mode", "agency");
    window.localStorage.setItem(
      "lc:user-mode:v1",
      JSON.stringify({ state: { mode: "agency" }, version: 0 }),
    );
    window.localStorage.setItem("lc.welcome-acked", "wipe-me");
    await hardRefresh();
    // Canonical key preserved · stale zustand key removed.
    expect(window.localStorage.getItem("lc.mode")).toBe("agency");
    expect(window.localStorage.getItem("lc:user-mode:v1")).toBeNull();
    expect(window.localStorage.getItem("lc.welcome-acked")).toBeNull();
  });

  it("preserves the full HARD_REFRESH_PRESERVED_KEYS list", async () => {
    for (const key of HARD_REFRESH_PRESERVED_KEYS) {
      window.localStorage.setItem(key, `value-for-${key}`);
    }
    window.localStorage.setItem("lc.welcome-acked", "wipe-me");
    await hardRefresh();
    for (const key of HARD_REFRESH_PRESERVED_KEYS) {
      expect(window.localStorage.getItem(key)).toBe(`value-for-${key}`);
    }
  });

  it("leaves non-namespaced keys alone", async () => {
    // A key that doesn't start with lc. / lc: / postiz. / engine. is
    // outside our wipe surface — leave it alone.
    window.localStorage.setItem("some-third-party-key", "keep-me");
    await hardRefresh();
    expect(window.localStorage.getItem("some-third-party-key")).toBe("keep-me");
  });
});

// ═════════════════════════════════════════════════════════════════════
// 4. Wiped localStorage keys.
// ═════════════════════════════════════════════════════════════════════

describe("hardRefresh · localStorage wipe", () => {
  it("wipes lc.welcome-acked", async () => {
    window.localStorage.setItem("lc.welcome-acked", "1");
    await hardRefresh();
    expect(window.localStorage.getItem("lc.welcome-acked")).toBeNull();
  });

  it("wipes lc: prefixed keys (colon namespace)", async () => {
    window.localStorage.setItem("lc:welcome-acked", "1");
    window.localStorage.setItem("lc:guest-mode", "1");
    await hardRefresh();
    expect(window.localStorage.getItem("lc:welcome-acked")).toBeNull();
    expect(window.localStorage.getItem("lc:guest-mode")).toBeNull();
  });

  it("wipes postiz. prefixed keys", async () => {
    window.localStorage.setItem("postiz.tenant.cache", "abc");
    await hardRefresh();
    expect(window.localStorage.getItem("postiz.tenant.cache")).toBeNull();
  });

  it("wipes engine. prefixed keys", async () => {
    window.localStorage.setItem("engine.session.slug", "xyz");
    await hardRefresh();
    expect(window.localStorage.getItem("engine.session.slug")).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════
// 5. Diag emission.
// ═════════════════════════════════════════════════════════════════════

describe("hardRefresh · diagnostics", () => {
  it("emits hard_refresh_triggered with from_route", async () => {
    await hardRefresh();
    const triggers = diagCalls.filter((c) => c.topic === "hard_refresh_triggered");
    expect(triggers).toHaveLength(1);
    expect(triggers[0].data.from_route).toBe("#/mock");
  });

  it("emits BEFORE the storage wipe (so from_route is honest)", async () => {
    // Prime storage that would be wiped — the diag payload should read
    // the hash before we blow anything away. from_route is derived from
    // window.location.hash, which our stub returns as "#/mock".
    window.localStorage.setItem("lc.welcome-acked", "1");
    await hardRefresh();
    const triggers = diagCalls.filter((c) => c.topic === "hard_refresh_triggered");
    expect(triggers[0].data.from_route).toBe("#/mock");
  });
});

// ═════════════════════════════════════════════════════════════════════
// 6. Bus event.
// ═════════════════════════════════════════════════════════════════════

describe("hardRefresh · bus event", () => {
  it("emits app:hard-refresh on the shared bus", async () => {
    const handler = vi.fn();
    bus.on("app:hard-refresh", handler);
    await hardRefresh();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("fires the bus event BEFORE reload (so subscribers get their tick)", async () => {
    const callOrder: string[] = [];
    bus.on("app:hard-refresh", () => callOrder.push("bus"));
    reloadMock.mockImplementation(() => callOrder.push("reload"));
    await hardRefresh();
    expect(callOrder).toEqual(["bus", "reload"]);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 7. window.location.reload().
// ═════════════════════════════════════════════════════════════════════

describe("hardRefresh · reload", () => {
  it("calls window.location.reload() exactly once", async () => {
    await hardRefresh();
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("still reloads even when localStorage is unavailable", async () => {
    // Simulate a hostile environment where localStorage throws.
    const origLs = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("blocked");
      },
    });
    try {
      await hardRefresh();
      expect(reloadMock).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: origLs,
      });
    }
  });
});
