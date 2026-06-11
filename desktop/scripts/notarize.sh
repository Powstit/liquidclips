#!/usr/bin/env bash
# ───── IRON GATE IG-013 (v0.7.50) — see desktop/docs/IRON_GATES.md ─────
# Apple notarisation chain. Paired with .github/workflows/release.yml at
# the repo root. NEVER swap `xcrun notarytool submit --wait` for the
# deprecated polling pattern, NEVER hard-code one auth mode (env-var vs
# keychain profile), NEVER skip the stapler call after submit. The 5 GH
# Actions secrets (APPLE_CERTIFICATE, APPLE_CERTIFICATE_PASSWORD,
# APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID) are set on Powstit/liquidclips
# since 2026-06-02 — do not propose to "set them up again."
#
# notarize.sh — Submit a .dmg to Apple notarytool, poll for completion, staple.
#
# Usage:
#   ./scripts/notarize.sh <path-to-.dmg>
#
# Pre-flight (one-time setup):
#   xcrun notarytool store-credentials LIQUIDCLIPS_NOTARY \
#     --apple-id "daniel@smartmovecarhire.co.uk" \
#     --team-id "KT68NGT4LX" \
#     --password "<app-specific-password>"
#
# The keychain profile "LIQUIDCLIPS_NOTARY" is used locally. In GitHub Actions,
# set APPLE_ID, APPLE_PASSWORD, and APPLE_TEAM_ID and the script will use those
# directly instead.
# Generate the app-specific password at: https://appleid.apple.com

set -euo pipefail

DMG="${1:-}"
if [ -z "$DMG" ] || [ ! -f "$DMG" ]; then
  echo "Usage: $0 <path-to-.dmg>" >&2
  exit 1
fi

PROFILE="${NOTARY_KEYCHAIN_PROFILE:-LIQUIDCLIPS_NOTARY}"

NOTARY_ARGS=()
if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
  NOTARY_ARGS=(--apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID")
else
  NOTARY_ARGS=(--keychain-profile "$PROFILE")
fi

echo "=== Submitting $(basename "$DMG") to Apple notarytool ==="

# Submit and capture submission ID. Disable set -e for the submit call so we
# can ALWAYS print the captured output (auth errors / validation rejections
# go to stderr and the previous capture-then-set-e flow swallowed them, so
# CI showed nothing but a bare exit 1).
set +e
SUBMISSION=$(xcrun notarytool submit "$DMG" \
  "${NOTARY_ARGS[@]}" \
  --wait \
  2>&1)
SUBMIT_EXIT=$?
set -e
echo "--- notarytool submit output ---"
echo "$SUBMISSION"
echo "--- end output (exit=$SUBMIT_EXIT) ---"
if [ $SUBMIT_EXIT -ne 0 ]; then
  echo "✗ notarytool submit exited $SUBMIT_EXIT" >&2
  exit 1
fi

# Extract submission ID from output
ID=$(echo "$SUBMISSION" | grep -oE 'id: [a-f0-9-]+' | head -1 | sed 's/id: //')
if [ -z "$ID" ]; then
  echo "✗ Could not extract submission ID from notarytool output above" >&2
  exit 1
fi

echo "✓ Submission ID: $ID"

# Check final status
STATUS=$(xcrun notarytool info "$ID" "${NOTARY_ARGS[@]}" 2>&1)
if echo "$STATUS" | grep -q "status: Accepted"; then
  echo "✓ Notarization accepted"
else
  echo "✗ Notarization failed or rejected:" >&2
  echo "$STATUS" >&2
  # Fetch logs for debugging
  xcrun notarytool log "$ID" "${NOTARY_ARGS[@]}" 2>&1 || true
  exit 1
fi

# Staple the notarization ticket into the .dmg
echo "=== Stapling notarization ticket ==="
xcrun stapler staple "$DMG"

# Verify
echo "=== Verification ==="
spctl --assess -vv --type install "$DMG"

echo "✓ $(basename "$DMG") is notarized and stapled."
