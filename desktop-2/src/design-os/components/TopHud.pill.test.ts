/**
 * TopHud · pill regression · RC1 state-drift trifecta · P0-2 · 2026-07-11
 *
 * Locks acceptance criteria 2 + 5 as static contracts:
 *   - Criterion 2: signed-in users never see "Guest" or "Free" in the
 *     avatar pill by way of a hardcoded prop default. The `userName` +
 *     `userTier` props are removed entirely so no caller can pass a
 *     stale fallback string.
 *   - Criterion 5: no `userTier="pro"` (or any tier string literal) is
 *     ever passed to TopHud or SplashLeaderboard.
 *
 * Source-file grep pattern mirrors the shipped convention
 * (TopHud.identity.test.ts). Runtime behaviour is covered separately
 * by useAuth.test.ts / mode.test.ts fan-out proofs.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HUD_SRC = readFileSync(resolve(__dirname, "TopHud.tsx"), "utf-8");
const SPLASH_LB_SRC = readFileSync(
  resolve(__dirname, "..", "..", "overlays", "invaders", "SplashLeaderboard.tsx"),
  "utf-8",
);
const APP_SHELL_SRC = readFileSync(
  resolve(__dirname, "AppShell.tsx"),
  "utf-8",
);
const INTRO_SPLASH_SRC = readFileSync(
  resolve(__dirname, "..", "..", "overlays", "IntroSplash.tsx"),
  "utf-8",
);
const EXPORT_ROUTE_SRC = readFileSync(
  resolve(__dirname, "..", "routes", "ExportRoute.tsx"),
  "utf-8",
);

describe("TopHudProps · dead-prop deletion (RC1 P0-2)", () => {
  it("TopHudProps interface has no userName prop", () => {
    // The `userName` prop enabled callers to pass a stale hardcoded
    // string that persisted through signin. Deleted so identity flows
    // exclusively through useMe.
    expect(HUD_SRC).not.toMatch(/userName\?\s*:\s*string/);
  });

  it("TopHudProps interface has no userTier prop", () => {
    // The `userTier` prop was the vector for the `userTier="pro"`
    // hardcode in ExportRoute + any other caller. Deleted so gating
    // reads from useTierCaps.
    expect(HUD_SRC).not.toMatch(/userTier\?\s*:\s*string/);
  });

  it("TopHudProps interface has no greetingName prop", () => {
    // The greeting name defaulted to "Guest" — a signed-in user with
    // no prop passed saw "Guest" forever. Now the greeting reads from
    // useMe directly, same source as the avatar pill.
    expect(HUD_SRC).not.toMatch(/greetingName\?\s*:\s*string/);
  });

  // Wave 1 · Cluster 1 · identity ladder (2026-07-12). The old
  // ``handleFromEmail ? \`@${handleFromEmail}\` : "Guest"`` shape was
  // itself a bug carrier — for a JWT-holding user with no cached email
  // yet, the render fell to the literal string ``"Guest"``. Replaced
  // with a priority ladder ``handle → lc_id → 'Signing in…' → null``.
  // See ``lcos/09_BUG_LEDGER.md`` BUG-002.
  it("avatar-user-name renders the identity ladder (Wave 1)", () => {
    // The JSX must read from ``identityLadder.copy`` and expose a
    // ``data-identity-copy`` attribute for QA + ship-lens.
    expect(HUD_SRC).toContain('data-identity-copy={identityLadder.copy}');
    expect(HUD_SRC).toMatch(
      /className="lc-hud-user-name"[^>]*data-identity-copy=\{identityLadder\.copy\}/s,
    );
  });

  it("greeting eyebrow reads from the derived personalised string", () => {
    // BUG-013 · greeting must derive from local clock + identity ladder.
    expect(HUD_SRC).toContain('{derivedGreeting}');
    expect(HUD_SRC).toMatch(/const derivedGreeting = useMemo/);
  });

  it("greeting-name slot renders the ladder copy, never 'Guest'", () => {
    // BUG-002 · the JSX for the greeting-name slot must NOT contain
    // the literal ``: "Guest"`` fallback that shipped in ``e4ff1060``.
    // The old grep matched the exact regex ``: "Guest"}`` — assert it's gone.
    expect(HUD_SRC).not.toMatch(/lc-hud-greet-name">\s*\{handleFromEmail\s*\?[^}]*"Guest"\}/);
    expect(HUD_SRC).not.toMatch(/lc-hud-user-name">\s*\{handleFromEmail\s*\?[^}]*"Guest"\}/);
  });

  it("resolvedTier still gates through useTierCaps + Admin / Free honesty", () => {
    // The three-branch derivation matches SideNav's identity strip so
    // both surfaces render the same tier label.
    expect(HUD_SRC).toContain('if (tierCaps.platformRole === "admin") return "Admin"');
    expect(HUD_SRC).toContain('if (tierCaps.tier === "clipper") return "Free"');
  });
});

describe("SplashLeaderboard · dead-prop deletion (RC1 P0-2)", () => {
  it("no userName prop in the type signature", () => {
    // Same reason as TopHud — the splash "YOU" callout must never say
    // "Guest / Free" for a signed-in user.
    expect(SPLASH_LB_SRC).not.toMatch(/userName\?\s*:\s*string/);
  });

  it("no userTier prop in the type signature", () => {
    expect(SPLASH_LB_SRC).not.toMatch(/userTier\?\s*:\s*string/);
  });

  it("derives identity from useMe + useTierCaps (same as TopHud + SideNav)", () => {
    expect(SPLASH_LB_SRC).toContain('useMe(');
    expect(SPLASH_LB_SRC).toContain('useTierCaps(');
  });
});

describe("callers · no hardcoded tier / name strings passed to identity surfaces (RC1 P0-2)", () => {
  it("AppShell mounts <TopHud /> with no identity props", () => {
    // AppShell is the only mount site — every prop must be empty.
    expect(APP_SHELL_SRC).toMatch(/<TopHud\s*\/>/);
    expect(APP_SHELL_SRC).not.toMatch(/<TopHud[^/]*userName=/);
    expect(APP_SHELL_SRC).not.toMatch(/<TopHud[^/]*userTier=/);
    expect(APP_SHELL_SRC).not.toMatch(/<TopHud[^/]*greetingName=/);
  });

  it("IntroSplash mounts <SplashLeaderboard /> with only score prop", () => {
    expect(INTRO_SPLASH_SRC).toMatch(/<SplashLeaderboard\s+score=/);
    expect(INTRO_SPLASH_SRC).not.toMatch(/<SplashLeaderboard[^/]*userName=/);
    expect(INTRO_SPLASH_SRC).not.toMatch(/<SplashLeaderboard[^/]*userTier=/);
  });

  it('ExportRoute does not pass userTier="pro" (RC1 P1-B)', () => {
    // Acceptance criterion 5 · the hardcoded `userTier="pro"` in
    // ExportRoute.tsx:286 leaked Pro caps to every user regardless of
    // their real tier. Deleted; ExportPanel gates entirely through
    // watermarkLockedOverride (driven by useTierCaps).
    //
    // Regex only matches JSX-attribute form (whitespace-preceded) so
    // a docstring reference to the removed prop doesn't false-positive.
    expect(EXPORT_ROUTE_SRC).not.toMatch(/\s+userTier=["']pro["']/);
    expect(EXPORT_ROUTE_SRC).not.toMatch(/\s+userTier=["']free["']/);
    expect(EXPORT_ROUTE_SRC).not.toMatch(/\s+userTier=["']growth["']/);
    expect(EXPORT_ROUTE_SRC).not.toMatch(/\s+userTier=["']agency["']/);
  });
});
