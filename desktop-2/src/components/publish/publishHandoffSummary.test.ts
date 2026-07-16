import { describe, it, expect } from "vitest";
import { summarizeHandoff } from "./publishHandoffSummary";

describe("summarizeHandoff", () => {
  it("does NOT claim success when every composer failed (the original bug)", () => {
    const s = summarizeHandoff(0, 3, "TikTok");
    expect(s.errorToast).toBeDefined();
    expect(s.queuedMessage).toMatch(/couldn't open/i);
    expect(s.queuedMessage).not.toMatch(/opened \d/i);
  });

  it("surfaces an error toast for a single total failure", () => {
    const s = summarizeHandoff(0, 1, "YouTube");
    expect(s.errorToast?.title).toMatch(/couldn't open/i);
    expect(s.queuedMessage).toBe("Couldn't open the composer · try again.");
  });

  it("reports a clean single success with the platform name", () => {
    const s = summarizeHandoff(1, 0, "TikTok");
    expect(s.errorToast).toBeUndefined();
    expect(s.queuedMessage).toBe("Opened TikTok composer · Finder shows the clip.");
  });

  it("reports a clean multi success", () => {
    const s = summarizeHandoff(3, 0, "TikTok");
    expect(s.errorToast).toBeUndefined();
    expect(s.queuedMessage).toBe("Opened 3 composers · queue holds the rest.");
  });

  it("is specific about a partial failure so the user knows to retry", () => {
    const s = summarizeHandoff(2, 1, "Instagram");
    expect(s.errorToast).toBeUndefined();
    expect(s.queuedMessage).toBe(
      "Opened 2 of 3 composers · 1 didn't open, retry from the Schedule queue.",
    );
  });
});
