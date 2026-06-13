// ───── IRON GATE IG-014 (v0.7.58) — see desktop/docs/IRON_GATES.md ─────
//
// AUTH-KEYCHAIN INVARIANT — static-analysis test fixture.
//
// Static assertions over the source tree. Runs as:
//   node --test tests/no-passive-keychain.test.mjs
//
// Pairs with `scripts/assert-no-passive-keychain.sh` (pre-commit gate) and
// `docs/auth-keychain-invariant.md` (canonical statement). Both must agree
// on which files are "approved auth-only" — if you grant a new approval,
// edit both lists in the same commit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DESKTOP_ROOT = resolve(__dirname, "..");

// Approved auth-only files. Mirrors APPROVED in
// scripts/assert-no-passive-keychain.sh.
const APPROVED_AUTH_FILES = new Set([
  "src/lib/authStorage.ts",
  "src/lib/activation.ts",
  "src/lib/sidecar.ts",
  "python-sidecar/secrets_store.py",
  "python-sidecar/sidecar.py",
  "python-sidecar/whop_client.py",
  "scripts/assert-no-passive-keychain.sh",
  "tests/no-passive-keychain.test.mjs",
  "docs/auth-keychain-invariant.md",
  "docs/IRON_GATES.md",
  "CLAUDE.md",
  "src/components/NotificationBell.tsx",
]);

const SOURCE_GLOBS = [
  { root: join(DESKTOP_ROOT, "src"), exts: [".ts", ".tsx"] },
  { root: join(DESKTOP_ROOT, "python-sidecar"), exts: [".py"], shallow: true },
];

const SKIP_DIRS = new Set([
  "node_modules", "target", "dist", "bin", "models", "__pycache__", "public",
]);

/** Walk a tree and yield files matching the given extension list. Skips the
 *  SKIP_DIRS at any depth so build artifacts + vendored deps don't pollute. */
function* walk(root, exts, shallow = false) {
  const entries = readdirSync(root, { withFileTypes: true });
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(root, e.name);
    if (e.isDirectory()) {
      if (shallow) continue;
      yield* walk(full, exts);
    } else if (e.isFile()) {
      if (exts.some((x) => e.name.endsWith(x))) yield full;
    }
  }
}

function listSourceFiles() {
  const out = [];
  for (const { root, exts, shallow } of SOURCE_GLOBS) {
    try {
      statSync(root);
    } catch {
      continue;
    }
    for (const f of walk(root, exts, shallow)) out.push(f);
  }
  return out;
}

/** Strip the "//", "*", "#" comment lines so substring scans don't trip on
 *  prose that names the disallowed pattern in JSDoc / docstrings. */
function nonCommentLines(content) {
  return content
    .split("\n")
    .map((line, i) => ({ line, index: i + 1 }))
    .filter(({ line }) => {
      const t = line.replace(/^\s+/, "");
      if (t.startsWith("//")) return false;
      if (t.startsWith("*")) return false;
      if (t.startsWith("/*")) return false;
      if (t.startsWith("#")) return false;
      return true;
    });
}

function relativeFromDesktop(absPath) {
  return relative(DESKTOP_ROOT, absPath);
}

/** The exact patterns the pre-commit script enforces. Keep in lockstep. */
const PATTERNS = [
  { name: "TS/JS direct Keychain read", regex: /licenseJwtRead\(/ },
  { name: "TS/JS allowKeychainRead:true caller", regex: /allowKeychainRead:\s*true/ },
  { name: "TS/JS direct secretGet caller", regex: /sidecar\.secretGet/ },
  { name: "Python method_secret_get caller", regex: /method_secret_get/ },
  { name: "Python direct keyring read of LICENSE_JWT", regex: /keyring\.get_password.*LICENSE_JWT/ },
  { name: "legacy user-facing jnremployee URL", regex: /account\.jnremployee\.com/ },
];

const ALL_FILES = listSourceFiles();

test("auth-keychain invariant: no disallowed pattern outside approved files", () => {
  const violations = [];
  for (const file of ALL_FILES) {
    const rel = relativeFromDesktop(file);
    if (APPROVED_AUTH_FILES.has(rel)) continue;
    const content = readFileSync(file, "utf8");
    const lines = nonCommentLines(content);
    for (const { line, index } of lines) {
      for (const p of PATTERNS) {
        if (p.regex.test(line)) {
          violations.push(`${rel}:${index} [${p.name}] ${line.trim()}`);
        }
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    "auth-keychain invariant violations:\n" + violations.join("\n"),
  );
});

test("mount-sensitive surfaces never call licenseJwtRead", () => {
  const surfaces = [
    "src/components/NotificationSheet.tsx",
    "src/components/schedule/SchedulePage.tsx",
    "src/components/earn/RewardClipsPanel.tsx",
    "src/components/ScheduleQueue.tsx",
    "src/components/clips-feed/InlineScheduler.tsx",
  ];
  for (const surface of surfaces) {
    const full = resolve(DESKTOP_ROOT, surface);
    const content = readFileSync(full, "utf8");
    const lines = nonCommentLines(content);
    for (const { line, index } of lines) {
      assert.ok(
        !/licenseJwtRead\(/.test(line),
        `${surface}:${index} contains licenseJwtRead — must use getCachedLicenseJwt / requireCachedLicenseJwtOrThrow instead`,
      );
      assert.ok(
        !/allowKeychainRead:\s*true/.test(line),
        `${surface}:${index} passes allowKeychainRead:true — passive callers must use the cache`,
      );
    }
  }
});

test("mount-sensitive surfaces import cache-only auth helpers", () => {
  const surfaces = [
    "src/components/NotificationSheet.tsx",
    "src/components/schedule/SchedulePage.tsx",
    "src/components/earn/RewardClipsPanel.tsx",
    "src/components/ScheduleQueue.tsx",
    "src/components/clips-feed/InlineScheduler.tsx",
  ];
  for (const surface of surfaces) {
    const full = resolve(DESKTOP_ROOT, surface);
    const content = readFileSync(full, "utf8");
    assert.ok(
      /getCachedLicenseJwt/.test(content),
      `${surface} does not import getCachedLicenseJwt — mount path can't gate safely`,
    );
  }
});

test("ScheduleQueue does not use polling intervals", () => {
  const full = resolve(DESKTOP_ROOT, "src/components/ScheduleQueue.tsx");
  const content = readFileSync(full, "utf8");
  const lines = nonCommentLines(content);
  for (const { line, index } of lines) {
    assert.ok(
      !/useVisibilityInterval\(/.test(line),
      `ScheduleQueue.tsx:${index} restores useVisibilityInterval polling — auth-keychain invariant forbids passive refresh`,
    );
    assert.ok(
      !/setInterval\s*\(/.test(line),
      `ScheduleQueue.tsx:${index} restores setInterval polling — auth-keychain invariant forbids passive refresh`,
    );
  }
});

test("no user-facing string references account.jnremployee.com", () => {
  const offenders = [];
  for (const file of ALL_FILES) {
    const rel = relativeFromDesktop(file);
    if (APPROVED_AUTH_FILES.has(rel)) continue;
    const content = readFileSync(file, "utf8");
    const lines = nonCommentLines(content);
    for (const { line, index } of lines) {
      if (/account\.jnremployee\.com/.test(line)) {
        offenders.push(`${rel}:${index} ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [], "legacy jnremployee URLs found:\n" + offenders.join("\n"));
});

test("LICENSE_JWT secret is namespaced under app.liquidclips.auth.v1", () => {
  const full = resolve(DESKTOP_ROOT, "python-sidecar/secrets_store.py");
  const content = readFileSync(full, "utf8");
  assert.match(
    content,
    /SERVICE_AUTH\s*=\s*"app\.liquidclips\.auth\.v1"/,
    "SERVICE_AUTH must equal 'app.liquidclips.auth.v1' — namespace split per Daniel's v0.7.58 directive",
  );
  assert.match(
    content,
    /SERVICE_AUTH if name == "LICENSE_JWT"/,
    "_service_for must route LICENSE_JWT to SERVICE_AUTH — namespace split per Daniel's v0.7.58 directive",
  );
});

test("authStorage exports the safe accessor surface", () => {
  const full = resolve(DESKTOP_ROOT, "src/lib/authStorage.ts");
  const content = readFileSync(full, "utf8");
  for (const symbol of [
    "getCachedLicenseJwt",
    "licenseJwtPresence",
    "requireCachedLicenseJwtOrThrow",
    "primeLicenseJwtCache",
    "invalidateLicenseJwtCache",
    "readLicenseJwtForAuthAction",
    "CachedJwtUnavailableError",
    "RECONNECT_PROMPT_COPY",
  ]) {
    assert.match(
      content,
      new RegExp(`export\\s+(function|class|const|async\\s+function)\\s+${symbol}\\b`),
      `authStorage must export ${symbol}`,
    );
  }
});
