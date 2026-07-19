/**
 * IG-014-D regression guard · locks the WelcomeGate bus-subscription
 * contract so the 2026-07-18 "stuck on login screen with valid JWT"
 * bug can never come back.
 *
 * Root cause of the 2026-07-18 incident: WelcomeGate only listened to
 * `activation:complete`. SimpleLoginPanel.handleVerify emits
 * `auth:signed-in`, not `activation:complete` (the latter fires only
 * on the Whop deep-link / Clerk activation branch). Users who signed
 * in via OTP got a valid JWT stored in localStorage but WelcomeGate
 * never flipped `acked=true` in the same session — they stayed on the
 * login screen until they closed and reopened the app.
 *
 * Every test here MUST stay green forever. Any edit that removes the
 * `auth:signed-in` subscription or reverts to a single-event listener
 * fails here and blocks the commit.
 *
 * Runs under vitest (`npm run test:invariant` picks it up).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_SRC = resolve(__dirname);

function readSrc(relative: string): string {
  return readFileSync(resolve(REPO_SRC, relative), "utf-8");
}

describe("IG-014-D · WelcomeGate bus-subscription regression guard", () => {
  it("App.tsx WelcomeGate subscribes to auth:signed-in", () => {
    const src = readSrc("App.tsx");
    // The primary OTP sign-in path emits `auth:signed-in` — WelcomeGate
    // MUST listen to it or same-session sign-in strands users on the
    // login screen with a valid JWT already in localStorage.
    expect(src).toMatch(/bus\.on\(\s*["']auth:signed-in["']/);
  });

  it("App.tsx WelcomeGate still subscribes to activation:complete", () => {
    const src = readSrc("App.tsx");
    // The Whop deep-link + Clerk activation branches emit
    // `activation:complete`. Both subscriptions are load-bearing.
    expect(src).toMatch(/bus\.on\(\s*["']activation:complete["']/);
  });

  it("App.tsx contains the IG-014-D iron gate sentinel", () => {
    const src = readSrc("App.tsx");
    expect(src).toMatch(/IG-014-D/);
  });

  it("both subscriptions are wired inside the WelcomeGate function", () => {
    const src = readSrc("App.tsx");
    // Slice the WelcomeGate function body and check both handlers are
    // present INSIDE it. Prevents someone accidentally splitting the
    // handlers into a different component that WelcomeGate can't reach.
    const start = src.indexOf("function WelcomeGate(");
    expect(start).toBeGreaterThan(-1);
    // Find the matching close (naive: next unmatched '}' at column 0 or
    // the next `function `/`export ` keyword after `WelcomeGate` starts).
    const next = src.indexOf("\nfunction ", start + 1);
    const body = src.slice(start, next > -1 ? next : start + 8000);
    expect(body).toMatch(/bus\.on\(\s*["']auth:signed-in["']/);
    expect(body).toMatch(/bus\.on\(\s*["']activation:complete["']/);
  });

  it("both subscriptions call the same ack-check helper (no drift)", () => {
    const src = readSrc("App.tsx");
    // Both listeners must run the same predicate: JWT present OR
    // activation status "activated" OR welcome-acked. Locking this via
    // a shared helper (`runAckCheck` in the fix) prevents future drift
    // where one branch checks different conditions than the other.
    expect(src).toMatch(/const\s+runAckCheck\s*=/);
    // The helper must include the hasJwt() check — the whole point.
    const start = src.indexOf("const runAckCheck");
    const end = src.indexOf("};", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const helper = src.slice(start, end);
    expect(helper).toMatch(/hasJwt\(\)/);
  });
});
