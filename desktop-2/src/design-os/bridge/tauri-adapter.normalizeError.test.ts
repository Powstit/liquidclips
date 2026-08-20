/**
 * normalizeError · customer_message/error_code fallback
 *
 * 2026-08-20 · YouTubeBlockedError (sidecar.py) sends
 * customer_message/error_code, not human/code — normalizeError was only
 * reading human/code, so the sidecar's reviewed, specific copy (region-
 * locked, age-gate, login-required, 403, etc.) was silently discarded and
 * re-derived by the generic regex classifier instead. Proves the fallback
 * actually works, straight from the exact function that had the bug.
 */

import { describe, it, expect } from "vitest";
import { normalizeError } from "./tauri-adapter";

describe("normalizeError · customer_message/error_code fallback", () => {
  it("falls back to customer_message when human is absent", () => {
    const n = normalizeError({
      message: "This video is region-locked. Try a different link — or connect cookies from a supported region.",
      customer_message: "This video is region-locked. Try a different link — or connect cookies from a supported region.",
      error_code: "youtube_geo_block",
    });
    expect(n.human).toBe(
      "This video is region-locked. Try a different link — or connect cookies from a supported region.",
    );
    expect(n.code).toBe("youtube_geo_block");
  });

  it("still prefers human/code when both shapes are present", () => {
    const n = normalizeError({
      human: "explicit human copy",
      code: "PREFLIGHT_DROPBOX_STUB",
      customer_message: "should not win",
      error_code: "should_not_win",
    });
    expect(n.human).toBe("explicit human copy");
    expect(n.code).toBe("PREFLIGHT_DROPBOX_STUB");
  });

  it("leaves human/code undefined when neither shape is present", () => {
    const n = normalizeError({ message: "raw failure string" });
    expect(n.human).toBeUndefined();
    expect(n.code).toBeUndefined();
    expect(n.error).toBe("raw failure string");
  });
});
