#!/usr/bin/env bash
# IG-CAPS-AUDIT · Tauri v2 capabilities parity audit · LOCKED 2026-07-20
#
# Regression this locks: Tauri v2's security model is fine-grained per-
# permission grants. Over-broad `core:default` grants hide unused
# permissions (attack surface) AND missing plugin-specific grants fail
# at runtime with the opaque "the operation was rejected by the
# permission system" error users mistake for a bug in the flow.
#
# The 4-layer defense per feedback_never_regress_4_layer_defense.md:
#   Layer 1 · IRON GATE IG-CAPS-AUDIT sentinel in capabilities/default.json
#             (a JSON `_ig` comment key marking the block regression-locked)
#   Layer 2 · THIS script · ADVISORY. Prints a plugin / invoke parity
#             table and flags mismatches; NEVER fails the commit because
#             the fix (grant permission, remove import, split into
#             fine-grained caps) requires human judgement of the security
#             surface. Exit 0 always.
#   Layer 3 · Vitest at desktop-2/src/lib/tauriCapabilitiesAudit.test.ts
#             (asserts every imported @tauri-apps/plugin-* has at least
#              one matching permission grant · this IS a hard fail)
#   Layer 4 · Runtime · Tauri itself rejects ungranted plugin calls at
#             invoke time. The vitest layer catches the missing grant
#             at commit time so users never hit the runtime rejection.
#
# Wired into .githooks/pre-commit as ADVISORY (never blocks commit).
# Also runnable standalone:
#   bash desktop-2/scripts/lint-tauri-capabilities-audit.sh

set -uo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
DESKTOP_SRC="$REPO_ROOT/desktop-2/src"
TAURI_SRC="$REPO_ROOT/desktop-2/src-tauri/src"
CAPS_DIR="$REPO_ROOT/desktop-2/src-tauri/capabilities"

if [ ! -d "$DESKTOP_SRC" ] || [ ! -d "$CAPS_DIR" ]; then
  # Older branch — skip rather than block.
  exit 0
fi

/usr/bin/python3 - "$DESKTOP_SRC" "$TAURI_SRC" "$CAPS_DIR" <<'PY'
import json, re, sys, pathlib, os

desktop_src = pathlib.Path(sys.argv[1])
tauri_src   = pathlib.Path(sys.argv[2])
caps_dir    = pathlib.Path(sys.argv[3])

# ── 1. plugin imports on the JS side ────────────────────────────────
plugin_import_re = re.compile(r'@tauri-apps/plugin-([a-z-]+)')
js_plugins: dict[str, list[str]] = {}
for p in desktop_src.rglob("*.ts*"):
    if p.name.endswith(".test.ts") or p.name.endswith(".test.tsx"):
        continue
    try:
        text = p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        continue
    for m in plugin_import_re.finditer(text):
        name = m.group(1)
        js_plugins.setdefault(name, []).append(str(p.relative_to(desktop_src.parent)))

# ── 2. invoke() calls on the JS side ────────────────────────────────
# Two shapes:
#   A) direct     — invoke("name", ...) / invoke('name', ...)
#   B) wrapped    — invokeOrNoop("name", ...) / mod.invoke("name") /
#                   any TS wrapper that forwards a string literal to
#                   Tauri's invoke. We catch these by scanning for the
#                   literal command name inside any quoted string on the
#                   JS side · limited to the set of names we found on
#                   the Rust side so we don't false-flag every string.
direct_invoke_re = re.compile(r'''\binvoke\w*\s*\(\s*["']([a-zA-Z_][a-zA-Z0-9_]*)["']''')
js_invokes: dict[str, list[str]] = {}
js_all_text: list[tuple[str, str]] = []   # (rel_path, text) for wrapper scan below
for p in desktop_src.rglob("*.ts*"):
    if p.name.endswith(".test.ts") or p.name.endswith(".test.tsx"):
        continue
    try:
        text = p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        continue
    rel = str(p.relative_to(desktop_src.parent))
    js_all_text.append((rel, text))
    for m in direct_invoke_re.finditer(text):
        name = m.group(1)
        js_invokes.setdefault(name, []).append(rel)

# ── 3. #[tauri::command] fns on the Rust side ───────────────────────
cmd_re = re.compile(r'#\[tauri::command\][^\n]*\n(?:\s*#\[[^\]]*\][^\n]*\n)*\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)')
rust_commands: dict[str, str] = {}
for p in sorted(tauri_src.glob("*.rs")):
    text = p.read_text(encoding="utf-8", errors="ignore")
    for m in cmd_re.finditer(text):
        rust_commands[m.group(1)] = p.name

# Second pass · scan every JS file for a QUOTED string literal that
# matches a known Rust command name. Catches wrappers like
# invokeOrNoop("x"), mod.invoke("x"), or a table `{ "x": ... }` that
# eventually forwards to invoke. Restricted to the Rust name set so
# we don't false-flag arbitrary strings.
for cmd_name in list(rust_commands.keys()):
    if cmd_name in js_invokes:
        continue
    quoted = re.compile(r'''["']''' + re.escape(cmd_name) + r'''["']''')
    for rel, text in js_all_text:
        if quoted.search(text):
            js_invokes.setdefault(cmd_name, []).append(rel + " (wrapped)")
            break

# ── 4a. Rust plugin registrations · .plugin(tauri_plugin_X::init())
plugin_init_re = re.compile(r'\btauri_plugin_([a-z_]+)::')
rust_plugin_regs: set[str] = set()
for p in sorted(tauri_src.glob("*.rs")):
    text = p.read_text(encoding="utf-8", errors="ignore")
    for m in plugin_init_re.finditer(text):
        # normalise underscore back to hyphen to match JS plugin package name
        rust_plugin_regs.add(m.group(1).replace("_", "-"))

# ── 4b. capabilities/*.json permission grants ───────────────────────
granted: dict[str, list[str]] = {}
for cap_file in sorted(caps_dir.glob("*.json")):
    try:
        data = json.loads(cap_file.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"  ! could not parse {cap_file.name}: {e}")
        continue
    for perm in data.get("permissions", []):
        if isinstance(perm, str):
            key = perm
        elif isinstance(perm, dict) and "identifier" in perm:
            key = perm["identifier"]
        else:
            continue
        granted.setdefault(key, []).append(cap_file.name)

# derive plugin prefix from grants (e.g. `fs:default` → `fs`)
granted_plugin_prefixes = set()
for k in granted:
    if ":" in k:
        granted_plugin_prefixes.add(k.split(":", 1)[0])

# ── 5. build report table ───────────────────────────────────────────
print("──────────────────────────────────────────────────────────────")
print("IG-CAPS-AUDIT · Tauri v2 capabilities parity report")
print("──────────────────────────────────────────────────────────────")
print()
print("PLUGIN GRANTS · imported plugins vs Rust registration vs capability grants")
print(f"  {'plugin':22} {'js-import':10} {'rust-reg':10} {'granted':10} {'verdict'}")
print(f"  {'------':22} {'---------':10} {'--------':10} {'-------':10} {'-------'}")

all_plugins = set(js_plugins) | granted_plugin_prefixes | rust_plugin_regs
for plugin in sorted(all_plugins):
    used = plugin in js_plugins
    granted_here = plugin in granted_plugin_prefixes
    registered = plugin in rust_plugin_regs
    if plugin == "core":
        # `core:*` grants are not a plugin — Tauri built-in.
        registered = True
    if used and granted_here and registered:
        verdict = "OK"
    elif used and not registered:
        verdict = "PLUGIN NOT REGISTERED IN RUST · Cargo.toml + lib.rs .plugin(...) needed"
    elif used and not granted_here:
        verdict = "MISSING GRANT · runtime will reject"
    elif granted_here and not used and not registered:
        verdict = "over-permissive · no import + no registration"
    elif granted_here and not used and registered:
        verdict = "grant + Rust registration but no JS import (dead code?)"
    else:
        verdict = "?"
    print(f"  {plugin:22} {('yes' if used else 'no'):10} {('yes' if registered else 'no'):10} {('yes' if granted_here else 'no'):10} {verdict}")

print()
print("INVOKE PARITY · JS invoke() calls vs Rust #[tauri::command] fns")
print(f"  {'name':32} {'js':4} {'rust':6} {'verdict'}")
print(f"  {'----':32} {'--':4} {'----':6} {'-------'}")

all_cmds = set(js_invokes) | set(rust_commands)
for name in sorted(all_cmds):
    in_js = name in js_invokes
    in_rust = name in rust_commands
    if in_js and in_rust:
        verdict = "OK"
    elif in_js and not in_rust:
        verdict = "ORPHAN JS · invoke references nothing"
    elif in_rust and not in_js:
        verdict = "unused Rust command"
    else:
        verdict = "?"
    print(f"  {name:32} {('yes' if in_js else 'no'):4} {('yes' if in_rust else 'no'):6} {verdict}")

print()
print("Advisory only — this guard never blocks the commit.")
print("Reference: feedback_never_regress_4_layer_defense.md · IG-CAPS-AUDIT 2026-07-20.")
PY

# Never fail. This is an ADVISORY audit — the vitest is the hard fail
# for the missing-grant case (which is deterministic and testable in JS).
exit 0
