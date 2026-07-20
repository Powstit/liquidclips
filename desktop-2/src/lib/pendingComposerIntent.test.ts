import { beforeEach, describe, expect, it } from "vitest";
import {
  consumePendingComposerIntent,
  peekPendingComposerIntent,
  setPendingComposerIntent,
} from "./pendingComposerIntent";

describe("pendingComposerIntent · handoff buffer", () => {
  beforeEach(() => {
    consumePendingComposerIntent();
  });

  it("returns null when nothing queued", () => {
    expect(consumePendingComposerIntent()).toBeNull();
  });

  it("stores + returns the queued text once", () => {
    setPendingComposerIntent("record my screen");
    expect(consumePendingComposerIntent()).toBe("record my screen");
  });

  it("clears after consume (one-shot)", () => {
    setPendingComposerIntent("record my screen");
    consumePendingComposerIntent();
    expect(consumePendingComposerIntent()).toBeNull();
  });

  it("trims whitespace before storing", () => {
    setPendingComposerIntent("   record tutorial   ");
    expect(consumePendingComposerIntent()).toBe("record tutorial");
  });

  it("treats empty / whitespace as null", () => {
    setPendingComposerIntent("   ");
    expect(consumePendingComposerIntent()).toBeNull();
    setPendingComposerIntent("");
    expect(consumePendingComposerIntent()).toBeNull();
  });

  it("supports null to clear", () => {
    setPendingComposerIntent("record");
    setPendingComposerIntent(null);
    expect(consumePendingComposerIntent()).toBeNull();
  });

  it("last-write-wins on overwrite", () => {
    setPendingComposerIntent("first");
    setPendingComposerIntent("second");
    expect(consumePendingComposerIntent()).toBe("second");
  });

  it("peek does NOT clear", () => {
    setPendingComposerIntent("linger");
    expect(peekPendingComposerIntent()).toBe("linger");
    expect(peekPendingComposerIntent()).toBe("linger");
    expect(consumePendingComposerIntent()).toBe("linger");
    expect(consumePendingComposerIntent()).toBeNull();
  });
});
