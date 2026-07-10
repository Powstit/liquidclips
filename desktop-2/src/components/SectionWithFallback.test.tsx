/**
 * SectionWithFallback · tests
 *
 * Lane B · Chapter 4 · Cold-Entry-Mode-B sprint.
 *
 * Proves the five contract points from the sprint brief:
 *   1. Renders `SectionComponent` when it works.
 *   2. Renders `FallbackComponent` when `SectionComponent` throws.
 *   3. Emits `section_fallback_triggered` exactly on trip.
 *   4. Does NOT emit on success.
 *   5. `sanitizeError` strips bearer tokens, JWTs, emails, hex/base64
 *      blobs.
 *
 * Testing strategy — the desktop-2 project has NO `@testing-library/react`
 * dependency. Follow the established local pattern (see
 * `App.test.tsx` + `safe-inline.test.tsx`): mount into a jsdom container
 * via `createRoot`, `act` to flush, then read `container.textContent`.
 *
 * We stub `lcDiag` via `vi.mock` so the batch flusher in
 * `diagnosticLogger` never fires (no network, no interval leak).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SectionWithFallback, sanitizeError } from "./SectionWithFallback";

// ── Mocks ────────────────────────────────────────────────────────────
// Capture every lcDiag call so we can assert emit / no-emit precisely.
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

// Watchdog's nodeRegistry uses localStorage — jsdom provides one. But
// its interceptionBus dispatches CustomEvents on window; we don't need
// to stub anything. It's isolated.

// ── Test fixtures ────────────────────────────────────────────────────
function Working() {
  return <div data-testid="ok">real section rendered</div>;
}

function Broken(): never {
  throw new Error("boom · bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdEFGH · user@example.com");
}

function Fallback() {
  return <div data-testid="fallback">fallback rendered</div>;
}

// ── Helpers ──────────────────────────────────────────────────────────
function mount(node: React.ReactNode): { root: Root; container: HTMLDivElement } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return { root, container };
}

function unmount(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

beforeEach(() => {
  diagCalls.length = 0;
  // Watchdog persists state to localStorage — wipe between tests so
  // one test's admin override can't bleed into another.
  try {
    window.localStorage.clear();
  } catch { /* jsdom edge cases · non-fatal */ }
});

// ── React error-boundary console noise ───────────────────────────────
// React logs "The above error occurred in the <Broken> component" via
// console.error on every boundary catch. Silence it so the test output
// stays honest.
const _origConsoleError = console.error;
beforeEach(() => {
  console.error = (...args: unknown[]) => {
    const s = String(args[0] ?? "");
    if (
      s.includes("The above error occurred") ||
      s.includes("React will try to recreate this component tree") ||
      s.includes("boundary caught")
    ) return;
    _origConsoleError(...args);
  };
});

// ═════════════════════════════════════════════════════════════════════
// 1. Renders SectionComponent when it works.
// ═════════════════════════════════════════════════════════════════════

describe("SectionWithFallback · happy path", () => {
  it("renders SectionComponent when it does not throw", () => {
    const { root, container } = mount(
      <SectionWithFallback
        sectionName="test/happy"
        SectionComponent={Working}
        FallbackComponent={Fallback}
      />,
    );
    expect(container.textContent).toContain("real section rendered");
    expect(container.textContent).not.toContain("fallback rendered");
    unmount(root, container);
  });

  it("does NOT emit section_fallback_triggered on success", () => {
    const { root, container } = mount(
      <SectionWithFallback
        sectionName="test/happy"
        SectionComponent={Working}
        FallbackComponent={Fallback}
      />,
    );
    const trips = diagCalls.filter((c) => c.topic === "section_fallback_triggered");
    expect(trips).toHaveLength(0);
    unmount(root, container);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 2. + 3. Fallback + emit on trip.
// ═════════════════════════════════════════════════════════════════════

describe("SectionWithFallback · fallback path", () => {
  it("renders FallbackComponent when SectionComponent throws", () => {
    const { root, container } = mount(
      <SectionWithFallback
        sectionName="test/broken"
        SectionComponent={Broken}
        FallbackComponent={Fallback}
      />,
    );
    expect(container.textContent).toContain("fallback rendered");
    expect(container.textContent).not.toContain("real section rendered");
    unmount(root, container);
  });

  it("emits section_fallback_triggered exactly once on trip", () => {
    const { root, container } = mount(
      <SectionWithFallback
        sectionName="test/broken"
        SectionComponent={Broken}
        FallbackComponent={Fallback}
      />,
    );
    const trips = diagCalls.filter((c) => c.topic === "section_fallback_triggered");
    expect(trips).toHaveLength(1);
    expect(trips[0].data.section).toBe("test/broken");
    expect(trips[0].data.user_id).toBeNull();
    // Sanitizer must have scrubbed the JWT + email before it hit diag.
    const msg = String(trips[0].data.error_message);
    expect(msg).not.toContain("eyJ");
    expect(msg).not.toContain("user@example.com");
    unmount(root, container);
  });

  it("forwards user_id when supplied", () => {
    const { root, container } = mount(
      <SectionWithFallback
        sectionName="test/broken"
        SectionComponent={Broken}
        FallbackComponent={Fallback}
        user_id="usr_abc123"
      />,
    );
    const trips = diagCalls.filter((c) => c.topic === "section_fallback_triggered");
    expect(trips[0].data.user_id).toBe("usr_abc123");
    unmount(root, container);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 5. sanitizeError strips sensitive fields.
// ═════════════════════════════════════════════════════════════════════

describe("sanitizeError", () => {
  it("strips emails", () => {
    expect(sanitizeError(new Error("hi user@example.com there"))).not.toContain(
      "user@example.com",
    );
  });

  it("strips bearer tokens", () => {
    const out = sanitizeError(new Error("Bearer sk-abc123DEF456ghi789JKL012mno345PQR678stu"));
    expect(out.toLowerCase()).not.toMatch(/bearer\s+sk-/);
  });

  it("strips authorization header shapes", () => {
    const out = sanitizeError(new Error("authorization: eyJhbGciOiJIUzI1NiJ9"));
    expect(out).toContain("authorization=[redacted]");
  });

  it("strips 3-segment JWTs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const out = sanitizeError(new Error(`fail with ${jwt}`));
    expect(out).not.toContain("eyJ");
    expect(out).toContain("[jwt]");
  });

  it("strips long hex + base64 blobs", () => {
    const hex = "a".repeat(64);
    const blob = "AbcdefghijklmnopqRstuvwxyz0123456789+/AbcdefghijK".padEnd(50, "x");
    const out = sanitizeError(new Error(`hex=${hex} blob=${blob}`));
    expect(out).not.toContain(hex);
    expect(out).not.toContain(blob);
  });

  it("caps at 300 chars", () => {
    const long = "x".repeat(1000);
    expect(sanitizeError(new Error(long)).length).toBeLessThanOrEqual(300);
  });

  it("handles non-Error inputs", () => {
    expect(sanitizeError("just a string")).toBe("just a string");
    expect(sanitizeError(null)).toBe("null");
    expect(sanitizeError(undefined)).toBe("unknown");
    expect(sanitizeError({ toString: () => "obj" })).toBe("obj");
  });
});
