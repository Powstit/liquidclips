#!/usr/bin/env bash
# IRON GATE IG-014-C · prod-build env guard · LOCKED 2026-07-18
#
# Prevent dev URLs from being baked into a stable runtime bundle.
# LOCKED 2026-07-18 after the v2.2.36 bundle shipped with
# VITE_BACKEND_URL=http://localhost:8000 hardcoded, breaking every
# user's login attempt.
#
# Sibling of IG-014-B (session-reset regression guard in
# desktop-2/src/lib/authStorage.ts). IG-014-B locks the runtime
# recovery path; IG-014-C locks the build-time URL surface so a stale
# shell env var cannot inject dev URLs into a stable bundle.
#
# Usage:
#   ./scripts/assert-prod-build-env.sh <channel>
#
# Exits:
#   0 · channel is non-stable OR all VITE_* URLs are unset/prod-safe
#   1 · at least one VITE_* URL points to a non-production value

set -uo pipefail
CHANNEL="${1:-stable}"
if [ "$CHANNEL" != "stable" ]; then
  echo "assert-prod-build-env: channel=$CHANNEL · skipping (dev/beta may use overrides)"
  exit 0
fi
fail=0
check() {
  local var="$1" allowed="$2"
  local val="${!var:-<UNSET>}"
  if [ "$val" = "<UNSET>" ]; then return; fi
  if [ "$val" != "$allowed" ]; then
    echo "✗ $var=$val · must be unset or $allowed for stable channel"
    fail=1
  else
    echo "✓ $var=$val"
  fi
}
check VITE_BACKEND_URL "https://api.liquidclips.app"
check VITE_ACCOUNT_APP_URL "https://account.liquidclips.app"
check VITE_MARKETING_URL "https://liquidclips.app"
if [ "$fail" -ne 0 ]; then
  echo ""
  echo "One or more dev URLs would be baked into the stable runtime bundle."
  echo "unset the offending vars and re-run runtime-ship.sh."
  exit 1
fi
echo "assert-prod-build-env: clean · safe to build stable bundle"
