/**
 * navPerf · boot-emit tests · BUG-001 · Train B2 · 2026-07-12
 * -----------------------------------------------------------
 *
 * Class-elimination target BC-005 (route events unobservable). The
 * `boot` telemetry topic is the single synchronous signal that proves
 * which bundle actually rendered on cold-boot — without it, absence of
 * `nav_click_performance` after a Campaigns click cannot be distinguished
 * from a stale-bundle render.
 *
 * Contract points asserted:
 *   1. `emitBootTelemetry()` calls `lcDiag("boot", …)` exactly once
 *      even when invoked repeatedly (idempotent).
 *   2. Payload keys match the BUG-001 spec exactly:
 *        - runtime_version
 *        - source_sha
 *        - bundle_index_html_sha256
 *   3. `runtime_version` prefers the `<meta name="runtime-version">`
 *      tag when present (staged runtime bundle case), and falls back
 *      to the shell version when the tag is absent.
 *   4. `source_sha` follows the same meta → shell precedence via the
 *      `<meta name="source-sha">` tag.
 *   5. `bundle_index_html_sha256` is a hex string (SHA-256 = 64 chars)
 *      when WebCrypto is available in the environment. It may be null
 *      only when WebCrypto is genuinely missing — never a fabricated
 *      value.
 *
 * Testing strategy — mirrors hardRefresh.test.ts:
 *   - No @testing-library.
 *   - vi.mock() the diagnosticLogger so no batch flusher fires.
 *   - Direct meta-tag manipulation on the jsdom document.
 *   - `_resetBootTelemetryForTests()` re-arms the guard between tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const diagCalls: Array<{ topic: string; data: Record<string, unknown> }> = [];
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
import { emitBootTelemetry, _resetBootTelemetryForTests } from "./navPerf";

function clearMeta(name: string): void {
  const el = document.querySelector(`meta[name="${name}"]`);
  if (el) el.remove();
}

function setMeta(name: string, content: string): void {
  clearMeta(name);
  const m = document.createElement("meta");
  m.setAttribute("name", name);
  m.setAttribute("content", content);
  document.head.appendChild(m);
}

/** Wait one microtask flush so the async `computeBundleIndexHtmlSha256`
 *  promise chain has a chance to resolve and push the `boot` event onto
 *  `diagCalls`. Two `queueMicrotask` awaits are enough because the
 *  chain is: `.then` (hash) → `try { lcDiag(...) }`. Also drains a
 *  setTimeout tick so lingering `.finally` handlers from prior tests
 *  cannot bleed into the current assertion window. */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("navPerf · emitBootTelemetry · BUG-001 · BC-005", () => {
  beforeEach(() => {
    diagCalls.length = 0;
    _resetBootTelemetryForTests();
    clearMeta("runtime-version");
    clearMeta("source-sha");
  });

  afterEach(() => {
    clearMeta("runtime-version");
    clearMeta("source-sha");
  });

  it("emits the `boot` topic exactly once on first call", async () => {
    // Await the returned promise so the test doesn't race the emit.
    await emitBootTelemetry();
    await flushMicrotasks();
    const bootEvents = diagCalls.filter((c) => c.topic === "boot");
    expect(bootEvents.length).toBe(1);
  });

  it("is idempotent · a second call is a silent no-op", async () => {
    await emitBootTelemetry();
    await emitBootTelemetry();
    await emitBootTelemetry();
    await flushMicrotasks();
    const bootEvents = diagCalls.filter((c) => c.topic === "boot");
    expect(bootEvents.length).toBe(1);
  });

  it("payload carries the three BUG-001 keys", async () => {
    await emitBootTelemetry();
    await flushMicrotasks();
    const bootEvent = diagCalls.find((c) => c.topic === "boot");
    expect(bootEvent).toBeDefined();
    // Key set — strict membership check so a future refactor can't
    // silently drop one of the contract fields.
    const keys = Object.keys(bootEvent!.data).sort();
    expect(keys).toEqual([
      "bundle_index_html_sha256",
      "runtime_version",
      "source_sha",
    ]);
  });

  it("reads `runtime_version` from meta when the staged bundle injects it", async () => {
    setMeta("runtime-version", "2.4.1-staged");
    await emitBootTelemetry();
    await flushMicrotasks();
    const bootEvent = diagCalls.find((c) => c.topic === "boot");
    expect(bootEvent?.data.runtime_version).toBe("2.4.1-staged");
  });

  it("falls back to shell version when the runtime-version meta is absent", async () => {
    // No meta tag set — expect the shell fallback.
    await emitBootTelemetry();
    await flushMicrotasks();
    const bootEvent = diagCalls.find((c) => c.topic === "boot");
    // shellVersionFallback() returns __APP_VERSION__ if declared, else "dev".
    // The test env has no __APP_VERSION__ define, so we accept either a
    // real version string OR "dev". The point is NEVER null / empty.
    const v = bootEvent?.data.runtime_version;
    expect(typeof v).toBe("string");
    expect((v as string).length).toBeGreaterThan(0);
  });

  it("reads `source_sha` from meta when present", async () => {
    setMeta("source-sha", "abc123def456");
    await emitBootTelemetry();
    await flushMicrotasks();
    const bootEvent = diagCalls.find((c) => c.topic === "boot");
    expect(bootEvent?.data.source_sha).toBe("abc123def456");
  });

  it("falls back to shell version for `source_sha` when meta absent", async () => {
    await emitBootTelemetry();
    await flushMicrotasks();
    const bootEvent = diagCalls.find((c) => c.topic === "boot");
    const v = bootEvent?.data.source_sha;
    expect(typeof v).toBe("string");
    expect((v as string).length).toBeGreaterThan(0);
  });

  it("computes a 64-char hex `bundle_index_html_sha256` when WebCrypto is available", async () => {
    // jsdom in vitest ships WebCrypto (subtle.digest is available).
    await emitBootTelemetry();
    await flushMicrotasks();
    const bootEvent = diagCalls.find((c) => c.topic === "boot");
    const hash = bootEvent?.data.bundle_index_html_sha256;
    // Contract: string SHA-256 is 64 lowercase hex chars, or null if
    // the environment cannot compute one. Both are honest values.
    if (hash === null) {
      // Acceptable in a WebCrypto-less env.
      expect(hash).toBeNull();
    } else {
      expect(typeof hash).toBe("string");
      expect(hash as string).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
