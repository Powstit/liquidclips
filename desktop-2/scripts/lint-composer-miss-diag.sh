#!/usr/bin/env bash
# IG-COMPOSER-MISS-DIAG · Composer miss telemetry visibility · LOCKED 2026-07-19
#
# Regression this locks: Composer.tsx's `feature_failed` /
# `capability_route_miss` emit used to ship with NO indication of what
# the user typed. Admin HQ's /admin/bugs surfaced 22 miss events in one
# morning with `message: null` — total black box.
#
# The 4-layer defense per feedback_never_regress_4_layer_defense.md:
#   Layer 1 · IRON GATE IG-COMPOSER-MISS-DIAG sentinel in Composer.tsx
#   Layer 2 · this grep-guard (blocks removal of query_text from the payload)
#   Layer 3 · vitest at router.placeholderCommands.test.ts
#   Layer 4 · runtime — Composer telemetry.emit now carries metadata.query_text
#
# Wired into .githooks/pre-commit alongside the other IG guards.

set -uo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
COMPOSER="$REPO_ROOT/desktop-2/src/design-os/routes/Composer.tsx"
CAPS="$REPO_ROOT/desktop-2/src/design-os/engine/composer/capabilities.ts"

fail=0

check_present() {
  local file="$1" pattern="$2" reason="$3"
  if [ ! -f "$file" ]; then
    echo "IG-COMPOSER-MISS-DIAG FAIL · missing file: $file · $reason"; fail=1; return
  fi
  if ! grep -qE "$pattern" "$file"; then
    echo "IG-COMPOSER-MISS-DIAG FAIL · pattern missing in $file"
    echo "  Expected: $pattern"
    echo "  Reason:   $reason"
    fail=1
  fi
}

check_absent() {
  local file="$1" pattern="$2" reason="$3"
  # Strip comment-only + backtick-only lines so a "do not reintroduce X"
  # docstring doesn't trip its own guard.
  if [ -f "$file" ] && grep -vE '^\s*(//|\*|/\*)|`' "$file" | grep -qE "$pattern"; then
    echo "IG-COMPOSER-MISS-DIAG FAIL · forbidden pattern in $file"
    echo "  Forbidden: $pattern"
    echo "  Reason:    $reason"
    fail=1
  fi
}

# Layer 1a · sentinel comment
check_present "$COMPOSER" 'IRON GATE IG-COMPOSER-MISS-DIAG' \
  "sentinel marks the miss-diag block as regression-locked"

# Layer 4a · queryPreview computed from the trimmed text
check_present "$COMPOSER" 'const queryPreview = text\.slice\(0,\s*60\)' \
  "queryPreview must be computed as the 60-char text preview"

# Layer 4b · metadata.query_text passed to telemetry.emit
check_present "$COMPOSER" 'metadata:\s*\{\s*query_text:\s*queryPreview' \
  "telemetry.emit MUST pass metadata.query_text · without it the miss is a black box"

# Layer 4c · stable_error_code preserved (the string admin/bugs groups by)
check_present "$COMPOSER" 'stable_error_code:\s*"capability_route_miss"' \
  "stable_error_code must stay 'capability_route_miss' · admin/bugs groups by this key"

# ─── frame.hook must NOT claim aspect intents ────────────────────────
# The bug: /\\b9:16\\b/i inside frame.hook.intents made "9:16" resolve
# to frame.hook (execute frame flow) instead of canvas.set-aspect.
# capabilities.ts contains a comment describing the intent (that mention
# is allowed); a LIVE regex clause matching 9:16 is not.
if [ -f "$CAPS" ]; then
  # Extract only the frame.hook intents array body and check.
  BLOCK=$(/usr/bin/python3 <<PY
import re
src = open("$CAPS").read()
m = re.search(r'"frame\.hook":.*?intents:\s*\[(.*?)\]', src, re.S)
print(m.group(1) if m else "")
PY
)
  if echo "$BLOCK" | grep -qE '/\\?b?9:16\\?b?/'; then
    echo "IG-COMPOSER-MISS-DIAG FAIL · frame.hook.intents contains a 9:16 clause"
    echo "  Reason:  '9:16' must resolve to canvas.set-aspect · frame.hook stole it pre-2026-07-19 fix"
    fail=1
  fi
fi

if [ "$fail" -eq 0 ]; then
  echo "IG-COMPOSER-MISS-DIAG · Composer miss visibility guard · PASS"
  exit 0
fi

echo ""
echo "See:"
echo "  - desktop-2/src/design-os/routes/Composer.tsx (IG-COMPOSER-MISS-DIAG)"
echo "  - desktop-2/src/design-os/engine/composer/capabilities.ts (frame.hook block)"
echo "  - desktop-2/src/design-os/engine/composer/router.placeholderCommands.test.ts"
exit 1
