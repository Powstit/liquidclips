import { describe, it, expect } from "vitest";
import { humanError } from "./humanError";

describe("humanError", () => {
  it("rewrites Chromium's raw network error", () => {
    const e = new TypeError("Failed to fetch");
    expect(humanError(e)).toMatch(/couldn't reach liquid clips/i);
  });

  it("rewrites WebKit/Tauri's raw network error", () => {
    const e = new TypeError("Load failed");
    expect(humanError(e)).toMatch(/couldn't reach liquid clips/i);
  });

  it("rewrites an AbortController timeout", () => {
    const e = new DOMException("The operation was aborted.", "AbortError");
    expect(humanError(e)).toMatch(/took too long/i);
  });

  it("passes a real backend detail message straight through", () => {
    // These are already human — must NOT be swallowed by a generic message.
    const e = new Error("That code expired · request a fresh sign-in code");
    expect(humanError(e)).toBe("That code expired · request a fresh sign-in code");
  });

  it("passes 'Hosted AI requires Pro or Agency' through unchanged", () => {
    const e = new Error("Hosted AI requires Pro or Agency. Add your own OpenAI key or upgrade.");
    expect(humanError(e)).toContain("Hosted AI requires Pro or Agency");
  });

  it("uses the caller's fallback for a non-error, non-string throw", () => {
    expect(humanError({ weird: true }, "Couldn't save · try again.")).toBe("Couldn't save · try again.");
  });

  it("returns a trimmed string throw verbatim", () => {
    expect(humanError("  boom  ")).toBe("boom");
  });

  it("falls back when an Error has an empty message", () => {
    expect(humanError(new Error(""), "fallback here")).toBe("fallback here");
  });
});
