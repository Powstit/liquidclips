#!/usr/bin/env bash
# IG-BARE-URL-IS-SOURCE · 2026-07-23
# A bare URL pasted into the command bar MUST be treated as a SOURCE
# (acceptSource), never routed through intent classification.

set -euo pipefail
REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
BRAIN="$REPO_ROOT/desktop-2/src/design-os/routes/useComposerBrain.ts"
TEST="$REPO_ROOT/desktop-2/src/design-os/routes/useComposerBrain.bareUrl.test.ts"
fail() { echo "✗ $1" >&2; exit 1; }

[ -f "$BRAIN" ] || fail "missing $BRAIN"
[ -f "$TEST" ]  || fail "missing $TEST"

grep -q "IG-BARE-URL-IS-SOURCE" "$BRAIN" || fail "sentinel missing in useComposerBrain.ts"
grep -qF "/^https?:" "$BRAIN" || fail "URL regex missing in guard"
grep -qF "acceptSource({ url: cmd })" "$BRAIN" || fail "acceptSource call missing in guard"
grep -q "composer_brain_command_url_direct" "$BRAIN" || fail "diagnostic emit missing"

# Test file must reference the sentinel too
grep -q "IG-BARE-URL-IS-SOURCE" "$TEST" || fail "sentinel missing in test"
grep -q "acceptSource" "$TEST"          || fail "test doesn't verify acceptSource"

echo "✓ IG-BARE-URL-IS-SOURCE PASS · 6 guards green"
exit 0
