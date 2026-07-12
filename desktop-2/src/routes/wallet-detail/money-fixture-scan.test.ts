/**
 * money-fixture-scan.test.ts · Train C2 · RC1 sprint.
 *
 * BC-002 class-elimination guard for the C2-OWNED money surfaces
 * (wallet-detail · cancellation-intercept · affiliate). Enumerates
 * every `$NN.NN` literal in production JSX + narrative strings, then
 * whitelists ONLY:
 *
 *   * Brand-locked pricing constants (per §13a):
 *     `$99.99` subscription price · `$50` per-referral share ·
 *     `$1` Whop entry · `$1,500` paid_streak lifetime threshold
 *     display · `$29.99` legacy Solo price (mentioned in comments
 *     only · not actively rendered on the OWNED surfaces)
 *   * Comments explaining removed fixtures (e.g. "// prior version
 *     rendered $742.50/mo").
 *
 * Any user-specific dollar/cents value (a fixture) fails the test —
 * it must come from a real hook (`useMoneyRollup` · `useWalletLedger`
 * · `useCrewPipeline`) or an honest empty-state placeholder.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Directories C2 owns for the money-surface fixture scan. */
const OWNED_DIRS = [
  resolve(__dirname, '.'),
  resolve(__dirname, '../cancellation-intercept'),
  resolve(__dirname, '../affiliate'),
];

const DOLLAR_LITERAL_RE = /\$\d+(?:[.,]\d+)?/g;

/** §13a brand-locked pricing constants + display thresholds. Any
 *  literal outside this set must have documentation explaining why. */
const BRAND_ALLOW = new Set<string>([
  '$99.99',    // subscription base · §13a
  '$50',       // per-referral share cents-rendered
  '$1',        // Whop entry plan / one-time
  '$1,500',    // paid_streak lifetime threshold ($1,500 → 150_000 cents)
  '$0',        // appears only in "not a fabricated $0" comments
  '$29.99',    // legacy Solo price · comments only, never rendered
  '$500',      // legacy founder lifetime plan mention
]);

/** Historical fixture strings tolerated only as comment references
 *  documenting removed fake values (so future readers know what was
 *  removed and why). If any of these appear OUTSIDE a comment line,
 *  the test fails. */
const COMMENT_ONLY_TOLERATE = new Set<string>([
  '$742.50',   // pre-R2 fake MRR
  '$247.50',   // pre-R2 fake balance
  '$0.00',     // "fabricated $0.00" callout comment
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (
      st.isFile() &&
      (full.endsWith('.tsx') || full.endsWith('.ts')) &&
      !full.endsWith('.test.tsx') &&
      !full.endsWith('.test.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

interface LiteralHit {
  file: string;
  line: number;
  literal: string;
  context: string;
  inComment: boolean;
}

function scanFile(path: string): LiteralHit[] {
  const src = readFileSync(path, 'utf-8');
  const lines = src.split('\n');
  const hits: LiteralHit[] = [];
  // Track state for /* ... */ multi-line blocks so a `$742.50/mo`
  // sitting on the third continuation line of a JSDoc / block-comment
  // is correctly recognised as in-comment.
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const startedBlock = /\/\*/.test(line) && !/\*\//.test(line);
    const endsBlock = /\*\//.test(line);
    const isBlockCommentLine =
      inBlockComment || startedBlock || endsBlock || trimmed.startsWith('*');
    const isLineComment = trimmed.startsWith('//');
    // Inline trailing comment · everything after `//` on the line is
    // a comment. Also JSX comment blocks `{/* ... */}`.
    const inlineCommentIdx = line.indexOf('//');
    const jsxComment = /\{\s*\/\*/.test(line);

    const matches = line.matchAll(DOLLAR_LITERAL_RE);
    for (const m of matches) {
      const literal = m[0];
      const idx = m.index ?? 0;
      const afterLineComment =
        inlineCommentIdx >= 0 && idx > inlineCommentIdx;
      const inComment =
        isBlockCommentLine ||
        isLineComment ||
        afterLineComment ||
        jsxComment;
      hits.push({
        file: path,
        line: i + 1,
        literal,
        context: line.trim(),
        inComment,
      });
    }

    if (startedBlock) inBlockComment = true;
    if (endsBlock) inBlockComment = false;
  }
  return hits;
}

describe('BC-002 · fixture-scan · owned money surfaces', () => {
  const files = OWNED_DIRS.flatMap(walk);

  it('enumerates every source file under the owned surfaces', () => {
    // Sanity guard so the scan doesn't silently pass on zero files.
    expect(files.length).toBeGreaterThan(0);
  });

  it('has ZERO user-specific dollar/cents fixtures in production code', () => {
    const hits = files.flatMap(scanFile);
    const violations = hits.filter((h) => {
      if (BRAND_ALLOW.has(h.literal)) return false;
      if (COMMENT_ONLY_TOLERATE.has(h.literal) && h.inComment) return false;
      return true;
    });
    if (violations.length > 0) {
      const grouped = violations
        .map(
          (v) =>
            `  ${v.file.replace(/^.*\/desktop-2\//, 'desktop-2/')}:${v.line} · ${v.literal} · "${v.context.slice(0, 100)}"`,
        )
        .join('\n');
      throw new Error(
        `BC-002 fixture drift · ${violations.length} unexpected dollar literal(s):\n${grouped}`,
      );
    }
  });

  it('tolerated fixture references never appear in a rendered JSX literal', () => {
    // COMMENT_ONLY_TOLERATE values (e.g. "$742.50") were the old fake
    // MRR. If any of them show up in a non-comment line, that's a
    // regression — the fixture is back.
    const hits = files.flatMap(scanFile);
    const regressions = hits.filter(
      (h) => COMMENT_ONLY_TOLERATE.has(h.literal) && !h.inComment,
    );
    expect(regressions).toEqual([]);
  });

  it('every owned file that renders money reads from a canonical hook', () => {
    // Cross-check: any file that renders `${…mrr…}` (case-insensitive)
    // outside of a comment must import a money hook. This is a light
    // heuristic — the real proof is money-rollup.test.ts contract.
    const rendersMoney = files.filter((f) => {
      const src = readFileSync(f, 'utf-8');
      // JSX renders that include the word MRR / balance / earnings
      // outside of comments.
      const hasMoneyRender =
        /className="[^"]*ci-money[^"]*"|data-money-rollup-/.test(src);
      return hasMoneyRender;
    });
    for (const f of rendersMoney) {
      const src = readFileSync(f, 'utf-8');
      const importsHook =
        src.includes('useMoneyRollup') ||
        src.includes('useWalletLedger') ||
        src.includes('useCrewPipeline');
      expect(importsHook).toBe(true);
    }
  });
});
