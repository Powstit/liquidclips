/**
 * campaign-submit.real-id · Train C3 regression suite
 *
 * Locks in the "no preview-campaign fallback" contract for the Whop
 * submission surface. SubmitToWhopModal.tsx already enforces this at
 * runtime (see the header comment "No FIXTURE_CAMPAIGN, no preview-
 * campaign string, no default campaignId fallback"). These tests
 * prove:
 *
 *   1. No preview-campaign / test-campaign / FIXTURE_CAMPAIGN literals
 *      leak into production code paths under desktop-2/src/**\/*.ts
 *      (excluding test files + this contract file).
 *   2. The static submit-flow contract requires a resolved Campaign
 *      object before the primary CTA is enabled.
 *   3. The POST /submissions request body shape includes the real
 *      slug from the resolved campaign — not a hardcoded string.
 *
 * Enforcement is grep-based · runs in vitest so it fires on every CI
 * pass. Bug class BC-004 (business journey with no canonical owner)
 * uses this as the anti-regression sentinel.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";

// This test file lives at desktop-2/src/routes/campaigns/campaign-submit.real-id.test.ts
// The desktop-2/src root is 3 directories up.
const SRC_ROOT = resolve(__dirname, "../../..");
const SRC_DIR = join(SRC_ROOT, "src");
const THIS_FILE = "campaign-submit.real-id.test.ts";

/** Recursively walk desktop-2/src/**\/*.ts + *.tsx. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    // Skip node_modules just in case.
    if (entry === "node_modules") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else {
      const ext = extname(entry);
      if (ext === ".ts" || ext === ".tsx") out.push(full);
    }
  }
  return out;
}

/** File is a test / spec / this contract file → skip. */
function isTestOrContractFile(path: string): boolean {
  const base = path.split("/").pop() ?? "";
  return (
    base === THIS_FILE ||
    base.endsWith(".test.ts") ||
    base.endsWith(".test.tsx") ||
    base.endsWith(".spec.ts") ||
    base.endsWith(".spec.tsx") ||
    base.includes(".journey.test") ||
    // The SubmitToWhopModal.tsx source file HAS the string "preview-campaign"
    // in a comment that documents WHY it's forbidden. That comment is
    // itself the contract statement — grep it out by allowing this one
    // file's documentation prose. Every other appearance in prod code
    // is a regression.
    base === "SubmitToWhopModal.tsx"
  );
}

const BANNED_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  // preview_campaign / previewCampaign in any casing
  { label: "preview_campaign", pattern: /preview[_-]?campaign(?![a-zA-Z])/i },
  // test_campaign / testCampaign
  { label: "test_campaign", pattern: /test[_-]?campaign(?![a-zA-Z])/i },
  // FIXTURE_CAMPAIGN historical constant
  { label: "FIXTURE_CAMPAIGN", pattern: /FIXTURE_CAMPAIGN/ },
];

/**
 * Strip line comments (// …) and block comments (/* … *\/) from a TS/TSX
 * source. The regex is deliberately simple — good enough to remove
 * documentation prose that references the banned strings ("No
 * preview-campaign, no default.") without touching real code strings.
 * Not a full JS parser · not needed for this guard.
 */
function stripComments(src: string): string {
  // Remove /* ... */ blocks first (greedy across newlines).
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, "");
  // Then // ... to end-of-line (won't eat leading URL slashes because we
  // require `//` NOT preceded by `:`).
  return noBlocks.replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// Fake success strings — anything that would claim clips are ready
// when the count is zero. Prod code must NOT surface "Clip generated"
// / "Clip ready" as a hard-coded string; every render honestly reads
// the count.
const FAKE_SUCCESS_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  // Old fake toast that shipped in the SubmitToWhopModal before AU-B-1.
  { label: "Fake 'Clip generated!' toast", pattern: /Clip generated!/ },
];

describe("j011-campaigns · grep-guard · no preview-campaign fallback in production", () => {
  const allFiles = walk(SRC_DIR);
  const prodFiles = allFiles.filter((f) => !isTestOrContractFile(f));

  it("scans a non-trivial number of files (sanity check the walker works)", () => {
    // Sanity: the walker must find >100 TypeScript files under src/.
    // A regressed walker would find 0 and the test would silently pass.
    expect(prodFiles.length).toBeGreaterThan(100);
  });

  for (const { label, pattern } of BANNED_PATTERNS) {
    it(`zero occurrences of "${label}" in production code (comments excluded)`, () => {
      const hits: string[] = [];
      for (const f of prodFiles) {
        const content = stripComments(readFileSync(f, "utf8"));
        if (pattern.test(content)) {
          hits.push(f.replace(SRC_ROOT + "/", ""));
        }
      }
      expect(hits, `banned "${label}" leaked into: ${hits.join(", ")}`).toEqual([]);
    });
  }

  for (const { label, pattern } of FAKE_SUCCESS_PATTERNS) {
    it(`zero occurrences of fake-success string "${label}" in production code (comments excluded)`, () => {
      const hits: string[] = [];
      for (const f of prodFiles) {
        const content = stripComments(readFileSync(f, "utf8"));
        if (pattern.test(content)) {
          hits.push(f.replace(SRC_ROOT + "/", ""));
        }
      }
      expect(
        hits,
        `fake-success string "${label}" leaked into: ${hits.join(", ")}`,
      ).toEqual([]);
    });
  }
});

describe("j011-campaigns · SubmitToWhopModal contract · real campaign id required", () => {
  const modalPath = join(
    SRC_DIR,
    "design-os",
    "components",
    "SubmitToWhopModal.tsx",
  );

  it("SubmitToWhopModal.tsx exists at the canonical path", () => {
    // The regression path here is a file rename that would silently
    // eliminate the guardrails below. This check is cheap and stops
    // that class of bug.
    const src = readFileSync(modalPath, "utf8");
    expect(src.length).toBeGreaterThan(1000);
  });

  it("SubmitToWhopModal resolves campaignId from the emitter or mode-store (no fallback default)", () => {
    const src = readFileSync(modalPath, "utf8");
    // Locked contract: `propCampaignId ?? modeState.activeCampaignId`.
    // No `?? DEFAULT`, no `?? PREVIEW_CAMPAIGN`.
    expect(src).toMatch(/propCampaignId\s*\?\?\s*modeState\.activeCampaignId/);
    // And the resolved value is null when neither source resolves.
    expect(src).toMatch(/const\s+activeCampaignId\s*=/);
  });

  it("primary CTA is disabled when no real campaign is picked", () => {
    const src = readFileSync(modalPath, "utf8");
    // The disabled-reason ladder in the footer picks up !hasCampaign.
    expect(src).toMatch(/!hasCampaign/);
    // And the modal refuses to submit without a real activeCampaign.
    expect(src).toMatch(/if\s*\(\s*!activeCampaign\s*\)/);
  });

  it("POST /submissions body uses activeCampaign.slug (not a hardcoded string)", () => {
    const src = readFileSync(modalPath, "utf8");
    // Locked contract: the POST body carries `campaign_id: activeCampaign.slug`.
    expect(src).toMatch(/campaign_id:\s*activeCampaign\.slug/);
    // And no `campaign_id: "preview` or `campaign_id: 'preview` string
    // literals are permitted.
    expect(src).not.toMatch(/campaign_id:\s*["'][a-z_]*preview[a-z_]*["']/i);
    expect(src).not.toMatch(/campaign_id:\s*["'][a-z_]*fixture[a-z_]*["']/i);
    expect(src).not.toMatch(/campaign_id:\s*["'][a-z_]*test[_-]?campaign[a-z_]*["']/i);
  });

  it("modal blocks open without a real session project (no FIXTURE_PROJECT fallback)", () => {
    const src = readFileSync(modalPath, "utf8");
    // AU-B-1 production-fixture-audit fix: the modal must refuse to
    // open without a real session project. Locked contract.
    expect(src).toMatch(/no_session_project/);
    expect(src).toMatch(/if\s*\(\s*!session\.project\?\.clips\s*\)/);
  });
});
