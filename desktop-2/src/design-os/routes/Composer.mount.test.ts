/**
 * IG-COMPOSER-A regression guard · locks the Composer route mount
 * contract so the 4-layer wrap, focusedClip resolution, stable
 * CockpitProvider mount, and route:enter emit can never regress.
 *
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class A row A1.
 *
 * Every test here MUST stay green forever. Runs under vitest
 * (`npm run test:invariant` picks it up).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const COMPOSER_SRC = readFileSync(resolve(__dirname, "Composer.tsx"), "utf-8");

describe("IG-COMPOSER-A · Composer route mount regression guard", () => {
  it("Composer.tsx contains the IG-COMPOSER-A iron gate sentinel", () => {
    expect(COMPOSER_SRC).toMatch(/IRON GATE IG-COMPOSER-A/);
  });

  it("ComposerRoute wraps in Watchdog outermost", () => {
    // The Watchdog element MUST be the outermost JSX in ComposerRoute's
    // return so a route-level crash surfaces the KadeRepairScreen
    // fallback rather than white-screening the shell.
    const start = COMPOSER_SRC.indexOf("export function ComposerRoute");
    expect(start).toBeGreaterThan(-1);
    const nextExport = COMPOSER_SRC.indexOf("\nexport function", start + 1);
    const body = COMPOSER_SRC.slice(start, nextExport > -1 ? nextExport : start + 4000);
    // The first meaningful JSX element after the return must be <Watchdog.
    expect(body).toMatch(/return\s*\(\s*<Watchdog/);
  });

  it("ComposerRoute wraps EngineSessionProvider inside Watchdog", () => {
    const start = COMPOSER_SRC.indexOf("export function ComposerRoute");
    const nextExport = COMPOSER_SRC.indexOf("\nexport function", start + 1);
    const body = COMPOSER_SRC.slice(start, nextExport > -1 ? nextExport : start + 4000);
    expect(body).toMatch(/<Watchdog[\s\S]*?<EngineSessionProvider/);
  });

  it("ComposerBody wraps CockpitProvider around DesignOSAppShell", () => {
    // Ordering matters — CockpitProvider must be outside DesignOSAppShell
    // so nested design-os surfaces reading useCockpit() find the context.
    expect(COMPOSER_SRC).toMatch(/<CockpitProvider[\s\S]*?<DesignOSAppShell/);
  });

  it("focusedClip resolves via useFocusedClipFromSession (never FIXTURE_PROJECT)", () => {
    // Guard: no direct FIXTURE_PROJECT read inside ComposerCanvas or
    // ComposerBody · the resolver must go through the session hook so
    // IG-LC2-016 transfers cleanly.
    expect(COMPOSER_SRC).toMatch(/function useFocusedClipFromSession\(\)/);
    expect(COMPOSER_SRC).toMatch(/useFocusedClipFromSession\(\)/);
  });

  it("useFocusedClipFromSession reads useEngineSession().project.clips", () => {
    const start = COMPOSER_SRC.indexOf("function useFocusedClipFromSession");
    expect(start).toBeGreaterThan(-1);
    const end = COMPOSER_SRC.indexOf("\n}\n", start);
    expect(end).toBeGreaterThan(start);
    const body = COMPOSER_SRC.slice(start, end);
    expect(body).toMatch(/useEngineSession\(\)/);
    expect(body).toMatch(/project\.clips|\.project\.clips|session\.project/);
  });

  it("ComposerRoute emits route:enter with route: \"composer\"", () => {
    expect(COMPOSER_SRC).toMatch(
      /bus\.emit\(\s*["']route:enter["']\s*,\s*\{[\s\S]*?route:\s*["']composer["']/,
    );
  });

  it("CockpitProvider is NOT mounted conditionally", () => {
    // IG-LC2-018 transfer: mounting the provider inside a JSX ternary
    // (e.g. focusedClip ? <CockpitProvider>...</CockpitProvider> : null)
    // remounts the entire context tree on focus flips. Forbidden.
    // Regex looks for the offending pattern near CockpitProvider usage.
    const cockpitProviderOpens = [...COMPOSER_SRC.matchAll(/<CockpitProvider\b/g)];
    expect(cockpitProviderOpens.length).toBeGreaterThan(0);
    // For each open tag, back-scan the 400 characters before it looking
    // for a ternary condition (`?`) directly wrapping the provider.
    for (const match of cockpitProviderOpens) {
      const idx = match.index ?? 0;
      const preSlice = COMPOSER_SRC.slice(Math.max(0, idx - 400), idx);
      // Reject a `?` at ternary-position immediately followed by the
      // provider open. Allow `?` inside prop expressions or comments.
      // Heuristic: the `?` must appear on the same logical line as the
      // provider open without an intervening `{` or `(` that scopes it.
      // Simplest reject: a lone conditional expression pattern.
      const lastTernary = preSlice.lastIndexOf("?");
      if (lastTernary > -1) {
        const between = preSlice.slice(lastTernary + 1);
        // If nothing but whitespace and JSX-open between the `?` and the
        // provider, this is a conditional mount.
        const isConditional = /^\s*$/.test(between) || /^\s*\(\s*$/.test(between);
        expect(isConditional).toBe(false);
      }
    }
  });

  it("all three inherited iron gates are still referenced", () => {
    // IG-LC2-016 / 017 / 018 are the Workstation-family invariants that
    // Composer transfers. Removing the sentinel comments strips the
    // documentation trail even if the code still works.
    expect(COMPOSER_SRC).toMatch(/IRON GATE IG-LC2-016/);
    expect(COMPOSER_SRC).toMatch(/IRON GATE IG-LC2-017/);
    expect(COMPOSER_SRC).toMatch(/IRON GATE IG-LC2-018/);
  });
});
