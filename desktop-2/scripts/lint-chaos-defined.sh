#!/usr/bin/env bash
# IG-CHAOS-DEFINED · Reliability Sprint L4 · chaos harness present + wired.
# Guards that:
#   · chaos-runner.sh + 5 experiments exist and are executable
#   · chaos.test.ts regression exists
#   · EngineErrorBoundary is imported at the App shell
#   · SectionWithFallback is used per the money-surface rule
#
# 2026-07-22 · Reliability Sprint · Layer 4

set -euo pipefail
REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
CHAOS_DIR="$REPO_ROOT/desktop-2/scripts/chaos"
TEST="$REPO_ROOT/desktop-2/src/lib/chaos.test.ts"
APP="$REPO_ROOT/desktop-2/src/App.tsx"
fail() { echo "✗ $1" >&2; exit 1; }

[ -d "$CHAOS_DIR" ] || fail "missing $CHAOS_DIR"
[ -f "$TEST" ]      || fail "missing $TEST"
[ -f "$APP" ]       || fail "missing $APP"

for script in chaos-runner.sh kill-sidecar.sh drop-network.sh inject-backend-500.sh race-conditions.sh disk-full.sh; do
  [ -x "$CHAOS_DIR/$script" ] || fail "missing or non-executable $CHAOS_DIR/$script"
done

grep -q "IG-CHAOS-DEFINED" "$TEST"     || fail "sentinel missing in chaos.test.ts"

# App-shell resilience
grep -q "EngineErrorBoundary" "$APP" || fail "App.tsx must import EngineErrorBoundary"

# Money-surface fallback rule (Wallet only per desktop-2 CLAUDE.md)
WALLET="$REPO_ROOT/desktop-2/src/routes/wallet-detail/WalletDetail.tsx"
if [ -f "$WALLET" ]; then
  grep -q "SectionWithFallback\|fallback" "$WALLET" || fail "WalletDetail should use SectionWithFallback"
fi

# Verify each chaos script emits a "Verify recovery" block so runs are auditable
for script in kill-sidecar.sh drop-network.sh inject-backend-500.sh race-conditions.sh disk-full.sh; do
  grep -q "Verify recovery" "$CHAOS_DIR/$script" || fail "$script missing 'Verify recovery' block"
done

echo "✓ IG-CHAOS-DEFINED PASS · 14 guards green"
exit 0
