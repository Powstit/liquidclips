/**
 * IG-UNWRAP-CMD · Fence 3 · vitest audit of every `#[tauri::command]`
 * function body under desktop-2/src-tauri/src/. LOCKED 2026-07-20.
 *
 * The regression this file locks: a bare `.unwrap()` inside a Tauri
 * command panics the shell (or the sidecar host process). Panics inside
 * a command surface as "the app just quit" to the user — there is no JS
 * error, no lcDiag emission, no toast, no crash breadcrumb the user can
 * report.
 *
 * Every command body MUST either:
 *   A) return `Result<T, String>` and use `.map_err(|e| e.to_string())?`
 *   B) return `Result<T, String>` and use `.ok_or_else(...)?` for Options
 *   C) mark a genuinely-infallible unwrap with an `UNWRAP-OK:` sentinel
 *      on the same line OR the immediately preceding comment line
 *
 * The bash pre-commit lint (Fence 2 · lint-no-bare-unwrap-commands.sh)
 * runs on every commit. This vitest is the belt-and-braces text-audit
 * that runs on every `vitest` invocation so a hostile commit that skips
 * the pre-commit hook still fails CI.
 *
 * Reference: feedback_never_regress_4_layer_defense.md (LOCKED 2026-07-18).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const TAURI_SRC = resolve(__dirname, "../../src-tauri/src");
const SENTINEL = "UNWRAP-OK:";

interface Violation {
  file: string;
  line: number;
  fn: string;
  text: string;
}

/** Walk a Rust source string skipping over string literals, char
 *  literals, block comments and line comments. Returns the index just
 *  past the matching close-brace of the block opening at `openBraceIdx`. */
function findBodyEnd(src: string, openBraceIdx: number): number {
  let depth = 0;
  let i = openBraceIdx;
  const n = src.length;
  let inStr = false;
  let strChar = "";
  let inLineComment = false;
  let inBlockComment = false;
  while (i < n) {
    const c = src[i];
    const nxt = i + 1 < n ? src[i + 1] : "";
    if (inLineComment) {
      if (c === "\n") inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (c === "*" && nxt === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inStr) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === strChar) inStr = false;
      i++;
      continue;
    }
    if (c === "/" && nxt === "/") {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (c === "/" && nxt === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      strChar = c;
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return n;
}

/** Parse every #[tauri::command] fn body from a Rust source file and
 *  return every bare .unwrap() call site that has no UNWRAP-OK sentinel
 *  on the same line or the line immediately above. */
function findViolations(file: string, src: string): Violation[] {
  const lines = src.split("\n");
  const cmdHeader = /#\[tauri::command\][^\n]*\n((?:\s*#\[[^\]]*\][^\n]*\n)*)\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\(/g;
  const bareUnwrap = /\.unwrap\(\)/g;
  const results: Violation[] = [];

  let m: RegExpExecArray | null;
  while ((m = cmdHeader.exec(src)) !== null) {
    const fnName = m[2];
    // Advance past parameter list `(...)`
    let i = m.index + m[0].length;
    let depth = 1; // we already consumed the opening `(`
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      i++;
    }
    // Advance to opening `{`
    while (i < src.length && src[i] !== "{") i++;
    if (i >= src.length) continue;
    const bodyEnd = findBodyEnd(src, i);
    const body = src.slice(i, bodyEnd);

    let um: RegExpExecArray | null;
    const bodyStartAbs = i;
    bareUnwrap.lastIndex = 0;
    while ((um = bareUnwrap.exec(body)) !== null) {
      const absPos = bodyStartAbs + um.index;
      const lineNo = (src.slice(0, absPos).match(/\n/g)?.length ?? 0) + 1;
      const lineText = lines[lineNo - 1] ?? "";
      const prevLineText = lineNo >= 2 ? (lines[lineNo - 2] ?? "") : "";
      if (lineText.includes(SENTINEL) || prevLineText.includes(SENTINEL)) continue;
      results.push({ file, line: lineNo, fn: fnName, text: lineText.trim() });
    }
  }
  return results;
}

describe("IG-UNWRAP-CMD · no bare .unwrap() inside #[tauri::command] bodies", () => {
  it("every bare .unwrap() inside a tauri::command fn body carries an UNWRAP-OK: sentinel", () => {
    const files = readdirSync(TAURI_SRC).filter((f) => f.endsWith(".rs"));
    expect(files.length).toBeGreaterThan(0);

    const allViolations: Violation[] = [];
    for (const name of files) {
      const path = join(TAURI_SRC, name);
      const src = readFileSync(path, "utf-8");
      allViolations.push(...findViolations(path, src));
    }

    if (allViolations.length > 0) {
      const report = allViolations
        .map((v) => `  ${v.file}:${v.line} [${v.fn}] ${v.text}`)
        .join("\n");
      throw new Error(
        `IG-UNWRAP-CMD · ${allViolations.length} bare .unwrap() call(s) found inside #[tauri::command] fn bodies without an UNWRAP-OK: sentinel:\n${report}\n\n` +
          `Fix: return Result<T, String> and use .map_err(|e| e.to_string())? OR ` +
          `add // UNWRAP-OK: <reason> on the line above if the unwrap is genuinely infallible.`,
      );
    }
    expect(allViolations).toEqual([]);
  });
});
