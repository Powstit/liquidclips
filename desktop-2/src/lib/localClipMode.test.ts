/**
 * localClipMode · single source of truth for the local-upload Automatic/
 * Manual preference, shared between InlineCreatePanel's toggle and
 * DropOverlay's drag/drop emit (2026-09-08 follow-up).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { getLocalClipMode, setLocalClipMode } from "./localClipMode";

describe("localClipMode", () => {
  beforeEach(() => {
    setLocalClipMode("automatic");
  });

  it("defaults to automatic", () => {
    expect(getLocalClipMode()).toBe("automatic");
  });

  it("round-trips manual", () => {
    setLocalClipMode("manual");
    expect(getLocalClipMode()).toBe("manual");
  });

  it("round-trips back to automatic", () => {
    setLocalClipMode("manual");
    setLocalClipMode("automatic");
    expect(getLocalClipMode()).toBe("automatic");
  });
});
