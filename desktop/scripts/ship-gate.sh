#!/usr/bin/env bash
# ship-gate.sh — mechanical ship gate.
# Reads desktop/docs/ship-lens-review.json (written by ship-lens-reviewer
# agent). Exits 0 if every P0/P1 finding has addressed: true AND verdict==PASS.
# Exits non-zero otherwise. Called by build/install/deploy before claiming done.

set -Eeuo pipefail

REVIEW="$(cd "$(dirname "$0")/.." && pwd)/docs/ship-lens-review.json"
C_OK=$'\033[32m'; C_ERR=$'\033[31m'; C_END=$'\033[0m'

if [ ! -f "$REVIEW" ]; then
  echo "${C_ERR}✗${C_END} ship-lens-review.json not found at $REVIEW" >&2
  echo "  The reviewer agent must run before ship. Aborting." >&2
  exit 2
fi

verdict=$(python3 -c "import json;print(json.load(open('$REVIEW')).get('verdict','UNKNOWN'))")
unaddressed=$(python3 -c "
import json
d = json.load(open('$REVIEW'))
print(sum(1 for f in d.get('findings', []) if f.get('severity') in ('P0','P1') and not f.get('addressed')))
")

if [ "$verdict" != "PASS" ] || [ "$unaddressed" -ne 0 ]; then
  echo "${C_ERR}✗${C_END} ship-gate FAILED — verdict=$verdict, unaddressed P0/P1=$unaddressed" >&2
  python3 -c "
import json
d = json.load(open('$REVIEW'))
for f in d.get('findings', []):
    if f.get('severity') in ('P0','P1') and not f.get('addressed'):
        print(f\"  [{f.get('severity')}-{f.get('id')}] {f.get('summary')} ({f.get('file')})\")
"
  exit 1
fi

echo "${C_OK}✓${C_END} ship-gate green — verdict=$verdict, 0 unaddressed P0/P1"
