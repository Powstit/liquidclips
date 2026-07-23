#!/usr/bin/env bash
# Post-Dispatch Sweep · G2 · 2026-07-23
#
# Run this AFTER all parallel agents commit + push. Verifies the REAL
# post-merge state on HEAD instead of trusting individual agent reports
# (which may have snapshotted transient working-tree state).
#
# Sequence:
#   1. Pull latest from origin (fast-forward only · never merge here)
#   2. tsc --noEmit on HEAD
#   3. iron-gates.sh fast (includes G1 tsc gate + all 40+ lint scripts)
#   4. vitest run (all suites)
#   5. Emit a compact green/red table so the operator can trust HEAD
#
# NEVER pushes. NEVER merges. Read-only verification.
#
# 2026-07-23 · added after false-alarm root cause (see /docs/HEURISTIC_EVAL)

set -euo pipefail
REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
DESKTOP2="$REPO_ROOT/desktop-2"

if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_ERR=$'\033[31m'; C_DIM=$'\033[2m'; C_END=$'\033[0m'
else
  C_OK=""; C_ERR=""; C_DIM=""; C_END=""
fi

pass() { echo "${C_OK}✓${C_END} $*"; }
fail() { echo "${C_ERR}✗${C_END} $*"; }
step() { echo ""; echo "→ $*"; }

RC=0

step "1/4 · Sync with origin (fast-forward only)"
cd "$REPO_ROOT"
BRANCH=$(git branch --show-current)
if [ -z "$BRANCH" ]; then
  fail "detached HEAD · aborting sweep"
  exit 2
fi
git fetch origin "$BRANCH" --quiet
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo "$LOCAL")
if [ "$LOCAL" = "$REMOTE" ]; then
  pass "up-to-date · HEAD $LOCAL"
elif git merge-base --is-ancestor HEAD "origin/$BRANCH"; then
  echo "  fast-forwarding local to origin"
  git merge --ff-only "origin/$BRANCH" >/dev/null 2>&1 || { fail "fast-forward failed"; exit 2; }
  pass "fast-forwarded to $(git rev-parse HEAD)"
else
  fail "local and origin diverged · fix branch state before running sweep"
  exit 2
fi

step "2/4 · tsc --noEmit (types clean on HEAD)"
cd "$DESKTOP2"
if npx tsc --noEmit 2>&1 | tee /tmp/sweep-tsc.log | grep -q "error TS"; then
  fail "tsc errors on HEAD · see /tmp/sweep-tsc.log"
  RC=1
else
  pass "tsc clean · 0 errors"
fi

step "3/4 · iron-gates.sh fast"
if bash "$DESKTOP2/scripts/iron-gates.sh" fast > /tmp/sweep-gates.log 2>&1; then
  GATE_COUNT=$(grep -c "^✓ IG-" /tmp/sweep-gates.log || echo 0)
  pass "iron-gates fast tier PASS · ${GATE_COUNT} gates green"
else
  fail "iron-gates fast tier FAILED · see /tmp/sweep-gates.log"
  RC=1
fi

step "4/4 · vitest run (all suites)"
if npx vitest run --reporter=default > /tmp/sweep-vitest.log 2>&1; then
  PASSED=$(grep -oE "Tests +[0-9]+ passed" /tmp/sweep-vitest.log | tail -1 | awk '{print $2}' || echo "?")
  pass "vitest PASS · $PASSED tests green"
else
  FAILED=$(grep -oE "[0-9]+ failed" /tmp/sweep-vitest.log | tail -1 | awk '{print $1}' || echo "?")
  fail "vitest FAILED · $FAILED tests failing · see /tmp/sweep-vitest.log"
  RC=1
fi

echo ""
if [ "$RC" = "0" ]; then
  pass "SWEEP GREEN · HEAD $(git rev-parse HEAD) is safe to ship"
else
  fail "SWEEP RED · HEAD is NOT safe to ship · resolve failures above"
fi

exit $RC
