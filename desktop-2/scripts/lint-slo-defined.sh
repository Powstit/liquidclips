#!/usr/bin/env bash
# IG-SLO-DEFINED · Reliability Sprint L5 · Service Level Objectives.
# Guards that:
#   · slo.ts exists + defines the 3 canonical SLO targets
#   · slo.test.ts exists with regression coverage
#   · sloSink is registered in bootstrap.ts
#   · SLO targets match the Reliability Sprint spec
#
# 2026-07-22 · Reliability Sprint · Layer 5
set -euo pipefail
REPO_ROOT="$( cd "$(/usr/bin/dirname "$0")/../.." && /bin/pwd )"
SLO="$REPO_ROOT/desktop-2/src/lib/telemetry/slo.ts"
TEST="$REPO_ROOT/desktop-2/src/lib/telemetry/slo.test.ts"
SINK="$REPO_ROOT/desktop-2/src/lib/telemetry/sinks/sloSink.ts"
BOOT="$REPO_ROOT/desktop-2/src/lib/telemetry/bootstrap.ts"
fail() { echo "✗ $1" >&2; exit 1; }

[ -f "$SLO" ]  || fail "missing $SLO"
[ -f "$TEST" ] || fail "missing $TEST"
[ -f "$SINK" ] || fail "missing $SINK"
[ -f "$BOOT" ] || fail "missing $BOOT"

grep -q "IG-SLO-DEFINED" "$SLO"  || fail "sentinel missing in slo.ts"
grep -q "IG-SLO-DEFINED" "$SINK" || fail "sentinel missing in sloSink.ts"

grep -qE 'errorRateMax:\s*0\.01' "$SLO"         || fail "errorRateMax must be 0.01"
grep -qE 'crashFreeSessionMin:\s*0\.995' "$SLO" || fail "crashFreeSessionMin must be 0.995"
grep -qE 'p95LatencyMsMax:\s*2000' "$SLO"       || fail "p95LatencyMsMax must be 2000"
grep -q "Object.freeze" "$SLO"                  || fail "SLO_TARGETS must be Object.freeze'd"

grep -q "registerSink(sloSink)" "$BOOT" || fail "sloSink not registered in bootstrap.ts"

grep -q "sloSnapshot" "$TEST" || fail "slo.test.ts missing sloSnapshot regression"
grep -q "SLO_TARGETS" "$TEST" || fail "slo.test.ts missing SLO_TARGETS assertion"

echo "✓ IG-SLO-DEFINED PASS · 10 guards green"
exit 0
