/**
 * Composer Class C client contracts · tests for C1 · C6 · C7.
 *
 * Enforces the IG-COMPOSER-X · Y · Z sentinels are in place and that
 * each client wrapper (kadeIntentClient · campaignPreflight ·
 * whopSubmit) uses authedFetch and never speaks to a foreign host.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const INTENT = readFileSync(resolve(__dirname, "kadeIntentClient.ts"), "utf-8");
const PREFLIGHT = readFileSync(resolve(__dirname, "campaignPreflight.ts"), "utf-8");
const SUBMIT = readFileSync(resolve(__dirname, "whopSubmit.ts"), "utf-8");

describe("IG-COMPOSER-X · Kade intent client contract (C1)", () => {
  it("carries the IG-COMPOSER-X sentinel", () => {
    expect(INTENT).toMatch(/IRON GATE IG-COMPOSER-X/);
  });
  it("uses authedFetch (license JWT transport)", () => {
    expect(INTENT).toMatch(/import\s*\{\s*authedFetch\s*\}\s*from\s*"\.\/authedFetch"/);
  });
  it("hits the /proxy/llm/intent backend path", () => {
    expect(INTENT).toMatch(/\/proxy\/llm\/intent/);
  });
  it("exports the requestKadeIntent function", () => {
    expect(INTENT).toMatch(/export\s+async\s+function\s+requestKadeIntent/);
  });
  it("declares the { action, capability, resolved_params } shape", () => {
    expect(INTENT).toMatch(/action:\s*IntentAction/);
    expect(INTENT).toMatch(/capability:\s*string\s*\|\s*null/);
    expect(INTENT).toMatch(/resolved_params:\s*Record<string,\s*string>/);
  });
});

describe("IG-COMPOSER-Y · Campaign preflight client contract (C6)", () => {
  it("carries the IG-COMPOSER-Y sentinel", () => {
    expect(PREFLIGHT).toMatch(/IRON GATE IG-COMPOSER-Y/);
  });
  it("uses authedFetch", () => {
    expect(PREFLIGHT).toMatch(/import\s*\{\s*authedFetch\s*\}\s*from\s*"\.\/authedFetch"/);
  });
  it("hits the /campaigns/{id}/preflight backend path", () => {
    expect(PREFLIGHT).toMatch(/\/campaigns\/\$\{encodeURIComponent\(campaignId\)\}\/preflight/);
  });
  it("exports runCampaignPreflight", () => {
    expect(PREFLIGHT).toMatch(/export\s+async\s+function\s+runCampaignPreflight/);
  });
  it("declares failures + warnings + ok fields", () => {
    expect(PREFLIGHT).toMatch(/ok:\s*boolean/);
    expect(PREFLIGHT).toMatch(/failures:\s*PreflightRuleFailure\[\]/);
    expect(PREFLIGHT).toMatch(/warnings:\s*PreflightWarning\[\]/);
  });
});

describe("IG-COMPOSER-Z · Whop submit client contract (C7)", () => {
  it("carries the IG-COMPOSER-Z sentinel", () => {
    expect(SUBMIT).toMatch(/IRON GATE IG-COMPOSER-Z/);
  });
  it("uses authedFetch", () => {
    expect(SUBMIT).toMatch(/import\s*\{\s*authedFetch\s*\}\s*from\s*"\.\/authedFetch"/);
  });
  it("hits the /whop/submit backend path", () => {
    expect(SUBMIT).toMatch(/\/whop\/submit/);
  });
  it("exports submitClipToBounty", () => {
    expect(SUBMIT).toMatch(/export\s+async\s+function\s+submitClipToBounty/);
  });
  it("returns submission_url so Kade can open the persistent-cookie webview", () => {
    expect(SUBMIT).toMatch(/submission_url:\s*string/);
  });
});
