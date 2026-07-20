#!/usr/bin/env bash
# IG-AUTH-KEYCHAIN · Layer 2 · No direct secret_{get,set,delete}_jwt invoke
# outside the approved single broker at src/lib/authStorage.ts.
# LOCKED 2026-07-20.
#
# What this locks: every credential read/write MUST route through
# authStorage.ts because that broker enforces:
#   - kill-switch honoring (lc:disable-keychain.v1)
#   - transactional presence-file order
#   - single boot-reconcile path
#   - consistent logout state
# A rogue component that invokes secret_set_jwt directly bypasses all
# of the above and reintroduces the keychain-prompt-loop that the kill
# switch was invented to stop.
#
# Explicitly ALLOWED without the broker:
#   - invoke("secret_presence_get")  — non-prompt read of a boolean file
#
# Sentinel escape (same line or line above):
#   // AUTH-BROKER-OK: <one-sentence reason>
#
# 5-layer defense per feedback_never_regress_4_layer_defense.md.
# Wired into .githooks/pre-commit. Also runnable standalone.

set -uo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
SRC_DIR="${LINT_AUTH_BROKER_SCAN_DIR:-$REPO_ROOT/desktop-2/src}"

if [ ! -d "$SRC_DIR" ]; then
  exit 0
fi

BROKER_PATH="lib/authStorage.ts"
SENTINEL="AUTH-BROKER-OK:"

# Find every .ts/.tsx file that invokes secret_{get,set,delete}_jwt
# via any function whose name ends in `invoke`. Use grep -n to get
# line numbers, then check the sentinel-adjacency in awk.
raw=$(cd "$SRC_DIR" && \
  find . -type f \( -name '*.ts' -o -name '*.tsx' \) \
    -not -path '*/node_modules/*' \
    -not -path '*/dist/*' \
    -not -path '*/build/*' \
    -not -name '*.test.ts' \
    -not -name '*.test.tsx' \
    -print0 | \
  xargs -0 grep -HnE 'invoke[A-Za-z]*[[:space:]]*(<[^(]*>)?[[:space:]]*\([[:space:]]*"secret_(get|set|delete)_jwt"' 2>/dev/null | \
  sed 's|^\./||')

if [ -z "$raw" ]; then
  echo "IG-AUTH-KEYCHAIN · no direct credential invoke outside authStorage.ts · PASS"
  exit 0
fi

# Filter: allow the broker file · honour AUTH-BROKER-OK sentinel on
# same line or line above.
offenders=""
while IFS= read -r hit; do
  rel="${hit%%:*}"
  # rest = "line_no: content"
  rest="${hit#*:}"
  lno="${rest%%:*}"
  content="${rest#*:}"
  # Skip broker file
  case "$rel" in
    "$BROKER_PATH"|*"/$BROKER_PATH") continue ;;
  esac
  # Check sentinel on the same line
  case "$content" in
    *"$SENTINEL"*) continue ;;
  esac
  # Check sentinel on line above
  prev_lno=$((lno - 1))
  if [ "$prev_lno" -ge 1 ]; then
    prev_line=$(sed -n "${prev_lno}p" "$SRC_DIR/$rel" 2>/dev/null)
    case "$prev_line" in
      *"$SENTINEL"*) continue ;;
    esac
  fi
  offenders="${offenders}${rel}:${lno}: ${content}
"
done <<< "$raw"

if [ -n "$offenders" ]; then
  echo "IG-AUTH-KEYCHAIN FAIL · direct credential invoke outside authStorage.ts"
  echo ""
  printf '%s' "$offenders"
  echo ""
  echo "  Every credential read/write MUST use the authStorage.ts broker."
  echo "  Diagnostics that need the presence Record can use"
  echo '  invoke("secret_presence_get") directly (non-prompt, no Keychain).'
  echo ""
  echo "  Exceptional site override (same line or line above):"
  echo "    // AUTH-BROKER-OK: <one-sentence reason>"
  echo ""
  echo "  Reference: feedback_never_regress_4_layer_defense.md · IG-AUTH-KEYCHAIN 2026-07-20"
  exit 1
fi

echo "IG-AUTH-KEYCHAIN · no direct credential invoke outside authStorage.ts · PASS"
exit 0
