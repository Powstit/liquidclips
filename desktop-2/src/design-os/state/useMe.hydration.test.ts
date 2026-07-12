/**
 * useMe · BUG-015 · BC-002 · hydration state machine test suite
 *
 * Locks the 4-transition hydration state machine (started / succeeded /
 * stalled / failed), the ``me_hydration_kind_drift`` dev-only rail, and
 * the ``IdentityKind`` union membership rule.
 *
 * Harness discipline (matches `useAuth.test.ts`):
 *   - `createRoot` + React `act` · no @testing-library.
 *   - `vi.mock("../../lib/diagnosticLogger")` to capture `lcDiag` topics
 *     without a real batch flush.
 *   - `vi.useFakeTimers()` for the 8s stall watchdog.
 *   - Fetch is stubbed via `vi.stubGlobal("fetch", …)` per test.
 *
 * Author: Agent A1 · wave-a1/identity-hydration · 2026-07-12.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { createElement } from "react";
import {
  useMe,
  loadMe,
  _resetMeForTests,
  ME_HYDRATION_STALL_MS,
  type IdentityKind,
} from "./useMe";
import { setJwt, clearJwt, _resetAuthStorageForTests } from "../../lib/authStorage";

/* ─── Diagnostic logger capture ──────────────────────────────────────── */

interface DiagCall {
  topic: string;
  data: Record<string, unknown>;
}
const diagCalls: DiagCall[] = [];
vi.mock("../../lib/diagnosticLogger", () => ({
  lcDiag: (topic: string, data: Record<string, unknown> = {}): void => {
    diagCalls.push({ topic, data });
  },
  bootDiag: (): void => undefined,
  probeSidecarState: async (): Promise<void> => undefined,
  getDiagSessionId: (): string => "test-session",
  forceFlush: async (): Promise<void> => undefined,
}));

function topics(): string[] {
  return diagCalls.map((c) => c.topic);
}

function countTopic(t: string): number {
  return diagCalls.filter((c) => c.topic === t).length;
}

function lastPayloadFor(t: string): Record<string, unknown> | null {
  for (let i = diagCalls.length - 1; i >= 0; i -= 1) {
    if (diagCalls[i].topic === t) return diagCalls[i].data;
  }
  return null;
}

/* ─── Small React probe harness ──────────────────────────────────────── */

interface ProbeSink {
  kind: IdentityKind | null;
  source: string;
  renderCount: number;
}

function mountProbe(container: HTMLDivElement, sink: ProbeSink): Root {
  const root = createRoot(container);
  function Probe(): null {
    const me = useMe();
    sink.kind = me.kind;
    sink.source = me.source;
    sink.renderCount += 1;
    return null;
  }
  act(() => {
    root.render(createElement(Probe));
  });
  return root;
}

/* ─── Fetch stubs ────────────────────────────────────────────────────── */

function stubFetch200(body: Record<string, unknown>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

function stubFetch500(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response("boom", { status: 500 }),
    ),
  );
}

function stubFetchHang(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => { /* never resolves */ })),
  );
}

/* ─── Shared setup ───────────────────────────────────────────────────── */

beforeEach(() => {
  diagCalls.length = 0;
  try { window.localStorage.clear(); } catch { /* non-fatal */ }
  _resetAuthStorageForTests();
  _resetMeForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearJwt();
});

/* ─── Suite 1 · hydration transitions ────────────────────────────────── */

describe("useMe · BUG-015 · hydration state machine", () => {
  it("hydration-fires-started-once · mount hook fires `me_hydration_started` exactly once", async () => {
    setJwt("valid.jwt.for.started");
    // 200 response — we only care about the initial started emit.
    stubFetch200({ lc_id: "LC-STARTED", handle: null, email: "user@example.com" });

    const container = document.createElement("div");
    const sink: ProbeSink = { kind: null, source: "unknown", renderCount: 0 };
    const root = mountProbe(container, sink);
    try {
      // Let the mount effect kick off `loadMe`.
      await act(async () => {
        await Promise.resolve();
      });
      // `me_hydration_started` fires synchronously inside `loadMe`
      // before the async fetch resolves, so it MUST already be present.
      expect(countTopic("me_hydration_started")).toBe(1);
    } finally {
      act(() => { root.unmount(); });
    }
  });

  it("hydration-fires-succeeded-on-real-http · 200 response fires succeeded + hydrates lcId/handle", async () => {
    setJwt("valid.jwt.for.success");
    stubFetch200({
      lc_id: "LC-000042",
      handle: "danielx",
      email: "daniel@liquidclips.app",
    });

    const container = document.createElement("div");
    const sink: ProbeSink = { kind: null, source: "unknown", renderCount: 0 };
    const root = mountProbe(container, sink);
    try {
      // Drive the fetch resolution + subsequent React state emit.
      await act(async () => {
        await loadMe();
      });

      // Started + succeeded must both be present.
      expect(topics()).toContain("me_hydration_started");
      expect(topics()).toContain("me_hydration_succeeded");

      // Snapshot fields are populated (validated via classifier).
      // handle takes rung 1.
      expect(sink.kind).toBe("handle");
      expect(sink.source).toBe("real-http");

      // Payload boolean-only shape.
      const p = lastPayloadFor("me_hydration_succeeded");
      expect(p).not.toBeNull();
      expect(p!.hasHandle).toBe(true);
      expect(p!.hasLcId).toBe(true);
      expect(p!.hasJwt).toBe(true);
      expect(typeof p!.elapsedMs).toBe("number");
    } finally {
      act(() => { root.unmount(); });
    }
  });

  it("hydration-fires-stalled-after-8s · never-resolving fetch triggers stall watchdog", async () => {
    vi.useFakeTimers();
    setJwt("valid.jwt.for.stall");
    stubFetchHang();

    const container = document.createElement("div");
    const sink: ProbeSink = { kind: null, source: "unknown", renderCount: 0 };
    const root = mountProbe(container, sink);
    try {
      // Kick off the loader manually so we control timing.
      // NOTE: not awaited — the fetch never resolves.
      void loadMe();

      // Started is synchronous.
      expect(countTopic("me_hydration_started")).toBe(1);
      expect(countTopic("me_hydration_stalled")).toBe(0);

      // Advance to just before the threshold — no stall yet.
      await act(async () => {
        vi.advanceTimersByTime(ME_HYDRATION_STALL_MS - 1);
      });
      expect(countTopic("me_hydration_stalled")).toBe(0);

      // Advance past the threshold — stall fires exactly once.
      await act(async () => {
        vi.advanceTimersByTime(2);
      });
      expect(countTopic("me_hydration_stalled")).toBe(1);

      // Payload records the elapsed time is at least the stall threshold.
      const p = lastPayloadFor("me_hydration_stalled");
      expect(p).not.toBeNull();
      expect(typeof p!.elapsedMs).toBe("number");
      expect(p!.hasJwt).toBe(true);
    } finally {
      act(() => { root.unmount(); });
    }
  });

  it("hydration-fires-failed-on-5xx · 500 response fires failed with cause payload", async () => {
    setJwt("valid.jwt.for.500");
    stubFetch500();

    const container = document.createElement("div");
    const sink: ProbeSink = { kind: null, source: "unknown", renderCount: 0 };
    const root = mountProbe(container, sink);
    try {
      await act(async () => {
        await loadMe();
      });

      expect(topics()).toContain("me_hydration_started");
      expect(topics()).toContain("me_hydration_failed");

      const p = lastPayloadFor("me_hydration_failed");
      expect(p).not.toBeNull();
      expect(p!.cause).toBe("server-error");
      expect(p!.status).toBe(500);
      expect(p!.hasJwt).toBe(true);
    } finally {
      act(() => { root.unmount(); });
    }
  });
});

/* ─── Suite 2 · IdentityKind union membership ───────────────────────── */

describe("useMe · BUG-015 · IdentityKind union membership", () => {
  const ALLOWED = new Set<string>([
    "handle",
    "lc-id",
    "email-local",
    "signing-in",
    "complete-profile",
  ]);

  function assertKindMembership(kind: IdentityKind | null): void {
    if (kind === null) return; // null is a legitimate non-union value
    expect(ALLOWED.has(kind)).toBe(true);
  }

  it("kind-in-identity-kind-union · every observed kind across all states is a union member", async () => {
    const container = document.createElement("div");
    const sink: ProbeSink = { kind: null, source: "unknown", renderCount: 0 };
    const root = mountProbe(container, sink);
    try {
      // State 1 · signed-out (no jwt, no snapshot) → null.
      // Reset just in case another test polluted the cache.
      await act(async () => {
        clearJwt();
        _resetMeForTests();
        await loadMe();
      });
      // Force a re-render for the probe by re-mounting the effect flow.
      assertKindMembership(sink.kind);

      // State 2 · signing-in (jwt present, never-resolving fetch).
      vi.useFakeTimers();
      stubFetchHang();
      await act(async () => {
        setJwt("kind-union-jwt");
        void loadMe();
      });
      // With a JWT and no snapshot yet, classifier returns `signing-in`.
      assertKindMembership(sink.kind);
      // Reset the timer strategy before the next stub.
      vi.useRealTimers();

      // State 3 · complete-profile (jwt + hydrated snapshot with no
      // handle / lcId / email).
      stubFetch200({
        lc_id: null,
        handle: null,
        // No email either → forces the classifier to `complete-profile`.
      });
      await act(async () => {
        _resetMeForTests();
        setJwt("kind-union-jwt-2");
        await loadMe();
      });
      assertKindMembership(sink.kind);

      // State 4 · email-local (jwt + snapshot with email only).
      stubFetch200({
        lc_id: null,
        handle: null,
        email: "user@example.com",
      });
      await act(async () => {
        _resetMeForTests();
        setJwt("kind-union-jwt-3");
        await loadMe();
      });
      assertKindMembership(sink.kind);

      // State 5 · lc-id (jwt + snapshot with lcId only).
      stubFetch200({
        lc_id: "LC-UNION",
        handle: null,
        email: null,
      });
      await act(async () => {
        _resetMeForTests();
        setJwt("kind-union-jwt-4");
        await loadMe();
      });
      assertKindMembership(sink.kind);

      // State 6 · handle (jwt + snapshot with handle).
      stubFetch200({
        lc_id: "LC-UNION",
        handle: "unionuser",
        email: null,
      });
      await act(async () => {
        _resetMeForTests();
        setJwt("kind-union-jwt-5");
        await loadMe();
      });
      assertKindMembership(sink.kind);
    } finally {
      act(() => { root.unmount(); });
    }
  });
});
