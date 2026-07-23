/**
 * IG-COMPOSER-REGIONS regression guard.
 *
 * Locks the 5-region workbench contract on ComposerRoute + the new
 * `composer/ComposerWorkbench` subtree so drifting back to the old
 * 14-surface bag trips CI.
 *
 * Contract:
 *   1) ComposerRoute.tsx carries the IG-COMPOSER-REGIONS sentinel.
 *   2) The Workbench file exists and imports from ComposerRoute.
 *   3) All 6 region testids are present in the Workbench.
 *   4) Base Window JSON panel + ASK TESTS strip + REMOTE ACTIVE pill
 *      only render when `isDev` is truthy.
 *   5) Exactly ONE `composer-primary-cta` testid across the Workbench.
 *   6) No Kade panel/bubble/StickyKade/KadeController mount tags inside
 *      the composer subtree (Kade lives in AppShell only).
 *
 * Any test failing here means the redesign is regressing. Update the
 * lint script + this test together if the contract itself changes.
 *
 * 2026-07-22 · Sprint composer-5-region
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROUTE_SRC = readFileSync(resolve(__dirname, "ComposerRoute.tsx"), "utf-8");
const WORKBENCH_PATH = resolve(__dirname, "composer/ComposerWorkbench.tsx");
const WORKBENCH_SRC = readFileSync(WORKBENCH_PATH, "utf-8");
const WORKBENCH_CSS_PATH = resolve(__dirname, "composer/ComposerWorkbench.css");

describe("IG-COMPOSER-REGIONS · 5-region workbench contract", () => {
  it("ComposerRoute.tsx carries the IG-COMPOSER-REGIONS sentinel", () => {
    expect(ROUTE_SRC).toMatch(/IRON GATE IG-COMPOSER-REGIONS/);
  });

  it("ComposerRoute renders <ComposerWorkbench brain={brain} ... />", () => {
    expect(ROUTE_SRC).toMatch(/<ComposerWorkbench\b[^/]*brain=\{brain\}/);
  });

  it("workbench file exists at composer/ComposerWorkbench.tsx", () => {
    expect(existsSync(WORKBENCH_PATH)).toBe(true);
    expect(existsSync(WORKBENCH_CSS_PATH)).toBe(true);
  });

  it("all 6 region testids appear in the workbench", () => {
    for (const id of [
      "composer-topbar",
      "composer-activitybar",
      "composer-canvas",
      "composer-rightpanel",
      "composer-bottompanel",
      "composer-statusbar",
    ]) {
      expect(WORKBENCH_SRC).toMatch(new RegExp(`data-testid="${id}"`));
    }
  });

  it("exactly ONE composer-primary-cta testid exists in the workbench", () => {
    const matches = [...WORKBENCH_SRC.matchAll(/data-testid="composer-primary-cta"/g)];
    expect(matches.length).toBe(1);
  });

  it("Base Window JSON panel is dev-gated", () => {
    // The JSON panel testid must live inside an `{isDev && ...}` guard.
    // Coarse check: find the testid, walk back 200 chars, expect isDev.
    const idx = WORKBENCH_SRC.indexOf('data-testid="composer-dev-json-panel"');
    expect(idx).toBeGreaterThan(-1);
    const pre = WORKBENCH_SRC.slice(Math.max(0, idx - 400), idx);
    expect(pre).toMatch(/\{\s*isDev\s*&&/);
  });

  it("ASK TESTS strip is dev-gated", () => {
    const idx = WORKBENCH_SRC.indexOf('data-testid="composer-dev-asktests"');
    expect(idx).toBeGreaterThan(-1);
    const pre = WORKBENCH_SRC.slice(Math.max(0, idx - 400), idx);
    expect(pre).toMatch(/\{\s*isDev\s*&&/);
  });

  it("REMOTE ACTIVE pill is dev-gated OR removed", () => {
    // Skip references inside file-header docstrings — those are just prose.
    // Find any occurrence of the JSX-visible string "REMOTE ACTIVE" that
    // is NOT inside a leading `*` comment line.
    const lines = WORKBENCH_SRC.split("\n");
    let jsxIdx = -1;
    let seenPastHeader = false;
    let running = 0;
    for (const line of lines) {
      if (!seenPastHeader) {
        // JSX starts after `export function` first appears
        if (line.includes("export function ComposerWorkbench")) seenPastHeader = true;
        running += line.length + 1;
        continue;
      }
      const trimmed = line.trim();
      // Skip any comment line (block · line · JSX `{/* ... */}` inline).
      if (
        trimmed.startsWith("//") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("{/*") ||
        trimmed.startsWith("*/")
      ) {
        running += line.length + 1;
        continue;
      }
      if (line.includes("REMOTE ACTIVE")) {
        jsxIdx = running + line.indexOf("REMOTE ACTIVE");
        break;
      }
      running += line.length + 1;
    }
    if (jsxIdx === -1) return; // Not rendered as JSX · OK.
    const pre = WORKBENCH_SRC.slice(Math.max(0, jsxIdx - 600), jsxIdx);
    expect(pre).toMatch(/\{\s*isDev\s*&&/);
  });

  it("workbench does NOT mount any KadeSpeechBubble | StickyKade | KadeController | KadePanel", () => {
    // Kade lives at the AppShell level only. Zero mounts in workbench.
    expect(WORKBENCH_SRC).not.toMatch(/<KadeSpeechBubble\b/);
    expect(WORKBENCH_SRC).not.toMatch(/<StickyKade\b/);
    expect(WORKBENCH_SRC).not.toMatch(/<KadeController\b/);
    expect(WORKBENCH_SRC).not.toMatch(/<KadePanel\b/);
  });

  it("ComposerRoute does NOT mount any KadeSpeechBubble | StickyKade | KadeController | KadePanel", () => {
    // Comment references (e.g. in the sentinel prose) are fine; JSX open
    // tags are not.
    expect(ROUTE_SRC).not.toMatch(/<KadeSpeechBubble\b/);
    expect(ROUTE_SRC).not.toMatch(/<StickyKade\b/);
    expect(ROUTE_SRC).not.toMatch(/<KadeController\b/);
    expect(ROUTE_SRC).not.toMatch(/<KadePanel\b/);
  });

  it("dev gate reads BOTH ?dev=1 URL flag and import.meta.env.DEV", () => {
    expect(ROUTE_SRC).toMatch(/dev=1/);
    expect(ROUTE_SRC).toMatch(/import\.meta[^)]*DEV/);
  });

  it("primary CTA labels are verb-first (never 'Submit')", () => {
    // The visible label pool must include Get clips / Send. Never the
    // generic 'Submit' anti-pattern.
    expect(WORKBENCH_SRC).toMatch(/Get clips/);
    expect(WORKBENCH_SRC).not.toMatch(/["']Submit["']/);
  });

  it("Bottom panel exposes the 5 canonical tabs", () => {
    // Tab testids are rendered from a template string
    // `composer-bottom-tab-${tab.key}`. Assert the key list is present
    // in the BOTTOM_TABS constant.
    for (const tab of ["timeline", "trim", "captions", "reactions", "audio"]) {
      expect(WORKBENCH_SRC).toMatch(new RegExp(`key:\\s*"${tab}"`));
    }
    // The template that materialises the testids is present.
    expect(WORKBENCH_SRC).toMatch(/composer-bottom-tab-\$\{[^}]*key\}/);
  });
});
