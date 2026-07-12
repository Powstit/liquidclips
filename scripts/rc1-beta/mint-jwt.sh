#!/usr/bin/env bash
# scripts/rc1-beta/mint-jwt.sh
#
# Mint a Liquid Clips license JWT via /desktop/connect using INTERNAL_API_SECRET.
# Used by native-walk-prep Playwright specs and by hand for manual walks.
#
# Env:
#   INTERNAL_API_SECRET  · required · from ~/.claude-credentials/junior-internal.env
#   LC_BACKEND           · optional · default http://localhost:8000
#
# Args:
#   $1  clerk_user_id   · required · e.g. user_walk_j005_1234
#   $2  email           · optional · default derived from clerk_user_id
#   $3  challenge       · optional · default ch_lcos_walk
#
# Outputs:
#   Prints the license_jwt on stdout on success.
#   Non-zero exit + error to stderr on failure.
#
# Read-only side effects on the backend (writes a users row for the clerk_user_id).
# Idempotent: repeat calls for the same clerk_user_id return a fresh JWT for the
# same user row.

set -euo pipefail

CLERK_USER_ID="${1:-}"
EMAIL="${2:-}"
CHALLENGE="${3:-ch_lcos_walk}"

if [[ -z "${CLERK_USER_ID}" ]]; then
  echo "usage: $0 <clerk_user_id> [email] [challenge]" >&2
  echo "  clerk_user_id  e.g.  user_walk_j005_$(date +%s)" >&2
  exit 2
fi

if [[ -z "${INTERNAL_API_SECRET:-}" ]]; then
  # Try to source from credentials file
  if [[ -f "${HOME}/.claude-credentials/junior-internal.env" ]]; then
    # shellcheck disable=SC1091
    source "${HOME}/.claude-credentials/junior-internal.env"
  fi
fi

if [[ -z "${INTERNAL_API_SECRET:-}" ]]; then
  echo "error: INTERNAL_API_SECRET not set and ~/.claude-credentials/junior-internal.env not found" >&2
  exit 3
fi

if [[ -z "${EMAIL}" ]]; then
  EMAIL="${CLERK_USER_ID}@walk.local"
fi

LC_BACKEND="${LC_BACKEND:-http://localhost:8000}"

BODY=$(cat <<EOF
{
  "clerk_user_id": "${CLERK_USER_ID}",
  "challenge": "${CHALLENGE}",
  "email": "${EMAIL}",
  "first_name": "LCOS"
}
EOF
)

RESPONSE=$(curl -sS -X POST "${LC_BACKEND}/desktop/connect" \
  -H "content-type: application/json" \
  -H "x-internal-secret: ${INTERNAL_API_SECRET}" \
  -d "${BODY}")

# Extract license_jwt via jq if available, else grep
if command -v jq >/dev/null 2>&1; then
  JWT=$(echo "${RESPONSE}" | jq -r '.license_jwt // empty')
else
  JWT=$(echo "${RESPONSE}" | grep -o '"license_jwt":"[^"]*"' | cut -d'"' -f4)
fi

if [[ -z "${JWT}" ]]; then
  echo "error: no license_jwt in response" >&2
  echo "response: ${RESPONSE}" >&2
  exit 4
fi

echo "${JWT}"
