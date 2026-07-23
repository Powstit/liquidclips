#!/usr/bin/env bash
# IG-COCKPIT-COMING-SOON-GUARD · Reliability Sprint L3 (H0-02) · 2026-07-22
# Guards that the record source picker's click handler ignores coming-soon
# tiles at the RUNTIME layer (not just CSS pointer-events).

set -euo pipefail
REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
MOCKUP="$REPO_ROOT/desktop-2/public/mockup/composer-suite.html"
fail() { echo "✗ $1" >&2; exit 1; }

[ -f "$MOCKUP" ] || fail "missing $MOCKUP"

grep -q "IG-COCKPIT-COMING-SOON-GUARD" "$MOCKUP" || fail "sentinel missing in composer-suite.html"

# The click handler MUST early-return when data-status === 'coming-soon'
grep -qE 'data-status.{0,30}coming-soon' "$MOCKUP" || fail "coming-soon data-status attribute missing"
grep -qE 'getAttribute\("data-status"\)\s*===\s*"coming-soon"' "$MOCKUP" \
  || fail "runtime guard missing · handler must early-return on coming-soon"
grep -q "record.source" "$MOCKUP" || fail "record.source emit missing"

# Each coming-soon tile MUST carry the badge + tooltip
count=$(grep -c 'param-src-coming-soon-badge' "$MOCKUP")
[ "$count" -ge 4 ] || fail "expected ≥4 coming-soon badges, found $count"

echo "✓ IG-COCKPIT-COMING-SOON-GUARD PASS · 5 guards green"
exit 0
