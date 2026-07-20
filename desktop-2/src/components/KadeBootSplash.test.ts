// @vitest-environment jsdom
/**
 * IG-BOOT-CHECK-THEN-SERVE · Layer 3 · KadeBootSplash behaviour tests.
 * LOCKED 2026-07-20.
 *
 * Locks the actual check-and-reload behaviour by exercising the
 * component with a mocked Tauri invoke:
 *   - browser (no Tauri) → children render immediately
 *   - loop-guard → skips the check on rapid reboots
 *   - version drift → triggers window.location.reload()
 *   - no drift → dismisses splash + renders children
 *   - timeout → falls through to children without reload
 *   - initial telemetry emits stable event names
 *
 * The regression this locks: without an awaited check-and-reload,
 * boot serves whatever bundle happened to be staged on the PRIOR
 * session — users always ~1 ship behind.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

// ── Test seams · we mock the whole invoke surface + telemetry ──────

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const diagEvents: Array<{ topic: string; data: unknown }> = [];
vi.mock("../lib/diagnosticLogger", () => ({
  lcDiag: (topic: string, data: unknown) => {
    diagEvents.push({ topic, data });
  },
  bootDiag: () => undefined,
  probeSidecarState: async () => undefined,
  getDiagSessionId: () => "test-session",
  forceFlush: async () => undefined,
}));

// ── Test helpers ───────────────────────────────────────────────────

const RELOAD_MARK_KEY = "lc.boot-reload-at";

function resetLocalStorage(): void {
  const store = new Map<string, string>();
  const fake = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  } as unknown as Storage;
  Object.defineProperty(window, "localStorage", { value: fake, writable: true, configurable: true });
}

function setTauriRuntime(isTauri: boolean): void {
  if (isTauri) {
    (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ = {};
  } else {
    delete (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
  }
}

async function mountSplash(root: Root, children: string = "REAL-APP"): Promise<void> {
  // Dynamic ESM import so the mocks are in place before module init.
  const mod = await import("./KadeBootSplash");
  await act(async () => {
    root.render(createElement(mod.KadeBootSplash, null, children));
  });
}

async function waitTick(ms: number = 0): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  invokeMock.mockReset();
  diagEvents.length = 0;
  vi.resetModules();
  resetLocalStorage();
  setTauriRuntime(true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

// ─────────────────────────────────────────────────────────────────────

describe("IG-BOOT-CHECK-THEN-SERVE · KadeBootSplash · browser fallthrough", () => {
  it("renders children IMMEDIATELY when not running under Tauri", async () => {
    setTauriRuntime(false);
    await mountSplash(root, "APP-BROWSER");
    expect(container.textContent).toContain("APP-BROWSER");
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("IG-BOOT-CHECK-THEN-SERVE · KadeBootSplash · loop-guard", () => {
  it("SKIPS the check when a reload happened within the loop-guard window", async () => {
    window.localStorage.setItem(RELOAD_MARK_KEY, String(Date.now() - 5_000));
    await mountSplash(root, "APP-SKIPPED");
    await waitTick(50);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("APP-SKIPPED");
    expect(diagEvents.find((e) => e.topic === "kade_boot_splash_skipped")).toBeDefined();
  });
});

describe("IG-BOOT-CHECK-THEN-SERVE · KadeBootSplash · check-and-reload", () => {
  it("triggers hardReloadForRuntimeSwap() when a NEW bundle stages during the check", async () => {
    // Spy on the helper module directly (rather than patching
    // window.location) — that's the whole point of the indirection.
    const reloadSpy = vi.fn();
    vi.doMock("../lib/hardReload", () => ({
      hardReloadForRuntimeSwap: reloadSpy,
    }));

    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "runtime_info") {
        // Two calls: first returns version A, second returns B → drift.
        const callCount = invokeMock.mock.calls.filter((c) => c[0] === "runtime_info").length;
        return { active_version: callCount === 1 ? "2.2.60" : "2.2.61", source: "staged" };
      }
      if (cmd === "runtime_check_now") return undefined;
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    await mountSplash(root, "APP-DRIFT");
    await waitTick(600);

    const reloadEvent = diagEvents.find((e) => e.topic === "kade_boot_splash_activate");
    expect(reloadEvent).toBeDefined();
    expect((reloadEvent!.data as { initial_version: string }).initial_version).toBe("2.2.60");
    expect((reloadEvent!.data as { new_version: string }).new_version).toBe("2.2.61");
    // Reload is delayed 250ms; ensure the mark is set + reload fired.
    expect(window.localStorage.getItem(RELOAD_MARK_KEY)).not.toBeNull();
    expect(reloadSpy).toHaveBeenCalled();
  });

  it("DISMISSES the splash and renders children when the check completes with no drift", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "runtime_info") return { active_version: "2.2.60", source: "staged" };
      if (cmd === "runtime_check_now") return undefined;
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    await mountSplash(root, "APP-NODRIFT");
    // Wait past MIN_SPLASH_MS (400ms) plus a small buffer.
    await waitTick(600);

    expect(container.textContent).toContain("APP-NODRIFT");
    expect(diagEvents.find((e) => e.topic === "kade_boot_splash_pass")).toBeDefined();
  });
});

describe("IG-BOOT-CHECK-THEN-SERVE · KadeBootSplash · offline / timeout", () => {
  it("falls through to children when runtime_check_now rejects (offline)", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "runtime_info") return { active_version: "2.2.60", source: "staged" };
      if (cmd === "runtime_check_now") throw new Error("network unreachable");
      return undefined;
    });

    await mountSplash(root, "APP-OFFLINE");
    await waitTick(600);

    expect(container.textContent).toContain("APP-OFFLINE");
    expect(diagEvents.find((e) => e.topic === "kade_boot_splash_fallthrough")).toBeDefined();
  });

  it("falls through to children when runtime_check_now hangs past CHECK_TIMEOUT_MS", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "runtime_info") return { active_version: "2.2.60", source: "staged" };
      // Simulate a hang · never resolves.
      if (cmd === "runtime_check_now") return new Promise(() => { /* pending forever */ });
      return undefined;
    });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mountSplash(root, "APP-HANG");
    // Fast-forward past CHECK_TIMEOUT_MS (15s) + MIN_SPLASH_MS (400ms).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    vi.useRealTimers();

    // Timeout produces a fallthrough diag.
    expect(diagEvents.find((e) => e.topic === "kade_boot_splash_fallthrough")).toBeDefined();
  }, 20_000);
});
