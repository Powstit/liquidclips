#!/usr/bin/env bash
# Wire git to the tracked .githooks/ directory so the user-journey-lens
# commit-msg gate fires for every contributor + every fresh clone.
#
# Run once per clone:    bash desktop/scripts/setup-hooks.sh
#
# The hooksPath config is per-clone (NOT tracked by git), so this is the
# canonical "did you set the config" check + auto-fix.

set -euo pipefail
cd "$(dirname "$0")/../.."

EXPECTED=".githooks"
CURRENT=$(git config --get core.hooksPath 2>/dev/null || echo "")

if [ "$CURRENT" = "$EXPECTED" ]; then
  echo "✓ core.hooksPath already wired to $EXPECTED — gate is armed."
  exit 0
fi

git config core.hooksPath "$EXPECTED"
echo "✓ core.hooksPath set to $EXPECTED (was: ${CURRENT:-<unset, defaulted to .git/hooks>})"

# Quick smoke — confirm the hook scripts exist + are executable.
for HOOK in commit-msg pre-commit; do
  if [ -x "$EXPECTED/$HOOK" ]; then
    echo "  ✓ $EXPECTED/$HOOK is executable"
  else
    echo "  ✗ $EXPECTED/$HOOK missing or not +x — gate is HALF-armed" >&2
    exit 1
  fi
done

echo ""
echo "Gate armed. Every fix(*) commit must now include Enables / Prevents / Repairs lines."
