/**
 * useAuth · P0-3 · single source of truth for JWT presence
 *
 * Contract tests (RC1 state-drift trifecta · 2026-07-11).
 *
 * Daniel-locked acceptance criterion 1: signin updates every identity
 * surface without reload. This suite proves the canonical hook is the
 * one place every consumer subscribes to and that a signin bus event
 * flips every subscriber on the same tick.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { createElement } from "react";
import { useAuth, _resetUseAuthForTests } from "./useAuth";
import { setJwt, clearJwt, _resetAuthStorageForTests } from "./authStorage";
import { bus } from "../design-os/bridge/events";

// Silence the diagnostic logger — no batch flushes during tests.
vi.mock("./diagnosticLogger", () => ({
  lcDiag: () => undefined,
  bootDiag: () => undefined,
  probeSidecarState: async () => undefined,
  getDiagSessionId: () => "test-session",
  forceFlush: async () => undefined,
}));

/** Small React harness — renders a fn-body component that captures the
 *  latest useAuth() snapshot into `sink`. Returns the sink so tests can
 *  assert the value + a render-count so we can prove synchronous flip. */
interface ProbeSink {
  hasJwt: boolean;
  renderCount: number;
}

function mountProbe(container: HTMLDivElement, sink: ProbeSink): Root {
  const root = createRoot(container);
  function Probe() {
    const auth = useAuth();
    sink.hasJwt = auth.hasJwt;
    sink.renderCount += 1;
    return null;
  }
  act(() => { root.render(createElement(Probe)); });
  return root;
}

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* non-fatal */ }
  bus.clear();
  _resetAuthStorageForTests();
  _resetUseAuthForTests();
});

afterEach(() => {
  bus.clear();
});

describe("useAuth · module-scope cache", () => {
  it("reflects JWT presence at first render", () => {
    setJwt("test-jwt-1");
    _resetUseAuthForTests(); // re-read cache after direct setJwt

    const container = document.createElement("div");
    const sink: ProbeSink = { hasJwt: false, renderCount: 0 };
    const root = mountProbe(container, sink);
    try {
      expect(sink.hasJwt).toBe(true);
    } finally {
      act(() => { root.unmount(); });
    }
  });

  it("reflects no-JWT at first render when localStorage is empty", () => {
    const container = document.createElement("div");
    const sink: ProbeSink = { hasJwt: true, renderCount: 0 };
    const root = mountProbe(container, sink);
    try {
      expect(sink.hasJwt).toBe(false);
    } finally {
      act(() => { root.unmount(); });
    }
  });
});

describe("useAuth · flips on bus events", () => {
  it("flips true when auth:signed-in fires after a setJwt", () => {
    const container = document.createElement("div");
    const sink: ProbeSink = { hasJwt: false, renderCount: 0 };
    const root = mountProbe(container, sink);
    try {
      expect(sink.hasJwt).toBe(false);

      // Simulate SimpleLoginPanel OTP verify — write JWT, emit event.
      act(() => {
        setJwt("otp-jwt");
        bus.emit("auth:signed-in", {});
      });

      expect(sink.hasJwt).toBe(true);
    } finally {
      act(() => { root.unmount(); });
    }
  });

  it("flips true when activation:complete fires (Whop deep-link path)", () => {
    const container = document.createElement("div");
    const sink: ProbeSink = { hasJwt: false, renderCount: 0 };
    const root = mountProbe(container, sink);
    try {
      expect(sink.hasJwt).toBe(false);
      act(() => {
        setJwt("whop-jwt");
        bus.emit("activation:complete", { source: "whop" });
      });
      expect(sink.hasJwt).toBe(true);
    } finally {
      act(() => { root.unmount(); });
    }
  });

  it("flips false when auth:signed-out fires after a clearJwt", () => {
    setJwt("existing-jwt");
    _resetUseAuthForTests(); // re-prime cache to true

    const container = document.createElement("div");
    const sink: ProbeSink = { hasJwt: false, renderCount: 0 };
    const root = mountProbe(container, sink);
    try {
      expect(sink.hasJwt).toBe(true);
      act(() => {
        clearJwt();
        bus.emit("auth:signed-out", {});
      });
      expect(sink.hasJwt).toBe(false);
    } finally {
      act(() => { root.unmount(); });
    }
  });
});

describe("useAuth · fan-out to multiple consumers on one tick", () => {
  it("flips every mounted consumer on the same auth:signed-in tick", () => {
    // Mount THREE independent probes in three roots. This is the exact
    // shape the app has today (TopHud, SideNav / SplashLeaderboard,
    // MembershipGate all subscribing independently). Prior to the
    // trifecta fix each mount installed its own useState + listener,
    // and a race left them out-of-sync.
    const containers = [
      document.createElement("div"),
      document.createElement("div"),
      document.createElement("div"),
    ];
    const sinks: ProbeSink[] = [
      { hasJwt: false, renderCount: 0 },
      { hasJwt: false, renderCount: 0 },
      { hasJwt: false, renderCount: 0 },
    ];
    const roots = containers.map((c, i) => mountProbe(c, sinks[i]));
    try {
      // All three start with hasJwt = false.
      for (const s of sinks) expect(s.hasJwt).toBe(false);

      act(() => {
        setJwt("fan-out-jwt");
        bus.emit("auth:signed-in", {});
      });

      // All three flipped in the same act() commit — no drift.
      for (const s of sinks) expect(s.hasJwt).toBe(true);
    } finally {
      for (const r of roots) act(() => { r.unmount(); });
    }
  });
});

describe("useAuth · cross-tab storage event", () => {
  it("re-reads on `storage` event that clears the JWT key", () => {
    setJwt("cross-tab-jwt");
    _resetUseAuthForTests();

    const container = document.createElement("div");
    const sink: ProbeSink = { hasJwt: false, renderCount: 0 };
    const root = mountProbe(container, sink);
    try {
      expect(sink.hasJwt).toBe(true);

      // Simulate another tab clearing the JWT — clear localStorage
      // directly (as if the other tab did) then dispatch the
      // synthetic StorageEvent. This is the only path that fires
      // storage events in jsdom.
      act(() => {
        window.localStorage.removeItem("lc.license.jwt.v1");
        _resetAuthStorageForTests();
        window.dispatchEvent(new StorageEvent("storage", {
          key: "lc.license.jwt.v1",
          oldValue: "cross-tab-jwt",
          newValue: null,
        }));
      });

      expect(sink.hasJwt).toBe(false);
    } finally {
      act(() => { root.unmount(); });
    }
  });
});
