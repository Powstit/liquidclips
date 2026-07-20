/**
 * HUD stores · mode + speed persistence contract (2026-07-19)
 *
 * Locks the localStorage round-trip + default contract for the two
 * HUD stores that back the mockup's Kade/Classic toggle and 1×/2×/5×
 * speed selector. If either store starts silently forgetting state
 * across reloads, this test fires first.
 *
 * Sister to `deepWorkMode.test.ts` behavioural pattern — probe the
 * hook via a throw-away React root, drive the setter through `act`,
 * assert what landed in `localStorage`.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";
import {
  useModeStore,
  MODE_STORAGE_KEY,
  type HudMode,
} from "./modeStore";
import {
  useSpeedStore,
  SPEED_STORAGE_KEY,
  type HudSpeed,
} from "./speedStore";

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

describe("useModeStore · Kade/Classic persistence", () => {
  beforeEach(() => {
    window.localStorage.removeItem(MODE_STORAGE_KEY);
  });

  it("defaults to 'kade' on first read", () => {
    const probe = mountHook(() => useModeStore());
    try {
      const [mode] = probe.current;
      expect(mode).toBe<HudMode>("kade");
    } finally {
      probe.unmount();
    }
  });

  it("round-trips 'classic' through localStorage", () => {
    const probe = mountHook(() => useModeStore());
    try {
      const [, setMode] = probe.current;
      act(() => { setMode("classic"); });
      const [mode] = probe.current;
      expect(mode).toBe<HudMode>("classic");
      expect(window.localStorage.getItem(MODE_STORAGE_KEY)).toBe("classic");
    } finally {
      probe.unmount();
    }
  });

  it("hydrates 'classic' from a pre-existing localStorage value", () => {
    window.localStorage.setItem(MODE_STORAGE_KEY, "classic");
    const probe = mountHook(() => useModeStore());
    try {
      const [mode] = probe.current;
      expect(mode).toBe<HudMode>("classic");
    } finally {
      probe.unmount();
    }
  });

  it("round-trips 'kade' back after being set to 'classic'", () => {
    window.localStorage.setItem(MODE_STORAGE_KEY, "classic");
    const probe = mountHook(() => useModeStore());
    try {
      const [initial, setMode] = probe.current;
      expect(initial).toBe<HudMode>("classic");
      act(() => { setMode("kade"); });
      const [mode] = probe.current;
      expect(mode).toBe<HudMode>("kade");
      expect(window.localStorage.getItem(MODE_STORAGE_KEY)).toBe("kade");
    } finally {
      probe.unmount();
    }
  });
});

describe("useSpeedStore · 1×/2×/5× persistence", () => {
  beforeEach(() => {
    window.localStorage.removeItem(SPEED_STORAGE_KEY);
  });

  it("defaults to 1 on first read", () => {
    const probe = mountHook(() => useSpeedStore());
    try {
      const [speed] = probe.current;
      expect(speed).toBe<HudSpeed>(1);
    } finally {
      probe.unmount();
    }
  });

  it("round-trips 2 through localStorage", () => {
    const probe = mountHook(() => useSpeedStore());
    try {
      const [, setSpeed] = probe.current;
      act(() => { setSpeed(2); });
      const [speed] = probe.current;
      expect(speed).toBe<HudSpeed>(2);
      expect(window.localStorage.getItem(SPEED_STORAGE_KEY)).toBe("2");
    } finally {
      probe.unmount();
    }
  });

  it("round-trips 5 through localStorage", () => {
    const probe = mountHook(() => useSpeedStore());
    try {
      const [, setSpeed] = probe.current;
      act(() => { setSpeed(5); });
      const [speed] = probe.current;
      expect(speed).toBe<HudSpeed>(5);
      expect(window.localStorage.getItem(SPEED_STORAGE_KEY)).toBe("5");
    } finally {
      probe.unmount();
    }
  });

  it("hydrates 5 from a pre-existing localStorage value", () => {
    window.localStorage.setItem(SPEED_STORAGE_KEY, "5");
    const probe = mountHook(() => useSpeedStore());
    try {
      const [speed] = probe.current;
      expect(speed).toBe<HudSpeed>(5);
    } finally {
      probe.unmount();
    }
  });

  it("falls back to default 1 when a stray value is stored", () => {
    // Defensive · an old build (or a stale QA cache) might have
    // written a value outside the fixed ladder. Reader must reject
    // it rather than passing garbage downstream.
    window.localStorage.setItem(SPEED_STORAGE_KEY, "9");
    const probe = mountHook(() => useSpeedStore());
    try {
      const [speed] = probe.current;
      expect(speed).toBe<HudSpeed>(1);
    } finally {
      probe.unmount();
    }
  });
});

describe("HUD store storage keys · versioned + stable", () => {
  it("MODE_STORAGE_KEY is 'lc:hud-mode.v1'", () => {
    expect(MODE_STORAGE_KEY).toBe("lc:hud-mode.v1");
  });
  it("SPEED_STORAGE_KEY is 'lc:hud-speed.v1'", () => {
    expect(SPEED_STORAGE_KEY).toBe("lc:hud-speed.v1");
  });
});
