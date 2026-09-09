/**
 * openSmart · browser-preview fallback regression.
 *
 * Found via a live interactive debug pass on the crew-invite flow:
 * clicking "Send invite" (with Resend unconfigured, so the code falls
 * back to a mailto: link) threw an uncaught
 * "TypeError: Cannot read properties of undefined (reading 'invoke')"
 * in browser-preview/simulator mode, because openerOpenUrl() calls
 * the real Tauri IPC bridge unconditionally. Outside a real Tauri
 * runtime that bridge doesn't exist. Mirrors the isTauriRuntime()
 * guard already used by lib/browse.ts.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockRejectedValue(new Error("should not be called outside Tauri")),
  openPath: vi.fn().mockRejectedValue(new Error("should not be called outside Tauri")),
}));

import { openSmart } from "./openSmart";

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe("openSmart · browser-preview fallback", () => {
  it("falls back to window.open for mailto: links when not in a real Tauri runtime", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    await openSmart("mailto:friend@example.com?subject=Hi");
    expect(openSpy).toHaveBeenCalledWith("mailto:friend@example.com?subject=Hi", "_blank");
  });

  it("falls back to window.open for https: links when not in a real Tauri runtime", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    await openSmart("https://liquidclips.app/join/friend");
    expect(openSpy).toHaveBeenCalledWith("https://liquidclips.app/join/friend", "_blank");
  });

  it("routes through the real opener plugin when __TAURI_INTERNALS__ is present", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    (openUrl as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    await openSmart("mailto:friend@example.com");
    expect(openUrl).toHaveBeenCalledWith("mailto:friend@example.com");
  });

  // Phase 3 · native Messages handoff — sms: added to URL_PREFIX so it
  // rides the exact same route mailto: already proved in production,
  // no new Tauri capability required (opener:allow-open-url has no
  // scheme restriction).
  it("falls back to window.open for sms: links when not in a real Tauri runtime", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    await openSmart("sms:+15551234567?body=Hi");
    expect(openSpy).toHaveBeenCalledWith("sms:+15551234567?body=Hi", "_blank");
  });

  it("routes sms: through the real opener plugin when __TAURI_INTERNALS__ is present", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    (openUrl as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    await openSmart("sms:+15551234567?body=Hi");
    expect(openUrl).toHaveBeenCalledWith("sms:+15551234567?body=Hi");
  });
});
