#!/usr/bin/env bash
#
# LCOS dispatch guard · pre-parallel-dispatch invariant check.
#
# Locked by BC-006 (12_BUG_CLASSES.md · shared-worktree state bleed under
# parallel isolation:worktree agents).
#
# Verifies BEFORE any parallel Agent() call with isolation:worktree:
#   1. Main repo is on the expected integration branch
#   2. Working tree has zero modified tracked files
#   3. No stale merge-in-progress marker
#
# Exits 0 · safe to dispatch
# Exits 1 · unsafe · integration lead must reset before dispatch
#
# Usage:
#   lcos/scripts/dispatch-guard.sh
#   LCOS_INTEGRATION_BRANCH=integration/other-branch lcos/scripts/dispatch-guard.sh
#
set -euo pipefail

REPO="${LCOS_REPO:-/Users/dipdip/code/jnr}"
EXPECTED="${LCOS_INTEGRATION_BRANCH:-integration/cold-entry-mode-b}"

cd "$REPO"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "$EXPECTED" ]; then
  echo "DISPATCH GUARD FAIL · main repo on '$BRANCH' · expected '$EXPECTED'"
  echo "Reset with:"
  echo "  git -C $REPO checkout -- .   # discard any modified tracked files"
  echo "  git -C $REPO checkout $EXPECTED"
  exit 1
fi

DIRTY=$(git status --porcelain | grep -v '^??' || true)
if [ -n "$DIRTY" ]; then
  echo "DISPATCH GUARD FAIL · tracked files modified in main repo:"
  echo "$DIRTY" | head -10
  echo "Reset with:"
  echo "  git -C $REPO checkout -- ."
  exit 1
fi

if [ -f "$REPO/.git/MERGE_HEAD" ] || [ -f "$REPO/.git/CHERRY_PICK_HEAD" ]; then
  echo "DISPATCH GUARD FAIL · unresolved merge or cherry-pick in progress"
  exit 1
fi

HEAD_SHA=$(git rev-parse HEAD)
echo "DISPATCH GUARD PASS · on $BRANCH @ $HEAD_SHA · working tree clean"
exit 0
