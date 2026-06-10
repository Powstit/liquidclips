#!/usr/bin/env bash
# ship-gate.sh — mechanical ship gate.
# Reads desktop/docs/ship-lens-review.json (written by ship-lens-reviewer
# agent). Exits 0 if every P0/P1 finding has addressed: true AND verdict==PASS.
# Exits non-zero otherwise. Called by build/install/deploy before claiming done.

set -Eeuo pipefail

REVIEW="$(cd "$(dirname "$0")/.." && pwd)/docs/ship-lens-review.json"
C_OK=$'\033[32m'; C_ERR=$'\033[31m'; C_END=$'\033[0m'

# v0.7.45 — Phase 1: lens compliance sweep over fix(*) commits.
# Runs FIRST so a stale ship-lens-review.json can't gate it out. Sweeps the
# range since the most recent tag (the actual "what's new in this ship"
# delta); on first-ever ship falls back to 30 days.
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -n "$LAST_TAG" ]; then
  LENS_RANGE="${LAST_TAG}..HEAD"
else
  LENS_RANGE="--since=30.days"
fi
echo "→ user-journey-lens sweep over fix(*) commits ($LENS_RANGE)…"
LENS_MISSING=()
while IFS= read -r sha; do
  [ -z "$sha" ] && continue
  msg=$(git log -1 --format='%B' "$sha")
  for keyword in Enables Prevents Repairs; do
    if ! printf '%s\n' "$msg" | grep -qE "^${keyword}:"; then
      LENS_MISSING+=("$sha missing $keyword")
    fi
  done
done < <(git log --grep='^fix(' --format='%H' $LENS_RANGE 2>/dev/null)

if [ ${#LENS_MISSING[@]} -ne 0 ]; then
  echo "${C_ERR}✗${C_END} ship-gate FAILED — fix(*) commits without lens block:" >&2
  for line in "${LENS_MISSING[@]}"; do
    echo "  $line" >&2
  done
  echo "" >&2
  echo "  See ~/.claude/skills/user-journey-lens/SKILL.md → Enforcement." >&2
  exit 3
fi
echo "${C_OK}✓${C_END} user-journey-lens — every fix(*) commit declared Enables / Prevents / Repairs"
echo ""

# Phase 2: ship-lens-review.json gate (if present + fresh).
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

echo "${C_OK}✓${C_END} ship-lens-review verdict=$verdict, 0 unaddressed P0/P1"
echo ""
echo "${C_OK}✓${C_END} ship-gate green"
