import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { emitHqEvent } from "./hqEmit";
import { isHqEvent } from "./hqEvents";
import { __resetInstallIdCacheForTests } from "./installId";

// Capture whatever hqEmit hands to lcDiag so we can inspect the
// envelope shape without touching network.
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
    /* jsdom may deny localStorage — fine */
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hqEmit · lcDiag ↔ HqEvent bridge", () => {
  test("emits an envelope that isHqEvent accepts", () => {
    const cid = emitHqEvent({
      category: "app.health",
      severity: "info",
      topic: "app.boot",
      data: { source: "vitest" },
    });
    expect(cid.length).toBeGreaterThan(8);
    expect(lcDiagCalls.length).toBe(1);
    const envelope = lcDiagCalls[0].data.hq_event;
    expect(isHqEvent(envelope)).toBe(true);
  });

  test("threads correlation_id when the caller supplies one", () => {
    const correlation = "corr_test_1234";
    const cid = emitHqEvent({
      category: "processing.failed",
      severity: "error",
      topic: "ingest.failed",
      correlation_id: correlation,
      data: { stage: "ingest" },
    });
    expect(cid).toBe(correlation);
    const envelope = lcDiagCalls[0].data.hq_event as { correlation_id: string };
    expect(envelope.correlation_id).toBe(correlation);
  });

  test("hashed_handle defaults to null when no handle provided", () => {
    emitHqEvent({
      category: "app.health",
      severity: "info",
      topic: "heartbeat",
    });
    const envelope = lcDiagCalls[0].data.hq_event as {
      identifiers: { hashed_handle: string | null };
    };
    expect(envelope.identifiers.hashed_handle).toBeNull();
  });

  test("install_id survives across sequential emissions", () => {
    emitHqEvent({ category: "app.health", severity: "info", topic: "one" });
    emitHqEvent({ category: "app.health", severity: "info", topic: "two" });
    const a = (lcDiagCalls[0].data.hq_event as { identifiers: { install_id: string } })
      .identifiers.install_id;
    const b = (lcDiagCalls[1].data.hq_event as { identifiers: { install_id: string } })
      .identifiers.install_id;
    expect(a).toBe(b);
    expect(a.startsWith("install_")).toBe(true);
  });

  test("session_id stays stable within the process", () => {
    emitHqEvent({ category: "app.health", severity: "info", topic: "one" });
    emitHqEvent({ category: "app.health", severity: "info", topic: "two" });
    const a = (lcDiagCalls[0].data.hq_event as { identifiers: { session_id: string } })
      .identifiers.session_id;
    const b = (lcDiagCalls[1].data.hq_event as { identifiers: { session_id: string } })
      .identifiers.session_id;
    expect(a).toBe(b);
  });
});
