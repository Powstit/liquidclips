#!/usr/bin/env bash
# IG-TSC-CLEAN · G1 · Type-check the whole app on every fast tier run
# so a bad type never sneaks into a runtime bundle.
#
# 2026-07-23 · added after post-mortem on false-alarm agent reports.
# tsc catches logic-level type mistakes that grep-based lint scripts
# can't see (renamed props, wrong shapes, missing exports).

set -euo pipefail
REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
DESKTOP2="$REPO_ROOT/desktop-2"

if ! command -v npx >/dev/null 2>&1; then
  echo "✗ IG-TSC-CLEAN · npx not found" >&2
  exit 2
fi

cd "$DESKTOP2"
OUT=$(npx tsc --noEmit 2>&1) || {
  echo "✗ IG-TSC-CLEAN · tsc failed" >&2
  echo "$OUT" | grep -E "error TS" | head -20 >&2
  exit 1
}

if echo "$OUT" | grep -q "error TS"; then
  echo "✗ IG-TSC-CLEAN · tsc reported errors" >&2
  echo "$OUT" | grep -E "error TS" | head -20 >&2
  exit 1
fi

echo "✓ IG-TSC-CLEAN · tsc --noEmit clean · 0 errors"
