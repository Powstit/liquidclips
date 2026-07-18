import { describe, it, expect } from "vitest";
import { describeError } from "./customerSafeErrors";

/**
 * Launch-critical · the free-tier "make your first clip" moment.
 *
 * Per the app's own architecture, a free user with no BYOK key can't run
 * hosted AI — the sidecar raises "No clip-judge provider available…" and the
 * backend returns 403 "Hosted Anthropic requires Pro or Agency." That must read
 * as a clear next step (add a key OR upgrade), never a generic failure.
 */
describe("describeError · NEEDS_CLIP_PROVIDER (free-tier clip gate)", () => {
  const cases = [
    "No clip-judge provider available. Add an ANTHROPIC_API_KEY or OPENAI_API_KEY in Settings → API keys, or sign in with a Pro/Agency license for hosted AI.",
    "Hosted Anthropic requires Pro or Agency.",
    "Hosted AI requires Pro or Agency. Add your own OpenAI key or upgrade.",
  ];

  for (const raw of cases) {
    it(`classifies: ${raw.slice(0, 40)}…`, () => {
      const safe = describeError(new Error(raw));
      expect(safe.code).toBe("NEEDS_CLIP_PROVIDER");
      expect(safe.title).toBe("Add a key to make clips");
      // must point the user somewhere actionable
      expect(safe.action?.kind).toBe("settings");
      // must NOT leak the raw runtime text in the body
      expect(safe.body).not.toMatch(/RuntimeError|Traceback|ANTHROPIC_API_KEY/);
      // must name both routes: bring a key, or upgrade
      expect(safe.body.toLowerCase()).toMatch(/key/);
      expect(safe.body.toLowerCase()).toMatch(/upgrade|pro/);
    });
  }

  it("does NOT misfire on a genuine provider 5xx (that stays PROVIDER_UPSTREAM)", () => {
    const safe = describeError(new Error("anthropic proxy returned HTTP 502 bad gateway"));
    expect(safe.code).toBe("PROVIDER_UPSTREAM");
  });

  it("does NOT misfire on a normal zero-clips result", () => {
    const safe = describeError(new Error("clip_plan_empty · produced zero clips"));
    expect(safe.code).toBe("ZERO_CLIPS");
  });
});
