#!/bin/bash
# verify-receipt.sh <task-slug>
# ------------------------------------------------------------------
# Validates the proof artifacts for a completed reliability-sprint task.
# Reads 08_receipts/<slug>/PROOF.md and checks every asserted artifact.
#
# Exit codes:
#   0 · all assertions pass
#   1 · any assertion fails
#   2 · usage error or missing input
#
# Assertion syntax in PROOF.md (one per line under `## artifacts`):
#   - <filename> · assert: "<expected substring>"
#   - <filename> · assert: exists
#   - <filename> · assert: size > <bytes>
#
# Written by claude-2 · 2026-07-04 · v1.0
# Do NOT modify without a Section A/B task explicitly authorising it.
# ------------------------------------------------------------------

set -uo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: bash scripts/verify-receipt.sh <task-slug>"
  exit 2
fi

SLUG="$1"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RECEIPT_DIR="$REPO_ROOT/08_receipts/$SLUG"
PROOF_FILE="$RECEIPT_DIR/PROOF.md"

echo "──────────────────────────────────────────────────────"
echo "verify-receipt · task=$SLUG"
echo "receipts dir : $RECEIPT_DIR"
echo "──────────────────────────────────────────────────────"

if [ ! -d "$RECEIPT_DIR" ]; then
  echo "❌ FAIL: receipt folder does not exist: $RECEIPT_DIR"
  exit 1
fi

if [ ! -f "$PROOF_FILE" ]; then
  echo "❌ FAIL: PROOF.md missing at $PROOF_FILE"
  exit 1
fi

echo ""
echo "PROOF.md contents:"
echo "---"
cat "$PROOF_FILE"
echo "---"
echo ""

PASS=0
FAIL=0

# Parse each `- <filename> · assert: <assertion>` line
while IFS= read -r line; do
  # Skip lines that aren't artifact assertions
  if [[ ! "$line" =~ ^-[[:space:]]+(.+)[[:space:]]·[[:space:]]assert:[[:space:]]+(.+)$ ]]; then
    continue
  fi

  FILENAME="${BASH_REMATCH[1]}"
  ASSERT="${BASH_REMATCH[2]}"
  # Trim surrounding whitespace
  FILENAME="${FILENAME## }"; FILENAME="${FILENAME%% }"
  ASSERT="${ASSERT## }";     ASSERT="${ASSERT%% }"

  FILE_PATH="$RECEIPT_DIR/$FILENAME"

  if [ ! -f "$FILE_PATH" ]; then
    echo "❌ FAIL · $FILENAME missing"
    FAIL=$((FAIL + 1))
    continue
  fi

  # Assertion dispatch
  if [[ "$ASSERT" == "exists" ]]; then
    ACTUAL_SIZE=$(wc -c < "$FILE_PATH" | tr -d ' ')
    if [ "$ACTUAL_SIZE" -gt 0 ]; then
      echo "✓ PASS · $FILENAME exists (size=$ACTUAL_SIZE)"
      PASS=$((PASS + 1))
    else
      echo "❌ FAIL · $FILENAME exists but is empty"
      FAIL=$((FAIL + 1))
    fi

  elif [[ "$ASSERT" =~ ^size[[:space:]]*\>[[:space:]]*([0-9]+)$ ]]; then
    MIN_SIZE="${BASH_REMATCH[1]}"
    ACTUAL_SIZE=$(wc -c < "$FILE_PATH" | tr -d ' ')
    if [ "$ACTUAL_SIZE" -gt "$MIN_SIZE" ]; then
      echo "✓ PASS · $FILENAME size $ACTUAL_SIZE > $MIN_SIZE"
      PASS=$((PASS + 1))
    else
      echo "❌ FAIL · $FILENAME size $ACTUAL_SIZE not > $MIN_SIZE"
      FAIL=$((FAIL + 1))
    fi

  else
    # Substring assertion — strip surrounding double-quotes if present
    EXPECTED="${ASSERT#\"}"
    EXPECTED="${EXPECTED%\"}"

    if grep -qF "$EXPECTED" "$FILE_PATH"; then
      echo "✓ PASS · $FILENAME contains \"$EXPECTED\""
      PASS=$((PASS + 1))
    else
      echo "❌ FAIL · $FILENAME does NOT contain \"$EXPECTED\""
      FAIL=$((FAIL + 1))
    fi
  fi
done < "$PROOF_FILE"

echo ""
echo "──────────────────────────────────────────────────────"
echo "Result: $PASS passed · $FAIL failed"
echo "──────────────────────────────────────────────────────"

if [ "$FAIL" -eq 0 ] && [ "$PASS" -gt 0 ]; then
  echo "✓ ALL CHECKS PASSED"
  exit 0
elif [ "$PASS" -eq 0 ] && [ "$FAIL" -eq 0 ]; then
  echo "❌ VERIFY FAILED · no assertions found in PROOF.md"
  exit 1
else
  echo "❌ VERIFY FAILED"
  exit 1
fi
