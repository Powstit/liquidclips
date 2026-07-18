// @vitest-environment jsdom
/**
 * IG-COMPOSER-C regression guard · locks the command history log
 * contract so A8's history-chip render (next feature) reads a
 * stable, versioned, capped source and never invents entries.
 *
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class A row A7.
 *
 * Runs under vitest with jsdom so we can exercise localStorage.
 */

import { beforeEach, describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readCommandHistory } from "./Composer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const COMPOSER_SRC = readFileSync(resolve(__dirname, "Composer.tsx"), "utf-8");
const STORAGE_KEY = "lc.composer.history.v1";

describe("IG-COMPOSER-C · command history log · source contract", () => {
  it("Composer.tsx contains the IG-COMPOSER-C iron gate sentinel", () => {
    expect(COMPOSER_SRC).toMatch(/IRON GATE IG-COMPOSER-C/);
  });

  it("defines COMPOSER_HISTORY_STORAGE_KEY constant · versioned", () => {
    // Versioned key so a future migration can co-exist with old buffers.
    expect(COMPOSER_SRC).toMatch(
      /const\s+COMPOSER_HISTORY_STORAGE_KEY\s*=\s*"lc\.composer\.history\.v1"/,
    );
  });

  it("defines COMPOSER_HISTORY_CAP · buffer growth limit", () => {
    // Cap prevents unbounded localStorage growth on power users.
    expect(COMPOSER_SRC).toMatch(/const\s+COMPOSER_HISTORY_CAP\s*=\s*20/);
  });

  it("appendCommandHistory function is defined and wraps write in try/catch", () => {
    expect(COMPOSER_SRC).toMatch(/function\s+appendCommandHistory\(cmd:\s*string\)/);
    // The try/catch is REQUIRED · without it, localStorage-disabled
    // environments throw from submitCommand and break the whole flow.
    const start = COMPOSER_SRC.indexOf("function appendCommandHistory");
    const end = COMPOSER_SRC.indexOf("\n}", start);
    expect(end).toBeGreaterThan(start);
    const body = COMPOSER_SRC.slice(start, end);
    expect(body).toMatch(/try\s*\{[\s\S]*?catch\s*\{/);
  });

  it("submitCommand calls appendCommandHistory BEFORE routeIntent", () => {
    // Order matters · logging before routing means misses + asks are
    // also captured in history (per master plan A7 exit criteria).
    const submitStart = COMPOSER_SRC.indexOf("const submitCommand = useCallback");
    expect(submitStart).toBeGreaterThan(-1);
    const submitEnd = COMPOSER_SRC.indexOf("],\n    [sessionState", submitStart);
    const submitBody = COMPOSER_SRC.slice(
      submitStart,
      submitEnd > -1 ? submitEnd : submitStart + 2000,
    );
    const appendIdx = submitBody.indexOf("appendCommandHistory(");
    const routeIdx = submitBody.indexOf("routeIntent(");
    expect(appendIdx).toBeGreaterThan(-1);
    expect(routeIdx).toBeGreaterThan(-1);
    expect(appendIdx).toBeLessThan(routeIdx);
  });

  it("readCommandHistory is exported for A8's history-chip consumer", () => {
    // Read side needs to be exported so the future ChipRow component
    // (A8) can import from the same file. Also confirms the accessor
    // returns a defensive copy so mutations can't corrupt storage.
    expect(COMPOSER_SRC).toMatch(/export function readCommandHistory\(\):\s*string\[\]/);
  });
});

describe("IG-COMPOSER-C · command history log · runtime behaviour", () => {
  beforeEach(() => {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
  });

  it("readCommandHistory returns [] when storage is empty", () => {
    expect(readCommandHistory()).toEqual([]);
  });

  it("readCommandHistory returns a defensive copy · mutations do NOT persist", () => {
    // Seed one entry directly then mutate the returned array.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(["9:16"]));
    const first = readCommandHistory();
    expect(first).toEqual(["9:16"]);
    first.push("mutated");
    const second = readCommandHistory();
    expect(second).toEqual(["9:16"]);
  });
});
