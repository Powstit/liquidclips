/**
 * IG-BARE-URL-IS-SOURCE · 2026-07-23
 *
 * Regression: a bare URL pasted into the command bar MUST hit
 * `acceptSource` and MUST NOT reach `routeIntent` or `requestKadeIntent`.
 * Source-code invariant test (matches LC's Composer.mount.test.ts style).
 *
 * Root cause of the fence:
 *   User pasted `https://youtu.be/UmhxGGdpDVU?is=...` in the command bar.
 *   The hosted LLM took 5 seconds and mis-routed the intent to `library`.
 *   activeSlug stayed null, no pipeline started, user perceived "clipping
 *   engine hanging."  Verified via remote channel state.snapshot 10:20am.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = readFileSync(resolve(__dirname, "useComposerBrain.ts"), "utf-8");

describe("IG-BARE-URL-IS-SOURCE · command-bar URL guard", () => {
  it("useComposerBrain carries the sentinel", () => {
    expect(SRC).toMatch(/IG-BARE-URL-IS-SOURCE/);
  });

  it("guard runs BEFORE local routeIntent (never a URL through the classifier)", () => {
    // The guard block must appear before the `Tier 1 · local regex` marker.
    const guardIdx = SRC.indexOf("IG-BARE-URL-IS-SOURCE");
    const routeIdx = SRC.indexOf("Tier 1 · local regex");
    expect(guardIdx, "sentinel must appear").toBeGreaterThan(-1);
    expect(routeIdx, "Tier 1 marker must appear").toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(routeIdx);
  });

  it("URL guard uses /^https?:\\/\\// regex + calls acceptSource", () => {
    // Extract the block between the sentinel and the Tier 1 marker.
    const guardIdx = SRC.indexOf("IG-BARE-URL-IS-SOURCE");
    const routeIdx = SRC.indexOf("Tier 1 · local regex");
    const block = SRC.slice(guardIdx, routeIdx);
    expect(block).toMatch(/\^https\?:/);
    expect(block).toMatch(/acceptSource\(\s*\{\s*url:\s*cmd\s*\}\s*\)/);
  });

  it("live-stream branch shows a friendly Kade message + returns", () => {
    const guardIdx = SRC.indexOf("IG-BARE-URL-IS-SOURCE");
    const routeIdx = SRC.indexOf("Tier 1 · local regex");
    const block = SRC.slice(guardIdx, routeIdx);
    expect(block).toMatch(/youtube\\?\.com\\?\\?\/live\\?\//);
    expect(block).toMatch(/Live streams aren't downloadable yet/);
  });

  it("guard never falls through to routeIntent when URL matched", () => {
    // The guard block must contain a `return` after acceptSource.
    const guardIdx = SRC.indexOf("IG-BARE-URL-IS-SOURCE");
    const routeIdx = SRC.indexOf("Tier 1 · local regex");
    const block = SRC.slice(guardIdx, routeIdx);
    // Both branches (live-stream reject + acceptSource) must return.
    const returnCount = (block.match(/\breturn;\s*$/gm) || []).length;
    expect(returnCount, "expected 2 return points in the guard").toBeGreaterThanOrEqual(2);
  });

  it("guard logs composer_brain_command_url_direct diagnostic", () => {
    expect(SRC).toMatch(/composer_brain_command_url_direct/);
  });
});
