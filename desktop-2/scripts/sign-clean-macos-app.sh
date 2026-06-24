#!/usr/bin/env bash
# sign-clean-macos-app.sh — deterministic macOS app signing repair.
#
# Tauri's direct macOS signing can fail on some macOS / File Provider setups
# with: "resource fork, Finder information, or similar detritus not allowed".
#
# The reliable path is:
#   1. rsync the generated .app into a clean working dir (no macOS ACL/xattr
#      copy flags).
#   2. remove only codesign-hostile attrs (FinderInfo / resource fork /
#      fpfs / macl). com.apple.provenance may remain; codesign accepts it.
#   3. sign the main executable, then the bundle.
#   4. replace the original .app with the signed clean copy.
#
# Slimmed for desktop-2 · NO Python sidecar yet · no helper binary signing
# pass. When a sidecar lands, re-add the `Contents/Resources/_up_/python-
# sidecar/bin/*` signing loop from legacy desktop/scripts/sign-clean-macos-app.sh.
#
# Usage:
#   ./scripts/sign-clean-macos-app.sh /path/to/Liquid\ Clips.app [identity] [entitlements]

set -euo pipefail

APP_PATH="${1:?usage: sign-clean-macos-app.sh /path/to/Liquid\\ Clips.app [identity] [entitlements]}"
IDENTITY="${2:-Developer ID Application: daniel diyepriye dokubo (KT68NGT4LX)}"
ENTITLEMENTS="${3:-$(cd "$(dirname "$0")/.." && pwd)/src-tauri/entitlements-direct.plist}"
MAIN_BIN_NAME="liquid-clips-shell"  # Cargo package name → Mach-O filename

codesign_with_retry() {
  local attempt
  for attempt in 1 2 3 4 5; do
    if codesign "$@"; then
      return 0
    fi
    echo "codesign failed on attempt $attempt; retrying after timestamp service backoff..." >&2
    sleep $((attempt * 10))
  done
  codesign "$@"
}

if [ ! -d "$APP_PATH" ]; then
  echo "✗ app not found: $APP_PATH" >&2
  exit 1
fi
if [ ! -f "$ENTITLEMENTS" ]; then
  echo "✗ entitlements not found: $ENTITLEMENTS" >&2
  exit 1
fi

APP_ABS="$(cd "$(dirname "$APP_PATH")" && pwd)/$(basename "$APP_PATH")"
WORK_ROOT="${LIQUIDCLIPS_SIGN_WORKDIR:-$HOME/LiquidClipsBuild/sign-clean}"
CLEAN_APP="$WORK_ROOT/$(basename "$APP_ABS")"

rm -rf "$WORK_ROOT"
mkdir -p "$WORK_ROOT"

echo "=== Clean-copying app for signing ==="
rsync -a --delete "$APP_ABS/" "$CLEAN_APP/"

echo "=== Removing codesign-hostile xattrs ==="
while IFS= read -r p; do
  xattr -d com.apple.FinderInfo "$p" 2>/dev/null || true
  xattr -d com.apple.ResourceFork "$p" 2>/dev/null || true
  xattr -d 'com.apple.fileprovider.fpfs#P' "$p" 2>/dev/null || true
  xattr -d com.apple.macl "$p" 2>/dev/null || true
done < <(find "$CLEAN_APP" -xattr -print)
rm -rf "$CLEAN_APP/Contents/_CodeSignature"

echo "=== Signing main executable ==="
codesign_with_retry --force --timestamp --options runtime --entitlements "$ENTITLEMENTS" --sign "$IDENTITY" "$CLEAN_APP/Contents/MacOS/$MAIN_BIN_NAME"

echo "=== Signing app bundle ==="
codesign_with_retry --force --deep --timestamp --options runtime --entitlements "$ENTITLEMENTS" --sign "$IDENTITY" "$CLEAN_APP"
codesign --verify --deep --strict --verbose=2 "$CLEAN_APP"

echo "=== Replacing original app with signed clean copy ==="
rm -rf "$APP_ABS"
rsync -a --delete "$CLEAN_APP/" "$APP_ABS/"
# Some File Provider-backed destinations attach FinderInfo/fpfs attributes
# as files are created. Strip those once more after the final copy.
while IFS= read -r p; do
  xattr -d com.apple.FinderInfo "$p" 2>/dev/null || true
  xattr -d com.apple.ResourceFork "$p" 2>/dev/null || true
  xattr -d 'com.apple.fileprovider.fpfs#P' "$p" 2>/dev/null || true
  xattr -d com.apple.macl "$p" 2>/dev/null || true
done < <(find "$APP_ABS" -xattr -print)
if ! codesign --verify --deep --strict --verbose=2 "$APP_ABS"; then
  if [ "${LIQUIDCLIPS_ALLOW_CLEAN_FALLBACK:-}" = "1" ]; then
    echo "⚠ destination app could not be verified after copy; using clean signed app instead:" >&2
    echo "$CLEAN_APP"
    exit 0
  fi
  exit 1
fi

echo "✓ signed app: $APP_ABS"
