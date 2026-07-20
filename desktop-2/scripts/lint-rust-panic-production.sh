#!/usr/bin/env bash
# IG-RUST-PANIC · No bare .unwrap()/.expect()/panic!/todo!/unimplemented! in
# production Rust OUTSIDE #[tauri::command] bodies · LOCKED 2026-07-20
#
# Companion to lint-no-bare-unwrap-commands.sh (which covers command bodies).
# This script covers everything else in src-tauri/src/*.rs:
#   - setup closures
#   - main()
#   - helper functions
#   - HTTP/protocol handlers
#   - module-level functions
#
# Excludes (safely):
#   - #[test] fn bodies
#   - #[cfg(test)] mod { ... } blocks
#   - Lines/blocks inside #[tauri::command] fns (covered by sister script)
#   - Any line/block above with UNWRAP-OK: or PANIC-OK: sentinel
#
# The 5-layer defense per feedback_never_regress_4_layer_defense.md:
#   Layer 1 · UNWRAP-OK: / PANIC-OK: sentinel in the .rs source
#             (same line or immediately above · same shape as sister fence)
#   Layer 2 · THIS grep-guard (walks all *.rs, brace-balances test skip)
#   Layer 3 · Vitest at desktop-2/src/lib/rustPanicProductionAudit.test.ts
#             (belt-and-braces · runs on every `vitest`)
#   Layer 4 · Runtime — native panic hook in lib.rs writes crash marker
#   Layer 5 · Baseline allowlist: scripts/rust-panic-baseline.txt
#             (freezes the 2 grandfathered sites; adding lines requires
#              an approved code-review with reason)
#
# Grandfather policy · 2026-07-20 · pre-existing violations that cannot
# be fixed without a shell rebuild are entered in
# scripts/rust-panic-baseline.txt as `<file>:<line>:<reason>` and skipped
# by this scanner. Every NEW violation must either add UNWRAP-OK:/PANIC-OK:
# sentinel above the line OR replace with map_err/ok_or_else.
#
# Wired into .githooks/pre-commit alongside sister IG-UNWRAP-CMD guard.
# Also runnable standalone:
#   bash desktop-2/scripts/lint-rust-panic-production.sh
#
# Environment overrides (for CI / negative-fixture proof):
#   LINT_RUST_PANIC_SCAN_DIR=path   Override scan dir (default: real src-tauri/src)
#   LINT_RUST_PANIC_BASELINE=path   Override baseline file (default: repo baseline)

set -uo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
TAURI_SRC="${LINT_RUST_PANIC_SCAN_DIR:-$REPO_ROOT/desktop-2/src-tauri/src}"
BASELINE="${LINT_RUST_PANIC_BASELINE:-$REPO_ROOT/desktop-2/scripts/rust-panic-baseline.txt}"

if [ ! -d "$TAURI_SRC" ]; then
  # Older branch — skip rather than block.
  exit 0
fi

offenders=$(/usr/bin/python3 - "$TAURI_SRC" "$BASELINE" <<'PY'
import re, sys, pathlib

root = pathlib.Path(sys.argv[1])
baseline_path = pathlib.Path(sys.argv[2])

# Load baseline: each line = "relative/path.rs:LINE:reason". Blank/# skipped.
# We match on the (file, line) tuple after resolving.
baseline = set()
if baseline_path.exists():
    for raw in baseline_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split(":", 2)
        if len(parts) >= 2:
            rel_path = parts[0].strip()
            try:
                lno = int(parts[1].strip())
            except ValueError:
                continue
            baseline.add((rel_path, lno))

files = sorted(root.glob("*.rs"))

# Attribute headers we recognise for scope
CMD_HEADER = re.compile(
    r'#\[tauri::command\][^\n]*\n'
    r'((?:\s*#\[[^\]]*\][^\n]*\n)*)'
    r'\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\(',
    re.M,
)
TEST_FN = re.compile(
    r'#\[test\][^\n]*\n'
    r'((?:\s*#\[[^\]]*\][^\n]*\n)*)'
    r'\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\(',
    re.M,
)
CFG_TEST_MOD = re.compile(
    r'#\[cfg\(test\)\]\s*\n\s*(?:pub\s+)?mod\s+\w+\s*\{',
    re.M,
)

FORBIDDEN_PATTERNS = [
    ("unwrap", re.compile(r'\.unwrap\(\)')),
    ("expect", re.compile(r'\.expect\(')),
    ("panic",  re.compile(r'\bpanic!\s*\(')),
    ("todo",   re.compile(r'\btodo!\s*\(?')),
    ("unimpl", re.compile(r'\bunimplemented!\s*\(?')),
]

# Sentinel shapes — any of these on the same line or the line above
# excuses the panic-risk line.
SENTINELS = ("UNWRAP-OK:", "PANIC-OK:", "SETUP-OK:")

def find_body_end(src, open_brace_idx):
    """Given index of an opening `{`, return the index just past its match."""
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
            i += 1; continue
        if in_block_comment:
            if c == '*' and nxt == '/':
                in_block_comment = False; i += 2; continue
            i += 1; continue
        if in_str:
            if c == '\\':
                i += 2; continue
            if c == str_char:
                in_str = False
            i += 1; continue
        if c == '/' and nxt == '/':
            in_line_comment = True; i += 2; continue
        if c == '/' and nxt == '*':
            in_block_comment = True; i += 2; continue
        if c == '"' or c == "'":
            in_str = True; str_char = c; i += 1; continue
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return n

def find_fn_body_span(src, header_match):
    """Given a CMD_HEADER/TEST_FN match, return (body_start, body_end) indices
    or (None, None) if the body cannot be found."""
    i = header_match.end()
    depth = 0
    # walk through the parameter list
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
        return (None, None)
    return (i, find_body_end(src, i))

def find_mod_body_span(src, header_match):
    """CFG_TEST_MOD header ends with `{`; back up one and delegate."""
    end = header_match.end()
    brace_idx = src.rfind('{', 0, end)
    if brace_idx == -1:
        return (None, None)
    return (brace_idx, find_body_end(src, brace_idx))

def is_in_string_or_comment(src, pos):
    """Cheap check: walk back to the start of the line, then scan forward
    tracking whether we're inside `"` or `//`."""
    line_start = src.rfind('\n', 0, pos) + 1
    in_str = False
    str_char = ''
    i = line_start
    while i < pos:
        c = src[i]
        nxt = src[i+1] if i+1 < len(src) else ''
        if not in_str and c == '/' and nxt == '/':
            return True
        if not in_str and (c == '"' or c == "'"):
            in_str = True; str_char = c
        elif in_str and c == '\\':
            i += 2; continue
        elif in_str and c == str_char:
            in_str = False
        i += 1
    return in_str

results = []
for f in files:
    src = f.read_text(encoding="utf-8", errors="ignore")
    lines = src.split("\n")

    # Build "exclusion mask" — byte ranges to SKIP because they're inside
    # a #[tauri::command] fn body OR a #[test] fn body OR a #[cfg(test)]
    # mod body.
    exclusion_ranges = []
    for m in CMD_HEADER.finditer(src):
        start, end = find_fn_body_span(src, m)
        if start is not None:
            exclusion_ranges.append((start, end))
    for m in TEST_FN.finditer(src):
        start, end = find_fn_body_span(src, m)
        if start is not None:
            exclusion_ranges.append((start, end))
    for m in CFG_TEST_MOD.finditer(src):
        start, end = find_mod_body_span(src, m)
        if start is not None:
            exclusion_ranges.append((start, end))

    def is_excluded(pos):
        for (a, b) in exclusion_ranges:
            if a <= pos < b:
                return True
        return False

    rel_path = f.name  # scanner deals with basename to keep baseline stable

    for kind, pat in FORBIDDEN_PATTERNS:
        for um in pat.finditer(src):
            pos = um.start()
            if is_excluded(pos):
                continue
            if is_in_string_or_comment(src, pos):
                continue
            line_no = src.count("\n", 0, pos) + 1
            line_text = lines[line_no - 1] if line_no <= len(lines) else ""
            prev_text = lines[line_no - 2] if line_no >= 2 else ""
            if any(s in line_text or s in prev_text for s in SENTINELS):
                continue
            if (rel_path, line_no) in baseline:
                continue
            results.append(f"{rel_path}:{line_no}:{kind}: {line_text.strip()}")

for r in results:
    print(r)
PY
)

if [ -n "$offenders" ]; then
  echo "IG-RUST-PANIC FAIL · bare panic risk in production Rust"
  echo ""
  echo "$offenders"
  echo ""
  echo "  Fix patterns:"
  echo "    A) .map_err(|e| e.to_string())?             # for Result<T, E>"
  echo "    B) .ok_or_else(|| \"reason\".into())?          # for Option<T>"
  echo "    C) .unwrap_or_else(|_| { /* safe fallback */ })"
  echo "    D) if the panic really is safe (unrecoverable init, infallible const)"
  echo "       add on the line above one of:"
  echo "         // UNWRAP-OK: <one-sentence reason>"
  echo "         // PANIC-OK:  <one-sentence reason>"
  echo "         // SETUP-OK:  <one-sentence reason>   (for init-only paths)"
  echo "    E) or add to scripts/rust-panic-baseline.txt with reason (requires review)"
  echo ""
  echo "  Reference: feedback_never_regress_4_layer_defense.md · IG-RUST-PANIC 2026-07-20"
  exit 1
fi

echo "IG-RUST-PANIC · no bare panic sites in production Rust · PASS"
exit 0
