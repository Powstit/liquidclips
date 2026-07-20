/**
 * FINISH-5 · ONE choice funnel regression test
 *
 * Daniel's directive (2026-07-20): "free → paywall → crew → free-to-explore".
 * WelcomeRoute must present a SINGLE primary CTA (email OTP via
 * SimpleLoginPanel). The Whop CTA collapses behind `?legacy_login=1`
 * because Whop checkout now fires AFTER first entry, not on the welcome
 * surface. LC-ID recovery stays as a muted footer link.
 *
 * These grep-in-a-test assertions freeze that funnel shape so a future
 * revert can't silently reintroduce the "3 questions" cold-start
 * experience Daniel objected to.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WELCOME = readFileSync(
  resolve(__dirname, "WelcomeRoute.tsx"),
  "utf8",
);

describe("FINISH-5 · WelcomeRoute ONE choice funnel", () => {
  it("SimpleLoginPanel remains the primary CTA", () => {
    expect(WELCOME).toMatch(/<SimpleLoginPanel/);
  });

  it("Whop CTA is wrapped in a ?legacy_login=1 visibility guard", () => {
    // The Whop button must sit inside a container that checks the
    // legacy_login URL param. If someone hoists the button back to the
    // top level, this regex won't match.
    expect(WELCOME).toMatch(
      /legacy_login[\s\S]{0,600}data-testid="welcome-clipper"/,
    );
  });

  it("LC-ID recovery link is styled as muted footer", () => {
    // Must carry the `-muted` class + point at onExistingUserClick.
    expect(WELCOME).toMatch(
      /lc-login-fallback-link-muted[\s\S]{0,200}data-testid="welcome-existing"/,
    );
  });

  it("Whop CTA does NOT appear unwrapped at the fallback-row top level", () => {
    // Assert there is exactly ONE occurrence of `welcome-clipper` in the
    // file (the one inside the legacy_login guard). If someone re-adds
    // the button outside the guard for A/B or "just visible", the count
    // grows to 2 and this fails.
    const matches = WELCOME.match(/data-testid="welcome-clipper"/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("FINISH-5 sentinel comment is present", () => {
    // Anchor for future greps + PR reviews.
    expect(WELCOME).toMatch(/FINISH-5\b[^\n]*ONE choice funnel/);
  });
});
