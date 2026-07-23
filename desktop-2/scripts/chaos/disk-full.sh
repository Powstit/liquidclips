#!/usr/bin/env bash
# IG-CHAOS-DEFINED · Chaos experiment · consume /tmp until N MB free.
# Verifies the app tolerates disk pressure (clip export writes to /tmp).

set -euo pipefail
target_mb="${1:-800}"
sentinel="/tmp/lc-chaos-disk-full-sentinel.bin"
echo "→ Chaos: allocate ${target_mb} MB to $sentinel"

dd if=/dev/zero of="$sentinel" bs=1m count="$target_mb" 2>&1 | tail -1
df -h /tmp | tail -1

echo ""
echo "→ Verify recovery:"
echo "  1. Trigger a clip export from the app · expect graceful ENOSPC error"
echo "  2. App does NOT crash · error boundary is NOT tripped"
echo "  3. User sees actionable copy: 'Free disk space and try again.'"
echo ""
echo "→ Cleanup when done:"
echo "  rm -f $sentinel && df -h /tmp"
