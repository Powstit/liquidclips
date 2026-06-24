#!/usr/bin/env bash
# local-install.sh — atomic quit + replace + relaunch of Liquid Clips.app.
#
# Slimmed for desktop-2 · NO Python sidecar yet · drops the legacy
# stale-sidecar staleness guard (Daniel can compare to
# desktop/scripts/local-install.sh for the full version that ran the
# guard on every install).
#
# Usage:
#   ./scripts/local-install.sh
#   ./scripts/local-install.sh --skip-quit   # if you know nothing is running
#
# Source path: assumes the build output at
#   src-tauri/target/release/bundle/macos/Liquid Clips.app
# Target path: /Applications/Liquid Clips.app

set -Eeuo pipefail

cd "$(dirname "$0")/.."

C_OK=$'\033[32m'; C_ERR=$'\033[31m'; C_BOLD=$'\033[1m'; C_END=$'\033[0m'
ok()   { echo "${C_OK}✓${C_END} $*"; }
fail() { echo "${C_ERR}✗${C_END} $*" >&2; exit 1; }
step() { echo ""; echo "${C_BOLD}→${C_END} $*"; }

SRC="$(pwd)/src-tauri/target/release/bundle/macos/Liquid Clips.app"
DST="/Applications/Liquid Clips.app"
SKIP_QUIT="${1:-}"

# --- preflight ----------------------------------------------------------
step "Preflight"
[ -d "$SRC" ] || fail "Built bundle not found at $SRC — run 'npm run tauri build -- --bundles app' first"
SRC_VER="$(plutil -p "$SRC/Contents/Info.plist" | awk -F'"' '/CFBundleShortVersionString/{print $4}')"
ok "Source bundle: $SRC ($SRC_VER)"

# --- graceful quit, then SIGKILL holdouts -------------------------------
if [ "$SKIP_QUIT" != "--skip-quit" ]; then
  step "Quitting running Liquid Clips.app"
  osascript -e 'tell application "Liquid Clips" to quit' 2>/dev/null || true
  for i in {1..10}; do
    pgrep -x "Liquid Clips" >/dev/null 2>&1 || break
    sleep 0.5
  done
  pkill -KILL -x "Liquid Clips" 2>/dev/null || true
  pkill -KILL -x "liquid-clips-shell" 2>/dev/null || true
  ok "no Liquid Clips process running"
fi

# --- replace bundle ------------------------------------------------------
step "Replacing $DST"
rm -rf "$DST"
ditto "$SRC" "$DST"
ok "copied"

# --- xattr scrub ---------------------------------------------------------
step "Stripping quarantine xattrs"
xattr -cr "$DST" 2>/dev/null || true
ok "quarantine cleared"

# --- verify codesign if signed ------------------------------------------
step "Codesign verify (best-effort · skipped if unsigned dev build)"
if codesign --verify --deep --strict "$DST" 2>/dev/null; then
  ok "code signature valid"
else
  echo "  (unsigned or signature invalid · OK for dev rehearsal · sign + notarize for distribution)"
fi

# --- launch --------------------------------------------------------------
step "Launching"
open -a "$DST"
sleep 1
DST_VER="$(plutil -p "$DST/Contents/Info.plist" | awk -F'"' '/CFBundleShortVersionString/{print $4}')"
ok "Liquid Clips $DST_VER is running"
