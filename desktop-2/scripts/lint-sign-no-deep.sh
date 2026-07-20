#!/usr/bin/env bash
# IG-SIGN-NO-DEEP · lint guard
#
# Fails if anyone re-adds `--deep` to the outer app-bundle codesign call
# in sign-clean-macos-app.sh. That flag re-signs Python.framework
# internals in a way that breaks the nested-code-first order required
# for Apple notarization (see v2.3.0 through v2.3.4 CI failures where
# _internal/Python and _internal/Python.framework/Python were rejected
# for "The signature of the binary is invalid" after --deep clobbered
# the earlier INSIDE-OUT sign pass).
#
# Wire into iron-gates.sh · runs on `pr` + `release` tiers.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$REPO_ROOT/desktop-2/scripts/sign-clean-macos-app.sh"

if [ ! -f "$SCRIPT" ]; then
  echo "IG-SIGN-NO-DEEP · script not found: $SCRIPT" >&2
  exit 2
fi

# Look for `--deep` ONLY on codesign SIGN calls (not verify calls).
# The `codesign --verify --deep` on line ~74 is fine — verify --deep is
# read-only and is our safety net.
OFFENDERS="$(grep -nE 'codesign(_with_retry)?[^#]*--deep' "$SCRIPT" \
  | grep -vE '^--$|--verify' \
  | grep -vE '^\s*#' \
  || true)"

if [ -n "$OFFENDERS" ]; then
  echo "❌ IG-SIGN-NO-DEEP violation · --deep found on a codesign SIGN call:" >&2
  echo "$OFFENDERS" >&2
  echo "" >&2
  echo "Do NOT re-add --deep to the sign-clean outer-bundle sign. It clobbers" >&2
  echo "Python.framework's nested-code-first ordering and produces the" >&2
  echo "ad-hoc-leak notarization rejection that killed v2.3.0-2.3.4." >&2
  echo "" >&2
  echo "If you need to re-sign nested binaries, extend the earlier" >&2
  echo "'Developer-ID re-sign PyInstaller sidecar bundle' step in" >&2
  echo ".github/workflows/release-desktop-2.yml instead." >&2
  exit 1
fi

echo "✓ IG-SIGN-NO-DEEP · no --deep on sign calls"
