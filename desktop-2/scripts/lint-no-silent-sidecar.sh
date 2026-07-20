#!/usr/bin/env bash
# IG-SIDECAR-CATCH · silent sidecar-hang regression guard · LOCKED 2026-07-19
#
# Regression this locks: `void sidecar.ingestUrl(...)` in Composer.tsx:559
# shipped without a `.catch()`. Sidecar-unavailable / IPC-timeout /
# whisper-crash all became a silent 5-minute hang — user saw "fetching"
# then nothing forever. Composer.tsx:565 now carries the inline fix; this
# guard is the class-level fence that prevents the pattern re-shipping in
# ANY file for the HIGH-STAKES money-moment methods.
#
# The 4-layer defense per feedback_never_regress_4_layer_defense.md:
#   Layer 1 · Type-level enforcement · desktop-2/src/lib/sidecarSafe.ts
#             (opt-in wrapper · required onError callback)
#   Layer 2 · THIS grep-guard · blocks the three shipped-hang patterns for
#             the HIGH-STAKES set only (ingestUrl · startRun · pickMoreClips
#             · runStage · exportClip). Non-high-stakes `void sidecar.getProject`
#             / `void sidecar.startOverlayBake` are left alone to avoid a
#             tree-wide migration; they use short-lived RPCs where a silent
#             failure is a UI glitch, not a 5-minute hang. See fence 4 for
#             the belt-and-braces text audit.
#   Layer 3 · Vitest regression · desktop-2/src/lib/sidecarCatchAudit.test.ts
#             (walks every .ts/.tsx and asserts every high-stakes call
#              carries .catch OR is inside a try block OR uses sidecarSafe.*)
#   Layer 4 · Runtime observer · desktop-2/src/design-os/components/AppShell.tsx
#             onReject handler tags sidecar-stack rejections and emits
#             `lcDiag("sidecar.unhandled_rejection", ...)` so silent failures
#             land in /admin/bugs even when a caller's .catch was forgotten.
#
# Wired into .githooks/pre-commit alongside the other IG guards. Also
# runnable standalone:
#   bash desktop-2/scripts/lint-no-silent-sidecar.sh

set -uo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
DESKTOP_SRC="$REPO_ROOT/desktop-2/src"

if [ ! -d "$DESKTOP_SRC" ]; then
  # Older branch — skip rather than block.
  exit 0
fi

fail=0

# High-stakes method set. These are the ones that:
#   - talk to the Python sidecar over a long-blocking RPC (ingest, run_stage,
#     pick_more_clips, export_clip) OR wait on a Tauri event with 5-minute
#     timeouts (start_ingest_url).
#   - hitting an unhandled rejection here = user waits forever with no UI.
# Additions to this list should be treated as intentional widening of the
# fence — bump the sentinel + memo + vitest at the same time.
HIGH_STAKES_ALT='(ingestUrl|startRun|pickMoreClips|runStage|exportClip)'

# ─── (a) · `void sidecar.<HIGH_STAKES>(...)` is banned ────────────────
# The exact shape of the Composer.tsx:559 bug. `void` discards the
# promise and any rejection becomes an unhandled_rejection at best or a
# silent 5-minute hang at worst. If you truly do NOT care about the
# result of a high-stakes call, wrap with sidecarSafe.* which forces an
# onError callback.
if hits=$(grep -rnE "void\s+sidecar\.${HIGH_STAKES_ALT}\(" "$DESKTOP_SRC" \
            --include='*.ts' --include='*.tsx' \
            --exclude='*.test.ts' --exclude='*.test.tsx' \
            2>/dev/null); then
  if [ -n "$hits" ]; then
    live_hits=$(echo "$hits" | grep -vE ':\s*(//|\*|/\*)')
    if [ -n "$live_hits" ]; then
      echo "IG-SIDECAR-CATCH FAIL · forbidden pattern: void sidecar.<high-stakes>(...)"
      echo "$live_hits"
      echo "  Fix: use sidecarSafe.* (from src/lib/sidecarSafe.ts) with an onError callback,"
      echo "       or chain .catch(err => ...) directly, or await inside try/catch."
      echo "  Reference: feedback_never_regress_4_layer_defense.md · Composer.tsx:559 shipped bug 2026-07-19."
      fail=1
    fi
  fi
fi

# ─── (b) · `void invoke(...)` in files that import @tauri-apps/api/core
# The same class of bug at the raw Tauri layer. `invoke("sidecar_call", ...)`
# discarded via `void` swallows every RPC-envelope error including sidecar
# restart + timeout classes.
while IFS= read -r file; do
  if grep -qE 'from\s+"@tauri-apps/api/core"' "$file" 2>/dev/null; then
    if bad=$(grep -nE 'void\s+invoke\(' "$file" 2>/dev/null | grep -vE ':\s*(//|\*|/\*)'); then
      if [ -n "$bad" ]; then
        echo "IG-SIDECAR-CATCH FAIL · forbidden pattern: void invoke(...) in $file"
        echo "$bad"
        echo "  Fix: attach .catch(err => ...) or wrap in try/catch when awaited."
        fail=1
      fi
    fi
  fi
done < <(find "$DESKTOP_SRC" -type f \( -name '*.ts' -o -name '*.tsx' \) \
           -not -name '*.test.ts' -not -name '*.test.tsx' 2>/dev/null)

# ─── (c) · sidecar.<HIGH-STAKES>(...) with no .catch in the expression
#      tree AND not inside a try block AND not a sidecarSafe.* call.
# We use python for the multi-line window scan so comment-line stripping
# and paren-balancing are reliable.
while IFS= read -r file; do
  # Skip the wrapper itself, the sidecar-stub itself, and test files.
  case "$file" in
    */lib/sidecarSafe.ts) continue ;;
    */design-os/engine/sidecar-stub.ts) continue ;;
    */lib/sidecarCatchAudit.test.ts) continue ;;
  esac

  offenders=$(/usr/bin/python3 - "$file" <<'PY'
import re, sys, pathlib
path = sys.argv[1]
src = pathlib.Path(path).read_text(encoding="utf-8", errors="ignore")

# ── Strip comments so text-inside-docstrings doesn't trip the guard.
#    Replace every `//...\n`, block `/* ... */`, and pure ` * ...` JSDoc
#    lines with blank-preserving whitespace so line numbers stay stable.
def blank_out(m):
    return re.sub(r'[^\n]', ' ', m.group(0))

# 1. block comments /* ... */
src_nc = re.sub(r'/\*.*?\*/', blank_out, src, flags=re.S)
# 2. line comments // ...
src_nc = re.sub(r'//[^\n]*', lambda m: ' ' * len(m.group(0)), src_nc)

lines_original = src.split("\n")

pattern = re.compile(
    r'\b(sidecar|exportApi)\.(ingestUrl|startRun|pickMoreClips|runStage|exportClip)\s*\('
)

def is_inside_try(before_text: str) -> bool:
    """Naive brace-balance from the most recent `try {` — we start scanning
    AFTER the opening brace, so depth 0 means still inside try body.
    Only when close-count EXCEEDS open-count have we exited try's block.
    Also require the try be paired with a `catch (` clause somewhere in
    the file (a bare `try` block without catch/finally is invalid TS but
    we defend anyway)."""
    try_matches = list(re.finditer(r'\btry\s*\{', before_text))
    if not try_matches:
        return False
    last_try = try_matches[-1]
    between = before_text[last_try.end():]
    # Inside iff we have NOT yet exited the try body's brace pair.
    return between.count("{") >= between.count("}")

def has_catch_in_expression(text: str, start: int) -> bool:
    """Walk forward from the call site, balance parens/braces, and check
    for `.catch(` before the statement terminator (semicolon at depth 0
    OR end-of-file). This correctly handles `.then(...).catch(...)` chains
    where the .catch lives 500-1500 chars away past a big .then arrow body."""
    depth = 0        # paren depth
    brace = 0        # brace depth (for arrow bodies)
    i = start
    n = len(text)
    while i < n:
        c = text[i]
        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
        elif c == '{':
            brace += 1
        elif c == '}':
            brace -= 1
        elif c == ';' and depth == 0 and brace == 0:
            # end of statement
            break
        # Look for `.catch(` anywhere in the expression tree.
        if c == '.' and text[i:i+7] == '.catch(':
            return True
        i += 1
    return False

hits = []
for m in pattern.finditer(src_nc):
    start = m.start()
    line_no = src_nc.count("\n", 0, start) + 1

    before = src_nc[:start]
    if is_inside_try(before):
        continue
    if has_catch_in_expression(src_nc, m.end()):
        continue

    src_line = lines_original[line_no - 1].rstrip()
    hits.append(f"{path}:{line_no}:{src_line}")

for h in hits:
    print(h)
PY
  )
  if [ -n "$offenders" ]; then
    echo "IG-SIDECAR-CATCH FAIL · high-stakes sidecar call with no .catch or try{"
    echo "$offenders"
    echo "  Fix patterns:"
    echo "    A) await sidecar.<method>(...) INSIDE a try/catch block"
    echo "    B) sidecar.<method>(...).catch((e) => { ... })"
    echo "    C) sidecarSafe.<method>(..., { onError: (e) => { ... } })"
    fail=1
  fi
done < <(find "$DESKTOP_SRC" -type f \( -name '*.ts' -o -name '*.tsx' \) \
           -not -name '*.test.ts' -not -name '*.test.tsx' 2>/dev/null)

if [ "$fail" -eq 0 ]; then
  echo "IG-SIDECAR-CATCH · silent-sidecar-hang guard · PASS"
  exit 0
fi

echo ""
echo "See:"
echo "  - desktop-2/src/lib/sidecarSafe.ts           (Fence 1 · wrapper API)"
echo "  - desktop-2/src/lib/sidecarCatchAudit.test.ts (Fence 4 · vitest proof)"
echo "  - desktop-2/src/design-os/components/AppShell.tsx (Fence 5 · runtime observer)"
echo "  - feedback_never_regress_4_layer_defense.md   (LOCKED memory · 2026-07-18)"
exit 1
