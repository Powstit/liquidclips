#!/usr/bin/env bash
# package-signed-macos-artifacts.sh — rebuild release artifacts from a signed .app.
#
# Run after sign-clean-macos-app.sh. This guarantees the DMG and updater
# tarball contain the repaired/signed app, not a stale bundle emitted before
# post-build signing.

set -euo pipefail

APP_PATH="${1:?usage: package-signed-macos-artifacts.sh /path/to/Liquid\\ Clips.app [arch]}"
ARCH="${2:-$(uname -m)}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAURI_CONF="$ROOT/src-tauri/tauri.conf.json"
VERSION="$(node -e "const fs=require('fs'); const c=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(c.version);" "$TAURI_CONF")"
PRODUCT_NAME="$(node -e "const fs=require('fs'); const c=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(c.productName);" "$TAURI_CONF")"
SAFE_PRODUCT="$(printf '%s' "$PRODUCT_NAME" | tr ' ' '.')"

APP_ABS="$(cd "$(dirname "$APP_PATH")" && pwd)/$(basename "$APP_PATH")"
if [ ! -d "$APP_ABS" ]; then
  echo "✗ app not found: $APP_ABS" >&2
  exit 1
fi

BUNDLE_ROOT="$(cd "$(dirname "$APP_ABS")" && pwd)"
DMG_DIR="$(cd "$BUNDLE_ROOT/.." && pwd)/dmg"
mkdir -p "$DMG_DIR"

case "$ARCH" in
  arm64|aarch64|aarch64-apple-darwin) ARTIFACT_ARCH="aarch64" ;;
  x86_64|x64|x86_64-apple-darwin) ARTIFACT_ARCH="x86_64" ;;
  *) ARTIFACT_ARCH="$ARCH" ;;
esac

TAR_PATH="$BUNDLE_ROOT/$PRODUCT_NAME.app.tar.gz"
DMG_PATH="$DMG_DIR/${SAFE_PRODUCT}_${VERSION}_${ARTIFACT_ARCH}.dmg"

echo "=== Verifying signed app before packaging ==="
codesign --verify --deep --strict --verbose=2 "$APP_ABS"

echo "=== Rebuilding updater tarball ==="
rm -f "$TAR_PATH" "$TAR_PATH.sig"
(cd "$BUNDLE_ROOT" && COPYFILE_DISABLE=1 tar --no-xattrs -czf "$TAR_PATH" "$(basename "$APP_ABS")")
if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  (cd "$ROOT" && npx tauri signer sign "$TAR_PATH")
else
  echo "(skip) TAURI_SIGNING_PRIVATE_KEY not set; updater .sig not generated"
fi

echo "=== Rebuilding DMG ==="
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/liquidclips-dmg.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE"
rsync -a --delete "$APP_ABS/" "$STAGE/$(basename "$APP_ABS")/"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG_PATH"
hdiutil create \
  -volname "$PRODUCT_NAME" \
  -srcfolder "$STAGE" \
  -ov \
  -format UDZO \
  "$DMG_PATH"

# Codesign the rebuilt DMG container itself. The .app inside is already signed
# (by sign-clean-macos-app.sh upstream), but `hdiutil create` produces a fresh
# unsigned DMG. Apple notarize/staple succeeds on the .app inside, but
# `spctl --assess --type install` checks the DMG's own signature — which is
# why v0.6.43 CI failed with `source=no usable signature` after a clean
# notarization+staple. Without this step every release post-launch-sprint
# would silently fail Gatekeeper installer assessment.
echo "=== Codesigning DMG container ==="
DMG_IDENTITY="${APPLE_SIGNING_IDENTITY:-Developer ID Application: daniel diyepriye dokubo (KT68NGT4LX)}"
codesign --sign "$DMG_IDENTITY" --timestamp "$DMG_PATH"
codesign --verify --verbose=2 "$DMG_PATH"

echo "=== Verifying DMG exists ==="
ls -lh "$DMG_PATH" "$TAR_PATH" "$TAR_PATH.sig" 2>/dev/null || ls -lh "$DMG_PATH" "$TAR_PATH"
echo "✓ packaged signed artifacts"
