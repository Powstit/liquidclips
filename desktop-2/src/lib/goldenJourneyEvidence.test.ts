/**
 * IG-GOLDEN-JOURNEY · release evidence schema tests.
 * Spec §11: promotion must reject fabricated / stale / mismatched
 * evidence. LOCKED 2026-07-20.
 */

import { describe, it, expect } from "vitest";
import {
  validateGoldenJourneyEvidence,
  evidenceMatchesRelease,
  type GoldenJourneyEvidence,
} from "./goldenJourneyEvidence";

const goodEvidence: GoldenJourneyEvidence = {
  gate: "IG-GOLDEN-JOURNEY",
  gitSha: "a1b2c3d4e5f6789012345678901234567890abcd",
  runtimeVersion: "2.2.57",
  fixtureSha256: "a".repeat(64),
  outputSha256: "b".repeat(64),
  outputBytes: 3_500_000,
  durationSeconds: 12.5,
  resolution: "1080x1920",
  audioStreams: 1,
  passedAt: new Date().toISOString(),
};

describe("IG-GOLDEN-JOURNEY · validateGoldenJourneyEvidence", () => {
  it("valid evidence passes", () => {
    const r = validateGoldenJourneyEvidence(goodEvidence);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects fabricated evidence with wrong gate name", () => {
    const bad = { ...goodEvidence, gate: "IG-OTHER" };
    const r = validateGoldenJourneyEvidence(bad);
    expect(r.valid).toBe(false);
    expect(r.errors.join("|")).toMatch(/gate/);
  });

  it("rejects missing gitSha", () => {
    const bad: Record<string, unknown> = { ...goodEvidence };
    delete bad.gitSha;
    expect(validateGoldenJourneyEvidence(bad).valid).toBe(false);
  });

  it("rejects malformed sha256 hex", () => {
    const bad = { ...goodEvidence, outputSha256: "not-a-real-sha" };
    expect(validateGoldenJourneyEvidence(bad).valid).toBe(false);
  });

  it("rejects zero-byte output", () => {
    const bad = { ...goodEvidence, outputBytes: 0 };
    expect(validateGoldenJourneyEvidence(bad).valid).toBe(false);
  });

  it("rejects negative duration", () => {
    const bad = { ...goodEvidence, durationSeconds: -1 };
    expect(validateGoldenJourneyEvidence(bad).valid).toBe(false);
  });

  it("rejects invalid resolution format", () => {
    const bad = { ...goodEvidence, resolution: "1080p" };
    expect(validateGoldenJourneyEvidence(bad).valid).toBe(false);
  });

  it("rejects invalid ISO timestamp", () => {
    const bad = { ...goodEvidence, passedAt: "yesterday" };
    expect(validateGoldenJourneyEvidence(bad).valid).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(validateGoldenJourneyEvidence(null).valid).toBe(false);
    expect(validateGoldenJourneyEvidence("string").valid).toBe(false);
    expect(validateGoldenJourneyEvidence(42).valid).toBe(false);
  });
});

describe("IG-GOLDEN-JOURNEY · evidenceMatchesRelease", () => {
  it("matches when SHA + version + freshness align", () => {
    const r = evidenceMatchesRelease({
      evidence: goodEvidence,
      currentGitSha: goodEvidence.gitSha,
      currentRuntimeVersion: goodEvidence.runtimeVersion,
      maxAgeMs: 60_000,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects evidence from a different SHA", () => {
    const r = evidenceMatchesRelease({
      evidence: goodEvidence,
      currentGitSha: "0000000000000000000000000000000000000000",
      currentRuntimeVersion: goodEvidence.runtimeVersion,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join("|")).toMatch(/gitSha/);
  });

  it("rejects evidence from a different runtime version", () => {
    const r = evidenceMatchesRelease({
      evidence: goodEvidence,
      currentGitSha: goodEvidence.gitSha,
      currentRuntimeVersion: "9.9.9",
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join("|")).toMatch(/runtimeVersion/);
  });

  it("rejects stale evidence past maxAgeMs", () => {
    const stale: GoldenJourneyEvidence = {
      ...goodEvidence,
      passedAt: new Date(Date.now() - 3_600_000).toISOString(),
    };
    const r = evidenceMatchesRelease({
      evidence: stale,
      currentGitSha: stale.gitSha,
      currentRuntimeVersion: stale.runtimeVersion,
      maxAgeMs: 60_000,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join("|")).toMatch(/age/);
  });

  it("case-insensitive SHA compare", () => {
    const r = evidenceMatchesRelease({
      evidence: goodEvidence,
      currentGitSha: goodEvidence.gitSha.toUpperCase(),
      currentRuntimeVersion: goodEvidence.runtimeVersion,
    });
    expect(r.ok).toBe(true);
  });
});
