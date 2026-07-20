/**
 * IG-GOLDEN-JOURNEY · export verification gate regression tests
 *
 * These grep-in-a-test assertions freeze two invariants that both export
 * success paths (Composer/PublishModule + ExportRoute) MUST enforce:
 *
 *   1. On `verifyExportedFile → verified:false`, the code throws
 *      `LC-EXPORT-VERIFY-005: <reason>` so the caller cannot persist
 *      the unverified path or mint a RewardClip.
 *
 *   2. When we're in a Tauri context and the fs plugin import fails
 *      (catastrophic infra fault — bundle corruption / plugin drop /
 *      config drift), the code throws
 *      `LC-EXPORT-VERIFY-005: fs_plugin_import_failed` instead of
 *      silently falling through to `setLatestOutputPath` / mint. The
 *      audit dated 2026-07-20 flagged this as the remaining false-
 *      success gap after the initial verifyExportedFile wire-in.
 *
 * The tests scan the source strings so a future revert (removing the
 * throw, or replacing it with a log-and-continue) fails locally BEFORE
 * the tag push.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..", "..");

const EXPORT_ROUTE = readFileSync(
  resolve(REPO_ROOT, "src/design-os/routes/ExportRoute.tsx"),
  "utf8",
);
const PUBLISH_MODULE = readFileSync(
  resolve(REPO_ROOT, "src/design-os/engine/cockpit/PublishModule.tsx"),
  "utf8",
);

describe("IG-GOLDEN-JOURNEY · export verification gate", () => {
  describe("ExportRoute.tsx", () => {
    it("imports verifyExportedFile from lib", () => {
      expect(EXPORT_ROUTE).toMatch(
        /import\s*{\s*verifyExportedFile\s*}\s*from\s*["'][^"']*verifyExportedFile["']/,
      );
    });

    it("throws LC-EXPORT-VERIFY-005 on verified:false", () => {
      expect(EXPORT_ROUTE).toMatch(
        /throw new Error\(`LC-EXPORT-VERIFY-005:\s*\$\{verification\.reason/,
      );
    });

    it("throws LC-EXPORT-VERIFY-005 when fs plugin import fails in Tauri", () => {
      expect(EXPORT_ROUTE).toMatch(
        /throw new Error\(["']LC-EXPORT-VERIFY-005: fs_plugin_import_failed["']\)/,
      );
    });

    it("does NOT fall through to setLatestOutputPath on unverified path", () => {
      // Anchor: the throw MUST appear before setLatestOutputPath is
      // called. If setLatestOutputPath moved above the verify block, the
      // regex-substring test below would still pass but the semantic
      // guarantee would break. Assert on structural order.
      const throwIdx = EXPORT_ROUTE.indexOf(
        'throw new Error(`LC-EXPORT-VERIFY-005:',
      );
      const persistIdx = EXPORT_ROUTE.indexOf(
        "setLatestOutputPath(result.outputPath)",
      );
      expect(throwIdx).toBeGreaterThan(-1);
      expect(persistIdx).toBeGreaterThan(-1);
      expect(throwIdx).toBeLessThan(persistIdx);
    });
  });

  describe("PublishModule.tsx", () => {
    it("imports verifyExportedFile from lib", () => {
      expect(PUBLISH_MODULE).toMatch(
        /import\s*{\s*verifyExportedFile\s*}\s*from\s*["'][^"']*verifyExportedFile["']/,
      );
    });

    it("throws LC-EXPORT-VERIFY-005 on verified:false", () => {
      expect(PUBLISH_MODULE).toMatch(
        /throw new Error\(`LC-EXPORT-VERIFY-005:\s*\$\{verification\.reason/,
      );
    });

    it("throws LC-EXPORT-VERIFY-005 when fs plugin import fails in Tauri", () => {
      expect(PUBLISH_MODULE).toMatch(
        /throw new Error\(["']LC-EXPORT-VERIFY-005: fs_plugin_import_failed["']\)/,
      );
    });
  });
});
