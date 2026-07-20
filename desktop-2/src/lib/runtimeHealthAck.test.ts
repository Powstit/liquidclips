// @vitest-environment jsdom
/**
 * IG-BOOT-HEALTH-ACK · Layer 3 · runtimeHealthAck vitest.
 * LOCKED 2026-07-20.
 *
 * Locks:
 *   - Browser fallthrough (no Tauri = no invoke)
 *   - Tauri path invokes `runtime_ack_boot_healthy` after the delay
 *   - Invoke error is swallowed silently (never rejects the caller)
 *   - Cleanup on unmount cancels the pending timer
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function setTauriRuntime(isTauri: boolean): void {
  if (isTauri) {
    (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ = {};
  } else {
    delete (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
  }
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  invokeMock.mockReset();
  vi.resetModules();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mountHost(): Promise<void> {
  const { useRuntimeBootHealthyAck } = await import("./runtimeHealthAck");
  function Host() {
    useRuntimeBootHealthyAck();
    return null;
  }
  await act(async () => {
    root.render(createElement(Host));
  });
}

describe("IG-BOOT-HEALTH-ACK · useRuntimeBootHealthyAck", () => {
  it("NO-OP in browser (no __TAURI_INTERNALS__)", async () => {
    setTauriRuntime(false);
    vi.useFakeTimers();
    await mountHost();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    vi.useRealTimers();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("Invokes runtime_ack_boot_healthy after the delay window (Tauri path)", async () => {
    setTauriRuntime(true);
    invokeMock.mockResolvedValue(undefined);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mountHost();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_800);
    });
    vi.useRealTimers();
    expect(invokeMock).toHaveBeenCalledWith("runtime_ack_boot_healthy");
  });

  it("Does NOT invoke before the delay elapses", async () => {
    setTauriRuntime(true);
    invokeMock.mockResolvedValue(undefined);
    vi.useFakeTimers();
    await mountHost();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    vi.useRealTimers();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("Cancels the pending timer on unmount (no invoke fires after unmount)", async () => {
    setTauriRuntime(true);
    invokeMock.mockResolvedValue(undefined);
    vi.useFakeTimers();
    await mountHost();
    // Unmount BEFORE the delay elapses.
    await act(async () => {
      root.unmount();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    vi.useRealTimers();
    expect(invokeMock).not.toHaveBeenCalled();
    // Prevent afterEach from calling unmount again.
    root = createRoot(document.createElement("div"));
  });

  it("Swallows invoke rejection silently (never throws to caller)", async () => {
    setTauriRuntime(true);
    invokeMock.mockRejectedValue(new Error("IPC boom"));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mountHost();
    // If the rejection propagated, this would throw inside act().
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    vi.useRealTimers();
    expect(invokeMock).toHaveBeenCalled();
  });
});
