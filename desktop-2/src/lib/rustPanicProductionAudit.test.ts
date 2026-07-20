/**
 * IG-RUST-PANIC · Layer 3 · vitest audit of production Rust OUTSIDE
 * #[tauri::command] bodies. LOCKED 2026-07-20.
 *
 * The regression this locks: bare `.unwrap()`, `.expect(...)`, `panic!`,
 * `todo!`, `unimplemented!` in setup closures, main(), helpers, or
 * HTTP/protocol handlers. A panic in any of those paths kills the shell
 * with no JS error, no lcDiag emission, no toast.
 *
 * Sister of `tauriCommandsUnwrapAudit.test.ts` (which covers command
 * bodies). This audit deliberately EXCLUDES:
 *   - #[tauri::command] fn bodies (already covered)
 *   - #[test] fn bodies
 *   - #[cfg(test)] mod { ... } blocks
 *   - Lines inside string literals or comments
 *   - Lines carrying UNWRAP-OK: / PANIC-OK: / SETUP-OK: sentinel
 *     on the same line or the line immediately above
 *   - Lines listed in scripts/rust-panic-baseline.txt (grandfathered)
 *
 * The bash lint (Layer 2 · scripts/lint-rust-panic-production.sh) runs
 * on every commit. This vitest is the belt-and-braces text-audit that
 * runs on every `vitest` invocation so a hostile commit that skips the
 * pre-commit hook still fails CI.
 *
 * Reference: feedback_never_regress_4_layer_defense.md (LOCKED 2026-07-18).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const TAURI_SRC = resolve(__dirname, "../../src-tauri/src");
const BASELINE_PATH = resolve(
  __dirname,
  "../../scripts/rust-panic-baseline.txt",
);

const SENTINELS = ["UNWRAP-OK:", "PANIC-OK:", "SETUP-OK:"] as const;

interface Violation {
  file: string;
  line: number;
  kind: string;
  text: string;
}

type Range = readonly [number, number];

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

function findFnBodySpan(
  src: string,
  headerEnd: number,
): Range | null {
  // Walk through the parameter list starting after `fn name(`
  let i = headerEnd;
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth < 0) {
        i++;
        break;
      }
    }
    i++;
  }
  while (i < src.length && src[i] !== "{") i++;
  if (i >= src.length) return null;
  return [i, findBodyEnd(src, i)];
}

function findModBodySpan(src: string, headerEnd: number): Range | null {
  const braceIdx = src.lastIndexOf("{", headerEnd);
  if (braceIdx === -1) return null;
  return [braceIdx, findBodyEnd(src, braceIdx)];
}

function loadBaseline(): Set<string> {
  const s = new Set<string>();
  if (!existsSync(BASELINE_PATH)) return s;
  const txt = readFileSync(BASELINE_PATH, "utf-8");
  for (const raw of txt.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(":", 3);
    if (parts.length < 2) continue;
    const path = parts[0].trim();
    const lno = Number(parts[1]);
    if (!Number.isFinite(lno)) continue;
    s.add(`${path}:${lno}`);
  }
  return s;
}

function isInStringOrLineComment(src: string, pos: number): boolean {
  const lineStart = src.lastIndexOf("\n", pos - 1) + 1;
  let inStr = false;
  let strChar = "";
  let i = lineStart;
  while (i < pos) {
    const c = src[i];
    const nxt = i + 1 < src.length ? src[i + 1] : "";
    if (!inStr && c === "/" && nxt === "/") return true;
    if (!inStr && (c === '"' || c === "'")) {
      inStr = true;
      strChar = c;
    } else if (inStr && c === "\\") {
      i += 2;
      continue;
    } else if (inStr && c === strChar) {
      inStr = false;
    }
    i++;
  }
  return inStr;
}

const HEADERS = {
  cmd: /#\[tauri::command\][^\n]*\n((?:\s*#\[[^\]]*\][^\n]*\n)*)\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\(/g,
  testFn: /#\[test\][^\n]*\n((?:\s*#\[[^\]]*\][^\n]*\n)*)\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\(/g,
  cfgTestMod: /#\[cfg\(test\)\]\s*\n\s*(?:pub\s+)?mod\s+\w+\s*\{/g,
} as const;

const FORBIDDEN = [
  { kind: "unwrap", pat: /\.unwrap\(\)/g },
  { kind: "expect", pat: /\.expect\(/g },
  { kind: "panic", pat: /\bpanic!\s*\(/g },
  { kind: "todo", pat: /\btodo!\s*\(?/g },
  { kind: "unimpl", pat: /\bunimplemented!\s*\(?/g },
] as const;

function findViolations(
  fileBase: string,
  src: string,
  baseline: Set<string>,
): Violation[] {
  const excl: Range[] = [];
  const collectFnSpans = (re: RegExp) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const span = findFnBodySpan(src, m.index + m[0].length);
      if (span) excl.push(span);
    }
  };
  collectFnSpans(HEADERS.cmd);
  collectFnSpans(HEADERS.testFn);

  HEADERS.cfgTestMod.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEADERS.cfgTestMod.exec(src)) !== null) {
    const span = findModBodySpan(src, m.index + m[0].length);
    if (span) excl.push(span);
  }

  const inExcluded = (pos: number): boolean =>
    excl.some(([a, b]) => a <= pos && pos < b);

  const lines = src.split("\n");
  const out: Violation[] = [];
  for (const { kind, pat } of FORBIDDEN) {
    pat.lastIndex = 0;
    let hit: RegExpExecArray | null;
    while ((hit = pat.exec(src)) !== null) {
      const pos = hit.index;
      if (inExcluded(pos)) continue;
      if (isInStringOrLineComment(src, pos)) continue;
      const lineNo = (src.slice(0, pos).match(/\n/g)?.length ?? 0) + 1;
      const text = lines[lineNo - 1] ?? "";
      const prev = lineNo >= 2 ? lines[lineNo - 2] ?? "" : "";
      if (SENTINELS.some((s) => text.includes(s) || prev.includes(s))) continue;
      if (baseline.has(`${fileBase}:${lineNo}`)) continue;
      out.push({ file: fileBase, line: lineNo, kind, text: text.trim() });
    }
  }
  return out;
}

describe("IG-RUST-PANIC · no bare panic sites in production Rust", () => {
  it("every .unwrap()/.expect/panic!/todo!/unimplemented! outside command bodies is either sentinel'd or baselined", () => {
    const baseline = loadBaseline();
    const files = readdirSync(TAURI_SRC).filter((f) => f.endsWith(".rs"));
    expect(files.length).toBeGreaterThan(0);

    const all: Violation[] = [];
    for (const name of files) {
      const src = readFileSync(join(TAURI_SRC, name), "utf-8");
      all.push(...findViolations(name, src, baseline));
    }
    if (all.length > 0) {
      const report = all
        .map((v) => `  ${v.file}:${v.line} [${v.kind}] ${v.text}`)
        .join("\n");
      throw new Error(
        `IG-RUST-PANIC · ${all.length} unguarded panic risk(s) in production Rust:\n${report}\n\n` +
          `Fix: rewrite as .map_err/.ok_or_else/.unwrap_or_else OR add\n` +
          `// UNWRAP-OK: / PANIC-OK: / SETUP-OK: sentinel above the line.\n` +
          `To grandfather, add to desktop-2/scripts/rust-panic-baseline.txt with reason.`,
      );
    }
    expect(all).toEqual([]);
  });
});
