/**
 * IG-COMPOSER-K regression guard · HQ library client contract.
 *
 * Enforces that:
 *   1. The IG-COMPOSER-K sentinel stays in place.
 *   2. The client ONLY talks to junior-backend (never hq.liquidclips.com).
 *   3. HQ_READ_SECRET never appears in the desktop bundle.
 *   4. Handoff routes go through /library/handoff/ + /podcast/handoff/.
 *   5. authedFetch (license JWT) is the transport.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLIENT_SRC = readFileSync(resolve(__dirname, "hqLibrary.ts"), "utf-8");

describe("IG-COMPOSER-K · HQ library client contract", () => {
  it("contains the IG-COMPOSER-K sentinel", () => {
    expect(CLIENT_SRC).toMatch(/IRON GATE IG-COMPOSER-K/);
  });

  it("uses authedFetch (license JWT transport)", () => {
    expect(CLIENT_SRC).toMatch(/import\s*\{\s*authedFetch\s*\}\s*from\s*["']\.\/authedFetch["']/);
  });

  it("NEVER references hq.liquidclips.com or tally-production directly", () => {
    expect(CLIENT_SRC).not.toMatch(/hq\.liquidclips\.com/);
    expect(CLIENT_SRC).not.toMatch(/tally-production/);
  });

  it("NEVER embeds HQ_READ_SECRET or x-hq-secret", () => {
    expect(CLIENT_SRC).not.toMatch(/HQ_READ_SECRET/);
    expect(CLIENT_SRC).not.toMatch(/x-hq-secret/i);
  });

  it("routes through junior-backend /library/* proxy", () => {
    expect(CLIENT_SRC).toMatch(/\/library\/search/);
    expect(CLIENT_SRC).toMatch(/\/library\/channel\//);
    expect(CLIENT_SRC).toMatch(/\/library\/handoff\//);
  });

  it("routes podcasts through junior-backend /podcast/handoff/", () => {
    expect(CLIENT_SRC).toMatch(/\/podcast\/handoff\//);
  });

  it("exports the 4 public functions Composer depends on", () => {
    expect(CLIENT_SRC).toMatch(/export function searchLibrary\(/);
    expect(CLIENT_SRC).toMatch(/export function getLibraryChannel\(/);
    expect(CLIENT_SRC).toMatch(/export function getLibraryHandoff\(/);
    expect(CLIENT_SRC).toMatch(/export function getPodcastHandoff\(/);
  });

  it("exports ytThumbnailUrl helper (zero-cost thumbnail rendering)", () => {
    expect(CLIENT_SRC).toMatch(/export function ytThumbnailUrl\(/);
    expect(CLIENT_SRC).toMatch(/i\.ytimg\.com\/vi\//);
  });
});
