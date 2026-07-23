#!/usr/bin/env bash
# IG-CHAOS-DEFINED · Chaos experiment · block backend for 30s.
# Verifies the app tolerates a transient network outage without
# corrupting local state or crash-looping.
#
# Uses pfctl (macOS packet filter) so no root outside the sudo prompt.

set -euo pipefail
duration="${1:-30}"
target_port="${2:-8000}"
echo "→ Chaos: drop network to localhost:$target_port for ${duration}s"

echo "block drop out proto tcp from any to 127.0.0.1 port $target_port" | \
  sudo pfctl -a com.liquidclips.chaos -f - 2>&1 | grep -v "pfctl: enable" || true
sudo pfctl -a com.liquidclips.chaos -e 2>&1 | grep -v "pfctl: enable" || true

echo "  ⚠ port $target_port blocked · countdown ${duration}s"
for i in $(seq "$duration" -1 1); do
  printf "\r  %ds  " "$i"
  sleep 1
done
echo ""

sudo pfctl -a com.liquidclips.chaos -F all 2>&1 | grep -v "pfctl:" || true
echo "  ✓ network restored"
echo ""
echo "→ Verify recovery:"
echo "  1. During block: app shows retry toast · queued requests · not crash"
echo "  2. After restore: queued requests complete · SLO breach transient"
echo "  3. sloSnapshot().breaches should be empty within 60s"
