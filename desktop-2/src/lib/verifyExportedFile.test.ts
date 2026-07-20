/**
 * IG-GOLDEN-JOURNEY · negative + positive controls for the false-
 * success verifier. LOCKED 2026-07-20.
 *
 * The mandatory Fence 6 negative control (spec §12):
 *   Sidecar returns { ok: true, output_path: "/does/not/exist.mp4" }
 *   MUST NOT surface as success in the UI.
 *
 * Every failure mode from spec §11 has a test row:
 *   - export_success without disk backing → fail
 *   - synthetic preview-stub path → fail
 *   - fs check throws → fail
 *   - empty/whitespace/undefined path → fail
 *   - real disk backing → pass exactly once
 */

import { describe, it, expect } from "vitest";
import { verifyExportedFile } from "./verifyExportedFile";

describe("IG-GOLDEN-JOURNEY · verifyExportedFile", () => {
  it("false-success: sidecar returns ok:true with non-existent path → verified=false, reason=file_missing", async () => {
    const existsFn = async () => false;
    const r = await verifyExportedFile("/tmp/does-not-exist.mp4", existsFn);
    expect(r.verified).toBe(false);
    expect(r.reason).toBe("file_missing");
    expect(r.fileExists).toBe(false);
    expect(r.fsCheckError).toBeNull();
  });

  it("real disk backing → verified=true, reason=null", async () => {
    const existsFn = async () => true;
    const r = await verifyExportedFile("/tmp/real.mp4", existsFn);
    expect(r.verified).toBe(true);
    expect(r.reason).toBeNull();
    expect(r.fileExists).toBe(true);
  });

  it("browser-preview synthetic path never surfaces as success even if existsFn lies", async () => {
    const existsFn = async () => true; // lie: pretend it exists
    const r = await verifyExportedFile(
      "/projects/uncle-daniel/clips/1-export-9x16.mp4",
      existsFn,
    );
    expect(r.verified).toBe(false);
    expect(r.reason).toBe("path_synthetic_preview_stub");
  });

  it("empty path → verified=false, reason=path_empty", async () => {
    const r = await verifyExportedFile("", async () => true);
    expect(r.verified).toBe(false);
    expect(r.reason).toBe("path_empty");
  });

  it("whitespace-only path → verified=false, reason=path_empty", async () => {
    const r = await verifyExportedFile("   ", async () => true);
    expect(r.verified).toBe(false);
    expect(r.reason).toBe("path_empty");
  });

  it("undefined path → verified=false, reason=path_empty", async () => {
    const r = await verifyExportedFile(undefined, async () => true);
    expect(r.verified).toBe(false);
    expect(r.reason).toBe("path_empty");
  });

  it("non-string path → verified=false, reason=path_empty", async () => {
    const r = await verifyExportedFile(42 as unknown, async () => true);
    expect(r.verified).toBe(false);
    expect(r.reason).toBe("path_empty");
  });

  it("fs.exists throws → verified=false, reason=fs_check_failed, error captured", async () => {
    const existsFn = async () => {
      throw new Error("EACCES: permission denied");
    };
    const r = await verifyExportedFile("/System/protected/file.mp4", existsFn);
    expect(r.verified).toBe(false);
    expect(r.reason).toBe("fs_check_failed");
    expect(r.fsCheckError).toContain("EACCES");
  });

  it("fs.exists throws with long stack → error captured but truncated to 200 chars", async () => {
    const big = "x".repeat(500);
    const existsFn = async () => {
      throw new Error(big);
    };
    const r = await verifyExportedFile("/tmp/x.mp4", existsFn);
    expect(r.fsCheckError).not.toBeNull();
    expect((r.fsCheckError ?? "").length).toBeLessThanOrEqual(200);
  });

  it("path gets trimmed before verification", async () => {
    let calledWith = "";
    const existsFn = async (p: string) => {
      calledWith = p;
      return true;
    };
    const r = await verifyExportedFile("  /tmp/x.mp4  ", existsFn);
    expect(r.verified).toBe(true);
    expect(calledWith).toBe("/tmp/x.mp4");
    expect(r.outputPath).toBe("/tmp/x.mp4");
  });
});
