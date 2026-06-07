#!/usr/bin/env bash
# check-humanError.sh — pre-commit gate.
#
# Forbids new occurrences of raw `String(e)` / `e.message` / `error.message`
# / `err.message` inside catch blocks in TS/TSX. The error-display policy at
# src/lib/sidecar.ts:1-13 requires every catch to pipe through humanError(e)
# so users never see "ModuleNotFoundError" or "[object Object]".
#
# Usage: bash desktop/scripts/check-humanError.sh
# Returns non-zero on any forbidden pattern in the staged diff.
#
# Install as a git hook:
#   ln -sf ../../desktop/scripts/check-humanError.sh .git/hooks/pre-commit

set -Eeuo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
C_OK=$'\033[32m'; C_ERR=$'\033[31m'; C_END=$'\033[0m'

# Only check staged changes in TS/TSX inside desktop/src
files=$(git -C "$REPO" diff --cached --name-only --diff-filter=ACM \
  -- 'desktop/src/**/*.ts' 'desktop/src/**/*.tsx' 'account-app/src/**/*.ts' 'account-app/src/**/*.tsx' \
  | grep -v _backups || true)

if [ -z "$files" ]; then
  echo "${C_OK}✓${C_END} humanError gate — no TS/TSX in staged diff"
  exit 0
fi

# Pattern: `String(e)` or `e.message` / `error.message` / `err.message` inside
# a setError* / setActionError / setBottomToast / setDropError call OR a toast template literal.
forbidden=$(echo "$files" | while read f; do
  [ -f "$REPO/$f" ] || continue
  # Match within ~3 lines after a catch (e) { — common pattern. Loose regex
  # that catches enough violations; the reviewer agent will catch any survivors.
  git -C "$REPO" diff --cached -- "$f" | awk '
    /^\+/ && /String\(e\)|String\(err\)|e\.message|err\.message|error\.message/ \
         && !/humanError|formatErrorForUI|ship-lens|\/\// {
      print FILENAME ": " $0
    }
  ' FILENAME="$f"
done)

if [ -n "$forbidden" ]; then
  echo "${C_ERR}✗${C_END} humanError gate — forbidden patterns in staged diff:" >&2
  echo "$forbidden" >&2
  echo "" >&2
  echo "Per src/lib/sidecar.ts ERROR-DISPLAY POLICY: wrap every catch in humanError(e)." >&2
  echo "If this is an intentional false-positive, prefix the line with '// allow-raw-error'." >&2
  exit 1
fi

echo "${C_OK}✓${C_END} humanError gate green"
