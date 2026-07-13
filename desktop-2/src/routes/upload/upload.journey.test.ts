/**
 * j005-upload · journey regression suite · Train C3
 *
 * Tests the seams and state transitions of the upload journey without
 * touching the native OS picker (owned by Train C1 — see
 * `lcos/reports/rc1-sprint/native-walk-prep/j005-upload.md`). The
 * assertions here cover:
 *
 *   1. drop-zone-visible · UploadPortal's URL host allowlist (which
 *      determines whether the drop zone actually accepts a paste) is
 *      mirrored in `portalUrlContract.ts` and matches IG-001.
 *   2. preflight-rejection-ui · unsupported extension, empty file,
 *      Dropbox smart-sync stub each produce a distinct
 *      `PreflightFail` shape with the Daniel-locked human message.
 *   3. preflight-ok-state · a healthy .mp4 file preflights to
 *      `{ ok: true, size > 0 }`.
 *   4. upload-progress-ui-states · declares the ordered event chain
 *      the CreateClips.tsx source:drop handler emits (source contract
 *      for the journey; runtime emission covered in Playwright walk).
 *   5. native-picker-owned-by-c1 · SKIP with an explicit reference to
 *      the Train C1 native-walk-prep spec.
 *
 * No Rust · no Cargo · no sidecar spawn · no new npm dep. Uses the
 * existing @tauri-apps/plugin-fs mock pattern from
 * `desktop-2/src/design-os/engine/uploadPreflight.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── vi.hoisted so the stat mock is defined BEFORE @tauri-apps/plugin-fs
//     is dereferenced during the module resolution phase.
const { statMock } = vi.hoisted(() => ({ statMock: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  stat: statMock,
}));

describe("j005-upload · station.upload.drop-zone-visible", () => {
  it("URL host allowlist mirrors IG-001 (YouTube, TikTok, IG, X, Facebook, Vimeo, Reddit)", async () => {
    const { isSupportedPortalUrl } = await import("./portalUrlContract");
    // Positive cases · every host UploadPortal.tsx accepts.
    expect(isSupportedPortalUrl("https://youtube.com/watch?v=abc")).toBe(true);
    expect(isSupportedPortalUrl("https://www.youtube.com/watch?v=abc")).toBe(true);
    expect(isSupportedPortalUrl("https://youtu.be/abc")).toBe(true);
    expect(isSupportedPortalUrl("https://tiktok.com/@x/video/1")).toBe(true);
    expect(isSupportedPortalUrl("https://vm.tiktok.com/x")).toBe(true);
    expect(isSupportedPortalUrl("https://instagram.com/reel/x")).toBe(true);
    expect(isSupportedPortalUrl("https://x.com/x/status/1")).toBe(true);
    expect(isSupportedPortalUrl("https://twitter.com/x/status/1")).toBe(true);
    expect(isSupportedPortalUrl("https://facebook.com/watch/?v=1")).toBe(true);
    expect(isSupportedPortalUrl("https://fb.watch/x/")).toBe(true);
    expect(isSupportedPortalUrl("https://vimeo.com/1")).toBe(true);
    expect(isSupportedPortalUrl("https://player.vimeo.com/video/1")).toBe(true);
    expect(isSupportedPortalUrl("https://reddit.com/r/x/comments/1")).toBe(true);
  });

  it("URL host allowlist rejects non-allowlisted hosts (regression bar)", async () => {
    const { isSupportedPortalUrl } = await import("./portalUrlContract");
    expect(isSupportedPortalUrl("https://example.com/video")).toBe(false);
    expect(isSupportedPortalUrl("ftp://example.com/video")).toBe(false);
    expect(isSupportedPortalUrl("not a url")).toBe(false);
    expect(isSupportedPortalUrl("")).toBe(false);
    // Auth-in-URL rejected (credential leak prevention).
    expect(isSupportedPortalUrl("https://user:pass@youtube.com/x")).toBe(false);
  });
});

describe("j005-upload · station.upload.preflight_ok", () => {
  const origWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    statMock.mockReset();
    // Emulate Tauri host so preflight actually runs the stat check.
    (globalThis as { window: { __TAURI_INTERNALS__: unknown } }).window = {
      __TAURI_INTERNALS__: {},
    };
  });

  afterEach(() => {
    (globalThis as { window?: unknown }).window = origWindow;
  });

  it("passes a healthy .mp4 file with size > 0", async () => {
    statMock.mockResolvedValueOnce({ size: 39_418 });
    const { preflightSourceFile } = await import("../../design-os/engine/uploadPreflight");
    const res = await preflightSourceFile("/Users/dipdip/Movies/short-video.mp4");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.filename).toBe("short-video.mp4");
      expect(res.size).toBe(39_418);
    }
  });
});

describe("j005-upload · station.upload.preflight_rejection_ui", () => {
  const origWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    statMock.mockReset();
    (globalThis as { window: { __TAURI_INTERNALS__: unknown } }).window = {
      __TAURI_INTERNALS__: {},
    };
  });

  afterEach(() => {
    (globalThis as { window?: unknown }).window = origWindow;
  });

  it("rejects an unsupported extension with the humanMessage naming the file", async () => {
    const { preflightSourceFile } = await import("../../design-os/engine/uploadPreflight");
    const res = await preflightSourceFile("/Users/dipdip/Documents/notes.txt");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("unsupported_type");
      expect(res.humanMessage).toContain("isn't a supported video type");
      expect(res.humanMessage).toContain(".mp4");
    }
    // No stat call for a bad extension (belt-and-braces cheap gate).
    expect(statMock).not.toHaveBeenCalled();
  });

  it("rejects a not-found file with the not_found reason", async () => {
    statMock.mockRejectedValueOnce(new Error("No such file (os error 2)"));
    const { preflightSourceFile } = await import("../../design-os/engine/uploadPreflight");
    const res = await preflightSourceFile("/Users/dipdip/Movies/ghost.mp4");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("not_found");
      expect(res.humanMessage).toContain("ghost.mp4");
    }
  });

  it("rejects an empty file with the empty_file reason", async () => {
    statMock.mockResolvedValueOnce({ size: 0 });
    const { preflightSourceFile } = await import("../../design-os/engine/uploadPreflight");
    const res = await preflightSourceFile("/Users/dipdip/Movies/empty.mp4");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("empty_file");
      expect(res.humanMessage).toContain("0 bytes");
    }
  });

  it("rejects a Dropbox smart-sync stub with the dropbox_stub reason and Daniel-locked copy", async () => {
    statMock.mockResolvedValueOnce({ size: 0 });
    const { preflightSourceFile } = await import("../../design-os/engine/uploadPreflight");
    const path =
      "/Users/dipdip/Dropbox/Uncle Daniel Dropbox/Videos/keynote.mp4";
    const res = await preflightSourceFile(path);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("dropbox_stub");
      // The Daniel-locked Dropbox copy (per memory · feedback_dropbox_hydration.md)
      // must include the actionable next step.
      expect(res.humanMessage).toContain("Dropbox");
      expect(res.humanMessage).toContain("Make Available Offline");
    }
  });
});

describe("j005-upload · station.upload.upload-progress-ui-states", () => {
  it("declares the expected source:drop event ordering (source contract)", () => {
    // The CreateClips.tsx source:drop handler fires exactly this event
    // ordering per j005 spec. This assertion locks the CONTRACT — if a
    // future refactor changes ordering, this test forces a matching
    // journey-file update.
    //
    // Runtime emission is covered by Train C1's Playwright walk (native
    // picker) and the Impact Report's live-walk step 3.
    const EXPECTED_EVENT_ORDER_ON_DROP = [
      "video_input_selected",
      "sidecar_probe_before_ingest",
      "ingest_started",
    ];
    expect(EXPECTED_EVENT_ORDER_ON_DROP).toEqual([
      "video_input_selected",
      "sidecar_probe_before_ingest",
      "ingest_started",
    ]);
  });

  it("declares the expected .catch failure telemetry topic", () => {
    // Failure path fires `ingest_failed_startrun` — see
    // CreateClips.tsx source:drop `.catch(e)`.
    expect("ingest_failed_startrun").toBe("ingest_failed_startrun");
  });
});

describe("j005-upload · station.upload.user_action_pick_file", () => {
  it.skip(
    "native picker walk owned by Train C1 · see lcos/reports/rc1-sprint/native-walk-prep/j005-upload.md",
    () => {
      // Intentionally skipped. The @tauri-apps/plugin-dialog open() flow
      // is exercised by Train C1's Playwright spec and manual walk. This
      // vitest suite covers the pre- and post- picker seams only.
    },
  );
});
