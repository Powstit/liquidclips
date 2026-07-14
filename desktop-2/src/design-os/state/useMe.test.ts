/**
 * useMe · RC1 state-drift trifecta · P0/P1-A · 2026-07-11
 *
 * Acceptance criterion 3: Whop connection updates immediately after
 * activation. The Whop deep-link flow (activation.ts) emits
 * `activation:complete` after the JWT lands. useMe MUST refetch on
 * that event so `whopUserId` (and every other /me field) hydrates
 * before the next React tick — otherwise TopHud shows "Connect Whop"
 * even though the link succeeded.
 *
 * Suite structure matches the source-file grep pattern used elsewhere
 * (see TopHud.identity.test.ts) so the assertions read as behavioral
 * documentation — no need for a fake fetch mock harness.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const USE_ME_SRC = readFileSync(resolve(__dirname, "useMe.ts"), "utf-8");

describe("useMe · bus subscribers", () => {
  it("subscribes to auth:signed-in (ship-lens P1-01/02 · pre-existing)", () => {
    // Prior fix (2026-07-11 morning) covers the OTP sign-in path.
    expect(USE_ME_SRC).toMatch(/bus\.on\(\s*["']auth:signed-in["']/);
  });

  it("subscribes to activation:complete (RC1 trifecta · Whop link path)", () => {
    // RC1 fix — the Whop deep-link activation flow stores the JWT +
    // emits `activation:complete`, but does NOT emit `auth:signed-in`
    // (reserved for OTP verify). Without this second subscriber, /me
    // stayed on its pre-Whop snapshot forever, so `whopUserId`
    // remained null after the link succeeded.
    expect(USE_ME_SRC).toMatch(/bus\.on\(\s*["']activation:complete["']/);
  });

  it("both subscribers call loadMe · not adhoc fetches", () => {
    // Consistency check — the effect body triggers `loadMe()` (single-
    // flight guard) for both events so a rapid sequence of signals
    // (Whop link → OTP recovery) doesn't fan out into parallel /me
    // fetches.
    const signedInBlock = USE_ME_SRC.match(
      /bus\.on\(\s*["']auth:signed-in["'][^)]*\)[^;]*/,
    );
    const activationBlock = USE_ME_SRC.match(
      /bus\.on\(\s*["']activation:complete["'][^)]*\)[^;]*/,
    );
    expect(signedInBlock?.[0]).toContain("loadMe()");
    expect(activationBlock?.[0]).toContain("loadMe()");
  });

  it("cleanup unsubscribes both listeners on unmount", () => {
    // Both handles wired into the effect return so React StrictMode's
    // double-mount doesn't leak subscriptions.
    expect(USE_ME_SRC).toMatch(/unsubscribeSignedIn\?\.\(\)/);
    expect(USE_ME_SRC).toMatch(/unsubscribeActivation\?\.\(\)/);
  });
});
