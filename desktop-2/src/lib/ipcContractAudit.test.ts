/**
 * IG-IPC-CONTRACT · Layer 3 · vitest audit of every Tauri command
 * name across the Rust source ↔ generate_handler! roster ↔ frontend
 * invoke() call sites ↔ scripts/ipc-manifest.json. LOCKED 2026-07-20.
 *
 * Locks four invariants:
 *   1. Every `#[tauri::command]` fn in src-tauri/src/*.rs appears in
 *      the generate_handler! macro call in lib.rs.
 *      Missing here = command is dead code · frontend calls will 404.
 *   2. Every entry in generate_handler! has a matching #[tauri::command]
 *      fn in the source. Missing here = compile error waiting to happen.
 *   3. Every command name in scripts/ipc-manifest.json is present in
 *      generate_handler!, and every generate_handler! entry appears in
 *      the manifest. Manifest drift = rename without a caller update.
 *   4. Every `invoke("name", ...)` string literal under src/ resolves
 *      to a command in the manifest. An unknown invoke = silent runtime
 *      404 for the user.
 *   5. Every command in the manifest is either invoked from src/ or
 *      explicitly marked `internal: true`. Prevents dead command creep.
 *
 * Companion enforcement:
 *   Layer 1 · Contract file scripts/ipc-manifest.json (this test's SoT)
 *   Layer 2 · Bash lint scripts/lint-ipc-contract.sh (fast pre-commit)
 *   Layer 3 · THIS vitest (belt-and-braces on every `vitest`)
 *   Layer 4 · Runtime — sidecarSafe wrapper surfaces IPC errors via lcDiag
 *
 * Reference: feedback_never_regress_4_layer_defense.md (LOCKED 2026-07-18).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const REPO_DESKTOP2 = resolve(__dirname, "../..");
const TAURI_SRC = join(REPO_DESKTOP2, "src-tauri/src");
const FRONTEND_SRC = join(REPO_DESKTOP2, "src");
const MANIFEST_PATH = join(REPO_DESKTOP2, "scripts/ipc-manifest.json");
const LIB_RS = join(TAURI_SRC, "lib.rs");

interface ManifestEntry {
  owner: string;
  args?: Record<string, string>;
  returns?: string;
  internal?: boolean;
  notes?: string;
}
interface Manifest {
  commands: Record<string, ManifestEntry>;
}

const CMD_ATTR = /#\[tauri::command\][^\n]*\n((?:\s*#\[[^\]]*\][^\n]*\n)*)\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\(/g;
// Match only the CANONICAL Tauri invoke shapes:
//   invoke("name", ...)
//   invokeSafe("name", ...)
//   invokeOrNoop("name", ...)
//   mod.invoke("name", ...) / anyThing.invoke(...)
// Explicitly does NOT match `tryInvoke` / `sidecarInvoke` / other
// wrappers that hit the Python sidecar via the sidecar_call bridge.
// The (?<![a-zA-Z0-9_$]) negative lookbehind bans word-continuation
// prefixes; `.` is allowed because we want to catch `mod.invoke(...)`.
const INVOKE_LITERAL = /(?<![a-zA-Z0-9_$])(?:invoke|invokeSafe|invokeOrNoop)\s*(?:<[^(]*>)?\s*\([\s\S]{0,300}?["'`]([a-z_][a-z0-9_]*)["'`]/g;

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
}

function collectRustCommandFns(): Map<string, string> {
  const out = new Map<string, string>();
  const files = readdirSync(TAURI_SRC).filter((f) => f.endsWith(".rs"));
  for (const name of files) {
    const src = readFileSync(join(TAURI_SRC, name), "utf-8");
    CMD_ATTR.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CMD_ATTR.exec(src)) !== null) {
      out.set(m[2], name);
    }
  }
  return out;
}

function collectRegisteredHandlers(): Set<string> {
  const src = readFileSync(LIB_RS, "utf-8");
  const start = src.indexOf("tauri::generate_handler!");
  if (start === -1) return new Set();
  const openBracket = src.indexOf("[", start);
  const closeBracket = src.indexOf("]", openBracket);
  if (openBracket === -1 || closeBracket === -1) return new Set();
  const body = src.slice(openBracket + 1, closeBracket);
  const names = new Set<string>();
  for (const raw of body.split(",")) {
    const t = raw.trim();
    if (!t || t.startsWith("//")) continue;
    // Strip module qualifier: `browse::open_browse_panel` → `open_browse_panel`
    const bare = t.includes("::") ? t.split("::").pop()! : t;
    names.add(bare);
  }
  return names;
}

function walkFrontendFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === "build") continue;
      walkFrontendFiles(full, out);
    } else if (/\.(ts|tsx|js|jsx|mts|cts)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

interface InvokeSite {
  file: string;
  line: number;
  command: string;
}

function collectInvokeSites(): InvokeSite[] {
  const files = walkFrontendFiles(FRONTEND_SRC);
  const results: InvokeSite[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf-8");
    // Skip audit tests themselves — they reference every command name literally.
    if (f.includes("ipcContractAudit.test") || f.includes("tauriCapabilitiesAudit.test")) continue;
    INVOKE_LITERAL.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INVOKE_LITERAL.exec(src)) !== null) {
      const pos = m.index;
      const line = (src.slice(0, pos).match(/\n/g)?.length ?? 0) + 1;
      results.push({ file: relative(REPO_DESKTOP2, f), line, command: m[1] });
    }
  }
  return results;
}

describe("IG-IPC-CONTRACT · Rust ↔ handler ↔ manifest ↔ invoke() parity", () => {
  const manifest = loadManifest();
  const rustFns = collectRustCommandFns();
  const registered = collectRegisteredHandlers();
  const invokeSites = collectInvokeSites();

  const manifestNames = new Set(Object.keys(manifest.commands));

  it("every #[tauri::command] fn is registered in generate_handler!", () => {
    const missing: string[] = [];
    for (const [name, file] of rustFns) {
      if (!registered.has(name)) missing.push(`${file} :: ${name}`);
    }
    if (missing.length) {
      throw new Error(
        `IG-IPC-CONTRACT · ${missing.length} command(s) defined but not registered:\n  ${missing.join(
          "\n  ",
        )}\n\nAdd them to tauri::generate_handler![...] in lib.rs OR delete the #[tauri::command] attribute.`,
      );
    }
    expect(missing).toEqual([]);
  });

  it("every entry in generate_handler! has a matching #[tauri::command] fn", () => {
    const orphans: string[] = [];
    for (const name of registered) {
      if (!rustFns.has(name)) orphans.push(name);
    }
    if (orphans.length) {
      throw new Error(
        `IG-IPC-CONTRACT · ${orphans.length} registered name(s) with no source fn:\n  ${orphans.join(
          "\n  ",
        )}\n\nRemove from generate_handler! OR add the missing #[tauri::command] fn.`,
      );
    }
    expect(orphans).toEqual([]);
  });

  it("manifest and generate_handler! roster are identical", () => {
    const missing = [...registered].filter((n) => !manifestNames.has(n));
    const extra = [...manifestNames].filter((n) => !registered.has(n));
    if (missing.length || extra.length) {
      throw new Error(
        `IG-IPC-CONTRACT · manifest ↔ generate_handler drift:\n` +
          (missing.length
            ? `  missing from manifest: ${missing.join(", ")}\n`
            : "") +
          (extra.length
            ? `  registered nowhere:    ${extra.join(", ")}\n`
            : "") +
          `Update scripts/ipc-manifest.json to match generate_handler!.`,
      );
    }
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it("every invoke() literal resolves to a registered command", () => {
    const orphans = invokeSites.filter((s) => !registered.has(s.command));
    if (orphans.length) {
      const report = orphans
        .map((s) => `  ${s.file}:${s.line} invoke("${s.command}")`)
        .join("\n");
      throw new Error(
        `IG-IPC-CONTRACT · ${orphans.length} invoke() call(s) target unknown command(s):\n${report}\n\n` +
          `Either rename the string literal OR add the command to generate_handler! + manifest.`,
      );
    }
    expect(orphans).toEqual([]);
  });

  it("every manifest command is either invoked from src/ or marked internal", () => {
    const invokedNames = new Set(invokeSites.map((s) => s.command));
    const dead: string[] = [];
    for (const [name, entry] of Object.entries(manifest.commands)) {
      if (invokedNames.has(name)) continue;
      if (entry.internal) continue;
      dead.push(name);
    }
    if (dead.length) {
      throw new Error(
        `IG-IPC-CONTRACT · ${dead.length} manifest command(s) have no invoke() caller and are not marked internal:\n  ${dead.join(
          "\n  ",
        )}\n\nEither call the command from src/ OR add "internal": true to the manifest entry with a note explaining why.`,
      );
    }
    expect(dead).toEqual([]);
  });
});
