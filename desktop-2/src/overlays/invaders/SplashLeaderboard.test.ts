/**
 * SplashLeaderboard · identity ladder companion tests · Wave 1 gap-closure.
 *
 * Mirrors ``TopHud.identity-ladder.test.ts`` for the splash surface so
 * both surfaces are proven to derive from the same 5-rung ladder shape
 * on the same tick. Grep-based · consistent with the rest of the
 * desktop-2 test conventions (no vitest runtime harness required).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SPLASH_LB_SRC = readFileSync(
  resolve(__dirname, "SplashLeaderboard.tsx"),
  "utf-8",
);

describe("SplashLeaderboard · Wave 1 gap-closure · 5-rung ladder", () => {
  it("rung 1 · signed-in-handle · shows @handle when snapshot has handle", () => {
    // The identity memo has a top-priority branch for handle producing
    // ``userName = @${handle}`` and ``identityKind = 'handle'``.
    expect(SPLASH_LB_SRC).toContain('userName = `@${handle}`;');
    expect(SPLASH_LB_SRC).toMatch(/identityKind\s*=\s*"handle"/);
  });

  it("rung 4 · signing-in-during-hydration · shows 'Signing in…' verbatim", () => {
    // Locked copy · the same string TopHud emits. Ship-lens greps
    // for the literal.
    expect(SPLASH_LB_SRC).toContain('"Signing in…"');
    expect(SPLASH_LB_SRC).toContain('loggedIn && !hydrated');
    expect(SPLASH_LB_SRC).toMatch(/identityKind\s*=\s*"pending"/);
  });

  it("rung 5 · hydrated-empty · 'Complete profile' opens sheet via bus", () => {
    // The hydrated-empty branch is ``loggedIn && hydrated`` after the
    // handle/lcId/email chain returns null. Renders as a clickable
    // button in ``YouCallout`` (see ``isCompleteProfileRung``).
    expect(SPLASH_LB_SRC).toContain('loggedIn && hydrated');
    expect(SPLASH_LB_SRC).toMatch(/identityKind\s*=\s*"complete-profile"/);
    expect(SPLASH_LB_SRC).toContain('"Complete profile"');
    expect(SPLASH_LB_SRC).toContain('bus.emit("identity:open-claim-sheet"');
    expect(SPLASH_LB_SRC).toContain('mountReason: "splash-cta"');
    expect(SPLASH_LB_SRC).toContain('lcDiag("complete_profile_cta_clicked"');
    expect(SPLASH_LB_SRC).toContain('data-testid="splash-complete-profile-cta"');
  });

  it("never emits 'Guest' for a JWT-holding user", () => {
    // Same anti-regression the TopHud test enforces on its side.
    // Comments referencing the removal are OK.
    expect(SPLASH_LB_SRC).not.toMatch(/userName\s*=\s*"Guest"/);
  });
});
