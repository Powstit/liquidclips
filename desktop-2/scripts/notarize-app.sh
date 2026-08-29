#!/usr/bin/env bash
# ───── IRON GATE IG-013 companion (2026-08-29) ─────
# notarize-app.sh — Notarize + staple the .app bundle ITSELF, not just
# the outer .dmg.
#
# Real gap found via a live NO-GO launch audit: notarize.sh (this
# directory) only ever notarized and stapled the .dmg container. Apple's
# stapler embeds the ticket into whatever it's pointed at — stapling the
# .dmg does NOT propagate a staple into the .app extracted from it. Two
# real distribution paths never carried a staple as a result:
#   1. A user drags the .app out of the (stapled) .dmg to /Applications —
#      completely standard, exactly what our own install docs describe —
#      and ends up with an unstapled .app. `xcrun stapler validate` on
#      that installed .app fails, confirmed live on 2.3.65 and 2.3.66.
#   2. The auto-updater ships `Liquid.Clips_<arch>.app.tar.gz` — built
#      straight from the signed .app, no .dmg involved at all — so every
#      auto-updated install was ALWAYS unstapled, regardless of whether
#      the manually-downloaded .dmg was fine.
#
# Fix: notarize + staple the .app directly, BEFORE it gets packaged into
# either the .dmg or the .app.tar.gz (see release-desktop-2.yml — this
# now runs ahead of "rebuild DMG + updater tarball from repaired app").
# Both artifacts then inherit an already-stapled .app. The existing
# .dmg-level notarize+staple step still runs afterward for the outer
# container — this does not replace it, it closes the gap that step
# alone left.
#
# Usage:
#   ./scripts/notarize-app.sh <path-to-.app>
#
# Same credential contract as notarize.sh: APPLE_ID/APPLE_PASSWORD/
# APPLE_TEAM_ID env vars in CI, or the LIQUIDCLIPS_NOTARY keychain
# profile locally.

set -euo pipefail

APP="${1:-}"
if [ -z "$APP" ] || [ ! -d "$APP" ]; then
  echo "Usage: $0 <path-to-.app>" >&2
  exit 1
fi

PROFILE="${NOTARY_KEYCHAIN_PROFILE:-LIQUIDCLIPS_NOTARY}"

NOTARY_ARGS=()
if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
  NOTARY_ARGS=(--apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID")
else
  NOTARY_ARGS=(--keychain-profile "$PROFILE")
fi

# notarytool only accepts .zip/.dmg/.pkg for submission — a raw .app
# directory is rejected. `ditto` (not `zip`) preserves the code-signing
# extended attributes/resource forks Apple's notary service inspects.
ZIP="$(mktemp -d)/$(basename "$APP" .app)-for-notary.zip"
echo "=== Zipping $(basename "$APP") for submission ==="
ditto -c -k --keepParent "$APP" "$ZIP"

echo "=== Submitting $(basename "$ZIP") to Apple notarytool ==="
set +e
SUBMISSION=$(xcrun notarytool submit "$ZIP" \
  "${NOTARY_ARGS[@]}" \
  --wait \
  2>&1)
SUBMIT_EXIT=$?
set -e
echo "--- notarytool submit output ---"
echo "$SUBMISSION"
echo "--- end output (exit=$SUBMIT_EXIT) ---"
rm -f "$ZIP"
if [ $SUBMIT_EXIT -ne 0 ]; then
  echo "✗ notarytool submit exited $SUBMIT_EXIT" >&2
  exit 1
fi

ID=$(echo "$SUBMISSION" | grep -oE 'id: [a-f0-9-]+' | head -1 | sed 's/id: //')
if [ -z "$ID" ]; then
  echo "✗ Could not extract submission ID from notarytool output above" >&2
  exit 1
fi

echo "✓ Submission ID: $ID"

STATUS=$(xcrun notarytool info "$ID" "${NOTARY_ARGS[@]}" 2>&1)
if echo "$STATUS" | grep -q "status: Accepted"; then
  echo "✓ Notarization accepted"
else
  echo "✗ Notarization failed or rejected:" >&2
  echo "$STATUS" >&2
  xcrun notarytool log "$ID" "${NOTARY_ARGS[@]}" 2>&1 || true
  exit 1
fi

# Staple the ORIGINAL .app in place — not the zip, which was only a
# submission vehicle and is already deleted.
echo "=== Stapling notarization ticket to $(basename "$APP") ==="
xcrun stapler staple "$APP"

echo "=== Verification ==="
xcrun stapler validate "$APP"
spctl -a -vv "$APP"

echo "✓ $(basename "$APP") is notarized and stapled."
