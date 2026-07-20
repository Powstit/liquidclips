/**
 * V1-EXPORT-VERIFY · IG-GOLDEN-JOURNEY regression guard.
 * LOCKED 2026-07-20.
 *
 * The bug this test locks: PublishModule.runExportAndMint used to
 * fire a `void (async () => …)()` block for the file-exists check.
 * Nobody awaited its result, so setExportOutputPath + rememberExportPath
 * fired unconditionally. A sidecar returning `{ ok: true, outputPath:
 * "/does/not/exist.mp4" }` still surfaced as SUCCESS in the UI.
 *
 * The fix (this session): the file-exists check is now synchronous, uses
 * verifyExportedFile, and THROWS with stable code LC-EXPORT-VERIFY-005
 * on any unverified outcome (file_missing / path_synthetic_preview_stub /
 * fs_check_failed / path_empty). Because the throw fires BEFORE
 * setExportOutputPath / rememberExportPath, no invalid path can be
 * persisted or revealed.
 *
 * This test asserts the CONTRACT at source-text level (module contains
 * the required wire) rather than mounting the React component, because:
 *   - runExportAndMint requires a full Cockpit + EngineSession +
 *     TierCaps + Watchdog context that is expensive to fake
 *   - source-text checks are the same pattern used by the sister
 *     Composer wire tests (KadeComposer.navRouting.test.ts family)
 *   - the pure-function verifier itself is already covered by
 *     verifyExportedFile.test.ts (10 tests, all failure modes)
 *
 * If PublishModule ever loses the verifier import OR the throw-on-
 * unverified guard, THIS test fails at pre-commit.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PUBLISH_MODULE_SRC = readFileSync(
  resolve(__dirname, "PublishModule.tsx"),
  "utf-8",
);
const EXPORT_ROUTE_SRC = readFileSync(
  resolve(__dirname, "../../routes/ExportRoute.tsx"),
  "utf-8",
);

describe("IG-GOLDEN-JOURNEY · PublishModule.runExportAndMint verifier wire", () => {
  it("imports verifyExportedFile from the shared verifier module", () => {
    expect(PUBLISH_MODULE_SRC).toMatch(
      /import\s*\{\s*verifyExportedFile\s*\}\s*from\s*["'][^"']*verifyExportedFile["']/,
    );
  });

  it("actually calls verifyExportedFile on the sidecar's outputPath", () => {
    // Must reference the function with an actual call, not just import it.
    expect(PUBLISH_MODULE_SRC).toMatch(
      /await\s+verifyExportedFile\s*\(\s*baseOutputPath\s*,/,
    );
  });

  it("throws with stable code LC-EXPORT-VERIFY-005 on unverified paths", () => {
    // The literal error code must appear in the throw path so the
    // caller / support triage can grep for it. Also asserts the
    // throw statement itself exists.
    expect(PUBLISH_MODULE_SRC).toMatch(/LC-EXPORT-VERIFY-005/);
    expect(PUBLISH_MODULE_SRC).toMatch(
      /throw\s+new\s+Error\s*\(\s*`LC-EXPORT-VERIFY-005/,
    );
  });

  it("does NOT reintroduce the fire-and-forget void (async ...)() gap", () => {
    // The specific pattern that shipped the bug. If this pattern
    // reappears in this file we regressed.
    expect(PUBLISH_MODULE_SRC).not.toMatch(
      /void\s*\(\s*async\s*\(\s*\)\s*=>\s*\{[\s\S]{0,200}?fs\.exists/,
    );
  });

  it("emits export_verification_failed diagnostic with the stable code", () => {
    expect(PUBLISH_MODULE_SRC).toMatch(/export_verification_failed/);
    expect(PUBLISH_MODULE_SRC).toMatch(/code:\s*["']LC-EXPORT-VERIFY-005["']/);
  });

  it("surfaces a customer-safe toast (kind: error) on verification failure", () => {
    // The toast body must NOT include the raw path (avoid leaking
    // private tokens). The customer message + retry hint are what
    // Daniel's spec §12 requires. Toast kind "error" is the shared
    // ToastKind alias for a hard failure (see bridge/events.ts).
    expect(PUBLISH_MODULE_SRC).toMatch(
      /bus\.emit\("toast",\s*\{[\s\S]{0,300}?kind:\s*["']error["'][\s\S]{0,300}?Export incomplete/,
    );
  });
});

describe("IG-GOLDEN-JOURNEY · ExportRoute (drift-route mirror) parity", () => {
  it("also imports verifyExportedFile", () => {
    expect(EXPORT_ROUTE_SRC).toMatch(
      /import\s*\{\s*verifyExportedFile\s*\}\s*from\s*["'][^"']*verifyExportedFile["']/,
    );
  });

  it("calls verifier on result.outputPath before setLatestOutputPath", () => {
    expect(EXPORT_ROUTE_SRC).toMatch(
      /await\s+verifyExportedFile\s*\(\s*result\.outputPath\s*,/,
    );
    // Order guard: verifier + throw must appear BEFORE setLatestOutputPath.
    const verifierIdx = EXPORT_ROUTE_SRC.search(/verifyExportedFile\s*\(/);
    const setterIdx = EXPORT_ROUTE_SRC.search(/setLatestOutputPath\s*\(\s*result\.outputPath/);
    expect(verifierIdx).toBeGreaterThan(-1);
    expect(setterIdx).toBeGreaterThan(-1);
    expect(verifierIdx).toBeLessThan(setterIdx);
  });

  it("throws with LC-EXPORT-VERIFY-005 in the drift route too", () => {
    expect(EXPORT_ROUTE_SRC).toMatch(/LC-EXPORT-VERIFY-005/);
  });
});
