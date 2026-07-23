/**
 * IG-SLO-DEFINED · regression tests for the SLO snapshot math.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { SLO_TARGETS, sloRecord, sloReset, sloSnapshot } from "./slo.ts";
import type { Envelope } from "./envelope.ts";

function env(overrides: Partial<Envelope>): Envelope {
  return {
    event: "test:noop" as never,
    schema_version: 1,
    actor: { kind: "anon", id: "sess-a" },
    feature_id: "test",
    journey_id: null,
    surface: "test",
    route: "/test",
    release: "test",
    build: "test",
    environment: "dev",
    operating_mode: "self",
    entitlement_class: "clipper",
    onboarding_state: null,
    correlation_id: "c",
    session_id: "s",
    attempt_id: "a",
    success: true,
    failure: null,
    duration_ms: null,
    stable_error_code: null,
    payload: {} as never,
    metadata: null,
    emitted_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("SLO snapshot math", () => {
  beforeEach(() => {
    sloReset();
  });

  it("empty ring is 100% clean", () => {
    const s = sloSnapshot();
    expect(s.errorRate).toBe(0);
    expect(s.crashFreeSession).toBe(1);
    expect(s.p95LatencyMs).toBe(0);
    expect(s.breaches).toEqual([]);
  });

  it("computes error rate + flags breach at 2% > 1% target", () => {
    for (let i = 0; i < 98; i++) sloRecord(env({ session_id: `s${i}` }));
    sloRecord(env({ session_id: "s98", success: false, failure: "err" }));
    sloRecord(env({ session_id: "s99", success: false, failure: "err" }));
    const s = sloSnapshot();
    expect(s.errorRate).toBeCloseTo(0.02, 5);
    expect(s.breaches).toContain("error_rate");
  });

  it("computes p95 latency + flags breach when top 10% of samples are slow", () => {
    // 90 fast + 10 slow · sorted index 94 falls in the slow band · breach expected.
    for (let i = 0; i < 90; i++)
      sloRecord(env({ session_id: `s${i}`, duration_ms: 100 }));
    for (let i = 0; i < 10; i++)
      sloRecord(env({ session_id: `s9${i}`, duration_ms: 3000 }));
    const s = sloSnapshot();
    expect(s.p95LatencyMs).toBeGreaterThanOrEqual(2000);
    expect(s.breaches).toContain("p95_latency_ms");
  });

  it("crash-free session = clean sessions / total sessions", () => {
    for (let i = 0; i < 995; i++) sloRecord(env({ session_id: `clean${i}` }));
    for (let i = 0; i < 5; i++)
      sloRecord(env({ session_id: `dirty${i}`, success: false, failure: "err" }));
    const s = sloSnapshot();
    expect(s.crashFreeSession).toBeCloseTo(0.995, 3);
    expect(s.breaches).not.toContain("crash_free_session");
  });

  it("SLO_TARGETS are frozen constants matching Reliability Sprint spec", () => {
    expect(SLO_TARGETS.errorRateMax).toBe(0.01);
    expect(SLO_TARGETS.crashFreeSessionMin).toBe(0.995);
    expect(SLO_TARGETS.p95LatencyMsMax).toBe(2000);
    expect(Object.isFrozen(SLO_TARGETS)).toBe(true);
  });
});
