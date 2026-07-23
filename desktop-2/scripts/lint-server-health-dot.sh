#!/usr/bin/env bash
# IG-SERVER-HEALTH-DOT · Reliability Sprint L3 (H0-03) · 2026-07-22
# Guards the persistent backend health indicator in TopHud.
set -euo pipefail
REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
COMP="$REPO_ROOT/desktop-2/src/design-os/components/ServerHealthDot.tsx"
TEST="$REPO_ROOT/desktop-2/src/design-os/components/ServerHealthDot.test.tsx"
HUD="$REPO_ROOT/desktop-2/src/design-os/components/TopHud.tsx"
fail() { echo "✗ $1" >&2; exit 1; }

for f in "$COMP" "$TEST" "$HUD"; do
  [ -f "$f" ] || fail "missing $f"
done

grep -q "IG-SERVER-HEALTH-DOT" "$COMP" || fail "sentinel missing"
grep -q "/healthcheck"         "$COMP" || fail "healthcheck endpoint reference missing"
grep -q "AbortController"      "$COMP" || fail "AbortController timeout missing"
grep -q "data-testid=\"server-health-dot\"" "$COMP" || fail "e2e testid missing"
grep -q "window.location.hash = \"#/diagnostics\"" "$COMP" || fail "click nav to diagnostics missing"

# TopHud must mount the dot
grep -q "import { ServerHealthDot }" "$HUD" || fail "TopHud missing ServerHealthDot import"
grep -q "<ServerHealthDot" "$HUD"           || fail "TopHud missing ServerHealthDot mount"

echo "✓ IG-SERVER-HEALTH-DOT PASS · 7 guards green"
exit 0
