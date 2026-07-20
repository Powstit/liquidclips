/**
 * IG-GOLDEN-JOURNEY · verifier that turns a claimed sidecar
 * `{ ok: true, outputPath }` into a REAL truth by disk-checking
 * the path. Pure function · dependency-injected · framework-free
 * so the negative controls in verifyExportedFile.test.ts can lie
 * about the filesystem to prove the guard fails closed.
 *
 * The regression this closes:
 *   Sidecar returns { ok: true, output_path: "/does/not/exist.mp4" }
 *   → previously UI called this a successful export.
 *   → user opens Finder, no file exists.
 *
 * With this verifier, the UI can never treat an unverified path as
 * success. Consumers should call this before promoting the export
 * to the persisted state store or the "Show in Finder" button.
 *
 * LOCKED 2026-07-20 · IG-GOLDEN-JOURNEY.
 */

export interface VerifyExportedFileResult {
  verified: boolean;
  outputPath: string;
  fileExists: boolean;
  reason: string | null;
  fsCheckError: string | null;
}

export type ExistsFn = (path: string) => Promise<boolean>;

/**
 * Verify that a sidecar-reported export outputPath is actually present
 * on disk. All I/O routes through the injected `existsFn` so tests can
 * fake:
 *   - filesystem present (verified: true)
 *   - filesystem missing (verified: false, reason: "file_missing")
 *   - filesystem check throws (verified: false, reason: "fs_check_failed")
 *   - path empty/whitespace/synthetic (verified: false, distinct reasons)
 */
export async function verifyExportedFile(
  outputPath: unknown,
  existsFn: ExistsFn,
): Promise<VerifyExportedFileResult> {
  const empty: VerifyExportedFileResult = {
    verified: false,
    outputPath: "",
    fileExists: false,
    reason: "path_empty",
    fsCheckError: null,
  };

  if (typeof outputPath !== "string" || outputPath.trim() === "") {
    return empty;
  }
  const path = outputPath.trim();

  // Synthetic browser-preview path shape from sidecar-stub · never
  // corresponds to a real disk file. Fence 6 spec §12 requires this
  // negative control.
  const synthetic = /^\/projects\/[^/]+\/clips\/[0-9]+-export-.+\.mp4$/;
  if (synthetic.test(path)) {
    return {
      verified: false,
      outputPath: path,
      fileExists: false,
      reason: "path_synthetic_preview_stub",
      fsCheckError: null,
    };
  }

  try {
    const exists = await existsFn(path);
    if (!exists) {
      return {
        verified: false,
        outputPath: path,
        fileExists: false,
        reason: "file_missing",
        fsCheckError: null,
      };
    }
    return {
      verified: true,
      outputPath: path,
      fileExists: true,
      reason: null,
      fsCheckError: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      verified: false,
      outputPath: path,
      fileExists: false,
      reason: "fs_check_failed",
      fsCheckError: msg.slice(0, 200),
    };
  }
}
