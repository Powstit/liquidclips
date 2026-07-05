#!/usr/bin/env bash
# scripts/audit-gate.sh · 2.2.24 · single-call ship gate.
#
# Run BEFORE any deploy. Fetches /audit/state from the backend and
# refuses to ship if any critical journey has flipped red, any backend
# probe is down, or any integration is unreachable.
#
# Wired into desktop/scripts/ship.sh as the first check. Also
# invokable ad-hoc:
#
#   bash desktop-2/scripts/audit-gate.sh
#
# Exit codes:
#   0 · audit says ok=true  · safe to ship
#   1 · audit says ok=false · blocking_findings printed
#   2 · audit endpoint unreachable · treat as blocked
#
# Override the backend URL for staging:
#   AUDIT_BASE_URL=https://staging.jnremployee.com bash audit-gate.sh

set -euo pipefail

BASE_URL="${AUDIT_BASE_URL:-https://api.jnremployee.com}"
AUDIT_URL="${BASE_URL%/}/audit/state"

echo "[audit-gate] Fetching ${AUDIT_URL}"

# 10s timeout · the endpoint should return in < 1s in practice.
if ! response=$(curl -sSf --max-time 10 "$AUDIT_URL" 2>&1); then
  echo "[audit-gate] BLOCK · audit endpoint unreachable"
  echo "$response"
  exit 2
fi

# Require jq for the exit-code branch. If missing, hard fail so we
# don't accidentally ship on a syntax-error response.
if ! command -v jq &> /dev/null; then
  echo "[audit-gate] BLOCK · jq not installed (brew install jq)"
  exit 2
fi

ok=$(echo "$response" | jq -r '.ok')

if [ "$ok" != "true" ]; then
  echo "[audit-gate] BLOCK · audit reports ok=false"
  echo "---"
  echo "$response" | jq '.blocking_findings'
  echo "---"
  echo "Full state at: $AUDIT_URL"
  exit 1
fi

timestamp=$(echo "$response" | jq -r '.timestamp')
ticks_last_hour=$(echo "$response" | jq -r '.gates.activity.ticks_last_hour')
echo "[audit-gate] PASS · timestamp=${timestamp} · activity=${ticks_last_hour} ticks/hr"
exit 0
