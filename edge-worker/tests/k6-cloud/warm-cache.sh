#!/usr/bin/env bash
#
# Pre-warm the two read routes' Cache API + KV layers BEFORE the main
# distributed k6 tests. Hits each Cloudflare edge from a wide handful
# of vantage points so the first k6 request from any of the 5 test
# regions gets a HIT, not a cold ORIGIN.
#
# Usage:
#   ./warm-cache.sh https://liquid-clips-edge.liquidclips.workers.dev
#
# Runs ~90s. Uses curl locally; combined with the fact that Cloudflare
# hydrates KV globally within ~60s, one pass from each of five continents
# is enough. But since we can only curl from THIS Mac, we do 20 spaced
# hits so KV writes reach all edges via Cloudflare's normal propagation.

set -euo pipefail

BASE="${1:-https://liquid-clips-edge.liquidclips.workers.dev}"

echo "=== warming /audit/state ==="
for i in {1..20}; do
  CODE=$(/usr/bin/curl -sSo /dev/null -w "%{http_code}" "$BASE/audit/state" || echo "err")
  CACHE=$(/usr/bin/curl -sSD /tmp/_h.txt -o /dev/null "$BASE/audit/state" 2>&1)
  H=$(grep -i "x-lc-edge-cache" /tmp/_h.txt | tr -d '\r')
  echo "  hit $i: $CODE · $H"
  sleep 3
done

echo ""
echo "=== warming /hq/carousel/clips ==="
for i in {1..20}; do
  CODE=$(/usr/bin/curl -sSo /dev/null -w "%{http_code}" "$BASE/hq/carousel/clips" || echo "err")
  CACHE=$(/usr/bin/curl -sSD /tmp/_h.txt -o /dev/null "$BASE/hq/carousel/clips" 2>&1)
  H=$(grep -i "x-lc-edge-cache" /tmp/_h.txt | tr -d '\r')
  echo "  hit $i: $CODE · $H"
  sleep 3
done

echo ""
echo "=== warm complete · L1 (Cache API) primed for LHR edge · L2 (KV) propagating globally ==="
echo "Cloudflare KV typically reaches all edges in <60s from first write."
echo "Wait 60s after this script exits before starting the distributed k6 run."
