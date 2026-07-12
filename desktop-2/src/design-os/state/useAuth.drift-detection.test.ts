/**
 * useAuth · BUG-016 · BC-001 · runtime drift-detection test suite
 *
 * Locks the auth writer-drift shim: `useAuth`'s 2s poll compares the
 * raw `localStorage.getItem("lc.license.jwt.v1")` value against the
 * internal `cachedHasJwt`. On divergence:
 *   - emit `auth_state_drift` telemetry `{ cached, actual, ts }`
 *   - force-sync `cachedHasJwt` from truth
 *   - fire `auth:signed-in` / `auth:signed-out` bus event so every
 *     subscriber lands on the same tick
 *
 * NOTE (Agent A1 · 2026-07-12): the ownership matrix names this file
 * at `desktop-2/src/design-os/state/useAuth.drift-detection.test.ts`.
 * The canonical `useAuth` module actually lives at
 * `desktop-2/src/lib/useAuth.ts` (referenced under that path by every
 * consumer). The test is placed at the OWNED path per matrix; imports
 * traverse `../../lib/useAuth`. Documented in the Impact Report so the
 * integration lead can reconcile the matrix at merge.
 *
 * Harness discipline (matches `src/lib/useAuth.test.ts`):
 *   - `createRoot` + React `act` · no @testing-library.
 *   - `vi.mock("../../lib/diagnosticLogger")` to capture `lcDiag`
 *     without a real batch flush.
 *   - `vi.useFakeTimers()` to drive the 2s poll deterministically.
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
  useAuth,
  AUTH_DRIFT_POLL_MS,
  _resetUseAuthForTests,
  _stopDriftDetectionForTests,
  _startDriftDetectionForTests,
  _checkAuthDriftForTests,
} from "../../lib/useAuth";
import {
  setJwt,
  clearJwt,
  LICENSE_JWT_STORAGE_KEY,
  _resetAuthStorageForTests,
} from "../../lib/authStorage";
import { bus } from "../bridge/events";

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
  hasJwt: boolean;
  renderCount: number;
}

function mountProbe(container: HTMLDivElement, sink: ProbeSink): Root {
  const root = createRoot(container);
  function Probe(): null {
    const auth = useAuth();
    sink.hasJwt = auth.hasJwt;
    sink.renderCount += 1;
    return null;
  }
  act(() => {
    root.render(createElement(Probe));
  });
  return root;
}

/* ─── Shared setup ───────────────────────────────────────────────────── */

beforeEach(() => {
  diagCalls.length = 0;
  try { window.localStorage.clear(); } catch { /* non-fatal */ }
  // Stop any interval left over from a previous suite so vitest fake
  // timers can be enabled deterministically.
  _stopDriftDetectionForTests();
  bus.clear();
  _resetAuthStorageForTests();
  _resetUseAuthForTests();
});

afterEach(() => {
  _stopDriftDetectionForTests();
  bus.clear();
  vi.useRealTimers();
});

/* ─── Drift detection contract ───────────────────────────────────────── */

describe("useAuth · BUG-016 · drift detection", () => {
  it("raw-localStorage-write-detected-within-2s · rogue write flips cached + emits telemetry", async () => {
    vi.useFakeTimers();
    // Start the drift interval explicitly — module init already ran
    // once at first import, but a) the reset helpers wiped state and
    // b) vi.useFakeTimers() re-plumbs the timer registry.
    _startDriftDetectionForTests();

    const container = document.createElement("div");
    const sink: ProbeSink = { hasJwt: true, renderCount: 0 };
    const root = mountProbe(container, sink);
    try {
      // Starting condition · signed-out, cachedHasJwt === false.
      expect(sink.hasJwt).toBe(false);
      expect(countTopic("auth_state_drift")).toBe(0);

      // Rogue write bypasses setJwt() — writes directly to localStorage.
      // This is the exact writer-discipline violation BUG-016 protects
      // against.
      window.localStorage.setItem(LICENSE_JWT_STORAGE_KEY, "raw-injected-jwt");

      // Cache has not yet re-read — no drift emit yet.
      expect(countTopic("auth_state_drift")).toBe(0);

      // Advance to the 2s threshold. The poll fires and the shim
      // self-heals cachedHasJwt to true + emits telemetry.
      await act(async () => {
        vi.advanceTimersByTime(AUTH_DRIFT_POLL_MS);
      });

      expect(countTopic("auth_state_drift")).toBe(1);
      const p = lastPayloadFor("auth_state_drift");
      expect(p).not.toBeNull();
      expect(p!.cached).toBe(false);
      expect(p!.actual).toBe(true);
      expect(typeof p!.ts).toBe("number");

      // Self-heal · every subscriber (this probe) reflects the truth
      // on the next React commit.
      expect(sink.hasJwt).toBe(true);
    } finally {
      act(() => { root.unmount(); });
    }
  });

  it("canonical-setJwt-no-drift-warning · setJwt writer path fires no drift telemetry", async () => {
    vi.useFakeTimers();
    _startDriftDetectionForTests();

    const container = document.createElement("div");
    const sink: ProbeSink = { hasJwt: false, renderCount: 0 };
    const root = mountProbe(container, sink);
    try {
      expect(sink.hasJwt).toBe(false);
      expect(countTopic("auth_state_drift")).toBe(0);

      // Canonical writer path · setJwt writes to memory + localStorage
      // AND fires the auth:signed-in bus event. That event runs
      // `refreshHasJwt()` synchronously, so cachedHasJwt matches
      // localStorage before the drift poll ever checks.
      act(() => {
        setJwt("canonical-jwt");
        bus.emit("auth:signed-in", {});
      });

      // Every subscriber has already flipped without drift.
      expect(sink.hasJwt).toBe(true);
      expect(countTopic("auth_state_drift")).toBe(0);

      // Advance a full poll interval — still no drift telemetry.
      await act(async () => {
        vi.advanceTimersByTime(AUTH_DRIFT_POLL_MS);
      });

      expect(countTopic("auth_state_drift")).toBe(0);
    } finally {
      act(() => { root.unmount(); });
    }
  });

  it("check-fn is idempotent · running it twice in a row without divergence emits nothing", () => {
    // Synchronous variant — proves the check body is a no-op when the
    // cache already matches localStorage.
    clearJwt();
    _resetUseAuthForTests();
    expect(countTopic("auth_state_drift")).toBe(0);

    _checkAuthDriftForTests();
    _checkAuthDriftForTests();
    expect(countTopic("auth_state_drift")).toBe(0);
  });
});
