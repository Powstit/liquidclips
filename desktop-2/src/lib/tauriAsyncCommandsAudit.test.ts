/**
 * IG-ASYNC-CMD · Fence 3 · vitest audit that every `#[tauri::command]`
 * fn is `async fn`. LOCKED 2026-07-20.
 *
 * The regression this file locks: a sync `#[tauri::command]` runs on
 * the main thread while async siblings run on Tauri's tokio runtime.
 * Mixing the two can create subtle deadlocks — a sync command's
 * blocking work stalls the same runtime the async siblings depend on
 * to make forward progress. GitButler's Tauri-app convention is
 * "async everything" so the dispatch semantics stay uniform.
 *
 * Escape: `SYNC-OK: <reason>` sentinel on a comment line in the block
 * that immediately precedes the `#[tauri::command]` attribute. Use only
 * when the command genuinely CANNOT be async (e.g. wraps a sync-only C
 * FFI and returns without blocking).
 *
 * Reference: feedback_never_regress_4_layer_defense.md (LOCKED 2026-07-18).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const TAURI_SRC = resolve(__dirname, "../../src-tauri/src");
const SENTINEL = "SYNC-OK:";

interface Violation {
  file: string;
  line: number;
  fn: string;
  text: string;
}

function scanFile(path: string, src: string): Violation[] {
  const lines = src.split("\n");
  const results: Violation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (!stripped.startsWith("#[tauri::command]")) continue;

    // Walk backwards through the block of comment lines preceding the
    // attribute to detect a SYNC-OK: sentinel.
    let allow = false;
    let j = i - 1;
    while (j >= 0) {
      const prev = lines[j].trim();
      if (prev === "" || prev.startsWith("//") || prev.startsWith("/*") || prev.startsWith("*")) {
        if (prev.includes(SENTINEL)) {
          allow = true;
          break;
        }
        if (prev === "") {
          // Allow ONE blank between the sentinel comment and the attribute.
          j--;
          if (j >= 0) {
            const before = lines[j].trim();
            if (before !== "" && !before.startsWith("//") && !before.startsWith("/*") && !before.startsWith("*")) {
              break;
            }
          }
          continue;
        }
        j--;
        continue;
      }
      break;
    }

    // Walk forward through any subsequent #[...] attributes to find the fn line.
    let k = i + 1;
    while (k < lines.length) {
      const l = lines[k].trim();
      if (l.startsWith("#[")) {
        k++;
        continue;
      }
      if (l === "") {
        k++;
        continue;
      }
      break;
    }
    if (k >= lines.length) continue;
    const fnLine = lines[k].trim();
    const fnMatch = fnLine.match(/(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/);
    if (!fnMatch) continue;
    const isAsync = /^(?:pub\s+)?async\s+fn\b/.test(fnLine);
    if (isAsync) continue;
    if (allow) continue;
    results.push({
      file: path,
      line: k + 1,
      fn: fnMatch[1],
      text: fnLine,
    });
  }

  return results;
}

describe("IG-ASYNC-CMD · every #[tauri::command] is async fn (or SYNC-OK: carved)", () => {
  it("no sync tauri::command exists without a SYNC-OK: sentinel above it", () => {
    const files = readdirSync(TAURI_SRC).filter((f) => f.endsWith(".rs"));
    expect(files.length).toBeGreaterThan(0);

    const allViolations: Violation[] = [];
    for (const name of files) {
      const path = join(TAURI_SRC, name);
      const src = readFileSync(path, "utf-8");
      allViolations.push(...scanFile(path, src));
    }

    if (allViolations.length > 0) {
      const report = allViolations.map((v) => `  ${v.file}:${v.line} [${v.fn}] ${v.text}`).join("\n");
      throw new Error(
        `IG-ASYNC-CMD · ${allViolations.length} sync #[tauri::command] found without a SYNC-OK: sentinel:\n${report}\n\n` +
          `Fix (preferred): change 'fn X' to 'async fn X'. The return type stays the same. ` +
          `Fix (escape):    add // SYNC-OK: <reason> on the line above the #[tauri::command] attribute.`,
      );
    }
    expect(allViolations).toEqual([]);
  });
});
