#!/usr/bin/env bash
# local-install.sh — atomic quit + replace + relaunch of Liquid Clips.app
#
# Purpose: until ship.sh + Tauri auto-updater are the canonical install path
# (blocked on Apple Developer Program enrollment), Daniel installs new
# builds by hand. Doing it manually drifts — stale sidecars survive Cmd+Q,
# the .app fails to replace because the running binary is locked, etc.
# This script handles it once, atomically, with verification at every step.
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
  # Wait up to 5s for graceful Cmd+Q to flush. Tauri's kill_on_drop fires on
  # SidecarState drop, which Tauri triggers on graceful exit — so the sidecar
  # usually dies with the parent. Force-kill anything that survives.
  for i in 1 2 3 4 5; do
    if ! pgrep -f "/Applications/Liquid Clips.app/Contents/MacOS/junior-desktop" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  remaining_app=$(pgrep -f "/Applications/Liquid Clips.app/Contents/MacOS/junior-desktop" || true)
  if [ -n "$remaining_app" ]; then
    echo "  app process(es) still alive after 5s; SIGKILL: $remaining_app"
    kill -9 $remaining_app 2>/dev/null || true
  fi
  # Sidecar can survive parent kill in rare cases (e.g. detached). Reap explicitly.
  remaining_sidecar=$(pgrep -f "/Applications/Liquid Clips.app/Contents/Resources/_up_/python-sidecar/sidecar.py" || true)
  if [ -n "$remaining_sidecar" ]; then
    echo "  sidecar(s) still alive; SIGKILL: $remaining_sidecar"
    kill -9 $remaining_sidecar 2>/dev/null || true
  fi
  sleep 1
  if pgrep -f "/Applications/Liquid Clips.app" >/dev/null 2>&1; then
    fail "Something still holding the installed app open — see 'pgrep -fl Liquid Clips' and resolve."
  fi
  ok "all processes from $DST are gone"
else
  ok "skip-quit requested"
fi

# --- replace the bundle -------------------------------------------------
step "Replacing $DST"
if [ -d "$DST" ]; then
  OLD_VER="$(plutil -p "$DST/Contents/Info.plist" 2>/dev/null | awk -F'"' '/CFBundleShortVersionString/{print $4}')"
  echo "  removing existing ($OLD_VER)"
  rm -rf "$DST"
fi
cp -R "$SRC" "$DST"
ok "copied"

# --- clear macOS quarantine flag (skip "are you sure you want to open" dialog)
step "Clearing quarantine attribute"
xattr -dr com.apple.quarantine "$DST" 2>/dev/null || true
ok "cleared"

# --- verify the install reports the expected version --------------------
step "Verifying installed version"
INSTALLED_VER="$(plutil -p "$DST/Contents/Info.plist" | awk -F'"' '/CFBundleShortVersionString/{print $4}')"
INSTALLED_ID="$(plutil -p "$DST/Contents/Info.plist" | awk -F'"' '/CFBundleIdentifier/{print $4}')"
INSTALLED_NAME="$(plutil -p "$DST/Contents/Info.plist" | awk -F'"' '/CFBundleName/{print $4}')"
echo "  CFBundleName:              $INSTALLED_NAME"
echo "  CFBundleIdentifier:        $INSTALLED_ID"
echo "  CFBundleShortVersionString: $INSTALLED_VER"
if [ "$INSTALLED_VER" != "$SRC_VER" ]; then
  fail "install version mismatch: source=$SRC_VER installed=$INSTALLED_VER"
fi
ok "matches source"

# --- relaunch -----------------------------------------------------------
step "Launching"
open "$DST"
sleep 2
RUN_PATH="$(pgrep -fl 'junior-desktop' | grep -v sidecar | awk '{print $2}' | head -1)"
RUN_PID="$(pgrep -f '/Applications/Liquid Clips.app/Contents/MacOS/junior-desktop' | head -1)"
echo "  running PID: ${RUN_PID:-(not yet)}"
echo "  running path: ${RUN_PATH:-(not yet)}"
ok "Liquid Clips.app $INSTALLED_VER launched"

echo ""
echo "${C_OK}${C_BOLD}═══ installed $INSTALLED_VER ═══${C_END}"
echo "  expect to see v$INSTALLED_VER in the wordmark pill at the top of the app"
echo ""
