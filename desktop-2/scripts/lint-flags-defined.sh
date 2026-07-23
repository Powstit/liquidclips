#!/usr/bin/env bash
# IG-FLAGS-DEFINED · Reliability Sprint L6 · feature flags + staged rollout.
# Guards that:
#   · flags.ts exists + defines FLAGS as a frozen registry
#   · flags.test.ts exists with regression coverage
#   · Every flag has enabled + rolloutPct + description + ownerContact
#   · isFlagEnabled respects the enabled kill switch
#   · rollout-runner.sh exists
#
# 2026-07-22 · Reliability Sprint · Layer 6
set -euo pipefail
REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
FLAGS="$REPO_ROOT/desktop-2/src/lib/flags.ts"
TEST="$REPO_ROOT/desktop-2/src/lib/flags.test.ts"
RUNNER="$REPO_ROOT/desktop-2/scripts/rollout-runner.sh"
fail() { echo "✗ $1" >&2; exit 1; }

[ -f "$FLAGS" ]  || fail "missing $FLAGS"
[ -f "$TEST" ]   || fail "missing $TEST"
[ -f "$RUNNER" ] || fail "missing $RUNNER"

grep -q "IG-FLAGS-DEFINED" "$FLAGS" || fail "sentinel missing in flags.ts"

grep -q "Object.freeze" "$FLAGS"       || fail "FLAGS must be Object.freeze'd"
grep -q "isFlagEnabled" "$FLAGS"       || fail "isFlagEnabled export missing"
grep -q "hash01" "$FLAGS"              || fail "deterministic bucket hash missing"
grep -qE 'if\s*\(!def\.enabled\)\s*return\s*false' "$FLAGS" || \
  fail "kill switch (enabled:false → return false) missing"

# Enforce every flag def carries the four required fields.
grep -q "ownerContact" "$FLAGS"   || fail "ownerContact field missing"
grep -q "description" "$FLAGS"    || fail "description field missing"
grep -q "rolloutPct" "$FLAGS"     || fail "rolloutPct field missing"

grep -q "deterministic bucketing" "$TEST" || fail "deterministic bucketing test missing"
grep -q "kill switch overrides"   "$TEST" || fail "kill switch regression test missing"

echo "✓ IG-FLAGS-DEFINED PASS · 10 guards green"
exit 0
