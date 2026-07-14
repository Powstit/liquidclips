#!/usr/bin/env bash
# scripts/rc1-beta/seed-fresh-user.sh
#
# Seed a clean Liquid Clips user via /desktop/connect + return the JWT.
# Wraps mint-jwt.sh with the walk-standard clerk_user_id + email pattern so
# every native-walk-prep spec + every manual walker produces the same shape.
#
# Env:
#   INTERNAL_API_SECRET · required (via mint-jwt.sh)
#   LC_BACKEND          · optional · default http://localhost:8000
#
# Args:
#   $1  journey_id      · required · e.g. j004 · j005 · j006 · j007 · j015
#   $2  suffix          · optional · default $(date +%s) so each run is fresh
#
# Outputs:
#   Two lines on stdout:
#     LC_CLERK_USER_ID=user_walk_<journey>_<suffix>
#     LC_JWT=<jwt>
#
# Also writes both values to /tmp/lc-walk-<journey>-<suffix>.env for later
# scripts (reset-test-env.sh · Playwright harness) to source.

set -euo pipefail

JOURNEY="${1:-}"
SUFFIX="${2:-$(date +%s)}"

if [[ -z "${JOURNEY}" ]]; then
  echo "usage: $0 <journey_id> [suffix]" >&2
  echo "  journey_id  one of j004 · j005 · j006 · j007 · j015" >&2
  exit 2
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CLERK_USER_ID="user_walk_${JOURNEY}_${SUFFIX}"
EMAIL="walk+${JOURNEY}+${SUFFIX}@lcos.local"

JWT=$("${HERE}/mint-jwt.sh" "${CLERK_USER_ID}" "${EMAIL}")

if [[ -z "${JWT}" ]]; then
  echo "error: mint-jwt.sh returned empty JWT" >&2
  exit 3
fi

ENV_FILE="/tmp/lc-walk-${JOURNEY}-${SUFFIX}.env"
{
  echo "LC_CLERK_USER_ID=${CLERK_USER_ID}"
  echo "LC_JWT=${JWT}"
  echo "LC_JOURNEY=${JOURNEY}"
  echo "LC_SUFFIX=${SUFFIX}"
  echo "LC_EMAIL=${EMAIL}"
} > "${ENV_FILE}"
chmod 600 "${ENV_FILE}"

echo "LC_CLERK_USER_ID=${CLERK_USER_ID}"
echo "LC_JWT=${JWT}"
echo "# env file: ${ENV_FILE}" >&2
