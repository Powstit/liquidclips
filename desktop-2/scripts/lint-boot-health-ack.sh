#!/usr/bin/env bash
# IG-BOOT-HEALTH-ACK · Layer 2 · The frontend MUST invoke
# `runtime_ack_boot_healthy` after the customer-facing app tree mounts
# so the Rust rollback trigger sees a healthy boot.
# LOCKED 2026-07-20.
#
# What this locks:
#   1. src/lib/runtimeHealthAck.ts exports `useRuntimeBootHealthyAck`
#      which invokes the Tauri command with a small delay (long enough
#      that early crashes don't ack, short enough that healthy boots
#      always ack).
#   2. src/App.tsx calls the hook so the ack fires on every boot.
#
# If either wire is missing, a signed-but-broken bundle would ack via
# lie-by-omission — the rollback trigger would never observe the missing
# ack because no invoke path exists. This fence catches that class of
# hostile edit.
#
# 4-layer defense per feedback_never_regress_4_layer_defense.md:
#   Layer 1 · sentinel in runtimeHealthAck.ts + App.tsx wire line
#   Layer 2 · THIS grep-guard
#   Layer 3 · runtimeHealthAck.test.ts (vitest) + App source-text check
#   Layer 4 · Runtime — Rust maybe_rollback_unhealthy_boot on next boot

set -uo pipefail

REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
HOOK="${LINT_HEALTH_ACK_HOOK:-$REPO_ROOT/desktop-2/src/lib/runtimeHealthAck.ts}"
APP="${LINT_HEALTH_ACK_APP:-$REPO_ROOT/desktop-2/src/App.tsx}"

if [ ! -f "$HOOK" ] || [ ! -f "$APP" ]; then
  exit 0
fi

fail=0
missing=""

need_hook() {
  if ! /usr/bin/grep -Eq "$1" "$HOOK"; then
    fail=1
    missing="${missing}
  runtimeHealthAck.ts: $2"
  fi
}
need_app() {
  if ! /usr/bin/grep -Eq "$1" "$APP"; then
    fail=1
    missing="${missing}
  App.tsx: $2"
  fi
}

need_hook 'runtime_ack_boot_healthy'                    "invoke command literal missing"
need_hook 'export function useRuntimeBootHealthyAck'    "hook export missing"
need_hook 'setTimeout'                                  "delay setTimeout missing (prevents early-crash false-acks)"
need_hook 'HEALTHY_BOOT_ACK_DELAY_MS'                   "HEALTHY_BOOT_ACK_DELAY_MS constant missing"

need_app  'useRuntimeBootHealthyAck'                    "App.tsx must call useRuntimeBootHealthyAck()"

if [ $fail -ne 0 ]; then
  echo "IG-BOOT-HEALTH-ACK FAIL · rollback-guarantee contract broken"
  echo "$missing"
  echo ""
  echo "  Every element above is required so a broken bundle that never"
  echo "  mounts the app cannot lie its way through the rollback gate."
  echo ""
  echo "  Reference: feedback_never_regress_4_layer_defense.md · IG-BOOT-HEALTH-ACK 2026-07-20"
  exit 1
fi

echo "IG-BOOT-HEALTH-ACK · runtime_ack_boot_healthy wired from App.tsx via delayed hook · PASS"
exit 0
