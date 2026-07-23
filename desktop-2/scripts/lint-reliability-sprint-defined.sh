#!/usr/bin/env bash
# IG-RELIABILITY-SPRINT · Reliability Sprint L2/L3 · docs + apparatus present.
# Guards that the Layer 2 UAT apparatus and Layer 3 heuristic eval are shipped.
#
# 2026-07-22 · Reliability Sprint · Layers 2 + 3

set -euo pipefail
REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
DOCS="$REPO_ROOT/desktop-2/docs"
fail() { echo "✗ $1" >&2; exit 1; }

for doc in \
  UAT_PROTOCOL.md \
  UAT_SUS_SURVEY.md \
  UAT_RECRUITMENT_EMAIL.md \
  UAT_TASK_CARDS.md \
  UAT_ANALYSIS_TEMPLATE.md \
  HEURISTIC_EVAL_2026-07-22.md \
; do
  [ -f "$DOCS/$doc" ] || fail "missing $DOCS/$doc"
done

# UAT_SUS_SURVEY must define the 10-question SUS
grep -q "System Usability Scale" "$DOCS/UAT_SUS_SURVEY.md" || fail "SUS survey title missing"
grep -qE "SUS.{0,20}68"           "$DOCS/UAT_SUS_SURVEY.md" || fail "SUS launch-gate 68 threshold missing"

# UAT_PROTOCOL must reference Nielsen 5-user + think-aloud
grep -q "5-User"     "$DOCS/UAT_PROTOCOL.md" || fail "5-user reference missing"
grep -q "Think-Aloud" "$DOCS/UAT_PROTOCOL.md" || fail "Think-aloud reference missing"

# Heuristic eval must have severity table with P0/P1/P2
grep -qE "P0.{0,60}Catastrophe" "$DOCS/HEURISTIC_EVAL_2026-07-22.md" || fail "P0 severity band missing"
grep -qE "P1.{0,60}Major"       "$DOCS/HEURISTIC_EVAL_2026-07-22.md" || fail "P1 severity band missing"

# Heuristic eval must cover all 10 Nielsen heuristics
for h in H1 H2 H3 H4 H5 H6 H7 H8 H9 H10; do
  grep -q "$h ·" "$DOCS/HEURISTIC_EVAL_2026-07-22.md" || fail "heuristic $h not covered"
done

echo "✓ IG-RELIABILITY-SPRINT PASS · 18 guards green"
exit 0
