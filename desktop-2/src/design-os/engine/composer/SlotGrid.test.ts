/**
 * IG-COMPOSER-U regression guard · Slot A/B/C system contract.
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class E row E7.
 *
 * Enforces:
 *   1. IG-COMPOSER-U sentinel stays in place.
 *   2. SLOT_LETTERS = ["A", "B", "C"] (locked · router uses these keys).
 *   3. selectSlot() emits "composer:slot-select" with the correct payload.
 *   4. getComposerSlot() returns the current selection.
 *   5. Bus event schema declares "composer:slot-select".
 *   6. Component renders 3 tiles with per-slot testids.
 *   7. CSS respects prefers-reduced-motion.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { SLOT_LETTERS, selectSlot, getComposerSlot } from "./SlotGrid";
import { bus } from "../../bridge";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = readFileSync(resolve(__dirname, "SlotGrid.tsx"), "utf-8");
const CSS = readFileSync(resolve(__dirname, "SlotGrid.css"), "utf-8");
const EVENTS = readFileSync(
  resolve(__dirname, "..", "..", "bridge", "events.ts"),
  "utf-8",
);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IG-COMPOSER-U · Slot A/B/C system contract", () => {
  it("SlotGrid.tsx carries the IG-COMPOSER-U sentinel", () => {
    expect(SRC).toMatch(/IRON GATE IG-COMPOSER-U/);
  });

  it("SLOT_LETTERS is locked at ['A','B','C']", () => {
    expect(SLOT_LETTERS).toEqual(["A", "B", "C"]);
  });

  it("events.ts declares the composer:slot-select schema", () => {
    expect(EVENTS).toMatch(/"composer:slot-select":\s*\{\s*slot:\s*"A"\s*\|\s*"B"\s*\|\s*"C"\s*\}/);
  });

  it("selectSlot fires the composer:slot-select bus event with the exact payload", () => {
    const spy = vi.spyOn(bus, "emit");
    selectSlot("B");
    expect(spy).toHaveBeenCalledWith("composer:slot-select", { slot: "B" });
    expect(getComposerSlot()).toBe("B");
  });

  it("selectSlot updates the module-scope current slot for later reads", () => {
    selectSlot("C");
    expect(getComposerSlot()).toBe("C");
    selectSlot("A");
    expect(getComposerSlot()).toBe("A");
  });

  it("component renders 3 tiles with per-slot testids", () => {
    expect(SRC).toMatch(/data-testid=\{`composer-slot-\$\{slot\}`\}/);
    expect(SRC).toMatch(/data-testid="composer-slotgrid"/);
  });

  it("CSS respects prefers-reduced-motion", () => {
    expect(CSS).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  it("component listens for composer:slot-select via useEvent (router entry)", () => {
    expect(SRC).toMatch(/useEvent\(\s*"composer:slot-select"/);
  });
});
