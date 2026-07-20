/**
 * IG-CAPS-AUDIT · Fence 3 · vitest asserts every imported
 * @tauri-apps/plugin-* has at least one matching permission grant in
 * desktop-2/src-tauri/capabilities/*.json. LOCKED 2026-07-20.
 *
 * The regression this file locks: Tauri v2 rejects any plugin call
 * whose permission is not granted in a capability file, with the
 * opaque runtime error `the operation was rejected by the permission
 * system`. Users see it as a broken flow ("update button does nothing")
 * — never as a config bug. The bash audit is advisory (never blocks
 * commits, because the fix requires human judgement on the security
 * surface). This vitest is the HARD FAIL that runs on every `vitest`
 * so a new plugin import without a matching grant fails the tree BEFORE
 * the app rejects the call at runtime.
 *
 * Reference: feedback_never_regress_4_layer_defense.md (LOCKED 2026-07-18).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const DESKTOP_SRC = resolve(__dirname, "..");
const CAPS_DIR = resolve(__dirname, "../../src-tauri/capabilities");

/** Walk `dir` for every .ts/.tsx file. Skip node_modules, dist, dot dirs, tests. */
function walkSrc(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    let entries: string[] = [];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(current, name);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
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

function collectImportedPlugins(files: string[]): Set<string> {
  const re = /@tauri-apps\/plugin-([a-z-]+)/g;
  const found = new Set<string>();
  for (const f of files) {
    let text = "";
    try {
      text = readFileSync(f, "utf-8");
    } catch {
      continue;
    }
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      found.add(m[1]);
    }
  }
  return found;
}

function collectGrantedPluginPrefixes(dir: string): Set<string> {
  const prefixes = new Set<string>();
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return prefixes;
  }
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    let raw = "";
    try {
      raw = readFileSync(path, "utf-8");
    } catch {
      continue;
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    if (typeof data !== "object" || data === null) continue;
    const perms = (data as { permissions?: unknown }).permissions;
    if (!Array.isArray(perms)) continue;
    for (const perm of perms) {
      let key: string | null = null;
      if (typeof perm === "string") key = perm;
      else if (
        typeof perm === "object" &&
        perm !== null &&
        typeof (perm as { identifier?: unknown }).identifier === "string"
      ) {
        key = (perm as { identifier: string }).identifier;
      }
      if (!key) continue;
      const colon = key.indexOf(":");
      if (colon > 0) prefixes.add(key.slice(0, colon));
    }
  }
  return prefixes;
}

describe("IG-CAPS-AUDIT · every imported @tauri-apps/plugin-* has a matching permission grant", () => {
  it("no plugin import is missing a capability grant (runtime would reject the call)", () => {
    const files = walkSrc(DESKTOP_SRC);
    expect(files.length).toBeGreaterThan(0);

    const imported = collectImportedPlugins(files);
    const granted = collectGrantedPluginPrefixes(CAPS_DIR);

    const missing: string[] = [];
    for (const plugin of imported) {
      if (!granted.has(plugin)) missing.push(plugin);
    }

    if (missing.length > 0) {
      throw new Error(
        `IG-CAPS-AUDIT · ${missing.length} imported plugin(s) missing a permission grant in ${CAPS_DIR}:\n` +
          missing.map((p) => `  - @tauri-apps/plugin-${p}  (add "${p}:default" to capabilities/default.json)`).join("\n") +
          `\n\nWithout a grant, Tauri v2 rejects the invoke at runtime with "the operation was rejected by the permission system".` +
          `\nReference: feedback_never_regress_4_layer_defense.md · IG-CAPS-AUDIT 2026-07-20.`,
      );
    }
    expect(missing).toEqual([]);
  });
});
