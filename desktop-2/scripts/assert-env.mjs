#!/usr/bin/env node
// assert-env.mjs — build-time env assertion for desktop-2.
//
// Reads desktop-2/required-env.json and validates that each listed VITE_*
// env var is present, non-empty, and matches its shape hint (if any).
//
// Wired as:
//   1. tauri.conf.json → build.beforeBuildCommand (runs before every
//      `tauri build`).
//   2. .github/workflows/release-desktop-2.yml → dedicated CI step
//      before the tauri-action call.
//
// Fires the v2.2.33 fire drill: shipped without VITE_CLERK_PUBLISHABLE_KEY
// baked in → ClerkProvider mounted with "" → Intel boot crash.
//
// HARD RULES
//   · NEVER echo, print, or otherwise leak the value of any env var. On
//     pass, print only "OK · <name>". On fail, print only the missing name
//     and the shape hint (which is a public prefix, not a secret).
//   · Exit 1 on any failure. Exit 0 only when every required var passes.
//   · No secrets in argv, no secrets in stderr, no secrets in tracebacks.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REQUIRED_JSON = path.resolve(__dirname, "..", "required-env.json");

function die(msg) {
  process.stderr.write(`✗ assert-env: ${msg}\n`);
  process.exit(1);
}

function ok(msg) {
  process.stdout.write(`✓ assert-env: ${msg}\n`);
}

if (!fs.existsSync(REQUIRED_JSON)) {
  die(`required-env.json not found at ${REQUIRED_JSON}`);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(REQUIRED_JSON, "utf8"));
} catch (err) {
  die(`failed to parse required-env.json: ${err.message}`);
}

const required = Array.isArray(manifest?.required) ? manifest.required : [];
if (required.length === 0) {
  die("required-env.json has no `required` array (or it is empty)");
}

const failures = [];
for (const entry of required) {
  const name = entry?.name;
  if (typeof name !== "string" || name.length === 0) {
    failures.push({ name: "<unnamed entry>", reason: "malformed required-env.json entry" });
    continue;
  }

  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") {
    failures.push({ name, reason: "missing or empty" });
    continue;
  }

  // Shape hint is space-separated list of allowed prefixes (e.g.
  // "pk_live_ pk_test_"). If given, at least one must match.
  const shape = typeof entry.shape === "string" ? entry.shape.trim() : "";
  if (shape.length > 0) {
    const prefixes = shape.split(/\s+/).filter(Boolean);
    const matches = prefixes.some((p) => raw.startsWith(p));
    if (!matches) {
      failures.push({
        name,
        reason: `does not match required shape (expected one of: ${prefixes.join(", ")})`,
      });
      continue;
    }
  }

  // Success — length only, NEVER the value.
  ok(`${name} present · length ${raw.length}`);
}

if (failures.length > 0) {
  for (const f of failures) {
    process.stderr.write(`✗ assert-env: ${f.name} — ${f.reason}\n`);
  }
  process.stderr.write(
    `\n✗ assert-env: ${failures.length} required env var(s) failed. Set them and retry.\n` +
      `  Local dev: export in your shell or add to desktop-2/.env.local (gitignored).\n` +
      `  CI: Settings → Secrets and variables → Actions.\n`,
  );
  process.exit(1);
}

process.stdout.write("✓ assert-env: all required VITE_* env vars present + shape-valid\n");
process.exit(0);
