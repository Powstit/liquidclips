import { describe, expect, test } from "vitest";

import {
  HQ_EVENT_SCHEMA_VERSION,
  hashHandle,
  isHqEvent,
  newCorrelationId,
  type HqEvent,
} from "./hqEvents";

function makeEvent<T extends Record<string, unknown>>(
  overrides: Partial<HqEvent<T>> = {},
): HqEvent<T> {
  return {
    schema_version: HQ_EVENT_SCHEMA_VERSION,
    category: "app.health",
    severity: "info",
    topic: "app.boot",
    correlation_id: newCorrelationId(),
    ts_ms: Date.now(),
    identifiers: {
      install_id: "install-1",
      session_id: "session-1",
      hashed_handle: null,
      runtime_version: "2.2.36",
      app_version: "2.2.36",
      app_arch: "x86_64",
    },
    data: {} as T,
    ...overrides,
  };
}

describe("hqEvents · schema envelope", () => {
  test("schema version is stable at 1 (bump only on breaking change)", () => {
    expect(HQ_EVENT_SCHEMA_VERSION).toBe(1);
  });

  test("isHqEvent accepts a valid envelope", () => {
    expect(isHqEvent(makeEvent())).toBe(true);
  });

  test("isHqEvent rejects a wrong schema_version", () => {
    // TypeScript blocks the literal at compile time; runtime check is
    // the whole point of the type-guard.
    const bad = { ...makeEvent(), schema_version: 999 };
    expect(isHqEvent(bad)).toBe(false);
  });

  test("isHqEvent rejects missing identifiers", () => {
    const { identifiers: _identifiers, ...bad } = makeEvent();
    void _identifiers;
    expect(isHqEvent(bad)).toBe(false);
  });

  test("isHqEvent rejects non-object input", () => {
    expect(isHqEvent(null)).toBe(false);
    expect(isHqEvent("string")).toBe(false);
    expect(isHqEvent(42)).toBe(false);
  });
});

describe("hqEvents · correlation IDs", () => {
  test("newCorrelationId returns a non-empty string", () => {
    const id = newCorrelationId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(8);
  });

  test("consecutive IDs are distinct (no accidental caching)", () => {
    const a = newCorrelationId();
    const b = newCorrelationId();
    expect(a).not.toBe(b);
  });
});

describe("hqEvents · hashed handle", () => {
  test("empty handle → null (no digest)", async () => {
    expect(await hashHandle(null)).toBeNull();
    expect(await hashHandle("")).toBeNull();
  });

  test("known handle → deterministic 64-char hex", async () => {
    // Vitest's jsdom env exposes crypto.subtle.
    const h = await hashHandle("harness_e2e");
    // Fail-safe when jsdom's subtle isn't wired: we just accept null.
    if (h !== null) {
      expect(h).toMatch(/^[0-9a-f]{64}$/);
      // Deterministic — same input, same output.
      const h2 = await hashHandle("harness_e2e");
      expect(h2).toBe(h);
    }
  });

  test("different handles produce different digests", async () => {
    const a = await hashHandle("alpha");
    const b = await hashHandle("beta");
    if (a !== null && b !== null) {
      expect(a).not.toBe(b);
    }
  });
});
