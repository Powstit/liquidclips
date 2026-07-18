#!/usr/bin/env bash
# IG-014-B · session-reset regression guard · LOCKED 2026-07-18
#
# Enforces three invariants around the "stuck keychain" fix:
#
#   1. `clearJwtKeychainForAuthAction` returns Promise<boolean> (never
#      Promise<void>). The old void signature made silent failure the
#      default and hid the bug for months.
#
#   2. The function must call `lcDiag("auth.keychain_purge_failed", ...)`
#      inside its catch block. Any refactor that drops the diagnostic
#      emission reintroduces the silent-swallow behaviour.
#
#   3. The IRON GATE IG-014-B sentinel comment must remain in place
#      inside authStorage.ts so future readers know the block is locked.
#
#   4. SimpleLoginPanel.tsx must import + mount <SessionResetButton />.
#
# Exits 1 on any offending file · zero on a clean sweep.
#
# Wire into .githooks/pre-commit alongside lint-kade-decoupling.sh. Also
# runnable standalone via `bash desktop-2/scripts/lint-session-reset-guard.sh`.

set -uo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
DESKTOP_SRC="$REPO_ROOT/desktop-2/src"
AUTH_STORAGE="$DESKTOP_SRC/lib/authStorage.ts"
LOGIN_PANEL="$DESKTOP_SRC/components/auth/SimpleLoginPanel.tsx"
RESET_BUTTON="$DESKTOP_SRC/components/auth/SessionResetButton.tsx"
APP_BOOT="$DESKTOP_SRC/App.tsx"

if [ ! -d "$DESKTOP_SRC" ]; then
  # Older branch that predates the split — skip rather than fail.
  exit 0
fi

fail=0

check_present() {
  local file="$1"
  local pattern="$2"
  local reason="$3"
  if [ ! -f "$file" ]; then
    echo "IG-014-B FAIL · missing file: $file · $reason"
    fail=1
    return
  fi
  if ! grep -qE "$pattern" "$file"; then
    echo "IG-014-B FAIL · pattern missing in $file"
    echo "  Expected: $pattern"
    echo "  Reason:   $reason"
    fail=1
  fi
}

check_absent() {
  local file="$1"
  local pattern="$2"
  local reason="$3"
  if [ -f "$file" ] && grep -qE "$pattern" "$file"; then
    echo "IG-014-B FAIL · forbidden pattern in $file"
    echo "  Forbidden: $pattern"
    echo "  Reason:    $reason"
    fail=1
  fi
}

# Invariant 1 · return type must be Promise<boolean>.
check_present "$AUTH_STORAGE" \
  'export async function clearJwtKeychainForAuthAction\(\): Promise<boolean>' \
  "must return Promise<boolean> so callers can detect silent Tauri failure"

# Invariant 1b · the OLD void signature must never come back.
check_absent "$AUTH_STORAGE" \
  'export async function clearJwtKeychainForAuthAction\(\)\s*:\s*Promise<void>' \
  "reverting to Promise<void> re-hides the stuck-keychain bug"

# Invariant 2 · diagnostic emission on failure.
check_present "$AUTH_STORAGE" \
  'lcDiag\("auth\.keychain_purge_failed"' \
  "catch block must emit lcDiag · never silently swallow"

# Invariant 3 · iron gate sentinel.
check_present "$AUTH_STORAGE" \
  'IRON GATE IG-014-B' \
  "sentinel comment marks this code path as regression-locked"

# Invariant 4 · SessionResetButton wired into login panel.
check_present "$LOGIN_PANEL" \
  'from "\./SessionResetButton"' \
  "SimpleLoginPanel must import the recovery affordance"

check_present "$LOGIN_PANEL" \
  '<SessionResetButton' \
  "SimpleLoginPanel must render <SessionResetButton /> so the stuck user can recover"

# Invariant 5 · component file must exist + use the correct purge helper.
check_present "$RESET_BUTTON" \
  'clearJwtKeychainForAuthAction' \
  "SessionResetButton must use the canonical purge helper (no bespoke fork)"

check_present "$RESET_BUTTON" \
  'security delete-generic-password' \
  "SessionResetButton must include the terminal-fallback command for macOS keychain failures"

# Invariant 6 · boot-time preemptive reconcile function exists.
check_present "$AUTH_STORAGE" \
  'export async function reconcileKeychainOnBoot\(\): Promise<void>' \
  "reconcileKeychainOnBoot must exist so returning users never see the stuck-keychain state"

# Invariant 7 · boot path invokes the reconcile function.
check_present "$APP_BOOT" \
  'reconcileKeychainOnBoot' \
  "App.tsx boot must call reconcileKeychainOnBoot after initAuthStorage"

if [ "$fail" -eq 0 ]; then
  echo "IG-014-B · session-reset regression guard · PASS"
  exit 0
else
  echo ""
  echo "IG-014-B lint failed. See docs/lc2/RUNTIME_UPDATE_ARCHITECTURE.md or"
  echo "the sentinel block at desktop-2/src/lib/authStorage.ts for context."
  exit 1
fi
