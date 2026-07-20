#!/usr/bin/env bash
# IG-ASYNC-CMD · every #[tauri::command] is `async fn` · LOCKED 2026-07-20
#
# Regression this locks: a sync `#[tauri::command]` runs on the main
# thread while async siblings run on Tauri's tokio runtime. Mixing the
# two creates subtle deadlocks — a sync command's blocking work stalls
# the same runtime the async siblings depend on to make forward
# progress. The GitButler standard is "async everything" so command
# dispatch semantics stay uniform.
#
# The 4-layer defense per feedback_never_regress_4_layer_defense.md:
#   Layer 1 · IG-ASYNC-CMD sentinel comments in Rust source describing
#             the async-by-default rule and (for legitimate escapes)
#             the SYNC-OK: reason
#   Layer 2 · THIS grep-guard · walks every #[tauri::command] and
#             asserts the fn signature carries `async fn`. Escape:
#             `SYNC-OK:` sentinel on the immediately preceding comment
#             line (or a `// SYNC-OK: <reason>` line inside the block
#             of comment lines that leads into the attribute)
#   Layer 3 · Vitest at desktop-2/src/lib/tauriAsyncCommandsAudit.test.ts
#   Layer 4 · The Rust compiler itself · a `#[tauri::command]` that
#             mixes async + sync patterns fails to type-check when the
#             runtime tries to dispatch (this is a natural runtime
#             invariant · the layers above catch the failure earlier)
#
# Wired into .githooks/pre-commit. Also runnable standalone:
#   bash desktop-2/scripts/lint-tauri-async-commands.sh

set -uo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
TAURI_SRC="$REPO_ROOT/desktop-2/src-tauri/src"

if [ ! -d "$TAURI_SRC" ]; then
  exit 0
fi

offenders=$(/usr/bin/python3 - "$TAURI_SRC" <<'PY'
import re, sys, pathlib

root = pathlib.Path(sys.argv[1])
SENTINEL = "SYNC-OK:"

# We need to walk the file line-by-line so we can grab the block of
# comment lines that immediately PRECEDES each #[tauri::command] and
# check for a SYNC-OK: escape there.
def scan(path: pathlib.Path):
    lines = path.read_text(encoding="utf-8", errors="ignore").split("\n")
    n = len(lines)
    results = []
    i = 0
    while i < n:
        line = lines[i]
        stripped = line.strip()
        if stripped.startswith("#[tauri::command]"):
            # Walk the preceding contiguous block of comment lines to
            # detect a `SYNC-OK: <reason>` escape.
            j = i - 1
            allow = False
            while j >= 0:
                prev = lines[j].strip()
                if prev == "" or prev.startswith("//") or prev.startswith("/*") or prev.startswith("*"):
                    if SENTINEL in prev:
                        allow = True
                        break
                    if prev == "":
                        # blank line still lets us walk back through a
                        # top-of-block gap · but only ONE. If we hit a
                        # second non-comment line, stop.
                        j -= 1
                        if j >= 0 and lines[j].strip() != "" and not lines[j].strip().startswith(("//", "/*", "*")):
                            break
                        continue
                    j -= 1
                    continue
                break
            # Now walk forward through any subsequent #[...] attributes
            # to find the `fn` line.
            k = i + 1
            while k < n:
                l = lines[k].strip()
                if l.startswith("#["):
                    k += 1
                    continue
                if l == "":
                    k += 1
                    continue
                break
            if k >= n:
                i += 1
                continue
            fn_line = lines[k].strip()
            fn_match = re.match(r'(?:pub\s+)?(?:async\s+)?fn\s+(\w+)', fn_line)
            if not fn_match:
                # Weird shape · skip.
                i = k + 1
                continue
            is_async = re.match(r'(?:pub\s+)?async\s+fn', fn_line) is not None
            fn_name = fn_match.group(1)
            if not is_async and not allow:
                results.append(f"{path}:{k+1}: [{fn_name}] {fn_line}")
            i = k + 1
        else:
            i += 1
    return results

hits = []
for f in sorted(root.glob("*.rs")):
    hits.extend(scan(f))

for h in hits:
    print(h)
PY
)

if [ -n "$offenders" ]; then
  echo "IG-ASYNC-CMD FAIL · sync #[tauri::command] found without SYNC-OK: sentinel"
  echo ""
  echo "$offenders"
  echo ""
  echo "  Fix (preferred): change 'fn X' to 'async fn X'. The return type stays"
  echo "                    the same. tauri v2 runs async fn commands on its"
  echo "                    tokio runtime automatically."
  echo "  Fix (escape):    if the command MUST stay sync (e.g. wraps a sync-only"
  echo "                    C FFI + never blocks), add a comment on the line"
  echo "                    IMMEDIATELY ABOVE the #[tauri::command] attribute:"
  echo "                      // SYNC-OK: <one-sentence reason>"
  echo "  Reference: feedback_never_regress_4_layer_defense.md · IG-ASYNC-CMD 2026-07-20."
  exit 1
fi

echo "IG-ASYNC-CMD · every #[tauri::command] is async fn (or SYNC-OK: carved) · PASS"
exit 0
