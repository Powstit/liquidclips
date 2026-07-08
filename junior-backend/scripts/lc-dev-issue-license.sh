#!/usr/bin/env bash
# lc-dev-issue-license · P0 first-run access · 2026-07-08
#
# Ops-only bypass for local/dev/staging: mint a Liquid Clips license
# JWT for an existing admin email (Daniel) without going through
# Clerk OTP. Not a customer path · admin allowlist gated inside the
# backend.
#
# Prereqs:
#   - `INTERNAL_API_SECRET` in ~/.claude-credentials/junior-internal.env
#   - `LC_DEV_ISSUE_LICENSE_ENABLED=1` set on the backend env you hit.
#     Ships DISABLED in prod · flip on in Railway dashboard to onboard
#     an admin laptop, flip off after.
#
# Usage:
#   scripts/lc-dev-issue-license.sh --email daniel@example.com
#   scripts/lc-dev-issue-license.sh --email daniel@example.com --backend https://api.jnremployee.com
#
# Prints the LC JWT once. Never store it in a file. Type or paste it
# into the app's "recovery" field · Watchdog picks it up + the shell
# opens.
set -euo pipefail

EMAIL=""
BACKEND="${LC_BACKEND_URL:-https://api.jnremployee.com}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --email) EMAIL="$2"; shift 2 ;;
    --backend) BACKEND="$2"; shift 2 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$EMAIL" ]]; then
  echo "usage: $0 --email <address> [--backend <url>]" >&2
  exit 2
fi

if [[ -f "$HOME/.claude-credentials/junior-internal.env" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/.claude-credentials/junior-internal.env"
fi

if [[ -z "${INTERNAL_API_SECRET:-}" ]]; then
  echo "INTERNAL_API_SECRET not set · source ~/.claude-credentials/junior-internal.env first" >&2
  exit 3
fi

RESPONSE=$(
  curl -sS -X POST "$BACKEND/admin/dev-issue-license" \
    -H "content-type: application/json" \
    -H "x-internal-secret: $INTERNAL_API_SECRET" \
    -d "{\"email\":\"$EMAIL\"}"
)

LICENSE=$(printf '%s' "$RESPONSE" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("license_jwt",""))')
USER_ID=$(printf '%s' "$RESPONSE" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("user_id",""))')
TIER=$(printf '%s' "$RESPONSE" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tier",""))')
EXP=$(printf '%s' "$RESPONSE" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("expires_at",""))')

if [[ -z "$LICENSE" ]]; then
  echo "dev-issue-license failed · response:" >&2
  echo "$RESPONSE" >&2
  exit 4
fi

echo "email:      $EMAIL"
echo "user_id:    $USER_ID"
echo "tier:       $TIER"
echo "expires_at: $EXP"
echo
echo "LC JWT (paste into the app's recovery field):"
echo
echo "$LICENSE"
echo
echo "· valid until $EXP · treat as a password · do not commit or share"
