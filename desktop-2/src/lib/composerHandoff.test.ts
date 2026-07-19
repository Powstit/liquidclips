/**
 * composerHandoff regression guard · IG-COMPOSER-HANDOFF-MICROTASK
 *
 * Locks the Composer→Workstation loop-close contract:
 *   - write / read-and-clear / peek behave symmetrically
 *   - TTL (15min) enforced on read
 *   - malformed / missing / partial payloads degrade to null cleanly
 *   - the campaignId promise from the interface docstring is honoured
 *     by BOTH producer and consumer (P0 finding closure)
 *   - the storage key literal is exported ONCE and matches Workstation's
 *     load-bearing microtask read (P1-002 finding closure)
 *
 * Runs under vitest with jsdom.
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  COMPOSER_HANDOFF_STORAGE_KEY,
  writeComposerHandoff,
  readAndClearComposerHandoff,
  peekComposerHandoff,
} from "./composerHandoff";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WORKSTATION_SRC = readFileSync(
  resolve(__dirname, "..", "design-os", "routes", "Workstation.tsx"),
  "utf-8",
);
const COMPOSER_SRC = readFileSync(
  resolve(__dirname, "..", "design-os", "routes", "Composer.tsx"),
  "utf-8",
);

describe("composerHandoff · storage contract", () => {
  beforeEach(() => {
    try { window.localStorage.clear(); } catch { /* jsdom quota */ }
  });
  afterEach(() => {
    try { window.localStorage.clear(); } catch { /* noop */ }
  });

  it("write + readAndClear round-trip preserves slug, clipIdx, campaignId", () => {
    writeComposerHandoff({ slug: "test-slug", clipIdx: 3, campaignId: "camp-42" });
    const h = readAndClearComposerHandoff();
    expect(h).not.toBeNull();
    expect(h!.slug).toBe("test-slug");
    expect(h!.clipIdx).toBe(3);
    expect(h!.campaignId).toBe("camp-42");
  });

  it("readAndClear consumes the entry · subsequent read returns null", () => {
    writeComposerHandoff({ slug: "s", clipIdx: 0 });
    expect(readAndClearComposerHandoff()).not.toBeNull();
    expect(readAndClearComposerHandoff()).toBeNull();
    expect(peekComposerHandoff()).toBeNull();
  });

  it("peek is non-destructive · subsequent readAndClear still returns the entry", () => {
    writeComposerHandoff({ slug: "s", clipIdx: 1 });
    expect(peekComposerHandoff()).not.toBeNull();
    expect(peekComposerHandoff()).not.toBeNull();
    const h = readAndClearComposerHandoff();
    expect(h).not.toBeNull();
    expect(readAndClearComposerHandoff()).toBeNull();
  });

  it("TTL enforcement · a stale entry (older than 15 min) is cleared without returning", () => {
    const staleTs = Date.now() - (16 * 60 * 1000);
    window.localStorage.setItem(
      COMPOSER_HANDOFF_STORAGE_KEY,
      JSON.stringify({ ts: staleTs, slug: "s", clipIdx: 0 }),
    );
    expect(readAndClearComposerHandoff()).toBeNull();
    expect(window.localStorage.getItem(COMPOSER_HANDOFF_STORAGE_KEY)).toBeNull();
  });

  it("malformed payload · clears + returns null", () => {
    window.localStorage.setItem(COMPOSER_HANDOFF_STORAGE_KEY, "not-json{{{");
    expect(readAndClearComposerHandoff()).toBeNull();
    // TLDR: readAndClear MUST not throw on corrupted data. If it did,
    // Workstation's mount effect would crash → users can never reach
    // Workstation after a bad handoff.
  });

  it("null / non-object payload · clears + returns null", () => {
    window.localStorage.setItem(COMPOSER_HANDOFF_STORAGE_KEY, "null");
    expect(readAndClearComposerHandoff()).toBeNull();
    expect(window.localStorage.getItem(COMPOSER_HANDOFF_STORAGE_KEY)).toBeNull();
  });

  it("campaignId omitted · read returns handoff with campaignId undefined (no crash on consumer)", () => {
    writeComposerHandoff({ slug: "s", clipIdx: 0 });
    const h = readAndClearComposerHandoff();
    expect(h).not.toBeNull();
    expect(h!.campaignId ?? null).toBeNull();
  });
});

describe("IG-COMPOSER-HANDOFF-MICROTASK · never-regress 4-layer defense", () => {
  it("Layer 1 · IRON GATE sentinel present in Workstation.tsx above the microtask effect", () => {
    expect(WORKSTATION_SRC).toMatch(/IRON GATE IG-COMPOSER-HANDOFF-MICROTASK/);
  });

  it("Layer 3 · vitest guard exists (this file · self-referential)", () => {
    // The presence of this test in the suite is the vitest guard. If
    // someone deletes this file, the pre-commit lint (Layer 2) rejects.
    expect(true).toBe(true);
  });

  it("Workstation uses the exported storage key API · never inlines the raw literal", () => {
    // P1-002 closure · Workstation MUST import + call
    // `readAndClearComposerHandoff` rather than duplicating the storage
    // key literal or the TTL magic number. Inline literals silently
    // desync on a v1→v2 bump.
    expect(WORKSTATION_SRC).toMatch(/readAndClearComposerHandoff/);
    // Prohibit the raw literal appearing outside of an import/comment.
    // Comments that mention the key for documentation are allowed; a
    // raw call like `window.localStorage.getItem("lc.composer.handoff.v1")`
    // is not.
    const rawReadPattern = /window\.localStorage\.getItem\(\s*["']lc\.composer\.handoff\.v1["']\s*\)/;
    expect(WORKSTATION_SRC).not.toMatch(rawReadPattern);
    const rawRemovePattern = /window\.localStorage\.removeItem\(\s*["']lc\.composer\.handoff\.v1["']\s*\)/;
    expect(WORKSTATION_SRC).not.toMatch(rawRemovePattern);
  });

  it("Workstation uses microtask defer · Promise.resolve().then before the read", () => {
    // Load-bearing. Removing the defer reintroduces the clip-shell
    // detachment regression at full-clipping-journey step 12.
    const effectSlice = WORKSTATION_SRC.slice(
      WORKSTATION_SRC.indexOf("IG-COMPOSER-HANDOFF-MICROTASK"),
      WORKSTATION_SRC.indexOf("IG-COMPOSER-HANDOFF-MICROTASK") + 2000,
    );
    expect(effectSlice).toMatch(/Promise\.resolve\(\)\.then/);
    // Cleanup flag prevents a stale promise resolving after unmount.
    expect(effectSlice).toMatch(/disposed\s*=\s*true/);
  });
});

describe("Composer Ship · P0 · captures activeCampaignId at Ship time", () => {
  it("Composer imports getModeState from modeStore", () => {
    expect(COMPOSER_SRC).toMatch(/from\s+["']\.\.\/\.\.\/shell\/modeStore["']/);
    expect(COMPOSER_SRC).toMatch(/getModeState/);
  });

  it("Ship handler calls writeComposerHandoff with campaignId · producer + consumer symmetric", () => {
    // Find the Ship button click handler slice.
    const shipIdx = COMPOSER_SRC.indexOf('data-testid="composer-ship-btn"');
    expect(shipIdx).toBeGreaterThan(-1);
    const shipSlice = COMPOSER_SRC.slice(shipIdx, shipIdx + 2000);
    expect(shipSlice).toMatch(/getModeState\(\)/);
    expect(shipSlice).toMatch(/campaignId/);
    expect(shipSlice).toMatch(/writeComposerHandoff\(/);
  });
});
