#!/usr/bin/env bash
# IRON GATE IG-012 — brand kit drift detector (desktop-2 port).
#
# Lightweight invariant: every canonical brand hex defined in desktop-2's
# src/index.css MUST also exist in the marketing site's globals.css and in
# the splash-game design-lock demo (docs/splash-game-demo.html). Refuses
# any commit that drifts a brand token in one file without updating the
# others.
#
# Ported 2026-06-23 from /Users/dipdip/code/jnr/desktop/scripts/brand-kit-drift-check.sh
# (the stale desktop/ original) with paths adapted to desktop-2/ as the
# canonical source. See brand-kit registry at
# ~/.claude/skills/liquid-clips-brand-kit/BRAND_ASSETS.md §0.
#
# Run from desktop-2/ root.
# Exit 0 = no drift. Exit 1 = drift detected.

set -euo pipefail

CANONICAL="src/brand/brandTheme.css"
MIRRORS=(
  "../liquidclips-marketing/src/app/globals.css"
)

# Canonical brand hex values. Bumping these MUST be paired with a bump in
# every mirror — that's the contract IG-012 enforces.
declare -a CANONICAL_HEXES=(
  "fuchsia:#ff1a8c"
  "fuchsia-bright:#ff3da5"
  "fuchsia-deep:#ff66b8"
  "cyan:#00e5ff"
  "paper:#0b0b10"
  "paper-warm:#15151c"
  "paper-elev:#1c1c25"
  "ink:#f4f1ea"
  "ink-soft:#c8c4be"
)

DRIFT=0

# Sanity — canonical file must contain every hex (catches accidental
# token drift on the canonical side too). Case-insensitive so #FF1A8C
# and #ff1a8c both match.
if [[ ! -f "$CANONICAL" ]]; then
  echo "  [DRIFT] CANONICAL $CANONICAL does not exist"
  exit 1
fi

for entry in "${CANONICAL_HEXES[@]}"; do
  name="${entry%%:*}"
  hex="${entry##*:}"
  if ! grep -i -F -q "$hex" "$CANONICAL"; then
    echo "  [DRIFT] $name=$hex missing from CANONICAL $CANONICAL"
    DRIFT=1
  fi
done

# Each mirror must contain every canonical hex (case-insensitive). A
# missing mirror file is a `[skip ]` not a drift — keeps the gate green
# on shallow checkouts that don't have the marketing repo alongside.
for mirror in "${MIRRORS[@]}"; do
  if [[ ! -f "$mirror" ]]; then
    echo "  [skip ] $mirror — file not present"
    continue
  fi
  for entry in "${CANONICAL_HEXES[@]}"; do
    name="${entry%%:*}"
    hex="${entry##*:}"
    if ! grep -i -F -q "$hex" "$mirror"; then
      echo "  [DRIFT] $name=$hex not in $mirror"
      DRIFT=1
    fi
  done
done

if [[ $DRIFT -ne 0 ]]; then
  echo ""
  echo "✗ IG-012 brand-kit drift detected. Canonical tokens in"
  echo "  $CANONICAL don't match all mirrors. Update the mirror(s) so the"
  echo "  values match — or bypass with LENS_OVERRIDE=1 if intentionally"
  echo "  retiring the gate."
  exit 1
fi

echo "✓ IG-012 brand-kit drift check green"
exit 0
