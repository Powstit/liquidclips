/**
 * IG-GOLDEN-JOURNEY · release evidence schema. Spec §11.
 *
 * The release-gate script generates one of these after a real Tier B
 * native journey passes (real sidecar · real ffmpeg · disk-verified
 * output). Promotion checks reject a bundle if:
 *   - evidence is absent
 *   - `gitSha` does not match the code being promoted
 *   - `runtimeVersion` does not match the bundle version
 *   - evidence is older than the release policy threshold
 *
 * This module owns the SHAPE. The generator + verifier live in
 * scripts/golden-journey-evidence.mjs (added when CI Tier B is wired).
 * LOCKED 2026-07-20.
 */

export interface GoldenJourneyEvidence {
  gate: "IG-GOLDEN-JOURNEY";
  gitSha: string;
  runtimeVersion: string;
  fixtureSha256: string;
  outputSha256: string;
  outputBytes: number;
  durationSeconds: number;
  resolution: string;
  audioStreams: number;
  passedAt: string;
}

const REQUIRED_KEYS: (keyof GoldenJourneyEvidence)[] = [
  "gate",
  "gitSha",
  "runtimeVersion",
  "fixtureSha256",
  "outputSha256",
  "outputBytes",
  "durationSeconds",
  "resolution",
  "audioStreams",
  "passedAt",
];

export interface EvidenceValidation {
  valid: boolean;
  errors: string[];
}

export function validateGoldenJourneyEvidence(
  raw: unknown,
): EvidenceValidation {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") {
    return { valid: false, errors: ["evidence must be an object"] };
  }
  const obj = raw as Record<string, unknown>;

  for (const k of REQUIRED_KEYS) {
    if (!(k in obj)) errors.push(`missing key: ${k}`);
  }
  if (obj.gate !== "IG-GOLDEN-JOURNEY") {
    errors.push(`gate must be exactly "IG-GOLDEN-JOURNEY" (got: ${String(obj.gate)})`);
  }
  if (typeof obj.gitSha !== "string" || !/^[0-9a-f]{7,40}$/i.test(obj.gitSha as string)) {
    errors.push("gitSha must be a valid short/full git SHA");
  }
  if (typeof obj.runtimeVersion !== "string" || (obj.runtimeVersion as string).length < 1) {
    errors.push("runtimeVersion must be a non-empty string");
  }
  if (typeof obj.fixtureSha256 !== "string" || !/^[0-9a-f]{64}$/i.test(obj.fixtureSha256 as string)) {
    errors.push("fixtureSha256 must be a 64-char hex string");
  }
  if (typeof obj.outputSha256 !== "string" || !/^[0-9a-f]{64}$/i.test(obj.outputSha256 as string)) {
    errors.push("outputSha256 must be a 64-char hex string");
  }
  if (typeof obj.outputBytes !== "number" || !Number.isFinite(obj.outputBytes) || (obj.outputBytes as number) <= 0) {
    errors.push("outputBytes must be a positive finite number");
  }
  if (typeof obj.durationSeconds !== "number" || !Number.isFinite(obj.durationSeconds) || (obj.durationSeconds as number) <= 0) {
    errors.push("durationSeconds must be a positive finite number");
  }
  if (typeof obj.resolution !== "string" || !/^\d+x\d+$/.test(obj.resolution as string)) {
    errors.push("resolution must be WIDTHxHEIGHT (e.g. 1080x1920)");
  }
  if (typeof obj.audioStreams !== "number" || !Number.isInteger(obj.audioStreams as number) || (obj.audioStreams as number) < 0) {
    errors.push("audioStreams must be a non-negative integer");
  }
  if (typeof obj.passedAt !== "string" || Number.isNaN(Date.parse(obj.passedAt as string))) {
    errors.push("passedAt must be an ISO-8601 timestamp");
  }
  return { valid: errors.length === 0, errors };
}

export interface EvidenceMatchArgs {
  evidence: GoldenJourneyEvidence;
  currentGitSha: string;
  currentRuntimeVersion: string;
  maxAgeMs?: number;
}

export interface EvidenceMatchResult {
  ok: boolean;
  errors: string[];
}

/**
 * Compare evidence against the SHA + version being promoted. Reject
 * mismatches. Optionally enforce a max age.
 */
export function evidenceMatchesRelease({
  evidence,
  currentGitSha,
  currentRuntimeVersion,
  maxAgeMs,
}: EvidenceMatchArgs): EvidenceMatchResult {
  const errors: string[] = [];
  if (evidence.gitSha.toLowerCase() !== currentGitSha.toLowerCase()) {
    errors.push(`gitSha mismatch: evidence=${evidence.gitSha} current=${currentGitSha}`);
  }
  if (evidence.runtimeVersion !== currentRuntimeVersion) {
    errors.push(
      `runtimeVersion mismatch: evidence=${evidence.runtimeVersion} current=${currentRuntimeVersion}`,
    );
  }
  if (typeof maxAgeMs === "number" && maxAgeMs > 0) {
    const ageMs = Date.now() - Date.parse(evidence.passedAt);
    if (ageMs > maxAgeMs) {
      errors.push(`evidence age ${ageMs}ms exceeds max ${maxAgeMs}ms`);
    }
  }
  return { ok: errors.length === 0, errors };
}
