/**
 * IG-AUTH-KEYCHAIN · Layer 3 · vitest audit that every direct
 * invoke("secret_{get,set,delete}_jwt") in src/**\/*.{ts,tsx} lives
 * inside the approved single broker at src/lib/authStorage.ts OR
 * carries an `AUTH-BROKER-OK: <reason>` sentinel on the same line or
 * the line immediately above. LOCKED 2026-07-20.
 *
 * Companion bash guard: scripts/lint-auth-broker.sh (fast pre-commit)
 * Reference: feedback_never_regress_4_layer_defense.md
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const REPO_DESKTOP2 = resolve(__dirname, "../..");
const SRC_DIR = join(REPO_DESKTOP2, "src");
const BROKER_REL = "lib/authStorage.ts";
const SENTINEL = "AUTH-BROKER-OK:";

// Matches invoke("secret_{get,set,delete}_jwt") · same regex family
// as the ipc-contract audit but restricted to the broker-only names.
const CREDENTIAL_INVOKE =
  /(?<![a-zA-Z0-9_$])(?:invoke|invokeSafe|invokeOrNoop)\s*(?:<[^(]*>)?\s*\([\s\S]{0,200}?["'`](secret_(?:get|set|delete)_jwt)["'`]/g;

interface Violation {
  file: string;
  line: number;
  command: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (["node_modules", "dist", "build"].includes(entry)) continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("IG-AUTH-KEYCHAIN · single-broker invariant", () => {
  it("no direct secret_{get,set,delete}_jwt invoke outside authStorage.ts", () => {
    const files = walk(SRC_DIR);
    const violations: Violation[] = [];
    for (const f of files) {
      const rel = relative(REPO_DESKTOP2, f);
      const srcRel = relative(SRC_DIR, f);
      if (srcRel === BROKER_REL) continue;
      if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) continue;
      // Skip audit files that document command names literally.
      if (
        rel.includes("ipcContractAudit") ||
        rel.includes("authBrokerAudit") ||
        rel.includes("tauriCapabilitiesAudit")
      ) {
        continue;
      }
      const src = readFileSync(f, "utf-8");
      const lines = src.split("\n");
      CREDENTIAL_INVOKE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CREDENTIAL_INVOKE.exec(src)) !== null) {
        const pos = m.index;
        const lineNo = (src.slice(0, pos).match(/\n/g)?.length ?? 0) + 1;
        const text = lines[lineNo - 1] ?? "";
        const prev = lineNo >= 2 ? lines[lineNo - 2] ?? "" : "";
        if (text.includes(SENTINEL) || prev.includes(SENTINEL)) continue;
        violations.push({ file: rel, line: lineNo, command: m[1] });
      }
    }
    if (violations.length) {
      const report = violations
        .map((v) => `  ${v.file}:${v.line} invoke("${v.command}")`)
        .join("\n");
      throw new Error(
        `IG-AUTH-KEYCHAIN · ${violations.length} rogue credential invoke(s) outside authStorage.ts:\n${report}\n\n` +
          `Route through authStorage.ts (setJwt / setJwtKeychainForAuthAction / getJwt / …)\n` +
          `OR add // AUTH-BROKER-OK: <reason> on the line above the invoke.`,
      );
    }
    expect(violations).toEqual([]);
  });
});
