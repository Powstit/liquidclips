/**
 * IG-SIDECAR-CATCH · Fence 4 · vitest audit of every high-stakes sidecar
 * call site under desktop-2/src/. LOCKED 2026-07-19.
 *
 * The regression this file locks: Composer.tsx:559 shipped
 * `void sidecar.ingestUrl(...)` with no `.catch()`. The rejection became
 * a silent 5-minute hang. Composer.tsx:565 now carries the inline .catch;
 * this test walks the whole tree and asserts NO high-stakes sidecar call
 * ever ships without one of the three approved error-handling shapes:
 *
 *   A) `await sidecar.<method>(...)` INSIDE a try/catch block
 *   B) `sidecar.<method>(...).catch((e) => ...)` inline promise chain
 *   C) `sidecarSafe.<method>(..., { onError: (e) => ... })` (Fence 1)
 *
 * Pure text analysis — no bundler, no runtime, no fs mocks. Fast enough
 * to run on every `vitest` invocation.
 *
 * Reference: feedback_never_regress_4_layer_defense.md.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, sep } from "node:path";

const REPO_SRC = resolve(__dirname, "..");
const COMPOSER = resolve(REPO_SRC, "design-os/routes/Composer.tsx");
const SIDECAR_STUB = resolve(REPO_SRC, "design-os/engine/sidecar-stub.ts");
const SIDECAR_SAFE = resolve(REPO_SRC, "lib/sidecarSafe.ts");

/** Recursively walk `dir` collecting every .ts / .tsx file, skipping
 *  node_modules, dist, and *.test.* files. */
function walkSrc(dir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    let entries: string[] = [];
    try {
      entries = readdirSync(current);
    } catch { continue; }
    for (const name of entries) {
      const full = join(current, name);
      let s;
      try {
        s = statSync(full);
      } catch { continue; }
      if (s.isDirectory()) {
        if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
        stack.push(full);
        continue;
      }
      if (!s.isFile()) continue;
      if (!/\.(ts|tsx)$/.test(name)) continue;
      if (/\.test\.(ts|tsx)$/.test(name)) continue;
      out.push(full);
    }
  }
  return out;
}

/** Strip block comments + line comments from `src`, preserving newlines so
 *  line numbers stay stable. Text inside strings is left alone (rare to
 *  matter here). */
function stripComments(src: string): string {
  const nc = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return nc.replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

/** Return true when the character range immediately preceding `start`
 *  places us inside the body of the most recent `try { ... }` block
 *  (i.e., a matching `}` has not yet been seen). */
function isInsideTry(beforeText: string): boolean {
  const tryRe = /\btry\s*\{/g;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = tryRe.exec(beforeText)) !== null) last = m;
  if (!last) return false;
  const between = beforeText.slice(last.index + last[0].length);
  const opens = (between.match(/\{/g) ?? []).length;
  const closes = (between.match(/\}/g) ?? []).length;
  return opens >= closes;
}

/** Walk forward from the call-site paren, balance braces/parens, and
 *  return true if `.catch(` appears anywhere in the expression tree
 *  before the statement terminator (semicolon at depth 0). */
function hasCatchInExpression(text: string, from: number): boolean {
  let depth = 0;
  let brace = 0;
  const n = text.length;
  for (let i = from; i < n; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "{") brace++;
    else if (c === "}") brace--;
    else if (c === ";" && depth === 0 && brace === 0) return false;
    if (c === "." && text.slice(i, i + 7) === ".catch(") return true;
  }
  return false;
}

interface Hit {
  file: string;
  line: number;
  raw: string;
}

/** Scan a single file for high-stakes sidecar call sites that lack a
 *  visible .catch AND are not inside a try block. */
function scanFile(file: string): Hit[] {
  const src = readFileSync(file, "utf-8");
  const clean = stripComments(src);
  const lines = src.split("\n");
  const hits: Hit[] = [];
  // Matches `sidecar.<method>(` and `exportApi.exportClip(`.
  const re = /\b(sidecar|exportApi)\.(ingestUrl|startRun|pickMoreClips|runStage|exportClip)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const start = m.index;
    const before = clean.slice(0, start);
    if (isInsideTry(before)) continue;
    if (hasCatchInExpression(clean, m.index + m[0].length)) continue;
    const line = clean.slice(0, start).split("\n").length;
    hits.push({ file, line, raw: (lines[line - 1] ?? "").trim() });
  }
  return hits;
}

describe("IG-SIDECAR-CATCH · Fence 4 · every high-stakes sidecar call handles rejection", () => {
  it("no high-stakes sidecar call ships without .catch or try/catch", () => {
    const files = walkSrc(REPO_SRC);
    const skip = new Set<string>([SIDECAR_STUB, SIDECAR_SAFE]);
    const offenders: Hit[] = [];
    for (const f of files) {
      if (skip.has(f)) continue;
      offenders.push(...scanFile(f));
    }
    // Human-readable failure with the fix menu so the caller knows what to do.
    const message = offenders.length === 0 ? "" : [
      "",
      "Found high-stakes sidecar calls without .catch or try/catch:",
      ...offenders.map((h) => `  ${relativize(h.file)}:${h.line} · ${h.raw}`),
      "",
      "Fix patterns:",
      "  A) await sidecar.<method>(...) inside a try/catch block",
      "  B) sidecar.<method>(...).catch((e) => { ... })",
      "  C) sidecarSafe.<method>(..., { onError: (e) => { ... } })  ← preferred for new code",
      "",
      "Reference: feedback_never_regress_4_layer_defense.md",
      "Wrapper:   desktop-2/src/lib/sidecarSafe.ts",
      "",
    ].join("\n");
    expect(offenders, message).toEqual([]);
  });

  it("Composer.tsx:559-570 preserves the 2026-07-19 .catch fix on URL detection", () => {
    // The exact bug that motivated this whole fence. If the .catch on the
    // Composer URL-detection ingestUrl path disappears, this test lights up.
    const src = readFileSync(COMPOSER, "utf-8");
    // Look for `sidecar.ingestUrl(text` followed within 400 chars by
    // `.catch(` and a `kade:speak` emit (the customer-visible surface).
    const idx = src.indexOf("sidecar.ingestUrl(text");
    expect(idx, "Composer.tsx must still contain the URL-detection ingestUrl call").toBeGreaterThan(0);
    const window = src.slice(idx, idx + 600);
    expect(window, "the URL-detection ingestUrl MUST attach .catch — this is the exact bug the fence exists to prevent").toMatch(/\.catch\(/);
    expect(window, "the .catch handler must surface via Kade so the user sees the failure").toMatch(/kade:(speak|mood)/);
  });

  it("sidecarSafe.ts exports the required high-stakes wrappers", () => {
    const src = readFileSync(SIDECAR_SAFE, "utf-8");
    for (const method of ["ingestUrl", "startRun", "pickMoreClips", "runStage", "exportClip"]) {
      expect(src, `sidecarSafe must expose ${method}`).toMatch(
        new RegExp(`\\b${method}\\s*\\(`),
      );
    }
    // onError is required (not optional) on the shared opts type.
    expect(src, "SidecarSafeOpts.onError MUST be required (not optional) — the whole point of the wrapper").toMatch(
      /onError:\s*\(e:\s*Error\)\s*=>\s*void/,
    );
  });
});

function relativize(p: string): string {
  const marker = `${sep}desktop-2${sep}src${sep}`;
  const idx = p.indexOf(marker);
  return idx < 0 ? p : p.slice(idx + 1);
}
