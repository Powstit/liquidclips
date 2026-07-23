#!/usr/bin/env bash
# IG-CHAOS-DEFINED · Chaos experiment · SIGKILL the Python sidecar.
# Verifies the app recovers gracefully when the sidecar dies mid-run.
#
# Expected behaviour after this script:
#   · in-flight sidecar request errors with a user-visible retry toast
#   · new sidecar spawn is triggered by the next request
#   · EngineErrorBoundary DOES NOT surface (this is a recoverable error)
#   · sloSnapshot().errorRate ticks up but stays under the SLO for 1 kill

set -euo pipefail
echo "→ Chaos: kill Python sidecar"
pids=$(pgrep -f "sidecar\.py\|liquid_clips_sidecar" 2>/dev/null || true)
if [ -z "$pids" ]; then
  echo "  ⚠ no sidecar process found — nothing to kill"
  exit 0
fi
echo "  targets: $pids"
for pid in $pids; do
  kill -9 "$pid" 2>/dev/null || true
  echo "  ✓ killed $pid"
done
echo ""
echo "→ Verify recovery:"
echo "  1. Open the app · trigger any sidecar-backed action (clip, trim, caption)"
echo "  2. Expect a retry toast · NOT the EngineErrorBoundary card"
echo "  3. Second attempt should succeed with a fresh sidecar spawn"
