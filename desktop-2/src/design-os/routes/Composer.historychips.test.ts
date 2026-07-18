/**
 * IG-COMPOSER-T regression guard · A8 command history chip row.
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class A row A8.
 *
 * Enforces:
 *   1. IG-COMPOSER-T sentinel is present.
 *   2. Composer renders the history chip row inside the .lc-composer root.
 *   3. Chip limit is locked at 8 (A8_HISTORY_CHIP_LIMIT).
 *   4. Chips are rendered as buttons carrying testid composer-history-chip-*.
 *   5. Chip click re-fires submitCommand(chip).
 *   6. Chip row is hidden when history is empty (respects IG-COMPOSER-F idle).
 *   7. Storage key stays lc.composer.history.v1 (versioned per IG-COMPOSER-C).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const COMPOSER = readFileSync(resolve(__dirname, "Composer.tsx"), "utf-8");

describe("IG-COMPOSER-T · Command history chip row (A8)", () => {
  it("Composer.tsx carries the IG-COMPOSER-T sentinel", () => {
    expect(COMPOSER).toMatch(/IRON GATE IG-COMPOSER-T/);
  });

  it("A8_HISTORY_CHIP_LIMIT is locked at 8", () => {
    expect(COMPOSER).toMatch(/const\s+A8_HISTORY_CHIP_LIMIT\s*=\s*8/);
  });

  it("history chip row is rendered inside the JSX tree", () => {
    expect(COMPOSER).toMatch(/data-testid="composer-history-chips"/);
  });

  it("chips are rendered as buttons with per-chip testids", () => {
    expect(COMPOSER).toMatch(/data-testid=\{`composer-history-chip-\$\{idx\}`\}/);
  });

  it("chip click re-fires submitCommand(chip)", () => {
    expect(COMPOSER).toMatch(/onClick=\{\(\)\s*=>\s*submitCommand\(chip\)\}/);
  });

  it("chip row is hidden when historyChips is empty (idle canvas rule)", () => {
    expect(COMPOSER).toMatch(/historyChips\.length\s*>\s*0/);
  });

  it("history read is memoised on a historyRevision counter", () => {
    expect(COMPOSER).toMatch(/const\s+historyChips\s*=\s*useMemo/);
    expect(COMPOSER).toMatch(/setHistoryRevision\(\(n\)\s*=>\s*n\s*\+\s*1\)/);
  });

  it("storage key stays lc.composer.history.v1 (IG-COMPOSER-C compat)", () => {
    expect(COMPOSER).toMatch(/COMPOSER_HISTORY_STORAGE_KEY\s*=\s*"lc\.composer\.history\.v1"/);
  });

  it("chips read historyChips through readCommandHistory (single source)", () => {
    expect(COMPOSER).toMatch(/readCommandHistory\(\)\.slice\(0,\s*A8_HISTORY_CHIP_LIMIT\)/);
  });
});
