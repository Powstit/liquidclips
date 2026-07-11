/**
 * uploadPreflight.test · Block 2 · 2026-07-11
 *
 * Contract tests for the pre-sidecar file gate. Covers every reason
 * the customer-visible failure UI needs to surface honestly:
 *
 *   - unsupported extension (picker bypass · .txt drop / .zip drop)
 *   - non-Tauri host (Vite preview) short-circuits to ok
 *   - not-found (path resolved by picker then deleted)
 *   - empty file (writes-in-progress · Time Machine restore)
 *   - Dropbox stub (0 bytes + path contains /Dropbox/)
 *   - unreadable (permission denied)
 *   - happy path (real file with size > 0 + supported ext)
 *
 * No real disk IO — @tauri-apps/plugin-fs is stubbed via vi.mock so
 * the tests run identically in CI and locally.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { statMock } = vi.hoisted(() => ({ statMock: vi.fn() }));

vi.mock("@tauri-apps/plugin-fs", () => ({
  stat: statMock,
}));

describe("uploadPreflight · Block 2", () => {
  const origInternals = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    statMock.mockReset();
    // Emulate Tauri host so preflight actually runs the stat check.
    (globalThis as { window: { __TAURI_INTERNALS__: unknown } }).window = {
      __TAURI_INTERNALS__: {},
    };
  });

  afterEach(() => {
    (globalThis as { window?: unknown }).window = origInternals;
  });

  it("rejects unsupported extensions before touching the FS", async () => {
    const { preflightSourceFile } = await import("./uploadPreflight");
    const res = await preflightSourceFile("/Users/me/notes.txt");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("unsupported_type");
    expect(res.humanMessage).toContain("notes.txt");
    expect(res.humanMessage).toMatch(/mp4|mov|m4v|webm/);
    expect(statMock).not.toHaveBeenCalled();
  });

  it("short-circuits ok when host is not Tauri (browser preview)", async () => {
    // Real non-Tauri host has NO __TAURI_INTERNALS__ key at all — the
    // preflight checks `"__TAURI_INTERNALS__" in window`, which is true
    // even when the value is undefined. Delete the key to prove the
    // browser-preview branch.
    (globalThis as unknown as { window: Record<string, unknown> }).window = {};
    const { preflightSourceFile } = await import("./uploadPreflight");
    const res = await preflightSourceFile("/tmp/test.mp4");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.size).toBe(-1);
    expect(statMock).not.toHaveBeenCalled();
  });

  it("returns not_found when fs.stat throws NotFound", async () => {
    statMock.mockRejectedValueOnce(new Error("No such file (os error 2)"));
    const { preflightSourceFile } = await import("./uploadPreflight");
    const res = await preflightSourceFile("/Users/me/deleted.mp4");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("not_found");
    expect(res.humanMessage).toContain("deleted.mp4");
  });

  it("returns unreadable when fs.stat throws permission error", async () => {
    statMock.mockRejectedValueOnce(new Error("Permission denied (os error 13)"));
    const { preflightSourceFile } = await import("./uploadPreflight");
    const res = await preflightSourceFile("/Users/root/private.mp4");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("unreadable");
    expect(res.humanMessage).toContain("permissions");
  });

  it("returns dropbox_stub for 0-byte file inside a Dropbox path", async () => {
    statMock.mockResolvedValueOnce({ size: 0 });
    const { preflightSourceFile } = await import("./uploadPreflight");
    const path =
      "/Users/me/Downloads/Uncle Daniel Dropbox/Videos/stream (1).mp4";
    const res = await preflightSourceFile(path);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("dropbox_stub");
    expect(res.humanMessage).toContain("Dropbox");
    expect(res.humanMessage).toContain("Make Available Offline");
  });

  it("does NOT falsely detect Dropbox for adjacent-substring dirs (ship-lens P1-03)", async () => {
    statMock.mockResolvedValue({ size: 0 });
    const { preflightSourceFile } = await import("./uploadPreflight");
    // MyDropboxBackup / not-dropbox-anymore should NOT trigger the
    // Dropbox-stub message. They're just 0-byte files.
    for (const path of [
      "/Users/me/MyDropboxBackup/clip.mp4",
      "/Users/me/not-dropbox-anymore/clip.mp4",
      "/Users/me/dropbox-old/clip.mp4",
    ]) {
      const res = await preflightSourceFile(path);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("empty_file");
      expect(res.humanMessage).not.toContain("Make Available Offline");
    }
  });

  it("returns empty_file for 0-byte file OUTSIDE a Dropbox path", async () => {
    statMock.mockResolvedValueOnce({ size: 0 });
    const { preflightSourceFile } = await import("./uploadPreflight");
    const res = await preflightSourceFile("/tmp/half-written.mp4");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("empty_file");
    expect(res.humanMessage).toContain("0 bytes");
  });

  it("returns ok for a real mp4 with size > 0", async () => {
    statMock.mockResolvedValueOnce({ size: 5_242_880 }); // 5 MB
    const { preflightSourceFile } = await import("./uploadPreflight");
    const res = await preflightSourceFile("/Users/me/Videos/clip.mp4");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.size).toBe(5_242_880);
    expect(res.filename).toBe("clip.mp4");
  });

  it("accepts .mov / .m4v / .webm variants", async () => {
    statMock.mockResolvedValue({ size: 1_000 });
    const { preflightSourceFile } = await import("./uploadPreflight");
    for (const ext of ["mov", "m4v", "webm"]) {
      const res = await preflightSourceFile(`/tmp/clip.${ext}`);
      expect(res.ok).toBe(true);
    }
  });
});
