#!/usr/bin/env bash
# IG-UNWRAP-CMD · No bare .unwrap() inside #[tauri::command] fns · LOCKED 2026-07-20
#
# Regression this locks: bare `.unwrap()` inside a `#[tauri::command]`
# panics the Tauri shell (or the sidecar host process). Panics inside a
# command surface as "the app just quit" to the user — there is no JS
# error object, no lcDiag emission, no toast. Every command must instead
# return `Result<T, String>` and convert failures with
# `.map_err(|e| e.to_string())?` so the JS side gets a real error.
#
# The 4-layer defense per feedback_never_regress_4_layer_defense.md:
#   Layer 1 · UNWRAP-OK: sentinel comments in the .rs source
#             (either on the same line as the unwrap, or on the line
#              immediately above · same shape as the sidecar-catch fence)
#   Layer 2 · THIS grep-guard · walks desktop-2/src-tauri/src/*.rs,
#             identifies every `#[tauri::command]` function body via
#             brace-balance, flags every bare .unwrap() inside that has
#             no `UNWRAP-OK:` allowlist marker on/above it
#   Layer 3 · Vitest at desktop-2/src/lib/tauriCommandsUnwrapAudit.test.ts
#             (same text-analysis pattern · runs on every `vitest`)
#   Layer 4 · Runtime — the native panic hook in lib.rs already writes
#             ~/LiquidClips/.last-crash.json on any Rust panic, and the
#             Result<_, String> return signature lets the JS layer surface
#             the error via `lcDiag` instead of a silent quit.
#
# Grandfather policy · 2026-07-20 · pre-existing violations receive an
# UNWRAP-OK sentinel of the shape:
#   // UNWRAP-OK: grandfathered · IG-UNWRAP-GRANDFATHER · pre-2026-07-20 · owner=null
# so the fence starts green today AND every FUTURE .unwrap() must be
# justified with an explicit UNWRAP-OK: comment (or replaced with a
# map_err chain, which is the preferred fix).
#
# Wired into .githooks/pre-commit alongside the other IG guards. Also
# runnable standalone:
#   bash desktop-2/scripts/lint-no-bare-unwrap-commands.sh

set -uo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
TAURI_SRC="$REPO_ROOT/desktop-2/src-tauri/src"

if [ ! -d "$TAURI_SRC" ]; then
  # Older branch — skip rather than block.
  exit 0
fi

fail=0

# Delegate the actual brace-balanced scan to python3. Bash regex cannot
# reliably identify the closing brace of a #[tauri::command] fn body
# because the body may contain nested braces (match arms, closures,
# structs, blocks). Python paren/brace balancing keeps false positives
# and false negatives out of the fence.
offenders=$(/usr/bin/python3 - "$TAURI_SRC" <<'PY'
import re, sys, pathlib

root = pathlib.Path(sys.argv[1])
files = sorted(root.glob("*.rs"))

# Regex that matches the #[tauri::command] attribute + optional extra
# attributes + optional `pub` + optional `async` + `fn <name>(`.
CMD_HEADER = re.compile(
    r'#\[tauri::command\][^\n]*\n'
    r'((?:\s*#\[[^\]]*\][^\n]*\n)*)'
    r'\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\(',
    re.M,
)

# Bare `.unwrap()` — not `.unwrap_or(...)`, not `.unwrap_or_else(...)`,
# not `.unwrap_or_default()`. The `(?!\w|\()` lookahead rules out any
# suffix character that would turn it into a different call.
BARE_UNWRAP = re.compile(r'\.unwrap\(\)')

SENTINEL = "UNWRAP-OK:"

def find_body_end(src: str, open_brace_idx: int) -> int:
    """Return the index just past the matching close-brace of the block
    that starts at open_brace_idx (which must point at a `{`)."""
    depth = 0
    i = open_brace_idx
    n = len(src)
    in_str = False
    str_char = ''
    in_line_comment = False
    in_block_comment = False
    while i < n:
        c = src[i]
        nxt = src[i+1] if i+1 < n else ''
        if in_line_comment:
            if c == '\n':
                in_line_comment = False
            i += 1
            continue
        if in_block_comment:
            if c == '*' and nxt == '/':
                in_block_comment = False
                i += 2
                continue
            i += 1
            continue
        if in_str:
            if c == '\\':
                i += 2
                continue
            if c == str_char:
                in_str = False
            i += 1
            continue
        if c == '/' and nxt == '/':
            in_line_comment = True
            i += 2
            continue
        if c == '/' and nxt == '*':
            in_block_comment = True
            i += 2
            continue
        if c == '"' or c == "'":
            # Rust char literals are 'x' — same skipping logic works.
            in_str = True
            str_char = c
            i += 1
            continue
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return n

results = []
for f in files:
    src = f.read_text(encoding="utf-8", errors="ignore")
    lines = src.split("\n")

    for m in CMD_HEADER.finditer(src):
        # Advance from the fn name to the opening `{` of the body,
        # skipping the parameter list + optional return type.
        i = m.end()
        depth = 0
        # walk to matching `)` for the parameter list
        while i < len(src):
            c = src[i]
            if c == '(':
                depth += 1
            elif c == ')':
                depth -= 1
                if depth < 0:
                    i += 1
                    break
            i += 1
        # walk to the opening `{`
        while i < len(src) and src[i] != '{':
            i += 1
        if i >= len(src):
            continue
        body_end = find_body_end(src, i)
        body = src[i:body_end]

        for um in BARE_UNWRAP.finditer(body):
            abs_pos = i + um.start()
            line_no = src.count("\n", 0, abs_pos) + 1
            line_text = lines[line_no - 1]
            prev_line_text = lines[line_no - 2] if line_no >= 2 else ""
            if SENTINEL in line_text or SENTINEL in prev_line_text:
                continue
            fn_name = m.group(2)
            results.append(f"{f}:{line_no}: [{fn_name}] {line_text.strip()}")

for r in results:
    print(r)
PY
)

if [ -n "$offenders" ]; then
  echo "IG-UNWRAP-CMD FAIL · bare .unwrap() inside #[tauri::command] fn body"
  echo ""
  echo "$offenders"
  echo ""
  echo "  Fix patterns (return Result<T, String> and either):"
  echo "    A) .map_err(|e| e.to_string())?             # for Result<T, E>"
  echo "    B) .ok_or_else(|| \"describe reason\".into())?  # for Option<T>"
  echo "    C) if the panic really is safe (infallible constant regex, static string parse, etc)"
  echo "       add on the line above:"
  echo "         // UNWRAP-OK: <one-sentence reason>"
  echo "  Reference: feedback_never_regress_4_layer_defense.md · IG-UNWRAP-CMD 2026-07-20."
  exit 1
fi

echo "IG-UNWRAP-CMD · no bare .unwrap() inside tauri::command bodies · PASS"
exit 0
