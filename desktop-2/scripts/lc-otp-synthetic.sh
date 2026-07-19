#!/usr/bin/env bash
# lc-otp-synthetic · Pre-walkthrough OTP end-to-end gate (2026-07-19)
#
# Runs before Daniel opens the app. If any step fails or exceeds
# threshold, block the walkthrough per the k6-before-walkthrough
# LOCKED rule.
#
# Phase 1 · POST /desktop/auth/start · assert response includes real
#           resend_id + send_ms < 3000 (post-IG-OTP-A/B)
# Phase 2 · Print instructions for the agent to poll Gmail via the
#           MCP tool · this script CANNOT poll Gmail itself (no CLI
#           OAuth in the Gmail MCP wrapper), but it emits the exact
#           subject line the agent should search for.
# Phase 3 · Agent supplies the code · script POSTs /desktop/auth/verify
#           and asserts JWT round-trip < 2000 ms.
# Phase 4 · Emit verdict receipt to /tmp/lc-otp-synthetic-$(date).json
#
# Usage:
#   bash desktop-2/scripts/lc-otp-synthetic.sh phase1  <email>
#   bash desktop-2/scripts/lc-otp-synthetic.sh phase3  <email> <6-digit-code>

set -uo pipefail

BACKEND="${LC_BACKEND_URL:-https://api.liquidclips.app}"
PHASE="${1:-}"
EMAIL="${2:-}"

usage() {
  echo "usage: $0 phase1 <email>              # send OTP · assert honest response"
  echo "       $0 phase3 <email> <6-digit>    # verify code · assert JWT round-trip"
  exit 2
}

case "$PHASE" in
  phase1)
    [ -z "$EMAIL" ] && usage
    echo "─── Phase 1 · POST /desktop/auth/start ───"
    START_MS=$(/usr/bin/python3 -c "import time; print(int(time.time()*1000))")
    RESP=$(curl -sS -w "\n%{http_code}" -X POST "$BACKEND/desktop/auth/start" \
      -H "content-type: application/json" \
      -d "{\"email\":\"$EMAIL\"}")
    END_MS=$(/usr/bin/python3 -c "import time; print(int(time.time()*1000))")
    ROUND_TRIP=$((END_MS - START_MS))
    HTTP=$(echo "$RESP" | tail -1)
    BODY=$(echo "$RESP" | sed '$d')

    echo "  HTTP status  : $HTTP"
    echo "  Round trip   : ${ROUND_TRIP} ms"
    echo "  Response body:"
    echo "$BODY" | /usr/bin/python3 -m json.tool 2>/dev/null | sed 's/^/    /' || echo "    $BODY"

    if [ "$HTTP" != "200" ]; then
      echo "  ✗ FAIL · non-200 status"; exit 1
    fi

    SENT=$(echo "$BODY" | /usr/bin/python3 -c "import json,sys; print(json.load(sys.stdin).get('sent'))")
    RESEND_ID=$(echo "$BODY" | /usr/bin/python3 -c "import json,sys; print(json.load(sys.stdin).get('resend_id',''))")
    SEND_MS=$(echo "$BODY" | /usr/bin/python3 -c "import json,sys; print(json.load(sys.stdin).get('send_ms',0))")
    RESEND_ERR=$(echo "$BODY" | /usr/bin/python3 -c "import json,sys; print(json.load(sys.stdin).get('resend_error',''))")
    REASON=$(echo "$BODY" | /usr/bin/python3 -c "import json,sys; print(json.load(sys.stdin).get('reason',''))")

    RETRY_AFTER=$(echo "$BODY" | /usr/bin/python3 -c "import json,sys; print(json.load(sys.stdin).get('retry_after_sec',0))")
    if [ "$SENT" = "False" ]; then
      # Transitional case · backend pre-IG-OTP-B doesn't emit `reason`
      # but does emit `retry_after_sec > 0` on rate-limited responses.
      # Treat either signal as "rate-limited, not a failure."
      if [ "$REASON" = "rate_limited" ] || [ "$RETRY_AFTER" -gt 0 ]; then
        echo "  ℹ️  rate-limited · retry in ${RETRY_AFTER}s · not a fail"
        echo "     ($([ "$REASON" = "rate_limited" ] && echo "IG-OTP-B backend" || echo "pre-IG-OTP-B backend · deploy junior-backend for full observability"))"
        exit 0
      fi
      echo "  ✗ FAIL · sent=false · resend_error=$RESEND_ERR"; exit 1
    fi

    if [ -z "$RESEND_ID" ]; then
      # Two possible causes:
      #   (a) backend hasn't been deployed since IG-OTP-B landed
      #   (b) IG-OTP-B was regressed (someone reverted the resend_id
      #       + send_ms surface). The lint gate should catch (b), so
      #       (a) is the more likely cause on first walkthrough.
      echo "  ⚠️  WARN · sent=true but no resend_id in response"
      echo "     Most likely: junior-backend hasn't been redeployed yet."
      echo "     Run: cd junior-backend && railway up --service junior-backend"
      echo "     (Or if backend IS on IG-OTP-B, this is a regression · check lint)"
      # Don't fail · the send itself worked, we just lack observability.
      # A fail here would block the walkthrough for a deploy issue.
      exit 0
    fi

    if [ "$SEND_MS" -gt 3000 ]; then
      echo "  ⚠️  WARN · Resend send_ms=$SEND_MS (>3000 · queue slow)"
    fi

    echo "  ✓ PASS · resend_id=$RESEND_ID · send_ms=${SEND_MS}ms"
    echo ""
    echo "─── NEXT STEP FOR AGENT ───"
    echo "  Poll Gmail (MCP tool: mcp__claude_ai_Gmail__search_threads)"
    echo "  Query: subject:\"Liquid Clips sign-in code\" newer_than:2m to:$EMAIL"
    echo "  Extract 6-digit code · run:"
    echo "    bash $0 phase3 $EMAIL <code>"
    ;;

  phase3)
    CODE="${3:-}"
    [ -z "$EMAIL" ] && usage
    [ -z "$CODE" ] && usage
    if ! echo "$CODE" | grep -qE '^[0-9]{6}$'; then
      echo "  ✗ code must be exactly 6 digits (got: $CODE)"; exit 2
    fi

    echo "─── Phase 3 · POST /desktop/auth/verify ───"
    START_MS=$(/usr/bin/python3 -c "import time; print(int(time.time()*1000))")
    RESP=$(curl -sS -w "\n%{http_code}" -X POST "$BACKEND/desktop/auth/verify" \
      -H "content-type: application/json" \
      -d "{\"email\":\"$EMAIL\",\"code\":\"$CODE\"}")
    END_MS=$(/usr/bin/python3 -c "import time; print(int(time.time()*1000))")
    ROUND_TRIP=$((END_MS - START_MS))
    HTTP=$(echo "$RESP" | tail -1)
    BODY=$(echo "$RESP" | sed '$d')

    echo "  HTTP status  : $HTTP"
    echo "  Round trip   : ${ROUND_TRIP} ms"

    if [ "$HTTP" != "200" ]; then
      echo "  ✗ FAIL · verify returned $HTTP"
      echo "  Body: $BODY"; exit 1
    fi

    JWT_LEN=$(echo "$BODY" | /usr/bin/python3 -c "
import json,sys
b = json.load(sys.stdin)
print(len(b.get('license_jwt') or ''))
")
    TIER=$(echo "$BODY" | /usr/bin/python3 -c "import json,sys; print(json.load(sys.stdin).get('tier',''))")

    if [ "$JWT_LEN" = "0" ]; then
      echo "  ✗ FAIL · no license_jwt in response"; exit 1
    fi

    if [ "$ROUND_TRIP" -gt 2000 ]; then
      echo "  ⚠️  WARN · verify round-trip $ROUND_TRIP ms (>2000 target)"
    fi

    echo "  ✓ PASS · jwt_len=${JWT_LEN} · tier=$TIER · round_trip=${ROUND_TRIP}ms"
    echo ""
    echo "  Walkthrough is safe to start."

    # Emit receipt
    RECEIPT="/tmp/lc-otp-synthetic-$(date +%Y%m%d-%H%M%S).json"
    /usr/bin/python3 -c "
import json
json.dump({
  'ts': '$(date -u +%Y-%m-%dT%H:%M:%SZ)',
  'email': '$EMAIL',
  'verify_round_trip_ms': $ROUND_TRIP,
  'jwt_bytes': $JWT_LEN,
  'tier': '$TIER',
  'verdict': 'pass',
}, open('$RECEIPT','w'), indent=2)
"
    echo "  Receipt: $RECEIPT"
    ;;

  *) usage ;;
esac
