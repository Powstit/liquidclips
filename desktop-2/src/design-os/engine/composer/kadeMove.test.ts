/**
 * IG-COMPOSER-P regression guard · moveKade contract.
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class E row E4.
 *
 * Enforces:
 *   1. The IG-COMPOSER-P sentinel stays in place.
 *   2. moveKade fires the "kade:move" bus event with { x, y, ms }.
 *   3. formatKadePos / parseKadePos round-trip cleanly.
 *   4. clampMoveDuration honours the turbo 40 ms floor.
 *   5. The bus event schema declares "kade:move".
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  moveKade,
  formatKadePos,
  parseKadePos,
  clampMoveDuration,
  TURBO_MOVE_DURATION_MS,
} from "./kadeMove";
import { bus } from "../../bridge";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = readFileSync(resolve(__dirname, "kadeMove.ts"), "utf-8");
const EVENTS = readFileSync(resolve(__dirname, "..", "..", "bridge", "events.ts"), "utf-8");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IG-COMPOSER-P · moveKade contract", () => {
  it("kadeMove.ts carries the IG-COMPOSER-P sentinel", () => {
    expect(SRC).toMatch(/IRON GATE IG-COMPOSER-P/);
  });

  it("events.ts declares the kade:move bus event schema", () => {
    expect(EVENTS).toMatch(/"kade:move":\s*\{\s*x:\s*number;\s*y:\s*number;\s*ms:\s*number\s*\}/);
  });

  it("moveKade emits the kade:move bus event with the exact payload", () => {
    const spy = vi.spyOn(bus, "emit");
    moveKade(120, 240, 320);
    expect(spy).toHaveBeenCalledWith("kade:move", { x: 120, y: 240, ms: 320 });
  });

  it("moveKade never emits a negative ms", () => {
    const spy = vi.spyOn(bus, "emit");
    moveKade(0, 0, -50);
    expect(spy).toHaveBeenCalledWith("kade:move", { x: 0, y: 0, ms: 0 });
  });

  it("formatKadePos + parseKadePos round-trip", () => {
    const raw = formatKadePos(120.4, 240.9);
    expect(raw).toBe("120,241");
    expect(parseKadePos(raw)).toEqual({ x: 120, y: 241 });
  });

  it("parseKadePos returns null for malformed input", () => {
    expect(parseKadePos(null)).toBeNull();
    expect(parseKadePos("")).toBeNull();
    expect(parseKadePos("not-a-pos")).toBeNull();
    expect(parseKadePos("120")).toBeNull();
    expect(parseKadePos("a,b")).toBeNull();
  });

  it("clampMoveDuration pins to 40 ms in turbo mode", () => {
    expect(clampMoveDuration(400, true)).toBe(TURBO_MOVE_DURATION_MS);
    expect(clampMoveDuration(20, true)).toBe(20);
  });

  it("clampMoveDuration passes through outside turbo mode", () => {
    expect(clampMoveDuration(400, false)).toBe(400);
    expect(clampMoveDuration(-100, false)).toBe(0);
  });
});
