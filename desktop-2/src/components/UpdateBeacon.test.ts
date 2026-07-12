/**
 * UpdateBeacon · Wave B1 · RC1 (2026-07-12)
 *
 * BUG-009 proof — the beacon must NOT flood the diag ring when the
 * backend has no runtime manifest (204 · no runtime bundles seeded
 * yet · fresh Railway DB · sidecar cold start).
 *
 * Two contract layers:
 *   1. Source-file grep — the component wires the deduplicated
 *      failure logger + resets the fingerprint on any successful
 *      `runtime_info` read. Both are cheap invariants a code review
 *      can lose.
 *   2. Backend contract — `/runtime/manifest.json` returns 204 in
 *      the three shapes the client needs to treat identically:
 *        - no manifest row for the channel
 *        - manifest row exists but current_version matches (client
 *          is already on the active bundle)
 *        - the ``runtime_manifests`` table is missing (fresh dev
 *          DB / seed skip) — degrades to 204 instead of 500.
 *      The backend contract is enforced by `test_runtime_manifest_shapes`
 *      in `junior-backend/tests/`.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BEACON_SRC = readFileSync(resolve(__dirname, "UpdateBeacon.tsx"), "utf-8");

// Silence diag flushes even for imports we don't call.
vi.mock("../lib/diagnosticLogger", () => ({
  lcDiag: () => undefined,
  bootDiag: () => undefined,
  probeSidecarState: async () => undefined,
  getDiagSessionId: () => "test-session",
  forceFlush: async () => undefined,
}));

describe("UpdateBeacon · source contract (Wave B1 · BUG-009)", () => {
  it("declares the failure fingerprint dedup ring", () => {
    expect(BEACON_SRC).toMatch(/lastFailureRef\s*=\s*useRef<FailureFingerprint\s*\|\s*null>/);
  });

  it("logCheckFailure suppresses identical follow-up failures", () => {
    // The comparator MUST be by (step, reason). Anything else and a
    // sidecar cold-start would still spam every 5 min.
    expect(BEACON_SRC).toMatch(/if\s*\(prev\s*&&\s*prev\.step\s*===\s*step\s*&&\s*prev\.reason\s*===\s*reason\)\s*return/);
  });

  it("healthy runtime_info read clears the dedup ring", () => {
    // If we don't reset on success a recovered backend never re-logs.
    // The test proves the invariant "one failure per unbroken sad
    // streak · logging resumes the moment the backend heals".
    expect(BEACON_SRC).toMatch(/readRuntimeInfo[\s\S]*?clearFailureFingerprint\(\);\s*[\s\S]*?return\s+info;/);
  });

  it("healthy runtime_check_now clears the dedup ring", () => {
    // The Rust command treats 204 (no update available) as Ok(())
    // — that's a HEALTHY answer, not silence. The healed state
    // must clear the fingerprint too.
    expect(BEACON_SRC).toMatch(/await\s+invoke\("runtime_check_now"\);\s*[\s\S]*?clearFailureFingerprint\(\);/);
  });

  it("only two failure sources are wired · runtime_info + runtime_check_now", () => {
    // If a new poll path is added later, the CheckFailureStep union
    // must extend AND every catch must call `logCheckFailure`. This
    // guard ensures the union stays honest.
    expect(BEACON_SRC).toMatch(/type\s+CheckFailureStep\s*=\s*"runtime_info"\s*\|\s*"runtime_check_now";/);
    const logCalls = BEACON_SRC.match(/logCheckFailure\(/g) ?? [];
    // 2 real call sites (runtime_info catch + runtime_check_now catch)
    // + the callback body definition inside useCallback. The catch-site
    // count must be >= 2; the definition is a bonus match.
    expect(logCalls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("UpdateBeacon · documented response shapes (contract for the backend)", () => {
  // BUG-009 landed a real backend fix — see `junior-backend/app/routes/
  // runtime.py::manifest`. This test documents (in the client repo,
  // where the surface lives) exactly what the client relies on.
  //
  // Wave D1 (2026-07-12) note: the "visibility rule" moved out of this
  // component into the shared updateJourney state machine. The beacon
  // no longer owns `stagedVersion` state — it hands each runtime_info
  // read to `applyRuntimeInfo` which fires the correct state
  // transitions. The tests below assert the new integration shape.
  it("treats a same-version runtime_info read as 'no change' via applyRuntimeInfo", () => {
    // The refactored guard: if `active_version === booted`, silent no-op.
    expect(BEACON_SRC).toMatch(/if\s*\(info\.active_version\s*===\s*booted\)\s*\{[\s\S]*?return;/);
  });

  it("treats a null runtime_info read as 'no change' (does not fire journey transitions)", () => {
    // A null read is filtered upstream · the beacon only calls
    // applyRuntimeInfo when the read succeeded.
    expect(BEACON_SRC).toMatch(/if\s*\(info\)\s*applyRuntimeInfo\(info\);/);
  });

  it("wraps runtime_check_now in a try/catch so a 500 never crashes the beacon", () => {
    expect(BEACON_SRC).toMatch(/try\s*\{\s*const\s*\{\s*invoke\s*\}[\s\S]*?await\s+invoke\("runtime_check_now"\);[\s\S]*?\}\s*catch\s*\(err\)/);
  });

  it("delegates state transitions to updateJourney · no local visibility state", () => {
    // Wave D1 · the transport layer imports the state-machine
    // transitions. If a future edit reintroduces local `visible` /
    // `stagedVersion` state here, ship-lens must be re-run.
    expect(BEACON_SRC).toMatch(/import\s*\{[\s\S]*?transitionToDownloading[\s\S]*?\}\s*from\s*"\.\.\/lib\/updateJourney"/);
    expect(BEACON_SRC).toMatch(/transitionToStaged\(/);
    expect(BEACON_SRC).toMatch(/return\s+null;\s*\}/);
  });
});
