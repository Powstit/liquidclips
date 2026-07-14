#!/usr/bin/env bash
# promote-bundle.sh · Block 4 · 2026-07-11
#
# The ONE and ONLY sanctioned way to flip runtime/current.json.
# Refuses to promote if smoke-gate.sh fails (exit != 0). Copies the
# built dist/ into ~/Library/Application Support/Liquid Clips/runtime/
# bundles/<version>/, computes sha256 of index.html, writes a fresh
# current.json.
#
# Usage:
#   ./promote-bundle.sh <version-tag>
# Example:
#   ./promote-bundle.sh 2.2.36-block-3-verified
#
# Environment overrides:
#   BUNDLE_ROOT   default ~/Library/Application Support/Liquid Clips/runtime
#   DIST_DIR      default desktop-2/dist  (resolved relative to script)
#   SKIP_GATE=1   emergency override — never in prod without a reason

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DESKTOP_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
DIST_DIR="${DIST_DIR:-$DESKTOP_ROOT/dist}"
BUNDLE_ROOT="${BUNDLE_ROOT:-$HOME/Library/Application Support/Liquid Clips/runtime}"

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "usage: promote-bundle.sh <version-tag>"
  echo "e.g.:  promote-bundle.sh 2.2.36-block-3-verified"
  exit 2
fi

echo "════════════════════════════════════════════════════════════"
echo "  Liquid Clips · promote-bundle → $VERSION"
echo "════════════════════════════════════════════════════════════"
echo "dist:        $DIST_DIR"
echo "bundle root: $BUNDLE_ROOT"
echo ""

if [ "${SKIP_GATE:-0}" != "1" ]; then
  echo "── Running smoke gate…"
  if ! "$SCRIPT_DIR/smoke-gate.sh"; then
    echo ""
    echo "════════════════════════════════════════════════════════════"
    echo "  PROMOTION REFUSED · smoke gate failed"
    echo "  current.json unchanged."
    echo "════════════════════════════════════════════════════════════"
    exit 1
  fi
else
  echo "!!  SKIP_GATE=1 set · skipping smoke gate. Do not do this."
fi

TARGET_DIR="$BUNDLE_ROOT/bundles/$VERSION"
echo ""
echo "── Staging bundle at $TARGET_DIR"
mkdir -p "$TARGET_DIR"
rsync -a --delete "$DIST_DIR/" "$TARGET_DIR/"

FILE_COUNT=$(find "$TARGET_DIR" -type f | wc -l | tr -d ' ')
SHA=$(shasum -a 256 "$TARGET_DIR/index.html" | awk '{print $1}')
echo "  file_count=$FILE_COUNT"
echo "  index.html sha256=$SHA"

CURRENT="$BUNDLE_ROOT/current.json"
BACKUP="$BUNDLE_ROOT/current-backup-$(date +%s).json"
if [ -f "$CURRENT" ]; then
  cp "$CURRENT" "$BACKUP"
  echo ""
  echo "── Previous current.json backed up to $(basename "$BACKUP")"
fi

cat > "$CURRENT" <<JSON
{
  "version": "$VERSION",
  "sha256": "$SHA",
  "promoted_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "promoted_by": "promote-bundle.sh (smoke gate green)"
}
JSON

echo ""
echo "── current.json flipped:"
cat "$CURRENT"
echo ""
echo "════════════════════════════════════════════════════════════"
echo "  PROMOTED · next app boot loads $VERSION"
echo "════════════════════════════════════════════════════════════"
