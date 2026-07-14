import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { generateDiagnosticBundle } from "./diagnosticBundle";
import { __resetInstallIdCacheForTests } from "./installId";

const lcDiagCalls: Array<{ topic: string; data: Record<string, unknown> }> = [];

vi.mock("./diagnosticLogger", () => {
  return {
    lcDiag: (topic: string, data: Record<string, unknown>) => {
      lcDiagCalls.push({ topic, data });
    },
  };
});

beforeEach(() => {
  lcDiagCalls.length = 0;
  __resetInstallIdCacheForTests();
  try {
    window.localStorage.removeItem("lc.install.id.v1");
  } catch {
    /* jsdom may deny localStorage */
  }
  const w = globalThis as unknown as {
    __lcEngineBoundaryCrashes?: Array<Record<string, unknown>>;
    __lcRuntime?: Record<string, string>;
  };
  w.__lcEngineBoundaryCrashes = [];
  w.__lcRuntime = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("diagnosticBundle · redacted support snapshot", () => {
  test("returns a JSON string with the canonical envelope shape", () => {
    const s = generateDiagnosticBundle();
    const b = JSON.parse(s);
    expect(b.schema_version).toBe(1);
    expect(typeof b.correlation_id).toBe("string");
    expect(typeof b.generated_at_ms).toBe("number");
    expect(b.install_id.startsWith("install_")).toBe(true);
    expect(Array.isArray(b.crashes)).toBe(true);
    expect(b.event_categories_active.length).toBeGreaterThanOrEqual(9);
  });

  test("emits a diagnostic.bundle HqEvent through lcDiag", () => {
    generateDiagnosticBundle();
    expect(lcDiagCalls.length).toBe(1);
    const envelope = lcDiagCalls[0].data.hq_event as {
      category: string;
      topic: string;
    };
    expect(envelope.category).toBe("diagnostic.bundle");
    expect(envelope.topic).toBe("diagnostic.bundle.generated");
  });

  test("strips stack + componentStack from surfaced crashes (redaction)", () => {
    const w = globalThis as unknown as {
      __lcEngineBoundaryCrashes?: Array<Record<string, unknown>>;
    };
    w.__lcEngineBoundaryCrashes = [
      {
        route: "workstation",
        component: "ClipCard",
        runtimeMode: "hosted",
        message: "boom",
        time: "2026-07-13T22:00:00Z",
        errStack: "Error\n at foo (secret)",
        componentStack: "<Foo>\n<Bar>",
      },
    ];
    const b = JSON.parse(generateDiagnosticBundle());
    const c = b.crashes[0];
    expect(c.message).toBe("boom");
    expect(c.errStack).toBeUndefined();
    expect(c.componentStack).toBeUndefined();
  });

  test("carries the same install_id across sequential bundles", () => {
    const a = JSON.parse(generateDiagnosticBundle());
    const b = JSON.parse(generateDiagnosticBundle());
    expect(a.install_id).toBe(b.install_id);
    // Correlation ids should differ per call.
    expect(a.correlation_id).not.toBe(b.correlation_id);
  });
});
