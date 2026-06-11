#!/usr/bin/env bash
# IRON GATE IG-012 — brand kit drift detector.
#
# Pre-commit chain that ensures the canonical brand tokens in
# src/index.css match the mirrors in docs/demo*.html. Refuses any commit
# that changes a token in one file without updating all the others.
#
# Run from desktop/ root. Exit 0 = no drift; exit 1 = drift detected.

set -euo pipefail

CANONICAL="src/index.css"
MIRRORS=(
  "docs/demo-pages.html"
  "docs/demo.html"
  "docs/demo-thumbnail.html"
)

# Canonical brand hex values. Bumping these MUST be paired with a bump in
# every mirror — that's the contract IG-012 enforces. Each entry is a
# friendly name + the hex value that must appear inside the IG-012
# sentinel range in every mirror file.
declare -a CANONICAL_HEXES=(
  "fuchsia:#ff1a8c"
  "fuchsia-bright:#ff3da5"
  "fuchsia-deep:#ff66b8"
  "paper:#0b0b10"
  "paper-warm:#15151c"
  "paper-elev:#1c1c25"
  "ink:#f4f1ea"
  "ink-soft:#c8c4be"
)

DRIFT=0

# Sanity — canonical file must contain every hex (catches accidental
# token drift on the canonical side too).
for entry in "${CANONICAL_HEXES[@]}"; do
  name="${entry%%:*}"
  hex="${entry##*:}"
  if ! grep -F -q "$hex" "$CANONICAL"; then
    echo "  [DRIFT] $name=$hex missing from CANONICAL $CANONICAL"
    DRIFT=1
  fi
done

# Each mirror must contain every canonical hex inside its IG-012 range.
for mirror in "${MIRRORS[@]}"; do
  if [[ ! -f "$mirror" ]]; then
    echo "  [skip ] $mirror — file not present"
    continue
  fi
  # Extract just the IG-012 sentinel range, then check each canonical hex.
  range=$(awk '/IRON GATE IG-012/,/END IRON GATE IG-012/' "$mirror")
  if [[ -z "$range" ]]; then
    echo "  [DRIFT] $mirror — no IG-012 sentinel range found"
    DRIFT=1
    continue
  fi
  for entry in "${CANONICAL_HEXES[@]}"; do
    name="${entry%%:*}"
    hex="${entry##*:}"
    if ! echo "$range" | grep -F -q "$hex"; then
      echo "  [DRIFT] $name=$hex not in $mirror IG-012 range"
      DRIFT=1
    fi
  done
done

if [[ $DRIFT -ne 0 ]]; then
  echo ""
  echo "[31m✗[0m IG-012 brand-kit drift detected. Canonical tokens in"
  echo "   $CANONICAL don't match all mirrors. Update the mirror(s)"
  echo "   within their IRON GATE IG-012 sentinel range so the values"
  echo "   match — or bypass with LENS_OVERRIDE=1 if intentionally"
  echo "   retiring the gate."
  exit 1
fi

echo "[32m✓[0m IG-012 brand-kit drift check green"
exit 0
