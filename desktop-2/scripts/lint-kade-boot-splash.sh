#!/usr/bin/env bash
# IG-BOOT-CHECK-THEN-SERVE · Layer 2 · KadeBootSplash MUST wrap App
# in main.tsx AND MUST implement the awaited check-and-reload wire.
# LOCKED 2026-07-20.
#
# What this locks:
#   1. main.tsx wraps <App /> in <KadeBootSplash>
#   2. KadeBootSplash.tsx implements the FOUR contract elements:
#      - awaits runtime_check_now (not fire-and-forget)
#      - reads runtime_info before + after the check
#      - triggers window.location.reload() on version drift
#      - loop-guards via lc.boot-reload-at localStorage key
#   3. Bounded timeout so a hanging manifest never blocks boot
#
# Without any of these, boot regresses to "serve stale then swap"
# (the exact UX Daniel called out as unacceptable).
#
# 4-layer defense per feedback_never_regress_4_layer_defense.md:
#   Layer 1 · IG-BOOT-CHECK-THEN-SERVE sentinel in KadeBootSplash.tsx
#   Layer 2 · THIS grep-guard (asserts wire + mount)
#   Layer 3 · Vitest at src/components/KadeBootSplash.test.ts
#   Layer 4 · Runtime — the awaited check + reload wire itself
#
# Wired into .githooks/pre-commit + scripts/iron-gates.sh fast tier.

set -uo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
SPLASH="${LINT_KADE_SPLASH_TARGET:-$REPO_ROOT/desktop-2/src/components/KadeBootSplash.tsx}"
MAIN="${LINT_KADE_MAIN_TARGET:-$REPO_ROOT/desktop-2/src/main.tsx}"

if [ ! -f "$SPLASH" ] || [ ! -f "$MAIN" ]; then
  # Older branch — skip rather than block.
  exit 0
fi

fail=0
missing=""

need_in_splash() {
  local pattern=$1
  local hint=$2
  if ! /usr/bin/grep -Eq "$pattern" "$SPLASH"; then
    fail=1
    missing="${missing}
  KadeBootSplash.tsx: $hint
    (pattern: $pattern)"
  fi
}

need_in_main() {
  local pattern=$1
  local hint=$2
  if ! /usr/bin/grep -Eq "$pattern" "$MAIN"; then
    fail=1
    missing="${missing}
  main.tsx: $hint
    (pattern: $pattern)"
  fi
}

# ── Splash contract ────────────────────────────────────────────────
need_in_splash "IG-BOOT-CHECK-THEN-SERVE"                  "sentinel comment missing"
need_in_splash 'invoke.*runtime_check_now'                 "runtime_check_now invocation missing"
need_in_splash 'invoke.*runtime_info'                      "runtime_info read missing (need before + after check)"
need_in_splash 'await\s+Promise\.race'                     "Promise.race timeout wrapper missing"
need_in_splash 'CHECK_TIMEOUT_MS'                          "bounded CHECK_TIMEOUT_MS constant missing"
need_in_splash 'hardReloadForRuntimeSwap'                  "hardReloadForRuntimeSwap() call missing"
need_in_splash 'lc\.boot-reload-at|RELOAD_MARK_KEY'        "loop-guard localStorage key missing"
need_in_splash 'LOOP_GUARD_MS'                             "LOOP_GUARD_MS constant missing"
need_in_splash 'kade_boot_splash_activate'                 "activate telemetry event missing"
need_in_splash 'kade_boot_splash_pass'                     "success telemetry event missing"
need_in_splash 'kade_boot_splash_fallthrough'              "fallthrough telemetry event missing"

# ── main.tsx wire ──────────────────────────────────────────────────
need_in_main   'import.*KadeBootSplash'                    "KadeBootSplash import missing"
need_in_main   '<KadeBootSplash>'                          "<KadeBootSplash> mount missing"

if [ $fail -ne 0 ]; then
  echo "IG-BOOT-CHECK-THEN-SERVE FAIL"
  echo "$missing"
  echo ""
  echo "  Every element above is required so users see the guaranteed-latest"
  echo "  bundle on every launch (Discord / Slack / Cursor pattern)."
  echo "  Removing any of them re-opens the 'stale bundle then swap' gap."
  echo ""
  echo "  Reference: feedback_never_regress_4_layer_defense.md · IG-BOOT-CHECK-THEN-SERVE 2026-07-20"
  exit 1
fi

echo "IG-BOOT-CHECK-THEN-SERVE · splash contract + main.tsx mount present · PASS"
exit 0
