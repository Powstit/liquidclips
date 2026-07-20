#!/usr/bin/env bash
# IG-RUNTIME-HOTSWAP · Layer 2 · The UpdateBeacon MUST reload the
# webview when a newer runtime bundle stages within the boot window.
# LOCKED 2026-07-20.
#
# What this locks: without the reload wire, users always see the
# PREVIOUSLY-staged runtime bundle after quit + relaunch because the
# webview loaded index.html BEFORE the Rust background task swapped
# current.json to point at the new bundle. The URI scheme handler
# reads from a live RwLock that DOES get refreshed after staging, so
# a `window.location.reload()` inside the `lc:runtime-staged` handler
# re-fetches from the new bundle immediately — no shell rebuild.
#
# The reload MUST be gated on `HOTSWAP_BOOT_WINDOW_MS` so we don't
# swap mid-session (BUG-012 · would wipe user work in progress).
#
# 4-layer defense per feedback_never_regress_4_layer_defense.md:
#   Layer 1 · IG-RUNTIME-HOTSWAP sentinel in UpdateBeacon.tsx
#   Layer 2 · THIS grep-guard (source-text asserts the wire)
#   Layer 3 · Vitest at src/components/UpdateBeacon.hotswap.test.ts
#   Layer 4 · Runtime — the reload itself + boot-window guard
#
# Wired into .githooks/pre-commit + scripts/iron-gates.sh fast tier.

set -uo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
BEACON="${LINT_RUNTIME_HOTSWAP_TARGET:-$REPO_ROOT/desktop-2/src/components/UpdateBeacon.tsx}"

if [ ! -f "$BEACON" ]; then
  # Older branch — skip rather than block.
  exit 0
fi

fail=0
missing=""

check() {
  local pattern=$1
  local hint=$2
  if ! /usr/bin/grep -Eq "$pattern" "$BEACON"; then
    fail=1
    missing="${missing}
  - $hint
    (pattern: $pattern)"
  fi
}

# The sentinel comment must be present so future editors know why the wire exists.
check "IG-RUNTIME-HOTSWAP" "sentinel comment · IG-RUNTIME-HOTSWAP not found"

# Boot-window constant declared.
check "HOTSWAP_BOOT_WINDOW_MS" "boot-window constant HOTSWAP_BOOT_WINDOW_MS missing"

# Mount timestamp ref captured.
check "mountedAtRef" "mount-timestamp ref mountedAtRef missing"

# The actual reload call — required as literal source text.
check "window\.location\.reload" "window.location.reload() call missing"

# Diagnostic telemetry so HQ sees hotswap events.
check "runtime_hotswap_reload" "runtime_hotswap_reload lcDiag event missing"

# The reload must be gated on the boot window (not fire mid-session).
check "withinBootWindow" "withinBootWindow gate missing (would violate BUG-012)"

if [ $fail -ne 0 ]; then
  echo "IG-RUNTIME-HOTSWAP FAIL · reload wire missing from UpdateBeacon.tsx"
  echo "$missing"
  echo ""
  echo "  Every element above must be present in src/components/UpdateBeacon.tsx"
  echo "  so users on stale bundles auto-swap to the new bundle within the boot"
  echo "  window. Removing any of them re-opens the 2-relaunch-per-ship gap."
  echo ""
  echo "  Reference: feedback_never_regress_4_layer_defense.md · IG-RUNTIME-HOTSWAP 2026-07-20"
  exit 1
fi

echo "IG-RUNTIME-HOTSWAP · reload wire + boot-window gate present · PASS"
exit 0
