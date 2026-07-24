/**
 * Deep-work mode · launch visibility contract.
 *
 * A fresh install must boot with nav + TopHud visible. Deep-work is an
 * opt-in focus view, not the first-run default, because it hides the
 * account/settings/notifications chrome that onboarding depends on.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DEEP_WORK_STORAGE_KEY, useDeepWorkMode } from "./deepWorkMode";

function mountHook<T>(hook: () => T): { current: T; unmount: () => void } {
  const container = document.createElement("div");
  const root: Root = createRoot(container);
  const sink: { current: T } = { current: undefined as unknown as T };
  function Probe(): null {
    sink.current = hook();
    return null;
  }
  act(() => { root.render(createElement(Probe)); });
  return {
    get current(): T { return sink.current; },
    unmount: () => { act(() => { root.unmount(); }); },
  };
}

describe("useDeepWorkMode · launch visibility", () => {
  beforeEach(() => {
    window.localStorage.removeItem(DEEP_WORK_STORAGE_KEY);
  });

  it("defaults to classic chrome visible on first launch", () => {
    const probe = mountHook(() => useDeepWorkMode());
    try {
      expect(probe.current.deepWork).toBe(false);
    } finally {
      probe.unmount();
    }
  });

  it("round-trips opt-in deep-work mode through localStorage", () => {
    const probe = mountHook(() => useDeepWorkMode());
    try {
      act(() => { probe.current.setDeepWork(true); });
      expect(probe.current.deepWork).toBe(true);
      expect(window.localStorage.getItem(DEEP_WORK_STORAGE_KEY)).toBe("1");
    } finally {
      probe.unmount();
    }
  });

  it("hydrates a user's prior opt-in deep-work preference", () => {
    window.localStorage.setItem(DEEP_WORK_STORAGE_KEY, "1");
    const probe = mountHook(() => useDeepWorkMode());
    try {
      expect(probe.current.deepWork).toBe(true);
    } finally {
      probe.unmount();
    }
  });
});
